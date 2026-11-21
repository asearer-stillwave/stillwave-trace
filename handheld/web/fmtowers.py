"""Trace 1.3.6 FM tower sites for the map (GET /api/fm/towers).
Reads the FCC FM table of the station bank (/var/lib/sdr/bank/stations.sqlite, table fm). Licensed stations whose
transmitters are within 2.5 km of each other are merged into one site:
  19 stations on Mt Wilson -> "MT WILSON · 19 FM";  2-4 -> "KCRW / KYSR";  1 -> "KLAX 97.9".
Query: ?bbox=W,S,E,N  or  ?lat=..&lon=..[&r_km=150]  (default: 150 km around the map's built-in centre, LA).
A missing or damaged bank answers an empty list. Receive only."""
import math, os, sqlite3

BANK_DB = os.environ.get("SDR_BANK_DB", "/var/lib/sdr/bank/stations.sqlite")
MERGE_KM = 2.5
MAX_SITES = 400
# a few well-known shared broadcast sites, so the big ones read as a place, not as a list of call signs
KNOWN = [("MT WILSON", 34.2258, -118.0664), ("MT LEE", 34.1350, -118.3194), ("SUTRO TOWER", 37.7552, -122.4528),
         ("MT SAN BRUNO", 37.6869, -122.4344), ("SANDIA CREST", 35.2139, -106.4497), ("MT SOLEDAD", 32.8397, -117.2442),
         ("SOUTH MTN", 33.3336, -112.0636), ("WHITE MTN", 33.6900, -117.0700), ("SIERRA PEAK", 33.8550, -117.6489)]


def km(a, b, c, d):
    r = math.pi / 180
    h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _bbox(args):
    if args.get("bbox"):
        w, s, e, n = (float(x) for x in str(args["bbox"]).split(","))
        if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= s < n <= 90): raise ValueError("bbox")
        return w, s, e, n
    lat = float(args.get("lat", 34.05)); lon = float(args.get("lon", -118.25)); r = min(600.0, max(1.0, float(args.get("r_km", 150))))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180): raise ValueError("lat/lon")
    dl = r / 111.0; dn = r / (111.0 * max(0.05, math.cos(math.radians(lat))))
    return lon - dn, lat - dl, lon + dn, lat + dl


def label(site):
    st = site["stations"]; n = len(st)
    if n >= 5:
        return (site.get("name") or (st[0]["city"] or "FM SITE").upper()) + " · %d FM" % n
    if n > 1: return " / ".join(x["call"] for x in st)
    return "%s %.1f" % (st[0]["call"], st[0]["mhz"])


def towers(args, db=None):
    db = db or BANK_DB
    w, s, e, n = _bbox(args)
    if not os.path.isfile(db): return {"ok": True, "towers": [], "count": 0, "bank": False}
    try:
        c = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=3)
        rows = c.execute("SELECT call, mhz, city, state, lat, lon, erp_kw, haat_m FROM fm WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?"
                         " AND (status IS NULL OR status = 'LIC') AND lat IS NOT NULL AND lon IS NOT NULL AND mhz BETWEEN 87.5 AND 108.1",
                         (s, n, w, e)).fetchall()
        c.close()
    except sqlite3.Error:
        return {"ok": True, "towers": [], "count": 0, "bank": False}
    st = [{"call": (r[0] or "").split("-")[0], "mhz": round(float(r[1]), 1), "city": (r[2] or "").title(), "state": r[3] or "",
           "lat": float(r[4]), "lon": float(r[5]), "erp_kw": r[6], "haat_m": r[7]} for r in rows]
    st.sort(key=lambda x: -(x["erp_kw"] or 0))
    sites = []
    for x in st:                                   # greedy: join the first site within 2.5 km of its anchor
        for t in sites:
            if km(t["lat0"], t["lon0"], x["lat"], x["lon"]) <= MERGE_KM: t["stations"].append(x); break
        else: sites.append({"lat0": x["lat"], "lon0": x["lon"], "stations": [x]})
    out = []
    for t in sites:
        ss = sorted(t["stations"], key=lambda x: x["mhz"])
        lat = sum(x["lat"] for x in ss) / len(ss); lon = sum(x["lon"] for x in ss) / len(ss)
        site = {"lat": round(lat, 5), "lon": round(lon, 5), "n": len(ss), "stations": ss, "name": None}
        for nm_, a, b in KNOWN:
            if km(lat, lon, a, b) <= 4.0: site["name"] = nm_; break
        site["label"] = label(site)
        out.append(site)
    out.sort(key=lambda t: (-t["n"], -max((x["erp_kw"] or 0) for x in t["stations"])))
    out = out[:MAX_SITES]
    return {"ok": True, "towers": out, "count": len(out), "bank": True, "merge_km": MERGE_KM}
