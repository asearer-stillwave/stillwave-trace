#!/usr/bin/env python3
"""Write and sign a Stillwave Trace content folder (the same layout on a home Pi and on Cloudflare R2):
  catalog.json + catalog.json.sig          map list (only packs that exist under maps/), Ed25519-signed
  maps/<id>.pmtiles + maps/<id>.pmtiles.sig
  bank/stations.json + .sig, bank/stations-<cycle>.sqlite.gz
  updates/handheld/  updates/desktop/      copied OTA folders (latest.json + bundle + .sig), optional
Usage:
  publish_content.py --out CONTENT_DIR --key /path/to/stillwave-update-ed25519.pem
        [--bank stations.sqlite] [--updates-handheld DIR] [--updates-desktop DIR]
The private key is only read to sign; it is never copied into CONTENT_DIR (the script refuses to finish if any
file there contains private key material)."""
import argparse, base64, datetime, gzip, hashlib, json, os, shutil, sqlite3, sys
from cryptography.hazmat.primitives.serialization import load_pem_private_key
HERE = os.path.dirname(os.path.abspath(__file__))


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): h.update(c)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True); ap.add_argument("--key", required=True)
    ap.add_argument("--bank"); ap.add_argument("--updates-handheld"); ap.add_argument("--updates-desktop")
    ap.add_argument("--regions", default=os.path.join(HERE, "regions.json"))
    a = ap.parse_args()
    key = load_pem_private_key(open(a.key, "rb").read(), password=None)
    sign = lambda data: base64.b64encode(key.sign(data)).decode() + "\n"
    out = os.path.abspath(a.out); os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    src = json.load(open(a.regions)); packs = []
    for p in src["packs"]:
        f = os.path.join(out, "maps", p["id"] + ".pmtiles")
        if not os.path.isfile(f): continue
        b = {}
        bj = os.path.join(out, "maps", p["id"] + ".build.json")
        if os.path.isfile(bj): b = json.load(open(bj))
        digest = sha(f)
        if b.get("sha256") not in (None, digest): print("note: %s changed since build.json" % p["id"])
        with open(f, "rb") as fh: open(f + ".sig", "w").write(sign(fh.read()))
        bb = p["bbox"]
        packs.append({"id": p["id"], "name": p["name"], "parent": p.get("parent"), "detail": p.get("detail", "street"), "sub": p.get("sub", ""),
                      "bbox": bb, "center": p.get("center") or [round((bb[0] + bb[2]) / 2, 4), round((bb[1] + bb[3]) / 2, 4)],
                      "minzoom": 0, "maxzoom": p.get("maxzoom", 14), "build": b.get("build", ""), "bytes": os.path.getsize(f), "sha256": digest,
                      "url": "maps/%s.pmtiles" % p["id"], "sig_url": "maps/%s.pmtiles.sig" % p["id"]})
    used = {p["parent"] for p in packs}
    regions, keep = src["regions"], set()
    byid = {r["id"]: r for r in regions}
    for rid in used:
        while rid: keep.add(rid); rid = byid.get(rid, {}).get("parent")
    cat = {"product": "stillwave-trace-content", "format": 1, "generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
           "attribution": "Map data © OpenStreetMap contributors (ODbL 1.0) · Protomaps basemap",
           "regions": [r for r in regions if r["id"] in keep], "packs": packs}
    if a.bank:
        os.makedirs(os.path.join(out, "bank"), exist_ok=True)
        c = sqlite3.connect("file:%s?mode=ro" % a.bank, uri=True); m = dict(c.execute("select k,v from meta").fetchall()); c.close()
        name = "stations-%s.sqlite.gz" % m["nasr_cycle"]; gz = os.path.join(out, "bank", name)
        with open(a.bank, "rb") as s, gzip.GzipFile(gz, "wb", 9, mtime=0) as d: shutil.copyfileobj(s, d)
        bm = {"product": "stillwave-trace-bank", "file": name, "bytes": os.path.getsize(gz), "sha256": sha(gz), "cycle": m["nasr_cycle"],
              "next": m.get("nasr_next"), "fcc_pulled": m.get("fcc_pulled"), "source": m.get("source")}
        raw = json.dumps(bm, indent=1).encode()
        open(os.path.join(out, "bank", "stations.json"), "wb").write(raw); open(os.path.join(out, "bank", "stations.json.sig"), "w").write(sign(raw))
        cat["bank"] = {"url": "bank/stations.json", "cycle": m["nasr_cycle"]}
        for f in os.listdir(os.path.join(out, "bank")):
            if f.startswith("stations-") and f != name: os.remove(os.path.join(out, "bank", f))
    for ed, d in (("handheld", a.updates_handheld), ("desktop", a.updates_desktop)):
        if d:
            dst = os.path.join(out, "updates", ed)
            shutil.rmtree(dst, ignore_errors=True); shutil.copytree(d, dst)
    raw = json.dumps(cat, indent=1).encode()
    open(os.path.join(out, "catalog.json"), "wb").write(raw); open(os.path.join(out, "catalog.json.sig"), "w").write(sign(raw))
    for root, _, fs in os.walk(out):
        for f in fs:
            p = os.path.join(root, f)
            if f.endswith(".pem") or (os.path.getsize(p) < 10_000_000 and b"PRIVATE KEY-----" in open(p, "rb").read()):
                sys.exit("refusing: private key material in " + p)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(out) for f in fs)
    print("catalog: %d packs, %d regions%s · folder %.1f MB -> %s" % (len(packs), len(cat["regions"]), " + bank " + cat["bank"]["cycle"] if "bank" in cat else "", tot / 1e6, out))


if __name__ == "__main__":
    main()
