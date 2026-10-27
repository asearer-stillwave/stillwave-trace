"""Trace 1.2.9 station names: tidy FAA/FCC casing and short on-screen names (5" screen, never wrap).
Used at build time by tools/build_station_bank.py (columns airport.short, afreq.short) and at run time by
bank.py as a fallback for station banks built before 1.2.9 (format 1)."""
import re

CAP = 14
SMALL = {"and", "of", "the", "in", "on", "at", "by", "for", "de", "la", "del", "via", "to", "only"}
ABBR = {"Intl": "International", "Rgnl": "Regional", "Muni": "Municipal", "Fld": "Field", "Arpt": "Airport", "Mem": "Memorial",
        "Hosp": "Hospital", "Cmplx": "Complex", "Arr": "Arrival", "Dep": "Departure", "Artcc": "ARTCC", "Afb": "AFB", "Aaf": "AAF",
        "Nas": "NAS", "Hpt": "Heliport", "Hlpt": "Heliport", "Socal": "SoCal", "Norcal": "NorCal"}


def tidy(s, expand=True):
    """'LEE'S SUMMIT' -> "Lee's Summit", 'MCALLEN' -> 'McAllen', 'LOS ANGELES INTL' -> 'Los Angeles International'."""
    if not s: return s
    s = re.sub(r"\s+", " ", str(s).strip()).title()
    s = re.sub(r"([A-Za-z])'S\b", r"\1's", s)
    s = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)
    s = re.sub(r"\b(Ii|Iii|Iv|Vi|Vii|Viii)\b", lambda m: m.group(1).upper(), s)
    s = re.sub(r"\b([A-Z])(?: (?=[A-Z]\b))", r"\1", s)              # M C R -> MCR
    s = re.sub(r"\b(\d+)(St|Nd|Rd|Th)\b", lambda m: m.group(1) + m.group(2).lower(), s)
    out = []
    for i, w in enumerate(s.split(" ")):
        def rep(m):
            t = m.group(0)
            if expand and t in ABBR: return ABBR[t]
            if i and t.lower() in SMALL and m.start() == 0 and not w.startswith("("): return t.lower()
            return t
        out.append(re.sub(r"[A-Za-z]+", rep, w))
    s = " ".join(out)
    s = re.sub(r"-(And|Of|The|By|On)(?=-)", lambda m: "-" + m.group(1).lower(), s)
    return s


def expand_label(s):
    """FAA frequency remark: expand shorthand only (keeps runway idents and casing)."""
    if not s: return s
    return re.sub(r"[A-Za-z]+", lambda m: ABBR.get(m.group(0).capitalize(), m.group(0)) if m.group(0).capitalize() in ("Cmplx", "Arr", "Dep", "Artcc", "Socal", "Norcal") else m.group(0), s)


def cap(s, n=CAP):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


DROP = re.compile(r"\b(INTERNATIONAL|INTL|AIRPORT|ARPT|REGIONAL|RGNL|MUNICIPAL|MUNI|FIELD|FLD|COUNTY|CO|PUB|PUBLIC|MEMORIAL|MEM|METRO|"
                  r"METROPOLITAN|EXECUTIVE|EXEC|STATION|SKID STRIP|JRB|NAS|AAF|AFB|ANGB)\b")


def apt_short(name, city=""):
    """'Los Angeles Intl' -> 'LOS ANGELES', 'Long Beach (Daugherty Fld)' -> 'LONG BEACH'. Max 14 chars."""
    s = re.split(r"[/(]", str(name or "").upper())[0]
    s = re.sub(r"\s+", " ", DROP.sub(" ", s)).strip(" -,.")
    if len(s) < 3: s = str(city or "").upper().strip()
    return cap(s)


FAC = {"tower": "TWR", "ground": "GND", "clearance": "CLR", "atis": "ATIS", "approach": "APP", "ctaf": "CTAF", "unicom": "UNIC"}


def side(label):
    l = str(label or "").upper()
    if re.search(r"HELI", l): return "HELO"
    if re.search(r"^ARR\b|\bARR(IVAL)?$", l): return "ARR"
    if re.search(r"^DEP\b|\bDEP(ARTURE)?$", l): return "DEP"
    m = re.match(r"(NORTH|SOUTH|EAST|WEST)\b", l)
    return m.group(1)[0] if m else ""


def preset_name(code, grp, label=""):
    """Preset / tune name: 'KLAX TWR N', 'SOCAL APP', 'KBUR ATIS'. Max 14 chars."""
    if grp == "approach" and label:
        base = re.split(r"\s+(APP(ROACH)?|DEP(ARTURE)?|CLASS [BC]|ARTCC|CENTER)\b", str(label).upper())[0].strip()
        if base: return cap(base + " APP")
    return cap(" ".join(x for x in (str(code or "").upper(), FAC.get(grp, str(grp or "").upper()), side(label)) if x))


