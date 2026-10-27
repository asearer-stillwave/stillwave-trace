#!/usr/bin/env python3
"""Stillwave Trace scope: owns the RTL-SDR for the spectrum/waterfall page and pushes frames to browsers with
Server-Sent Events.

  --mode spectrum  rtl_sdr IQ -> numpy FFT -> waterfall rows (~8/s)

1.3.2: the Scan page's RF detection mode (rtl_power sweeps, noise floor, signal list, HOLD) was removed.

Listens on 127.0.0.1:8081 (nginx proxies /api/scope/). Only one dongle user may
run at a time; sdr-mode / systemd Conflicts= take care of that.
"""
from pathlib import Path
import argparse
import base64
import json
import math
import os
import shutil
import signal
import subprocess
import threading
import time
from collections import deque

import numpy as np
from flask import Flask, Response, jsonify, request

RTL_SDR = os.environ.get("SDR_RTL_SDR_BIN", "rtl_sdr")
# 1.0.9 dual dongle: RADIO_DEVICE (/etc/sdr/dongles.env) = serial label of the radio dongle; empty = the only dongle
DEV_ARGS = ["-d", os.environ["RADIO_DEVICE"]] if os.environ.get("RADIO_DEVICE") else []
STATE = Path(os.environ.get("SDR_SCOPE_STATE",
                            os.path.join(os.environ.get("STATE_DIRECTORY", "/var/lib/sdr-station"), "scope.json")))
FM_ENV = Path(os.environ.get("SDR_ENV_FILE", "/etc/sdr/fm.env"))

F_MIN = 24e6      # R820T/R820T2 tuning range
F_MAX = 1766e6
SPANS = [250e3, 1.024e6, 1.2e6, 1.8e6, 2.048e6, 2.4e6]   # valid rtl_sdr sample rates
NFFTS = [512, 1024, 2048]
GAINS = ["auto", "0", "0.9", "1.4", "2.7", "3.7", "7.7", "8.7", "12.5", "14.4", "15.7", "16.6",
         "19.7", "20.7", "22.9", "25.4", "28.0", "29.7", "32.8", "33.8", "36.4", "37.2", "38.6",
         "40.2", "42.1", "43.4", "43.9", "44.5", "48.0", "49.6"]
DISPLAY_POINTS = 1600




def fm_ppm():
    try:
        for line in FM_ENV.read_text().splitlines():
            if line.startswith("RTL_PPM="):
                return int(float(line.split("=", 1)[1].strip() or 0))
    except (OSError, ValueError):
        pass
    return 0


DEFAULTS = {
    "spectrum": {"center_hz": 98.7e6, "span_hz": 2.4e6, "gain": "20.7", "nfft": 1024,
                 "fps": 8, "avg": 32, "ppm": None},
}
# keys that can change without restarting the rtl process
LIVE_KEYS = {"fps", "avg"}


def _num(v, lo, hi, default):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    return min(hi, max(lo, x))


def _nearest(v, options, default):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return min(options, key=lambda o: abs(o - x))


def validate(mode, cfg):
    d = dict(DEFAULTS[mode])
    d.update({k: v for k, v in (cfg or {}).items() if k in d})
    g = str(d.get("gain") or "auto").strip().lower()
    if g != "auto":
        g = str(_nearest(g, [float(x) for x in GAINS[1:]], 20.7))
    d["gain"] = g
    d["ppm"] = int(_num(d["ppm"] if d["ppm"] is not None else fm_ppm(), -200, 200, 0))
    if mode == "spectrum":
        d["span_hz"] = _nearest(d["span_hz"], SPANS, 2.4e6)
        half = d["span_hz"] / 2
        d["center_hz"] = _num(d["center_hz"], F_MIN + half, F_MAX - half, 98.7e6)
        d["nfft"] = int(_nearest(d["nfft"], NFFTS, 1024))
        d["fps"] = int(_num(d["fps"], 1, 20, 8))
        d["avg"] = int(_num(d["avg"], 1, 128, 32))
    return d


BOOT_MARK = Path(os.environ.get("SDR_SCOPE_BOOT_MARK", "/run/sdr-scope-booted"))


def load_cfg(mode):
    try:
        data = json.loads(STATE.read_text())
        d = data.get(mode) or {}
        if mode == "spectrum" and not BOOT_MARK.exists():   # 1.0.8: first spectrum start after boot opens at 98.7 MHz
            d = dict(d, center_hz=98.7e6)
            try: BOOT_MARK.touch()
            except OSError: pass
        return validate(mode, d)
    except (OSError, ValueError, AttributeError):
        return validate(mode, {})


