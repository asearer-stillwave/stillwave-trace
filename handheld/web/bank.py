"""Trace 1.2.6 station bank queries (read-only SQLite at /var/lib/sdr/bank/stations.sqlite).
FM: FCC licensing data. Airband: FAA NASR 28-day subscription. Both US public domain. Receive only, not for navigation."""
import math, os, sqlite3, threading
import stationnames as SN

G = {"tower": "Tower", "ground": "Ground", "clearance": "Clearance", "atis": "ATIS", "approach": "Approach", "ctaf": "CTAF", "unicom": "UNICOM"}
ORDER = list(G)
_c = {"conn": None, "mtime": 0, "lock": threading.Lock()}


def db(path):
    try:
        mt = os.stat(path).st_mtime
    except OSError:
        return None
    with _c["lock"]:
        if _c["conn"] is None or _c["mtime"] != mt:
            try:
                if _c["conn"] is not None: _c["conn"].close()
            except Exception: pass
            _c["conn"] = sqlite3.connect("file:%s?mode=ro" % path, uri=True, check_same_thread=False); _c["mtime"] = mt
        return _c["conn"]


def mi(a, b, c, d):
    r = math.pi / 180; x = (d - b) * r * math.cos((a + c) / 2 * r); y = (c - a) * r
    return math.hypot(x, y) * 3958.8


def new_bank(c):
    """True for a 1.2.9+ bank (format 2: tidy names + short columns). Older banks are fixed up per row below."""
    try: return any(r[1] == "short" for r in c.execute("pragma table_info(airport)"))
    except sqlite3.Error: return False


def fix(c, L):
    """Short names + tidy casing for every row (precomputed in format 2, computed here for older banks)."""
    old = not new_bank(c)
    for r in L:
        if old:
            for k in ("city", "name"):
                if r.get(k): r[k] = SN.tidy(r[k])
            if r.get("label"): r["label"] = SN.expand_label(r["label"])
        if "name" in r and not r.get("short"): r["short"] = SN.apt_short(r["name"], r.get("city", ""))
        if r.get("grp") and (r.get("icao") or r.get("id")): r["pname"] = SN.preset_name(r.get("icao") or r.get("id"), r["grp"], r.get("label", ""))
    return L


def rows(c, sql, *a):
    cur = c.execute(sql, a); k = [x[0] for x in cur.description]; return fix(c, [dict(zip(k, r)) for r in cur])


def apt_freqs(c, aid, code=None):
    f = rows(c, "select grp,mhz,label%s from afreq where apt=? order by mhz" % (",short" if new_bank(c) else ""), aid)
    for x in f:
        if not x.get("short"): x["short"] = SN.preset_name(code or aid, x["grp"], x["label"])
    return sorted(f, key=lambda x: ORDER.index(x["grp"]) if x["grp"] in ORDER else 99)


def airport(c, ident):
    ident = (ident or "").strip().upper()
    a = rows(c, "select * from airport where id=? or icao=? limit 1", ident, ident)
    if not a: return None
    a = a[0]; a["freqs"] = apt_freqs(c, a["id"], a["icao"] or a["id"])
    a["runways_deg"] = [r[0] for r in c.execute("select hdg from runway where apt=? order by hdg", (a["id"],))]
    return a


def focus_shape(a):
    """An airport in the 1.2.5 /api/airports shape (airmap.js)."""
    code = a["icao"] or a["id"]; gs = []
    for g in ("tower", "ground", "approach", "atis", "ctaf", "unicom", "clearance"):
        fr = []
        for f in a["freqs"]:
            if f["grp"] != g: continue
            fr.append({"mhz": f["mhz"], "name": f["short"], "heli": "Heli" in (f["label"] or ""), "lab": f["label"] or ""})
        fr.sort(key=lambda x: (x.pop("heli"), x["mhz"]))
        fr = fr[:6]
        for x, t in zip(fr, SN.quick_tags(g, [x.pop("lab") for x in fr])):   # 1.3.1 Quick Tune buttons: only what differs
            x["tag"] = t; x["name"] = code + " " + t
        if fr: gs.append({"id": g, "label": G[g], "freqs": fr})
    if not any(g["id"] == "tower" for g in gs) and gs:
        gs[0] = dict(gs[0], id="tower") if gs[0]["id"] in ("ctaf", "unicom") else gs[0]
    return {"icao": code, "name": a["name"], "lat": a["lat"], "lon": a["lon"], "zoom": 11.5 if a.get("towered") else 12.5,
            "runways_deg": a.get("runways_deg") or [], "groups": gs[:4], "source": "bank"}


