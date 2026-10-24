#!/usr/bin/env python3
"""Stillwave Trace 1.2.6 station bank builder (runs on a build machine / home server, not on the radio).
Downloads FCC FM (fmq list=4) + FAA NASR 28-day FRQ/APT CSV, writes stations.sqlite.
Usage: build_bank.py [NASR_DATE e.g. 2026-10-01] [outdir]"""
import csv, io, re, sqlite3, sys, os, zipfile, urllib.request, datetime, json
OUT = sys.argv[2] if len(sys.argv) > 2 else "data"
os.makedirs(OUT, exist_ok=True)
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "curl/8.5.0"})
    return urllib.request.urlopen(req, timeout=180).read()
def nasr_date():
    if len(sys.argv) > 1: return datetime.date.fromisoformat(sys.argv[1])
    base, today = datetime.date(2026, 10, 1), datetime.date.today()
    return base + datetime.timedelta(days=28 * ((today - base).days // 28))
d = nasr_date(); tag = d.strftime("%d_%b_%Y")
db_path = f"{OUT}/stations.sqlite"
if os.path.exists(db_path): os.remove(db_path)
db = sqlite3.connect(db_path)
db.executescript("""
CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE fm(facid INTEGER PRIMARY KEY, call TEXT, mhz REAL, city TEXT, state TEXT, lat REAL, lon REAL, erp_kw REAL, haat_m REAL, cls TEXT, status TEXT);
CREATE TABLE airport(id TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, state TEXT, lat REAL, lon REAL, towered INTEGER, artcc TEXT);
CREATE TABLE afreq(apt TEXT, grp TEXT, mhz REAL, label TEXT, facility TEXT);
CREATE TABLE zip(zip TEXT PRIMARY KEY, lat REAL, lon REAL);
CREATE TABLE runway(apt TEXT, hdg REAL);
CREATE TABLE center(artcc TEXT, site TEXT, state TEXT, lat REAL, lon REAL, mhz REAL);
""")
# ---- FCC FM ----
fm = get("https://transition.fcc.gov/fcc-bin/fmq?serv=FM&vac=3&freq=0.0&fre2=107.9&list=4&size=9").decode("latin1")
def dms(d, m, s, h):
    v = float(d) + float(m) / 60 + float(s) / 3600
    return round(-v if h in "SW" else v, 5)
rank = {"LIC": 0, "STA": 1, "MOD": 2, "CP": 3}
best = {}
for line in fm.splitlines():
    f = [x.strip() for x in line.split("|")]
    if len(f) < 28 or f[12] != "US" or f[9] not in rank: continue
    try:
        facid = int(f[18]); mhz = float(f[2].split()[0])
        erp = max(float(re.sub(r"[^\d.]", "", f[14]) or 0), float(re.sub(r"[^\d.]", "", f[15]) or 0))
        haat = float(re.sub(r"[^\d.-]", "", f[16]) or 0)
        row = (facid, f[1].split("-")[0] if f[1] else "", mhz, f[10].title(), f[11], dms(f[20], f[21], f[22], f[19]), dms(f[24], f[25], f[26], f[23]), erp, haat, f[7], f[9])
    except (ValueError, IndexError): continue
    if facid not in best or rank[f[9]] < rank[best[facid][10]]: best[facid] = row
db.executemany("INSERT INTO fm VALUES(?,?,?,?,?,?,?,?,?,?,?)", best.values())
# ---- FAA NASR ----
def zcsv(name):
    z = zipfile.ZipFile(io.BytesIO(get(f"https://nfdc.faa.gov/webContent/28DaySub/extra/{tag}_{name}_CSV.zip")))
    return z
apt = zcsv("APT"); icao = {}; artcc = {}
for r in csv.DictReader(io.TextIOWrapper(apt.open("APT_BASE.csv"), encoding="latin1")):
    icao[r["ARPT_ID"]] = r["ICAO_ID"]; artcc[r["ARPT_ID"]] = r["RESP_ARTCC_ID"]
def grp(use):
    u = use.upper()
    if u.startswith("LCL"): return "tower"
    if u.startswith("GND"): return "ground"
    if u.startswith("CD") or "CLNC" in u: return "clearance"
    if "ATIS" in u: return "atis"
    if re.match(r"(APCH|DEP|CLASS [BC]|TRSA)", u): return "approach"
    if u.startswith("CTAF"): return "ctaf"
    if u.startswith("UNICOM"): return "unicom"
    return None  # STAR/DP/ramp/ops/emerg skipped for the bank
CALLFIX = {"SOCAL": "SoCal", "NORCAL": "NorCal", "OKE CITY": "Oklahoma City"}
SMALL = {"OF", "VIA", "AND", "ONLY", "TO", "FOR", "THE", "AT", "ON"}
CAP = {"ARR", "DEP", "APP", "TWR", "GND", "CMPLX"}
def nw(w):
    if any(ch.isdigit() for ch in w): return w.upper()
    if w.upper() in SMALL: return w.lower()
    if w.upper() in CAP or len(w) > 3: return w.capitalize()
    return w.upper()
def nicecase(t):
    return " ".join(nw(w) for w in t.split())
def clean_label(g, r):
    sec = r["SECTORIZATION"].strip()
    if g != "approach":
        return nicecase(sec.replace("-", " "))[:40]
    call = r["PRIMARY_APPROACH_RADIO_CALL"].strip().upper()
    call = CALLFIX.get(call, call.title())
    u = r["FREQ_USE"].upper()
    kind = "Approach" if u.startswith("APCH") or "CLASS" in u or "TRSA" in u else "Departure"
    if u.startswith("APCH") and "DEP" in u: kind = "App/Dep"
    if "CLASS B" in u: kind = "Class B"
    elif "CLASS C" in u: kind = "Class C"
    sec = re.sub(r"\s+", " ", sec)
    tail = (" " + nicecase(sec)) if sec and len(sec) <= 18 else ""
    return ((call + " " if call else "") + kind + tail)[:40]
apts, freqs, centers = {}, set(), set()
for r in csv.DictReader(io.TextIOWrapper(zcsv("FRQ").open("FRQ.csv"), encoding="latin1")):
    try: mhz = float(r["FREQ"].split("/")[0])
    except ValueError: continue
    if not (118.0 <= mhz < 137.0) or r["SERVICED_COUNTRY"] not in ("US", ""): continue
    if r["FACILITY_TYPE"] == "RCAG":
        centers.add((r["ARTCC_OR_FSS_ID"] or r["FACILITY"], r["SERVICED_FAC_NAME"].title(), r["SERVICED_STATE"], float(r["LAT_DECIMAL"] or 0), float(r["LONG_DECIMAL"] or 0), mhz)); continue
    if r["SERVICED_SITE_TYPE"] not in ("AIRPORT", "HELIPORT", "SEAPLANE BASE"): continue
    g = grp(r["FREQ_USE"])
    if not g: continue
    a = r["SERVICED_FACILITY"]
    if a not in apts:
        apts[a] = [a, icao.get(a, ""), r["SERVICED_FAC_NAME"].title(), r["SERVICED_CITY"].title(), r["SERVICED_STATE"], float(r["LAT_DECIMAL"] or 0), float(r["LONG_DECIMAL"] or 0), 0, artcc.get(a, "")]
    if g == "tower": apts[a][7] = 1
    label = clean_label(g, r)
    freqs.add((a, g, mhz, label[:40], r["FACILITY"]))
rw = set()
for r in csv.DictReader(io.TextIOWrapper(apt.open("APT_RWY_END.csv"), encoding="latin1")):
    if r["ARPT_ID"] in apts and r["TRUE_ALIGNMENT"].strip():
        try: rw.add((r["ARPT_ID"], float(r["TRUE_ALIGNMENT"])))
        except ValueError: pass
db.executemany("INSERT INTO runway VALUES(?,?)", sorted(rw))
db.executemany("INSERT INTO airport VALUES(?,?,?,?,?,?,?,?,?)", apts.values())
best_f = {}
def lscore(l): return (not l.startswith(("Class", "")) if False else 0) + (0 if " Class " in " " + l else 2) + (1 if re.search(r"\d", l) else 0) + (0 if not l else 1)
for f in sorted(freqs):
    k = f[:3]
    if k not in best_f or lscore(f[3]) > lscore(best_f[k][3]): best_f[k] = f
db.executemany("INSERT INTO afreq VALUES(?,?,?,?,?)", sorted(best_f.values()))
db.executemany("INSERT INTO center VALUES(?,?,?,?,?,?)", sorted(centers))
zz = zipfile.ZipFile(io.BytesIO(get("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip")))
zl = io.TextIOWrapper(zz.open(zz.namelist()[0]), encoding="latin1"); next(zl)
db.executemany("INSERT INTO zip VALUES(?,?,?)", [(p[0], round(float(p[5]), 4), round(float(p[6]), 4)) for p in (l.split() for l in zl) if len(p) >= 7])
db.executescript("""
CREATE INDEX fm_st ON fm(state, city); CREATE INDEX fm_call ON fm(call); CREATE INDEX fm_mhz ON fm(mhz);
CREATE INDEX ap_st ON airport(state); CREATE INDEX ap_icao ON airport(icao); CREATE INDEX af_apt ON afreq(apt); CREATE INDEX rw_apt ON runway(apt); CREATE INDEX af_mhz ON afreq(mhz);
""")
db.executemany("INSERT INTO meta VALUES(?,?)", [("nasr_cycle", d.isoformat()), ("nasr_next", (d + datetime.timedelta(days=28)).isoformat()),
    ("fcc_pulled", datetime.date.today().isoformat()), ("format", "1"), ("source", "FCC FM Query (public domain); FAA NASR 28-day subscription (public domain); US Census ZCTA gazetteer (public domain). Not for navigation.")])
db.commit(); db.execute("VACUUM"); db.close()
c = sqlite3.connect(db_path); q = lambda s: c.execute(s).fetchone()[0]
stats = {k: q(f"select count(*) from {k}") for k in ("fm", "airport", "afreq", "runway", "center", "zip")}
stats["towered"] = q("select count(*) from airport where towered=1")
stats["bytes"] = os.path.getsize(db_path); print(json.dumps(stats))