def save_cfg(mode, cfg):
    try:
        try:
            data = json.loads(STATE.read_text())
        except (OSError, ValueError):
            data = {}
        data[mode] = cfg
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        tmp.replace(STATE)
    except OSError as exc:
        print(f"could not save {STATE}: {exc}", flush=True)


def encode(arr, lo=None, step=None):
    """Quantise dB values to uint8 + base64 (lo + q*step)."""
    a = np.asarray(arr, dtype=np.float32)
    fin = a[np.isfinite(a)]
    if lo is None:
        if fin.size == 0:
            lo, hi = -100.0, 0.0
        else:
            lo, hi = float(np.floor(fin.min())), float(np.ceil(fin.max()))
        step = max((hi - lo) / 255.0, 0.05)
    a = np.where(np.isfinite(a), a, lo)
    q = np.clip(np.rint((a - lo) / step), 0, 255).astype(np.uint8)
    return lo, step, base64.b64encode(q.tobytes()).decode("ascii")


def maxpool(arr, points):
    n = len(arr)
    if n <= points:
        return np.asarray(arr, dtype=np.float32), 1
    k = int(math.ceil(n / points))
    pad = (-n) % k
    a = np.concatenate([arr, np.full(pad, -np.inf, dtype=np.float32)]) if pad else np.asarray(arr)
    return a.reshape(-1, k).max(axis=1).astype(np.float32), k


class Hub:
    """Latest-frame broadcaster. Slow clients just skip frames."""

    def __init__(self):
        self.cond = threading.Condition()
        self.seq = 0
        self.msg = None
        self.subs = 0
        self.last_sub = 0.0

    def publish(self, obj):
        data = json.dumps(obj, separators=(",", ":"))
        with self.cond:
            self.seq += 1
            self.msg = data
            self.cond.notify_all()

    def wait(self, seq, timeout):
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seq, timeout)
            return self.seq, self.msg

    def watching(self):
        return self.subs > 0 or (time.time() - self.last_sub) < 5


class RtlProc:
    def __init__(self, cmd):
        self.cmd = cmd
        self.err = deque(maxlen=12)
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self):
        for raw in iter(self.proc.stderr.readline, b""):
            line = raw.decode("utf-8", "replace").strip()
            if line:
                self.err.append(line)

    def read_exact(self, n):
        buf = bytearray(n)
        view = memoryview(buf)
        got = 0
        while got < n:
            k = self.proc.stdout.readinto(view[got:])
            if not k:
                return None
            got += k
        return buf

    def close(self):
        p = self.proc
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait(timeout=3)

    def why(self):
        rc = self.proc.poll()
        tail = " | ".join(list(self.err)[-3:])
        return f"{os.path.basename(self.cmd[0])} exited rc={rc}: {tail}" if rc is not None else tail


def rtl_sdr_cmd(center, rate, gain, ppm, fps):
    block = 16384 * max(1, min(64, int(round(rate * 2 / max(fps, 1) / 2 / 16384))))
    cmd = [RTL_SDR, "-f", str(int(center)), "-s", str(int(rate)), "-p", str(int(ppm)), "-b", str(block)] + DEV_ARGS
    if gain != "auto":
        cmd += ["-g", str(gain)]
    return cmd + ["-"]


