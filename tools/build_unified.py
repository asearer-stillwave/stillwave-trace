#!/usr/bin/env python3
"""Stillwave Trace 1.3.8: ONE fresh-install / upgrade zip for both editions -> $TRACE_OUT (default /workspace/out-1.3.8)/trace-1.3.8.zip
Layout (no top folder; unzip -d DIR, then sudo bash DIR/install.sh):
  install.sh VERSION README.txt   (from /workspace/sdr/work138/trace-unified: edition question / --display dsi|hdmi / --upgrade)
  common/    files that are byte-identical (same mode) in both edition trees
  handheld/  the rest of /workspace/sdr/work138/sdr-station
  desktop/   the rest of /workspace/sdr/work/sdr-station-desktop
Skips __pycache__, .pyc/.pyo, *.pmtiles, *.pre-* rollback copies, .tmp. Refuses .pem / private-key material, unit keys,
Wi-Fi / password files, cloud-init user-data / network-config and anything from the Pi 5 kit. Never reads /workspace/sdr/keys."""
import hashlib, os, re, stat, sys, time, zipfile
OUT = os.environ.get("TRACE_OUT", "/workspace/out-1.3.8"); NAME = "trace-1.3.8.zip"; VER = "1.3.8"; LIMIT = 25 * 1000 * 1000
HH, DT, UNI = "/workspace/sdr/work138/sdr-station", "/workspace/sdr/work138/sdr-station-desktop", "/workspace/sdr/work138/trace-unified"
DENY = re.compile(r"(\.pem$|trace-unit-keys|(^|/)user-data$|(^|/)network-config$|wpa_supplicant|wifi.*pass|password|(^|/)keys/|(^|/)kit/|pi5-desktop)", re.I)
SKIPF = re.compile(r"(\.pyc$|\.pyo$|\.pmtiles$|\.pre-[^/]*$|\.tmp$)")
PRIV = (b"-----BEGIN PRIVATE KEY-----", b"BEGIN OPENSSH PRIVATE KEY", b"BEGIN EC PRIVATE KEY", b"BEGIN RSA PRIVATE KEY")

def files(W):
    out = {}
    for root, dirs, fs in os.walk(W):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and not os.path.realpath(os.path.join(root, d)).startswith("/workspace/sdr/keys"))
        for f in sorted(fs):
            p = os.path.join(root, f); rel = os.path.relpath(p, W)
            if SKIPF.search(rel): continue
            if DENY.search(rel): sys.exit("refusing: %s matches a secret-file pattern" % rel)
            if os.path.islink(p) or os.path.realpath(p).startswith("/workspace/sdr/keys"): sys.exit("refusing link: " + rel)
            data = open(p, "rb").read()
            if any(k in data for k in PRIV): sys.exit("refusing: private key material in " + rel)
            st = os.stat(p); out[rel] = (data, stat.S_IMODE(st.st_mode), st.st_mtime)
    return out

def main():
    assert open(HH + "/VERSION").read().strip() == VER
    assert open(DT + "/VERSION").read().strip() == VER + "-desktop"
    assert open(UNI + "/VERSION").read().strip() == VER
    h, d, u = files(HH), files(DT), files(UNI)
    entries = []
    for rel in sorted(u): entries.append((rel, u[rel]))
    for rel in sorted(set(h) | set(d)):
        if rel in h and rel in d and h[rel][:2] == d[rel][:2]: entries.append(("common/" + rel, h[rel]))
        else:
            if rel in h: entries.append(("handheld/" + rel, h[rel]))
            if rel in d: entries.append(("desktop/" + rel, d[rel]))
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, NAME); tmp = dst + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, (data, mode, mt) in entries:
            zi = zipfile.ZipInfo(name, time.localtime(mt)[:6])
            zi.external_attr = (stat.S_IFREG | mode) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    with zipfile.ZipFile(tmp) as z:
        assert z.testzip() is None
        names = z.namelist()
        bad = [x for x in names if re.search(r"__pycache__|\.pyc$|\.pmtiles$|\.pem$|(^|/)keys/|trace-unit-keys|user-data|network-config|wpa_supplicant|password|wifi.*pass|(^|/)kit/|pi5", x, re.I)]
        assert not bad, bad
    size = os.path.getsize(tmp); assert size < LIMIT, size
    os.replace(tmp, dst)
    hx = hashlib.sha256(open(dst, "rb").read()).hexdigest()
    open(dst + ".sha256", "w").write("%s  %s\n" % (hx, NAME))
    c = sum(1 for n in names if n.startswith("common/")); hh = sum(1 for n in names if n.startswith("handheld/")); dt = sum(1 for n in names if n.startswith("desktop/"))
    print("%s  %d bytes (%.2f MB)  %d files (common %d, handheld %d, desktop %d)  sha256 %s" % (dst, size, size / 1e6, len(names), c, hh, dt, hx))

if __name__ == "__main__":
    main()
