#!/usr/bin/env python3
"""Trace DESKTOP edition outputs (never touches the handheld tree or its outputs):
  /workspace/sdr/out/desktop/updates/<ver>/      signed OTA (make_release.py --edition desktop)
  /workspace/sdr/out/desktop/trace-desktop-<n>.zip         that folder, unzips to <ver>/
  /workspace/sdr/out/desktop/trace-desktop-deploy-<n>.zip  fresh-install bundle (with LA map), unzips to sdr-station-desktop/
The private key is only read by make_release.py for signing; nothing named *.pem or holding a private key is zipped."""
import os, sys, stat, subprocess, zipfile, time
W = "/workspace/sdr/work/sdr-station-desktop"; OUT = "/workspace/sdr/out/desktop"
ver = open(W + "/VERSION").read().strip(); num = ver.replace("-desktop", "")
assert open(W + "/EDITION").read().strip() == "desktop"
os.makedirs(OUT, exist_ok=True)
subprocess.run([sys.executable, "/workspace/sdr/tools/make_release.py", "--edition", "desktop", "--src", W, "--out", OUT + "/updates",
                "--min-version", "1.0.7-desktop", "--notes", os.environ.get("TRACE_NOTES") or ("Trace Desktop " + num)], check=True)
def zipdir(dst, items):
    tmp = dst + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p, arc in items:
            data = open(p, "rb").read()
            if p.endswith(".pem") or b"-----BEGIN PRIVATE KEY-----" in data or b"BEGIN OPENSSH PRIVATE" in data:
                sys.exit("refusing: private key material in " + p)
            st = os.stat(p); zi = zipfile.ZipInfo(arc, time.localtime(st.st_mtime)[:6])
            zi.external_attr = (stat.S_IFREG | stat.S_IMODE(st.st_mode)) << 16
            zi.compress_type = zipfile.ZIP_STORED if p.endswith((".pmtiles", ".gz", ".ota")) else zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    with zipfile.ZipFile(tmp) as z: assert z.testzip() is None
    os.replace(tmp, dst); print(f"{os.path.basename(dst)}: {os.path.getsize(dst)} bytes")
vd = OUT + "/updates/" + ver
zipdir(f"{OUT}/trace-desktop-{num}.zip", [(os.path.join(vd, f), f"{ver}/{f}") for f in sorted(os.listdir(vd))])
items = []
for root, dirs, fs in os.walk(W):
    dirs[:] = sorted(d for d in dirs if d != "__pycache__")
    for f in sorted(fs):
        if f.endswith((".pyc", ".pyo")): continue
        p = os.path.join(root, f); items.append((p, "sdr-station-desktop/" + os.path.relpath(p, W)))
zipdir(f"{OUT}/trace-desktop-deploy-{num}.zip", items)