class IQSpectrum:
    """Average |FFT|^2 of a few frames per row; the rest of the samples are drained."""

    def __init__(self, nfft):
        self.nfft = nfft
        self.win = np.hanning(nfft).astype(np.float32)
        self.norm = float(np.sum(self.win) ** 2)

    def row(self, buf, frames):
        n = self.nfft
        frames = max(1, min(frames, len(buf) // (2 * n)))
        x = np.frombuffer(buf, dtype=np.uint8, count=frames * n * 2).astype(np.float32)
        x -= 127.4
        x *= 1.0 / 128.0
        c = (x[0::2] + 1j * x[1::2]).reshape(frames, n) * self.win
        p = np.mean(np.abs(np.fft.fft(c, axis=1)) ** 2, axis=0)
        p = np.fft.fftshift(p) / self.norm
        mid = n // 2
        p[mid - 1:mid + 2] = (p[mid - 3] + p[mid + 3]) / 2.0   # hide the RTL DC spike
        return (10.0 * np.log10(p + 1e-20)).astype(np.float32)


class Scope:
    def __init__(self, mode):
        self.mode = mode
        self.cfg = load_cfg(mode)
        self.gen = 0
        self.lock = threading.Lock()
        self.hub = Hub()
        self.proc = None
        self.status = {"running": False, "error": "", "source": "", "frames": 0, "started": 0.0, "fps": 0.0}

    # ----- control -----
    def snapshot(self):
        with self.lock:
            return dict(self.cfg), self.gen

    def update(self, new):
        with self.lock:
            merged = dict(self.cfg)
            merged.update(new or {})
            cfg = validate(self.mode, merged)
            restart = any(cfg[k] != self.cfg.get(k) for k in cfg if k not in LIVE_KEYS)
            self.cfg = cfg
            if restart:
                self.gen += 1
        save_cfg(self.mode, cfg)
        if restart:
            self._kill()
        return cfg, restart

    def _kill(self):
        p = self.proc
        if p is not None:
            try:
                p.close()
            except Exception:
                pass

    def _err(self, msg):
        self.status.update(running=False, error=msg)
        self.hub.publish({"type": "status", "mode": self.mode, "error": msg, "t": time.time()})
        print(msg, flush=True)

    # ----- worker -----
    def run(self):
        while True:
            cfg, gen = self.snapshot()
            try:
                self.run_spectrum(cfg, gen)
            except FileNotFoundError as exc:
                self._err(f"missing tool: {exc.filename}. Install rtl-sdr (sudo apt-get install rtl-sdr)")
            except Exception as exc:   # keep the service alive and report
                self._err(f"{type(exc).__name__}: {exc}")
            finally:
                self._kill()
                self.proc = None
            if self.gen == gen:
                time.sleep(3)   # process died on its own: back off, then retry

    def _started(self, source):
        self.status.update(running=True, error="", source=source, frames=0, started=time.time())

    def _tick(self, t0):
        self.status["frames"] += 1
        dt = time.time() - t0
        if dt > 0:
            self.status["fps"] = round(self.status["frames"] / dt, 2)

    def run_spectrum(self, cfg, gen):
        rate = cfg["span_hz"]
        self.proc = RtlProc(rtl_sdr_cmd(cfg["center_hz"], rate, cfg["gain"], cfg["ppm"], cfg["fps"]))
        fft = IQSpectrum(cfg["nfft"])
        self._started("rtl_sdr")
        t0 = time.time()
        while self.gen == gen:
            live = self.cfg
            row_bytes = int(rate * 2 / live["fps"]) & ~1
            buf = self.proc.read_exact(row_bytes)
            if buf is None:
                if self.gen == gen:
                    self._err(self.proc.why() or "rtl_sdr stopped")
                return
            if not self.hub.watching():
                continue     # nobody looking: keep draining, skip the FFT
            db = fft.row(buf, live["avg"])
            lo, step, b64 = encode(db)
            n = cfg["nfft"]
            self._tick(t0)
            self.hub.publish({"type": "row", "mode": "spectrum", "t": time.time(),
                              "center": cfg["center_hz"], "span": rate, "n": n,
                              "f0": cfg["center_hz"] - rate / 2, "df": rate / n,
                              "lo": lo, "step": step, "b64": b64, "gain": cfg["gain"]})



app = Flask(__name__)
SCOPE = None


@app.after_request
def no_cache(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/health")
def health():
    return jsonify(ok=True, mode=SCOPE.mode)


@app.get("/api/scope/status")
def status():
    cfg, _ = SCOPE.snapshot()
    return jsonify(ok=True, mode=SCOPE.mode, config=cfg, status=SCOPE.status, 
                   spans=SPANS, gains=GAINS, nffts=NFFTS, clients=SCOPE.hub.subs,
                   range=[F_MIN, F_MAX])


@app.post("/api/scope/config")
def config():
    data = request.get_json(silent=True) or {}
    cfg, restarted = SCOPE.update(data)
    return jsonify(ok=True, mode=SCOPE.mode, config=cfg, restarted=restarted)


@app.get("/api/scope/stream")
def stream():
    hub = SCOPE.hub

    def gen():
        with hub.cond:
            hub.subs += 1
        seq = 0
        try:
            yield "retry: 2000\n\n"
            yield "event: hello\ndata: " + json.dumps({"mode": SCOPE.mode}) + "\n\n"
            while True:
                nseq, msg = hub.wait(seq, 15)
                if nseq == seq or msg is None:
                    yield ": keepalive\n\n"
                    continue
                seq = nseq
                yield "data: " + msg + "\n\n"
        finally:
            with hub.cond:
                hub.subs -= 1
                hub.last_sub = time.time()

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


def main():
    global SCOPE
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["spectrum"], default="spectrum")
    ap.add_argument("--port", type=int, default=int(os.environ.get("SDR_SCOPE_PORT", "8081")))
    ap.add_argument("--host", default=os.environ.get("SDR_SCOPE_HOST", "127.0.0.1"))
    args = ap.parse_args()
    SCOPE = Scope(args.mode)

    def bye(*_):
        SCOPE._kill()
        os._exit(0)

    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    threading.Thread(target=SCOPE.run, daemon=True).start()
    print(f"SDR scope ({args.mode}) listening on {args.host}:{args.port}", flush=True)
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