def query(c, what, q):
    if what == "meta":
        m = dict(c.execute("select k,v from meta").fetchall())
        m["counts"] = {t: c.execute("select count(*) from %s" % t).fetchone()[0] for t in ("fm", "airport", "afreq")}
        return m
    if what == "states":
        t = "fm" if q.get("band") == "fm" else "airport"
        return {"states": rows(c, "select state, count(*) n from %s where state!='' group by state order by state" % t)}
    if what == "cities":
        return {"cities": rows(c, "select city, count(*) n from fm where state=? group by city order by n desc, city limit ?",
                               q.get("state", ""), min(200, int(q.get("limit") or 60)))}
    if what == "fm":
        return {"stations": rows(c, "select call,mhz,city,state,erp_kw from fm where state=? and city=? order by mhz", q.get("state", ""), q.get("city", ""))}
    if what == "airports":
        return {"airports": rows(c, "select id,icao,name,city,towered%s,(select count(*) from afreq where apt=id) nf from airport where state=? "
                                    "order by towered desc, name limit ? offset ?" % (",short" if new_bank(c) else ""), q.get("state", ""), min(200, int(q.get("limit") or 60)), int(q.get("offset") or 0))}
    if what == "airport":
        a = airport(c, q.get("id", ""))
        return a or {"error": "not found"}
    if what == "search":
        s = (q.get("q") or "").strip()[:40]; out = []
        if not s: return {"results": []}
        like = "%" + s + "%"
        try:
            f = float(s)
            out += [dict(r, kind="fm") for r in rows(c, "select call,mhz,city,state from fm where abs(mhz-?)<0.01 order by erp_kw desc limit 10", f)]
            out += [dict(r, kind="air") for r in rows(c, "select a.icao,a.id,a.name,a.city,a.state,f.grp,f.mhz from afreq f join airport a on a.id=f.apt "
                                                         "where abs(f.mhz-?)<0.003 order by a.towered desc, a.name limit 10", f)]
        except ValueError:
            u = s.upper()
            out += [dict(r, kind="air") for r in rows(c, "select icao,id,name,city,state,towered%s from airport where icao=? or id=? or name like ? or city like ? "
                                                         "order by (icao=? or id=?) desc, towered desc limit 8" % (",short" if new_bank(c) else ""), u, u, like, like, u, u)]
            out += [dict(r, kind="fm") for r in rows(c, "select call,mhz,city,state from fm where call like ? or city like ? order by erp_kw desc limit 8", u + "%", like)]
        return {"results": out}
    if what == "near":
        if q.get("zip"):
            z = rows(c, "select lat,lon from zip where zip=?", q["zip"].strip()[:5])
            if not z: return {"error": "unknown ZIP code"}
            lat, lon = z[0]["lat"], z[0]["lon"]
        else:
            lat, lon = float(q["lat"]), float(q["lon"])
        R = min(150.0, float(q.get("mi") or 30)); d = R / 69; dl = d / max(0.2, math.cos(math.radians(lat)))
        if q.get("band") == "fm":
            L = rows(c, "select call,mhz,city,state,lat,lon,erp_kw from fm where lat between ? and ? and lon between ? and ?", lat - d, lat + d, lon - dl, lon + dl)
        else:
            L = rows(c, "select id,icao,name,city,state,lat,lon,towered%s from airport where lat" % (",short" if new_bank(c) else "") + " between ? and ? and lon between ? and ?", lat - d, lat + d, lon - dl, lon + dl)
        for r in L: r["mi"] = round(mi(lat, lon, r["lat"], r["lon"]), 1)
        L = [r for r in L if r["mi"] <= R]
        if q.get("band") == "fm":
            L.sort(key=lambda r: r["mhz"])
        else:
            L.sort(key=lambda r: (-r["towered"], r["mi"]))
            for a in L[:int(q.get("limit") or 40)]:
                a["tw"] = next((f["mhz"] for f in apt_freqs(c, a["id"], a["icao"] or a["id"]) if f["grp"] in ("tower", "ctaf", "unicom") and "Heli" not in f["label"]), None)
        return {"home": {"lat": lat, "lon": lon, "zip": q.get("zip")}, "mi": R, "n": len(L), "items": L[:int(q.get("limit") or 40)]}
    return {"error": "unknown"}
