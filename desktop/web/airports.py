"""Trace 1.3.2 airport focus that follows the map.
US: FAA NASR frequencies from the station bank (bank.py). Europe: OurAirports public-domain data bundled as
airports_eu.json (scheduled-service large/medium airports, airband 118-137 MHz only). Nothing is ever invented:
an airport without published frequencies is listed (so the map can center on it) with quick=False, and the
Quick Tune sheet is not offered for it. Receive only, not for navigation.
API (GET /api/airports):
  ?lat=..&lon=..[&n=5]  -> airports near a point, nearest first, with nautical-mile distance
  ?id=KSFO | EGLL       -> one airport in the focus shape (groups of tagged frequencies, runway headings)
  (none)                -> the built-in KLAX file, as in 1.2.5
"""
import json, math, os
import bank as B
import stationnames as SN

BANK_DB = os.environ.get("SDR_BANK_DB", "/var/lib/sdr/bank/stations.sqlite")
_eu = {"d": None}


def nm(a, b, c, d):
    r = math.pi / 180; x = (d - b) * r * math.cos((a + c) / 2 * r); y = (c - a) * r
    return math.hypot(x, y) * 3440.065


def eu(root):
    if _eu["d"] is None:
        try: _eu["d"] = json.load(open(os.path.join(root, "airports_eu.json"), encoding="utf-8")).get("airports", [])
        except (OSError, ValueError): _eu["d"] = []
    return _eu["d"]


def eu_shape(a):
    gs = []
    for g in ("tower", "ground", "approach", "atis", "clearance"):
        fr = sorted({round(m, 3): l for k, m, l in a["f"] if k == g}.items())[:6]
        if not fr: continue
        tags = SN.quick_tags(g, [l for _, l in fr])
        gs.append({"id": g, "label": B.G[g], "freqs": [{"mhz": m, "tag": t, "name": a["icao"] + " " + t} for (m, _), t in zip(fr, tags)]})
    return {"icao": a["icao"], "name": a["name"], "lat": a["lat"], "lon": a["lon"], "zoom": 11.5, "runways_deg": [],
            "groups": gs[:4], "source": "ourairports"}


def _bank(path):
    try: return B.db(path)
    except Exception: return None


def near(c, root, lat, lon, n=5, radius=60.0):
    out = []
    if c is not None:
        d = radius / 60.0; dl = d / max(0.2, math.cos(math.radians(lat)))
        for r in c.execute("select id, icao, name, lat, lon, (select count(*) from afreq where apt=airport.id and grp in "
                           "('tower','ground','approach','atis')) nf from airport where lat between ? and ? and lon between ? and ? "
                           "and (towered=1 or nf>0)", (lat - d, lat + d, lon - dl, lon + dl)):
            out.append({"icao": r[1] or r[0], "name": SN.tidy(r[2] or ""), "lat": r[3], "lon": r[4], "quick": r[5] > 0, "src": "FAA"})
    for a in eu(root):
        if abs(a["lat"] - lat) < 2 and abs(a["lon"] - lon) < 3:
            out.append({"icao": a["icao"], "name": a["name"], "lat": a["lat"], "lon": a["lon"], "quick": bool(a["f"]), "src": "OurAirports"})
    for a in out: a["nm"] = round(nm(lat, lon, a["lat"], a["lon"]), 1)
    out = [a for a in out if a["nm"] <= radius]
    out.sort(key=lambda a: a["nm"])
    return out[:n]


def one(c, root, ident):
    ident = (ident or "").strip().upper()
    if c is not None:
        a = B.airport(c, ident)
        if a: return B.focus_shape(a)
    for a in eu(root):
        if a["icao"] == ident: return eu_shape(a)
    return None


def api(q, root, bank_db=None, builtin=None):
    c = _bank(bank_db or BANK_DB)
    if q.get("lat") not in (None, "") and q.get("lon") not in (None, ""):
        lat, lon = float(q["lat"]), float(q["lon"])
        return {"ok": True, "near": near(c, root, lat, lon, max(1, min(10, int(q.get("n") or 5))))}
    ident = q.get("id")
    if ident:
        a = one(c, root, ident)
        if a: return {"ok": True, "airports": [a]}
    try: d = json.load(open(builtin or os.path.join(root, "..", "config", "airports.json")))
    except (OSError, ValueError): return {"ok": False, "airports": []}
    if ident:
        hit = [a for a in d.get("airports", []) if a.get("icao", "").upper() in (ident.upper(), "K" + ident.upper())]
        d = dict(d, airports=hit)
    return d
