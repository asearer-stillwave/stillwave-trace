#!/usr/bin/env python3
"""Build Stillwave Trace map packs: cut regions out of a Protomaps daily world build with the pmtiles CLI.
  build_map_pack.py --out CONTENT_DIR [--build YYYYMMDD] [--pmtiles /path/to/pmtiles] ID [ID ...]   (or --all)
  build_map_pack.py --dry-run ID ...            print the size each pack would have (no download)
Writes CONTENT_DIR/maps/<id>.pmtiles and CONTENT_DIR/maps/<id>.build.json (bbox, zooms, sha256, bytes, build).
Run publish_content.py afterwards to (re)write and sign catalog.json. Map data: OpenStreetMap contributors (ODbL), Protomaps basemap.
Get pmtiles from https://github.com/protomaps/go-pmtiles/releases (1.31+)."""
import argparse, datetime, hashlib, json, os, shutil, subprocess, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))


def latest_build():
    with urllib.request.urlopen(urllib.request.Request("https://build-metadata.protomaps.dev/builds.json", headers={"User-Agent": "curl/8"}), timeout=30) as r:
        b = json.load(r)
    return sorted(x["key"] for x in b if x["key"].endswith(".pmtiles"))[-1][:8]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): h.update(c)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*"); ap.add_argument("--all", action="store_true")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "content")); ap.add_argument("--build")
    ap.add_argument("--pmtiles", default=shutil.which("pmtiles") or "pmtiles"); ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--regions", default=os.path.join(HERE, "regions.json"))
    a = ap.parse_args()
    packs = {p["id"]: p for p in json.load(open(a.regions))["packs"]}
    ids = list(packs) if a.all else a.ids
    if not ids: sys.exit("name one or more pack ids, or --all")
    build = a.build or latest_build(); src = "https://build.protomaps.com/%s.pmtiles" % build
    os.makedirs(os.path.join(a.out, "maps"), exist_ok=True)
    for pid in ids:
        p = packs[pid]; bbox = ",".join(str(x) for x in p["bbox"]); dst = os.path.join(a.out, "maps", pid + ".pmtiles")
        cmd = [a.pmtiles, "extract", src, dst, "--bbox=" + bbox, "--maxzoom=%d" % p.get("maxzoom", 14)]
        if a.dry_run: cmd.append("--dry-run")
        print("==", pid, " ".join(cmd), flush=True)
        r = subprocess.run(cmd, capture_output=a.dry_run, text=True)
        if r.returncode: sys.exit("pmtiles extract failed for " + pid)
        if a.dry_run:
            print([l for l in (r.stdout + r.stderr).splitlines() if "archive size" in l or "Region tiles" in l]); continue
        meta = {"id": pid, "bbox": p["bbox"], "minzoom": 0, "maxzoom": p.get("maxzoom", 14), "build": build, "source": src,
                "bytes": os.path.getsize(dst), "sha256": sha(dst), "made": datetime.datetime.now().isoformat(timespec="seconds")}
        json.dump(meta, open(os.path.join(a.out, "maps", pid + ".build.json"), "w"), indent=1)
        print("   %s: %.1f MB sha256 %s" % (pid, meta["bytes"] / 1e6, meta["sha256"][:16]))


if __name__ == "__main__":
    main()
