#!/usr/bin/env python3
"""Build sdr-station-deploy.zip (with map) and sdr-station-app.zip (no map) from the work tree.
Pure Python zipfile; prefix sdr-station/; skips __pycache__/.pyc; keeps file modes; refuses private keys."""
import os, sys, stat, zipfile, time
W = "/workspace/sdr/work/sdr-station"; OUT = "/workspace/sdr/out"
def files(skip_map):
    for root, dirs, fs in os.walk(W):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for f in sorted(fs):
            if f.endswith((".pyc", ".pyo")): continue
            p = os.path.join(root, f); rel = os.path.relpath(p, W)
            if skip_map and rel.endswith(".pmtiles"): continue
            yield p, rel
def build(name, skip_map):
    dst = os.path.join(OUT, name); tmp = dst + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p, rel in files(skip_map):
            data = open(p, "rb").read()
            if b"PRIVATE KEY" in data and not rel.endswith((".sh", ".py", "sdr-update")):
                sys.exit(f"refusing: {rel} looks like a private key")
            if b"-----BEGIN PRIVATE KEY-----" in data and len(data) < 400:
                sys.exit(f"refusing: {rel} is a private key")
            st = os.stat(p)
            zi = zipfile.ZipInfo("sdr-station/" + rel, time.localtime(st.st_mtime)[:6])
            zi.external_attr = (stat.S_IFREG | stat.S_IMODE(st.st_mode)) << 16
            zi.compress_type = zipfile.ZIP_STORED if rel.endswith(".pmtiles") else zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    with zipfile.ZipFile(tmp) as z:
        bad = z.testzip(); assert bad is None, bad
    os.replace(tmp, dst)
    print(f"{name}: {os.path.getsize(dst)/1e6:.2f} MB")
build("sdr-station-app.zip", True)
build("sdr-station-deploy.zip", False)
