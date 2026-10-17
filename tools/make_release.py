#!/usr/bin/env python3
"""Build a signed Stillwave Trace update.
  make-release.sh [--src DIR] [--notes TEXT] [--min-version V] [--out DIR] [--key PEM]
Writes into OUT (default /workspace/sdr/out/updates/<version>/ and copies to OUT root):
  trace-update-<ver>.tar.gz      sdr-station/ tree (no map tiles) + sdr-station/MANIFEST.json
  trace-update-<ver>.tar.gz.sig  Ed25519 signature of the .tar.gz (base64)
  trace-update-<ver>.ota         one file = the two above (for phone / USB "Install from file")
  latest.json                    signed manifest; url/sig_url are relative (serve the folder as-is)
The private key never leaves /workspace/sdr/keys/ and is never written into any output."""
import argparse, base64, datetime, hashlib, io, json, os, re, shutil, sys, tarfile, time
from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PublicFormat

SIGNED_KEYS = ("product", "format", "version", "min_version", "notes", "released", "file", "sha256", "size", "key_id", "edition", "channel")
# (edition/channel only exist in desktop packages; handheld manifests have neither, so their signed bytes are unchanged)
SKIP_DIRS = {"__pycache__", ".git"}


def canonical(m):
    return json.dumps({k: m[k] for k in SIGNED_KEYS if k in m}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/workspace/sdr/work/sdr-station")
    ap.add_argument("--notes", default="")
    ap.add_argument("--min-version", default="1.0.0")
    ap.add_argument("--out", default="/workspace/sdr/out/updates")
    ap.add_argument("--key", default="/workspace/sdr/keys/stillwave-update-ed25519.pem")
    ap.add_argument("--released", default=None)
    ap.add_argument("--edition", choices=["handheld", "desktop"], default="handheld")
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    ver = open(os.path.join(src, "VERSION")).read().strip()
    desk = a.edition == "desktop"
    if desk:
        if not re.fullmatch(r"\d+(\.\d+){1,3}-desktop", ver) or open(os.path.join(src, "EDITION")).read().strip() != "desktop":
            sys.exit(f"desktop build needs VERSION x.y.z-desktop and EDITION=desktop (got {ver!r})")
    elif not re.fullmatch(r"\d+(\.\d+){1,3}", ver) or os.path.exists(os.path.join(src, "EDITION")):
        sys.exit(f"bad VERSION {ver!r} (or an EDITION file in a handheld tree)")
    product = "stillwave-trace-desktop" if desk else "stillwave-trace"
    prefix = "trace-desktop-update-" if desk else "trace-update-"
    extra = {"edition": "desktop", "channel": "desktop"} if desk else {}
    key = load_pem_private_key(open(a.key, "rb").read(), password=None)
    pub_raw = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    pub_pem = key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    baked = open(os.path.join(src, "config", "stillwave-update.pub"), "rb").read()
    if baked.strip() != pub_pem.strip():
        sys.exit("config/stillwave-update.pub in the tree is not the public half of --key")
    key_id = sha256(pub_raw)[:16]
    released = a.released or datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    files = {}
    for root, dirs, fns in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for fn in sorted(fns):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, src)
            if fn.endswith((".pyc", ".pmtiles")) or rel == "MANIFEST.json" or os.path.islink(p):
                continue
            data = open(p, "rb").read()
            if b"PRIVATE KEY-----" in data:
                sys.exit(f"refusing: {rel} contains a private key")
            files[rel] = (sha256(data), data, os.stat(p).st_mode & 0o777)
    inner = {"product": product, "format": 1, "version": ver, "min_version": a.min_version,
             "notes": a.notes, "released": released, "key_id": key_id, **extra,
             "files": {rel: h for rel, (h, _, _) in files.items()}}
    buf = io.BytesIO()
    mtime = int(time.time())

    def add(t, name, data, mode):
        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = mode; ti.mtime = mtime
        ti.uid = ti.gid = 0; ti.uname = ti.gname = "root"
        t.addfile(ti, io.BytesIO(data))
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=9) as t:
        dirs_added = set()
        for rel in sorted(files):
            parts = rel.split("/")[:-1]
            for i in range(len(parts)):
                d = "/".join(parts[:i + 1])
                if d not in dirs_added:
                    ti = tarfile.TarInfo("sdr-station/" + d); ti.type = tarfile.DIRTYPE; ti.mode = 0o755; ti.mtime = mtime
                    t.addfile(ti); dirs_added.add(d)
            h, data, mode = files[rel]
            add(t, "sdr-station/" + rel, data, 0o755 if mode & 0o111 else 0o644)
        add(t, "sdr-station/MANIFEST.json", json.dumps(inner, indent=1).encode(), 0o644)
    tgz = buf.getvalue()
    name = f"{prefix}{ver}.tar.gz"
    sig = base64.b64encode(key.sign(tgz)).decode() + "\n"
    latest = {"product": product, **extra, "format": 1, "version": ver, "min_version": a.min_version,
              "notes": a.notes, "released": released, "file": name, "sha256": sha256(tgz), "size": len(tgz),
              "key_id": key_id, "url": name, "sig_url": name + ".sig"}
    latest["manifest_sig"] = base64.b64encode(key.sign(canonical(latest))).decode()

    vdir = os.path.join(a.out, ver)
    os.makedirs(vdir, exist_ok=True)
    open(os.path.join(vdir, name), "wb").write(tgz)
    open(os.path.join(vdir, name + ".sig"), "w").write(sig)
    json.dump(latest, open(os.path.join(vdir, "latest.json"), "w"), indent=1)
    ota = io.BytesIO()
    with tarfile.open(fileobj=ota, mode="w") as t:
        add(t, name, tgz, 0o644)
        add(t, name + ".sig", sig.encode(), 0o644)
    open(os.path.join(vdir, f"{prefix}{ver}.ota"), "wb").write(ota.getvalue())
    print(f"{ver}: {len(files)} files, {name} {len(tgz)/1e6:.2f} MB sha256 {latest['sha256'][:16]}… key {key_id}")
    print(f"  -> {vdir}/")
    for f in sorted(os.listdir(vdir)):
        print(f"     {f}  {os.path.getsize(os.path.join(vdir, f))} bytes")


if __name__ == "__main__":
    main()