def upgrade_db(db):
    """Add the 1.2.9 columns to a station bank (sqlite3 connection, writable). Idempotent."""
    cols = lambda t: {r[1] for r in db.execute("pragma table_info(%s)" % t)}
    if "short" not in cols("airport"): db.execute("alter table airport add column short text")
    if "short" not in cols("afreq"): db.execute("alter table afreq add column short text")
    db.executemany("update airport set name=?, city=?, short=? where id=?",
                   [(tidy(n), tidy(c), apt_short(n, c), i) for i, n, c in db.execute("select id,name,city from airport").fetchall()])
    codes = dict(db.execute("select id, coalesce(nullif(icao,''), id) from airport"))
    db.executemany("update afreq set label=?, short=? where rowid=?",
                   [(expand_label(l), preset_name(codes.get(a, a), g, expand_label(l)), r) for r, a, g, l in db.execute("select rowid,apt,grp,label from afreq").fetchall()])
    db.executemany("update fm set city=? where facid=?", [(tidy(c), i) for i, c in db.execute("select facid,city from fm").fetchall()])
    db.executemany("update center set site=? where rowid=?", [(tidy(s), r) for r, s in db.execute("select rowid,site from center").fetchall()])
    db.execute("insert or replace into meta values('format','2')")
    db.commit()


# ---- 1.3.1 Quick Tune button tags: only the part that tells a frequency apart from the others in its group.
# Built from the FAA NASR frequency-use remark (afreq.label), never invented: a bearing sector "045-089" becomes the
# compass point of its middle (APP NE), "RWY 11L" -> APP RWY 11, North/South/West/East/Helicopters/Arrival/Departure
# words are kept. Nothing to tell them apart -> APP 1, APP 2 ...; a lone frequency -> APP.
_QK = {"approach": "APP", "tower": "TWR", "ground": "GND", "atis": "ATIS", "clearance": "CLR", "ctaf": "CTAF", "unicom": "UNIC"}
_OCT = ["NORTH", "NE", "EAST", "SE", "SOUTH", "SW", "WEST", "NW"]
_QW = [("heli", "HELI"), ("north", "NORTH"), ("south", "SOUTH"), ("east", "EAST"), ("west", "WEST"), ("arrival", "ARR"), ("departure", "DEP")]


def quick_tag(grp, label):
    lab = label or ""; low = lab.lower(); k = _QK.get(grp, (grp or "").upper()[:5])
    if grp == "approach":
        if "departure" in low and "app" not in low: k = "DEP"
        m = re.search(r"class ([bc])\b", low)
        if m: k = "CLASS " + m.group(1).upper()
        m = re.search(r"\b(\d{3})[- ](\d{3})\b", lab)
        if m:
            a, b = int(m.group(1)) % 360, int(m.group(2)) % 360
            return k + " " + _OCT[int((((a + ((b - a) % 360) / 2) % 360) + 22.5) // 45) % 8]
        m = re.search(r"\brwy (\d{1,2})", low)
        return k + " RWY " + m.group(1) if m else k
    m = re.search(r"\brwy (\d{1,2}[lrc]?)", low)
    if m: return k + " RWY " + m.group(1).upper()
    for w, v in _QW:
        if w in low: return k + " " + v
    return k


def quick_tags(grp, labels):
    """Tags for one group's labels (same order); duplicates get 1, 2, 3.
    1.3.2: bearing sectors are kept only when EVERY frequency of that kind has one (KLAX: APP NW / SE / NE, DEP SE / NW).
    When sector ranges are mixed with frequencies that have nothing to tell them apart (KSBA "App/Departure 151-329" next
    to plain "App/Departure"), the whole kind is numbered instead (APP 1, APP 2 ...). A raw bearing range such as
    "APP 151-329" never reaches a button."""
    t = [quick_tag(grp, l) for l in labels]
    rng = [bool(re.search(r"\b(\d{3})[- ](\d{3})\b", l or "")) for l in labels]
    kind = [x.split(" ")[0] if not x.startswith("CLASS") else x for x in t]
    for k in set(kind):
        idx = [i for i, y in enumerate(kind) if y == k]
        if any(rng[i] for i in idx) and not all(rng[i] for i in idx):
            for i in idx: t[i] = k
    t = [re.sub(r"\s*\b\d{3}[- ]\d{3}\b.*$", "", x) or x for x in t]
    for x in set(t):
        idx = [i for i, y in enumerate(t) if y == x]
        if len(idx) > 1:
            for n, i in enumerate(idx, 1): t[i] = f"{x} {n}"
    return t
