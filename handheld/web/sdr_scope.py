#!/usr/bin/env python3
"""Stillwave Trace scope: owns the RTL-SDR for the spectrum/waterfall page or the RF
detection page and pushes frames to browsers with Server-Sent Events.

  --mode spectrum  rtl_sdr IQ -> numpy FFT -> waterfall rows (~8/s)
  --mode detect    rtl_power sweeps (wide ranges) or rtl_sdr FFT (<= 2 MHz)
                   -> learned noise floor -> signals above threshold

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
RTL_POWER = os.environ.get("SDR_RTL_POWER_BIN", "rtl_power")
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
IQ_DETECT_MAX_SPAN = 2.0e6 + 1e3   # narrower detect ranges use the fast IQ path
DISPLAY_POINTS = 1600

PRESETS = [
    {"id": "full", "name": "Full range 24–1700 MHz", "start": 24e6, "stop": 1700e6},
    {"id": "fm", "name": "FM broadcast", "start": 87.5e6, "stop": 108e6},
    {"id": "air", "name": "Airband", "start": 118e6, "stop": 137e6},
    {"id": "2m", "name": "2 m ham", "start": 144e6, "stop": 148e6},
    {"id": "marine", "name": "Marine / NOAA WX", "start": 156e6, "stop": 163e6},
    {"id": "315", "name": "315 MHz keyfobs / TPMS", "start": 314e6, "stop": 316e6},
    {"id": "70cm", "name": "70 cm ham", "start": 420e6, "stop": 450e6},
    {"id": "433", "name": "433 MHz ISM", "start": 433.05e6, "stop": 434.79e6},
    {"id": "frs", "name": "FRS / GMRS", "start": 462e6, "stop": 468e6},
    {"id": "cell700", "name": "Cell 700 MHz", "start": 698e6, "stop": 806e6},
    {"id": "cell850", "name": "Cell 850 MHz", "start": 824e6, "stop": 894e6},
    {"id": "915", "name": "915 MHz ISM", "start": 902e6, "stop": 928e6},
    {"id": "adsb", "name": "ADS-B 1090", "start": 1085e6, "stop": 1095e6},
    {"id": "aws", "name": "AWS uplink 1710 MHz", "start": 1710e6, "stop": 1760e6},
]


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
    "detect": {"start_hz": 24e6, "stop_hz": 1700e6, "bin_hz": 0, "gain": "29.7",
               "threshold_db": 10.0, "hold_s": 120, "ppm": None, "track_hz": 0},
}
# keys that can change without restarting the rtl process
LIVE_KEYS = {"threshold_db", "hold_s", "track_hz", "fps", "avg"}


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
    else:
        a = _num(d["start_hz"], F_MIN, F_MAX - 0.1e6, 24e6)
        b = _num(d["stop_hz"], F_MIN + 0.1e6, F_MAX, 1700e6)
        if b <= a:
            a, b = min(a, b), max(a, b) + 0.1e6
        d["start_hz"], d["stop_hz"] = a, min(b, F_MAX)
        d["bin_hz"] = _num(d["bin_hz"], 0, 1e6, 0)
        d["threshold_db"] = _num(d["threshold_db"], 2, 60, 10.0)
        d["hold_s"] = int(_num(d["hold_s"], 5, 3600, 120))
        d["track_hz"] = _num(d["track_hz"], 0, F_MAX, 0)
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


def auto_bin(span):
    for b in (1e3, 2e3, 5e3, 10e3, 12.5e3, 25e3, 50e3, 100e3, 125e3, 250e3, 500e3, 1e6):
        if span / b <= 4000:
            return b
    return 1e6


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


def local_floor(db):
    """Noise floor per bin: 25th percentile in blocks, interpolated. Robust to signals."""
    n = len(db)
    block = int(max(8, min(256, n // 48)))
    nb = int(math.ceil(n / block))
    pad = nb * block - n
    a = np.concatenate([db, np.full(pad, db[-1], dtype=np.float32)]) if pad else db
    q = np.percentile(a.reshape(nb, block), 25, axis=1)
    centers = np.arange(nb) * block + (block - 1) / 2.0
    return np.interp(np.arange(n), centers, q).astype(np.float32)


class Detector:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        with getattr(self, "lock", threading.Lock()):
            self.floor = None
            self.sweeps = 0
            self.hits = []

    def process(self, freqs, db, cfg, bin_hz):
        with self.lock:
            return self._process(freqs, db, cfg, bin_hz)

    def _process(self, freqs, db, cfg, bin_hz):
        now = time.time()
        db = np.asarray(db, dtype=np.float32)
        fin = np.isfinite(db)
        if not fin.all():
            db = np.where(fin, db, np.min(db[fin]) if fin.any() else -100.0).astype(np.float32)
        lf = local_floor(db)
        if self.floor is None or len(self.floor) != len(db):
            self.floor = lf
            self.sweeps = 0
        else:
            a = 0.5 if self.sweeps < 3 else 0.15
            self.floor = ((1 - a) * self.floor + a * lf).astype(np.float32)
        self.sweeps += 1
        floor = self.floor
        excess = db - floor
        thr = float(cfg["threshold_db"])

        peaks = []
        mask = excess >= thr
        if mask.any():
            edges = np.diff(np.concatenate([[0], mask.view(np.int8), [0]]))
            starts = np.flatnonzero(edges == 1)
            ends = np.flatnonzero(edges == -1)
            runs = []
            for s, e in zip(starts[:600], ends[:600]):
                if runs and s - runs[-1][1] <= 2:      # close tiny gaps inside one signal
                    runs[-1][1] = e
                else:
                    runs.append([s, e])
            for s, e in runs[:400]:
                i = s + int(np.argmax(excess[s:e]))
                peaks.append({"f": float(freqs[i]), "db": round(float(db[i]), 1),
                              "ex": round(float(excess[i]), 1), "w": float((e - s) * bin_hz)})
            peaks.sort(key=lambda p: p["ex"], reverse=True)
            peaks = peaks[:40]

        tol = max(2 * bin_hz, 10e3)
        for p in peaks:
            for h in self.hits:
                if abs(h["f"] - p["f"]) <= max(tol, (h["w"] + p["w"]) / 2):
                    h.update(f=p["f"] if p["ex"] >= h["ex"] else h["f"], db=p["db"], ex=p["ex"], last=now,
                             w=max(h["w"], p["w"]))
                    h["hits"] += 1
                    h["max_ex"] = max(h["max_ex"], p["ex"])
                    break
            else:
                self.hits.append({"f": p["f"], "db": p["db"], "ex": p["ex"], "max_ex": p["ex"], "w": p["w"],
                                  "hits": 1, "first": now, "last": now})
        hold = float(cfg["hold_s"])
        self.hits = [h for h in self.hits if now - h["last"] <= hold]
        self.hits.sort(key=lambda h: (-(now - h["last"] < 3), -h["max_ex"]))
        self.hits = self.hits[:200]
        hits = [{"f": h["f"], "db": h["db"], "ex": h["ex"], "max_ex": h["max_ex"], "hits": h["hits"],
                 "age": round(now - h["last"], 1), "since": round(now - h["first"], 1)} for h in self.hits[:60]]

        if peaks:
            strongest = dict(peaks[0])
        else:
            i = int(np.argmax(excess))
            strongest = {"f": float(freqs[i]), "db": round(float(db[i]), 1), "ex": round(float(excess[i]), 1), "w": 0}

        track = None
        th = float(cfg.get("track_hz") or 0)
        if th and freqs[0] - tol <= th <= freqs[-1] + tol:
            sel = np.abs(freqs - th) <= max(tol / 2, bin_hz)
            if sel.any():
                j = np.flatnonzero(sel)[int(np.argmax(excess[sel]))]
                track = {"f": float(th), "db": round(float(db[j]), 1), "ex": round(float(excess[j]), 1)}

        disp, k = maxpool(db, DISPLAY_POINTS)
        fdisp, _ = maxpool(floor, DISPLAY_POINTS)
        lo, step, b64 = encode(np.concatenate([disp, fdisp]))
        q = base64.b64decode(b64)
        half = len(disp)
        return {
            "f0": float(freqs[0]), "df": float(bin_hz * k), "n": half,
            "lo": lo, "step": step,
            "b64": base64.b64encode(q[:half]).decode("ascii"),
            "floor_b64": base64.b64encode(q[half:]).decode("ascii"),
            "floor_db": round(float(np.median(floor)), 1),
            "learning": self.sweeps < 4, "sweeps": self.sweeps, "threshold": thr,
            "peaks": peaks, "hits": hits, "strongest": strongest, "track": track,
        }


class Scope:
    def __init__(self, mode):
        self.mode = mode
        self.cfg = load_cfg(mode)
        self.gen = 0
        self.lock = threading.Lock()
        self.hub = Hub()
        self.det = Detector()
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
            if self.mode == "detect":
                self.det.reset()
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
                if self.mode == "spectrum":
                    self.run_spectrum(cfg, gen)
                elif cfg["stop_hz"] - cfg["start_hz"] <= IQ_DETECT_MAX_SPAN:
                    self.run_detect_iq(cfg, gen)
                else:
                    self.run_detect_sweep(cfg, gen)
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

    def _publish_detect(self, cfg, freqs, db, bin_hz, source, sweep_s):
        live = dict(self.cfg)
        out = self.det.process(freqs, db, live, bin_hz)
        out.update(type="sweep", mode="detect", t=time.time(), source=source,
                   start=cfg["start_hz"], stop=cfg["stop_hz"], bin=bin_hz,
                   sweep_s=round(sweep_s, 2), gain=cfg["gain"])
        self.hub.publish(out)

    def run_detect_iq(self, cfg, gen):
        rate = 2.4e6
        span = cfg["stop_hz"] - cfg["start_hz"]
        # Tune off-center so a signal in the middle of the range is not hidden by the DC spike
        center = (cfg["start_hz"] + cfg["stop_hz"]) / 2 + (250e3 if span <= 1.4e6 else 150e3)
        nfft = 2048
        fps = 5
        self.proc = RtlProc(rtl_sdr_cmd(center, rate, cfg["gain"], cfg["ppm"], fps))
        fft = IQSpectrum(nfft)
        freqs_all = center - rate / 2 + np.arange(nfft) * (rate / nfft)
        sel = (freqs_all >= cfg["start_hz"]) & (freqs_all <= cfg["stop_hz"])
        freqs = freqs_all[sel]
        self._started("rtl_sdr")
        t0 = time.time()
        last = time.time()
        while self.gen == gen:
            buf = self.proc.read_exact(int(rate * 2 / fps) & ~1)
            if buf is None:
                if self.gen == gen:
                    self._err(self.proc.why() or "rtl_sdr stopped")
                return
            db = fft.row(buf, 48)[sel]
            now = time.time()
            self._tick(t0)
            self._publish_detect(cfg, freqs, db, rate / nfft, "rtl_sdr", now - last)
            last = now

    def run_detect_sweep(self, cfg, gen):
        span = cfg["stop_hz"] - cfg["start_hz"]
        bin_hz = cfg["bin_hz"] or auto_bin(span)
        cmd = [RTL_POWER, "-f", f"{int(cfg['start_hz'])}:{int(cfg['stop_hz'])}:{int(bin_hz)}",
               "-i", "1", "-c", "20%", "-p", str(int(cfg["ppm"]))] + DEV_ARGS
        if cfg["gain"] != "auto":
            cmd += ["-g", str(cfg["gain"])]
        cmd.append("-")
        if shutil.which("stdbuf"):
            cmd = ["stdbuf", "-oL"] + cmd       # rtl_power uses stdio; force line flushes
        self.proc = RtlProc(cmd)
        self._started("rtl_power")
        t0 = time.time()
        segs = []
        last_low = None
        last_stamp = None
        sweep_t = time.time()
        last_progress = 0.0
        for raw in iter(self.proc.proc.stdout.readline, b""):
            if self.gen != gen:
                return
            parts = raw.decode("ascii", "replace").strip().split(",")
            if len(parts) < 7:
                continue
            try:
                low = float(parts[2])
                step = float(parts[4])
                vals = np.array([float(v) for v in parts[6:]], dtype=np.float32)
            except ValueError:
                continue
            stamp = (parts[0].strip(), parts[1].strip())
            if segs and (low <= last_low or (stamp != last_stamp and low <= segs[0][0])):
                segs.sort(key=lambda s: s[0])
                freqs = np.concatenate([s[0] + np.arange(len(s[2])) * s[1] for s in segs])
                db = np.concatenate([s[2] for s in segs])
                now = time.time()
                self._tick(t0)
                self._publish_detect(cfg, freqs, db, segs[0][1] or bin_hz, "rtl_power", now - sweep_t)
                sweep_t = now
                segs = []
            segs.append((low, step, vals))
            last_low, last_stamp = low, stamp
            now = time.time()
            if now - last_progress > 1.0:
                last_progress = now
                pct = (low - cfg["start_hz"]) / max(span, 1) * 100
                self.hub.publish({"type": "progress", "mode": "detect", "t": now,
                                  "at": low, "pct": round(min(100, max(0, pct)), 1)})
        if self.gen == gen:
            self._err(self.proc.why() or "rtl_power stopped")


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
    return jsonify(ok=True, mode=SCOPE.mode, config=cfg, status=SCOPE.status, presets=PRESETS,
                   spans=SPANS, gains=GAINS, nffts=NFFTS, clients=SCOPE.hub.subs,
                   range=[F_MIN, F_MAX])


@app.post("/api/scope/config")
def config():
    data = request.get_json(silent=True) or {}
    cfg, restarted = SCOPE.update(data)
    return jsonify(ok=True, mode=SCOPE.mode, config=cfg, restarted=restarted)


@app.post("/api/scope/relearn")
def relearn():
    SCOPE.det.reset()
    return jsonify(ok=True, message="noise floor reset; learning")


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
    ap.add_argument("--mode", choices=["spectrum", "detect"], required=True)
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
