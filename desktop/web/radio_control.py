#!/usr/bin/env python3
from pathlib import Path
import json
import math
import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

from flask import Flask, Response, abort, jsonify, request, send_from_directory

app = Flask(__name__)
CONF = Path(os.environ.get("SDR_STATIONS_CONF", "/etc/sdr/stations.conf"))
ENV = Path(os.environ.get("SDR_ENV_FILE", "/etc/sdr/fm.env"))
SELECT = os.environ.get("SDR_SELECT_BIN", "/usr/local/sbin/sdr-select-station")
TUNE_FREQ = os.environ.get("SDR_TUNE_BIN", "/usr/local/sbin/sdr-tune-freq")
ADD_STATION = os.environ.get("SDR_ADD_BIN", "/usr/local/sbin/sdr-add-station")
APPLY = os.environ.get("SDR_APPLY_BIN", "/usr/local/sbin/sdr-apply-settings")
SAVE_PRESET = os.environ.get("SDR_SAVE_BIN", "/usr/local/sbin/sdr-save-preset")
DELETE_PRESET = os.environ.get("SDR_DELETE_BIN", "/usr/local/sbin/sdr-delete-preset")
NET_MODE = os.environ.get("SDR_NET_BIN", "/usr/local/sbin/sdr-net-mode")
BT = os.environ.get("SDR_BT_BIN", "/usr/local/sbin/sdr-bt")
SVC = os.environ.get("SDR_SVC_BIN", "/usr/local/sbin/sdr-svc")
ICECAST = os.environ.get("SDR_ICECAST_URL", "http://127.0.0.1:8000/live.mp3")
MODE_BIN = os.environ.get("SDR_MODE_BIN", "/usr/local/sbin/sdr-mode")
SCOPE_URL = os.environ.get("SDR_SCOPE_URL", "http://127.0.0.1:8081")
ADSB_JSON = Path(os.environ.get("SDR_ADSB_JSON", "/run/sdr-adsb/aircraft.json"))
ADSB_ENV = Path(os.environ.get("SDR_ADSB_ENV", "/etc/sdr/adsb.env"))
MAPS_DIR = Path(os.environ.get("SDR_MAPS_DIR", "/var/lib/sdr/maps"))
MAPS_BIN = os.environ.get("SDR_MAPS_BIN", "/usr/local/sbin/sdr-maps")
POWER_BIN = os.environ.get("SDR_POWER_BIN", "/usr/local/sbin/sdr-power")
UPDATE_BIN = os.environ.get("SDR_UPDATE_BIN", "/usr/local/sbin/sdr-update")
UPLOAD_DIR = Path(os.environ.get("SDR_UPLOAD_DIR", "/tmp/sdr-update-upload"))
SCREEN_BIN = os.environ.get("SDR_SCREEN_BIN", "/usr/local/sbin/sdr-screen")
# 1.0.9
DONGLES_BIN = os.environ.get("SDR_DONGLES_BIN", "/usr/local/sbin/sdr-dongles")
SHOT_BIN = os.environ.get("SDR_SHOT_BIN", "/usr/local/sbin/sdr-shot")
SHOT_DIR = os.environ.get("SDR_SHOT_DIR", "/var/lib/sdr/screenshots")
SCREEN_STATE = Path(os.environ.get("SDR_SCREEN_STATE", "/run/sdr-screen/state.json"))
SCREEN_NOTICE = Path(os.environ.get("SDR_SCREEN_NOTICE", "/run/sdr-screen/shutdown.json"))
SCREEN_CONF = Path(os.environ.get("SDR_SCREEN_CONF", "/etc/sdr/screen.env"))
# Map center / distance origin when no receiver position is saved: LAX airport reference point
DEFAULT_RECEIVER = (33.9425, -118.4081)
MODES = ("fm", "spectrum", "adsb")   # 1.3.2: detect (Scan) removed

DEFAULTS = {
    "gain": "4",
    "audio_rate": "48000",  # 1.3.2 new-preset defaults: 48000 / 50 / 8000 Hz (was 8500 in 1.3.1)
    "mp3_bitrate": "128k",
    "highpass": "50",
    "lowpass": "8000",
    "ppm": "0",
}
WEBDIR = Path(__file__).resolve().parent

FALLBACK = [
    {"id": "alt987", "name": "ALT 98.7", "frequency": "98.705M", "gain": "4"},
    {"id": "klos955", "name": "KLOS 95.5", "frequency": "95.5M", "gain": "4"},
    {"id": "kroq1067", "name": "KROQ 106.7", "frequency": "106.7M", "gain": "4"},
]


@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Cache-Control"] = "no-store"
    return resp


def stations():
    out = []
    if CONF.is_file():
        try:
            for line in CONF.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "|" not in line:
                    continue
                p = [x.strip() for x in line.split("|")]
                if len(p) >= 4:
                    out.append({
                        "id": p[0],
                        "name": p[1],
                        "frequency": p[2],
                        "gain": p[3] or DEFAULTS["gain"],
                        "audio_rate": (p[4] if len(p) > 4 and p[4] else DEFAULTS["audio_rate"]),
                        "mp3_bitrate": (p[5] if len(p) > 5 and p[5] else DEFAULTS["mp3_bitrate"]),
                        "highpass": (p[6] if len(p) > 6 and p[6] else DEFAULTS["highpass"]),
                        "lowpass": (p[7] if len(p) > 7 and p[7] else DEFAULTS["lowpass"]),
                        "ppm": (p[8] if len(p) > 8 and p[8] else DEFAULTS["ppm"]),
                    })
        except OSError:
            pass
    return out or list(FALLBACK)


def env():
    d = {}
    try:
        for line in ENV.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip()
    except OSError:
        pass
    return d


def current_station():
    sts = stations()
    e = env()
    cid = e.get("STATION_ID", "")
    for s in sts:
        if s["id"] == cid:
            return s
    live = {
        "id": cid or "unknown",
        "name": e.get("STATION_NAME", "Unknown"),
        "frequency": e.get("FREQ", ""),
        "gain": e.get("GAIN", DEFAULTS["gain"]),
        "audio_rate": e.get("AUDIO_RATE", DEFAULTS["audio_rate"]),
        "mp3_bitrate": e.get("MP3_BITRATE", DEFAULTS["mp3_bitrate"]),
        "highpass": e.get("HIGHPASS_HZ", DEFAULTS["highpass"]),
        "lowpass": e.get("LOWPASS_HZ", DEFAULTS["lowpass"]),
        "ppm": e.get("RTL_PPM", DEFAULTS["ppm"]),
    }
    for s in sts:
        if s["id"] == cid:
            merged = dict(s)
            merged.update({k: live[k] for k in live if live[k]})
            return merged
    if e.get("STATION_NAME") or e.get("FREQ"):
        return live
    return sts[0] if sts else live


def _html(name):
    path = WEBDIR / name
    body = path.read_text(encoding="utf-8") if path.is_file() else f"<h1>{name}</h1>"
    return Response(body, content_type="text/html; charset=utf-8")


# 1.0.8: one shell page (strip + nav, pages swap inside it without a full reload). "/" opens Spectrum.
@app.get("/")
@app.get("/app")
@app.get("/app.html")
def page():
    return _html("app.html")


@app.get("/radio")
@app.get("/radio.html")
def radio_page():
    from flask import redirect   # 1.2.7: the old FM page was orphaned; send old links/bookmarks to Listen
    return redirect("/listen" + (("?" + request.query_string.decode()) if request.query_string else ""), code=302)


@app.get("/listen")
@app.get("/listen.html")
def listen_page():
    return _html("listen.html")


@app.get("/scan")
@app.get("/scan.html")
@app.get("/detect")
@app.get("/detect.html")
def scan_page():
    from flask import redirect   # 1.3.2: the Scan tab and its hidden one-shot FM scan were removed; old links open Spectrum
    return redirect("/spectrum", code=302)


@app.get("/dashboard")
@app.get("/dashboard.html")
def dashboard_gone():
    from flask import redirect
    return redirect("/" + (("?" + request.query_string.decode()) if request.query_string else ""), code=302)   # 1.0.8: dashboard removed (kiosk flags kept)


@app.get("/advanced")
@app.get("/advanced.html")
def advanced():
    from flask import redirect   # 1.2.8: Tuner page removed (Station bank + Scan replace it); old links go to Listen
    return redirect("/listen" + (("?" + request.query_string.decode()) if request.query_string else ""), code=302)


@app.get("/presets")
@app.get("/presets.html")
def presets_page():
    return _html("presets.html")


@app.get("/network")
@app.get("/network.html")
def network_page():
    return _html("network.html")


@app.get("/system")
@app.get("/system.html")
def system_page():
    return _html("system.html")   # 1.3.1: Services + Logs (moved off Network)


@app.get("/audio")
@app.get("/audio.html")
def audio_page():
    return _html("audio.html")


@app.get("/spectrum")
@app.get("/spectrum.html")
def spectrum_page():
    return _html("spectrum.html")


@app.get("/adsb")
@app.get("/adsb.html")
def adsb_page():
    return _html("adsb.html")


@app.get("/settings")
@app.get("/settings.html")
def settings_page():
    return _html("settings.html")


@app.get("/more")
@app.get("/more.html")
def more_page():
    from flask import redirect   # 1.3: More was renamed Settings; old links/bookmarks land there
    q = request.query_string.decode()
    return redirect("/settings" + ("?" + q if q else ""), code=302)


@app.get("/dongles")
@app.get("/dongles.html")
@app.get("/roles")
@app.get("/roles.html")
def dongles_page():
    return _html("dongles.html")


@app.get("/about")
@app.get("/about.html")
def about_page():
    return _html("about.html")


@app.get("/airmap.js")
def airmap_js():
    return send_from_directory(WEBDIR, "airmap.js", mimetype="application/javascript", max_age=0)


@app.get("/towers.js")
def towers_js():   # 1.3.6: FM towers layer on the Map page
    return send_from_directory(WEBDIR, "towers.js", mimetype="application/javascript", max_age=0)


@app.get("/shots")
@app.get("/shots.html")
def shots_page():
    return _html("shots.html")


@app.get("/screen")
@app.get("/screen.html")
def screen_page():
    return _html("screen.html")


@app.get("/screen.js")
def screen_js():
    path = WEBDIR / "screen.js"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="application/javascript; charset=utf-8")


@app.get("/kbd.js")
def kbd_js():
    """On-screen keyboard for the kiosk (1.0.6)."""
    path = WEBDIR / "kbd.js"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="application/javascript; charset=utf-8")


@app.get("/updates")
@app.get("/updates.html")
def updates_page():
    return _html("updates.html")


# Offline map assets. nginx serves these directly (with Range); these routes cover :8080 access.
_MAPLIB_TYPES = {".mjs": "application/javascript", ".js": "application/javascript", ".css": "text/css",
                 ".json": "application/json", ".pbf": "application/x-protobuf", ".png": "image/png",
                 ".geojson": "application/geo+json"}


@app.get("/maplib/<path:sub>")
def maplib(sub):
    root = WEBDIR / "maplib"
    target = (root / sub).resolve()
    if not str(target).startswith(str(root.resolve()) + os.sep):
        abort(404)
    if not target.is_file():
        if sub.startswith("fonts/") and sub.endswith(".pbf"):
            sub = "fonts/empty.pbf"  # glyph ranges we do not ship (CJK is drawn with local fonts)
        else:
            abort(404)
    r = send_from_directory(root, sub, conditional=True,
                            mimetype=_MAPLIB_TYPES.get(Path(sub).suffix, "application/octet-stream"))
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/maps/<name>")
def maps_file(name):
    if name not in ("la.pmtiles", "la.json"):
        abort(404)
    r = send_from_directory(MAPS_DIR, name, conditional=True)  # Range requests for PMTiles
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/maps/packs/<name>")
def maps_pack_file(name):
    # 1.2.6: downloaded map packs (sdr-content), same Range handling as la.pmtiles
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}\.pmtiles", name):
        abort(404)
    r = send_from_directory(MAPS_DIR / "packs", name, conditional=True)
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/mode.js")
def mode_js():
    path = WEBDIR / "mode.js"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="application/javascript; charset=utf-8")


@app.get("/map108.js")
@app.get("/map108.css")
def map108_asset():
    name = request.path.lstrip("/")
    path = WEBDIR / name
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type=("text/css" if name.endswith(".css") else "application/javascript") + "; charset=utf-8")


@app.get("/nav.js")
def nav_js():
    path = WEBDIR / "nav.js"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="application/javascript; charset=utf-8")


@app.get("/power.js")
def power_js():
    path = WEBDIR / "power.js"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="application/javascript; charset=utf-8")


@app.post("/api/power/<action>")
def power(action):
    """Reboot / shut down. Needs a JSON body {"confirm": "<action>"} so a stray GET, a link or a
    plain HTML form can never trigger it. Answers 202 at once; sdr-power runs the action ~1 s later."""
    if action not in ("reboot", "poweroff"):
        return jsonify(ok=False, error="unknown action (reboot | poweroff)"), 404
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict) or body.get("confirm") != action:
        return jsonify(ok=False, error=f'confirmation missing: POST JSON {{"confirm": "{action}"}}'), 400
    try:
        r = _sudo([POWER_BIN, action], timeout=15)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="sdr-power timed out"), 504
    if r.returncode != 0:
        return jsonify(ok=False, error=(r.stderr or r.stdout or "sdr-power failed").strip()[-300:]), 500
    return jsonify(ok=True, action=action, in_seconds=1), 202


@app.get("/fonts/<name>")
def ui_font(name):
    """Stillwave UI fonts (Anton, JetBrains Mono; bundled, offline). Whitelisted names only."""
    if name not in ("anton-latin.woff2", "jetbrainsmono-latin.woff2"):
        abort(404)
    r = send_from_directory(WEBDIR / "fonts", name, conditional=True, mimetype="font/woff2")
    r.headers["Cache-Control"] = "max-age=86400"
    return r


@app.get("/manifest.webmanifest")
def web_manifest():
    """1.2.0 iPhone / Android home-screen web app: full-screen launch, Trace icon, dark theme."""
    m = {"name": "Stillwave Trace", "short_name": "Trace", "start_url": "/", "scope": "/", "display": "standalone",
         "orientation": "any", "background_color": "#0b0f0c", "theme_color": "#0b0f0c",
         "icons": [{"src": "/img/trace-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                   {"src": "/img/trace-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}
    r = Response(json.dumps(m), content_type="application/manifest+json")
    r.headers["Cache-Control"] = "max-age=3600"
    return r


@app.get("/apple-touch-icon.png")
@app.get("/apple-touch-icon-precomposed.png")
def apple_touch_icon():
    r = send_from_directory(WEBDIR / "img", "apple-touch-icon.png", conditional=True, mimetype="image/png")
    r.headers["Cache-Control"] = "max-age=86400"
    return r


@app.get("/img/<name>")
def ui_img(name):
    """Trace artwork (kiosk shutdown screen, same art as the boot splash) + 1.2.0 app icons. Whitelisted names only."""
    if name not in ("trace-art.png", "trace-icon-192.png", "trace-icon-512.png", "apple-touch-icon.png"):
        abort(404)
    r = send_from_directory(WEBDIR / "img", name, conditional=True, mimetype="image/png")
    r.headers["Cache-Control"] = "max-age=86400"
    return r


@app.get("/fieldnote.css")
def fieldnote_css():
    path = WEBDIR / "fieldnote.css"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="text/css; charset=utf-8")


@app.get("/content.css")
def content_css():
    """1.3.4: Maps, Stations and Presets pages load /content.css; without this route it was a 404 (labels ran together)."""
    path = WEBDIR / "content.css"
    body = path.read_text(encoding="utf-8") if path.is_file() else ""
    return Response(body, content_type="text/css; charset=utf-8")


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.get("/api/status")
def status():
    return jsonify(stations=stations(), current=current_station())


@app.route("/api/station/<sid>", methods=["GET", "POST", "OPTIONS"])
def tune(sid):
    if request.method == "OPTIONS":
        return Response(status=204)
    ids = {s["id"] for s in stations()}
    if sid not in ids:
        return jsonify(error=f"unknown station {sid}"), 404
    try:
        r = subprocess.run(
            ["/usr/bin/sudo", "-n", SELECT, sid],
            text=True,
            capture_output=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        return jsonify(error="tune timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "tune failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "tuned").strip(), current=current_station())


@app.get("/api/stream-ready")
def stream_ready():
    try:
        req = urllib.request.Request(ICECAST, headers={"Icy-MetaData": "0", "User-Agent": "sdr-ready"})
        with urllib.request.urlopen(req, timeout=3) as up:
            chunk = up.read(4096)
        return jsonify(ok=len(chunk) > 0, bytes=len(chunk))
    except Exception as exc:
        return jsonify(ok=False, error=str(exc))



def _net_web_log(msg):
    try:
        with open("/tmp/sdr-web-net.log", "a") as f:
            from datetime import datetime
            f.write(datetime.now().isoformat() + " [sdr-web] " + str(msg) + "\n")
    except Exception:
        pass


def _sudo(cmd, timeout=20):
    return subprocess.run(
        ["/usr/bin/sudo", "-n", *cmd],
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _settings_from_request():
    data = request.get_json(silent=True) or {}
    sid = str(data.get("id") or "preview").strip()
    name = str(data.get("name") or sid).strip()
    freq = str(data.get("frequency") or data.get("freq") or "").strip()
    if not freq:
        raise ValueError("frequency required")
    return [
        sid,
        name,
        freq,
        str(data.get("gain") or DEFAULTS["gain"]).strip(),
        str(data.get("audio_rate") or DEFAULTS["audio_rate"]).strip(),
        str(data.get("mp3_bitrate") or DEFAULTS["mp3_bitrate"]).strip(),
        str(data.get("highpass") or DEFAULTS["highpass"]).strip(),
        str(data.get("lowpass") or DEFAULTS["lowpass"]).strip(),
        str(data.get("ppm") or DEFAULTS["ppm"]).strip(),
    ]


@app.post("/api/preview")
def preview():
    try:
        args = _settings_from_request()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    try:
        r = _sudo([APPLY, *args], timeout=25)
    except subprocess.TimeoutExpired:
        return jsonify(error="preview timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "preview failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "preview").strip(), current=current_station())


@app.post("/api/preset")
def save_preset():
    try:
        args = _settings_from_request()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    try:
        r = _sudo([SAVE_PRESET, *args], timeout=25)
    except subprocess.TimeoutExpired:
        return jsonify(error="save timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "save failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "saved").strip(), stations=stations(), current=current_station())


@app.post("/api/preset/delete")
def delete_preset():
    data = request.get_json(silent=True) or {}
    sid = str(data.get("id") or "").strip()
    if not sid:
        return jsonify(error="id required"), 400
    try:
        r = _sudo([DELETE_PRESET, sid])
    except subprocess.TimeoutExpired:
        return jsonify(error="delete timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "delete failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "deleted").strip(), stations=stations(), current=current_station())


@app.post("/api/tune")
def tune_freq():
    data = request.get_json(silent=True) or {}
    freq = str(data.get("freq") or "").strip()
    gain = str(data.get("gain") or "4").strip()
    if not freq:
        return jsonify(error="freq required"), 400
    try:
        r = _sudo([TUNE_FREQ, freq, gain], timeout=25)
    except subprocess.TimeoutExpired:
        return jsonify(error="tune timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "tune failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "tuned").strip(), current=current_station())


# ---------- 1.0.8 Listen: airband (AM 118-137 MHz) + NOAA weather (narrow FM) ----------
LISTEN = os.environ.get("SDR_LISTEN_BIN", "/usr/local/sbin/sdr-listen")
USB_RESET = os.environ.get("SDR_USB_RESET_BIN", "/usr/local/sbin/sdr-usb-reset")


def demod_for(mhz):
    """Right demodulator for a frequency: 88-108 wideband FM, airband AM, everything else narrow FM."""
    if 87.5 <= mhz <= 108.0:
        return "wfm"
    if 118.0 <= mhz <= 137.0:
        return "am"
    return "nfm"


@app.get("/api/listen")
def listen_state():
    try:
        r = _sudo([LISTEN, "presets"], timeout=10)
        pre = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    except Exception:
        pre = {}
    try:
        r = _sudo([LISTEN, "bands"], timeout=10)
        bands = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    except Exception:
        bands = {}
    e = env()
    return jsonify(ok=True, airband=pre.get("airband", []), noaa=pre.get("noaa", []), frs=pre.get("frs", []), band=e.get("BAND") or "fm",
                   demod=e.get("DEMOD") or "wfm", squelch=e.get("SQUELCH") or "0", current=current_station(), bands=bands)


@app.post("/api/listen/band")
def listen_band():
    """1.0.9: per-band gain / squelch (FM, airband, NOAA), saved separately (sdr-listen band -> sdr-fm-env)."""
    d = request.get_json(silent=True) or {}
    band = str(d.get("band") or "")
    if band not in ("fm", "airband", "noaa", "frs"):
        return jsonify(error="band must be fm, airband, noaa or frs"), 400
    args = [LISTEN, "band", band]
    if d.get("gain") is not None:
        args.append("gain=" + str(d.get("gain"))[:8])
    if d.get("squelch") is not None:
        args.append("squelch=" + str(d.get("squelch"))[:4])
    for k in ("rate", "hp", "lp"):   # 1.3.1 audio filters (FM: rate/hp/lp, airband: hp/lp); "" = back to default
        if k in d and d.get(k) is not None:
            args.append(k + "=" + re.sub(r"[^0-9a-z]", "", str(d.get(k)))[:8])
    try:
        r = _sudo(args, timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(error="timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "failed").strip()), 400
    return jsonify(ok=True, bands=json.loads(r.stdout.strip().splitlines()[-1]))


@app.post("/api/listen/tune")
def listen_tune():
    d = request.get_json(silent=True) or {}
    try:
        mhz = round(float(d.get("mhz")), 4)
    except (TypeError, ValueError):
        return jsonify(error="mhz required"), 400
    demod = str(d.get("demod") or demod_for(mhz))
    if demod not in ("wfm", "am", "nfm"):
        return jsonify(error="demod must be wfm, am or nfm"), 400
    sq = str(int(d.get("squelch") or 0)) if str(d.get("squelch") or "0").isdigit() else "0"
    args = [LISTEN, "tune", ("%.4f" % mhz).rstrip("0").rstrip("."), demod, sq, str(d.get("name") or "")[:40]]
    if d.get("band"):
        args.append(str(d.get("band")))
    try:
        r = _sudo(args, timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(error="tune timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "tune failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "tuned").strip(), demod=demod, mhz=mhz, current=current_station())


@app.post("/api/listen/preset")
@app.post("/api/listen/preset/delete")
def listen_preset():
    d = request.get_json(silent=True) or {}
    band = str(d.get("band") or "")
    act = "delete" if request.path.endswith("/delete") else "save"
    args = [LISTEN, act, band, str(d.get("mhz") or "")] + ([str(d.get("name") or "")[:40]] if act == "save" else [])
    try:
        r = _sudo(args, timeout=10)
    except subprocess.TimeoutExpired:
        return jsonify(error="timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "failed").strip()), 400
    return jsonify(dict(json.loads(r.stdout.strip().splitlines()[-1]), ok=True))


@app.post("/api/sdr/reset-usb")
def sdr_reset_usb():
    try:
        r = _sudo([USB_RESET], timeout=60)
    except subprocess.TimeoutExpired:
        return jsonify(error="reset timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "reset failed").strip()), 500
    _strip_invalidate("mode")
    return jsonify(ok=True, message=(r.stdout or "reset").strip().splitlines()[-1])


# ---------- 1.0.9: SDR power, dongles, screenshots ----------
def _json_call(argv, timeout, what):
    try:
        r = _sudo(argv, timeout=timeout)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error=what + " timed out"), 504
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        d = {"ok": False, "error": (r.stderr or r.stdout or what + " failed").strip()[-400:]}
    if r.returncode != 0 and "error" not in d:
        d["error"] = d.get("message") or (r.stderr or "").strip()[-400:] or what + " failed"
    return jsonify(d), (200 if r.returncode == 0 else 500)


@app.post("/api/sdr/power")
def sdr_power():
    """OFF: stop every SDR service and release the dongle (safe to swap the antenna). ON: resume the last mode."""
    on = (request.get_json(silent=True) or {}).get("on")
    if on not in (True, False):
        return jsonify(ok=False, error="on must be true or false"), 400
    return _json_call([MODE_BIN, "on" if on else "off"], 60, "SDR " + ("on" if on else "off"))


@app.get("/api/dongles")
def dongles_list():
    return _json_call([DONGLES_BIN, "list", "--json"], 15, "dongle list")


@app.post("/api/dongles/label")
def dongles_label():
    role = str((request.get_json(silent=True) or {}).get("role") or "")
    if role not in ("adsb", "radio"):
        return jsonify(ok=False, error="role must be adsb or radio"), 400
    return _json_call([DONGLES_BIN, "label", role, "--json"], 120, "label")


# ---------- 1.2.5: radio roles (dual SDR by serial), listen level, airports, aircraft models ----------
@app.get("/api/radios")
def radios_list():
    return _json_call([DONGLES_BIN, "list", "--json"], 15, "radio list")


@app.post("/api/radios/roles")
def radios_roles():
    roles = (request.get_json(silent=True) or {}).get("roles")
    if not isinstance(roles, dict) or not roles:
        return jsonify(ok=False, error="roles must be {serial: adsb|radio|ais|spare}"), 400
    args = []
    for ser, role in roles.items():
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,32}", str(ser)) or role not in ("adsb", "radio", "ais", "spare"):
            return jsonify(ok=False, error="bad serial or role"), 400
        args.append("%s=%s" % (ser, role))
    return _json_call([DONGLES_BIN, "assign", *args, "--json"], 150, "saving roles")


@app.post("/api/radios/swap")
def radios_swap():
    return _json_call([DONGLES_BIN, "swap", "--json"], 150, "swap")


LEVEL_FILE = Path(os.environ.get("SDR_LEVEL_FILE", "/run/sdr-listen/level.json"))


@app.post("/api/listen/pi")
def listen_pi():
    """1.3.2: STOP / PLAY for the Pi's own playback (Bluetooth speaker / Pi output), not just the browser audio."""
    play = bool((request.get_json(silent=True) or {}).get("play"))
    try:
        r = _sudo([SVC, "restart-radio" if play else "stop-radio"], timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="timed out"), 504
    _LIVE["data"] = None
    if play:
        _TUNE["t"] = time.time()
    return jsonify(ok=r.returncode == 0, playing=play), (200 if r.returncode == 0 else 500)


@app.get("/api/listen/level")
def listen_level():
    """Map listen strip: what SDR 2 is playing + QUIET / TALKING (sdr-level meter, airband / NOAA only)."""
    e = env()
    band = e.get("BAND") or ("fm" if (e.get("DEMOD") or "wfm") == "wfm" else "other")
    sq = e.get({"airband": "AIRBAND_SQUELCH", "noaa": "NOAA_SQUELCH", "frs": "FRS_SQUELCH"}.get(band, "SQUELCH")) or e.get("SQUELCH") or "0"
    try:
        lv = json.loads(LEVEL_FILE.read_text())
        fresh = time.time() - float(lv.get("t", 0)) < 3
    except (OSError, ValueError):
        lv, fresh = {}, False
    st = current_station()
    state = "off"
    if fresh:
        state = "squelch_off" if str(sq) in ("", "0") else ("talking" if lv.get("talking") else "quiet")
    resp = jsonify(ok=True, band=band, name=st.get("name") or "", frequency=st.get("frequency") or e.get("FREQ") or "",
                   demod=e.get("DEMOD") or "wfm", squelch=int(sq) if str(sq).isdigit() else 0, state=state,
                   db=lv.get("db") if fresh else None, live=fresh,
                   air_gain=e.get("AIRBAND_GAIN") or "40")   # 1.3.4: Quick Tune GAIN chip (sdr-listen default 40)
    resp.headers["Cache-Control"] = "no-store"
    return resp


AIRPORTS_FILE = Path(os.environ.get("SDR_AIRPORTS_FILE", str(WEBDIR.parent / "config" / "airports.json")))


BANK_DB = os.environ.get("SDR_BANK_DB", "/var/lib/sdr/bank/stations.sqlite")
CONTENT_BIN = os.environ.get("SDR_CONTENT_BIN", "/usr/local/sbin/sdr-content")


def _bank():
    import sys as _sys
    if str(WEBDIR) not in _sys.path:
        _sys.path.insert(0, str(WEBDIR))
    import bank
    return bank, bank.db(BANK_DB)


@app.get("/api/airports")
def airports():
    # 1.3.2: web/airports.py. ?lat=&lon= -> nearby airports (FAA bank + OurAirports Europe); ?id=KBUR|EGLL -> focus shape;
    # nothing -> the built-in KLAX file (1.2.5). A damaged bank must never break the map.
    import sys as _sys
    if str(WEBDIR) not in _sys.path:
        _sys.path.insert(0, str(WEBDIR))
    import airports as _ap
    try:
        res = _ap.api(request.args.to_dict(), str(WEBDIR), BANK_DB, str(AIRPORTS_FILE))
    except (ValueError, TypeError) as exc:
        return jsonify(ok=False, error="bad request: %s" % exc), 400
    except Exception as exc:
        app.logger.warning("airports: %s", exc)
        try: res = json.loads(AIRPORTS_FILE.read_text())
        except (OSError, ValueError): res = {"ok": False, "airports": []}
    resp = jsonify(res); resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/fm/towers")
def fm_towers():
    # 1.3.6: FM transmitter sites for the map's Towers layer (web/fmtowers.py); a missing bank -> empty list
    import sys as _sys
    if str(WEBDIR) not in _sys.path:
        _sys.path.insert(0, str(WEBDIR))
    import fmtowers as _ft
    try:
        res = _ft.towers(request.args.to_dict(), BANK_DB)
    except (ValueError, TypeError) as exc:
        return jsonify(ok=False, error="bad request: %s" % exc, towers=[]), 400
    except Exception as exc:
        app.logger.warning("fm towers: %s", exc)
        res = {"ok": True, "towers": [], "count": 0}
    resp = jsonify(res); resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/bank/<what>")
def bank_query(what):
    if what not in ("meta", "states", "cities", "fm", "airports", "airport", "search", "near"):
        abort(404)
    try:
        bank, c = _bank()
        if c is None:
            return jsonify(ok=False, error="The station bank isn't installed. Tap Update station bank on About."), 503
        res = bank.query(c, what, request.args.to_dict())
    except (ValueError, KeyError) as exc:
        return jsonify(ok=False, error="bad request: %s" % exc), 400
    except Exception as exc:
        return jsonify(ok=False, error="station bank error: %s" % exc), 500
    res.setdefault("ok", "error" not in res)
    resp = jsonify(res)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/bank/update")
def bank_update():
    return _json_call([CONTENT_BIN, "bank-update", "--json"], 200, "station bank update")


@app.get("/api/content")
def content_status():
    r = _json_call([CONTENT_BIN, "status", "--json"], 20, "map status")
    r[0].headers["Cache-Control"] = "no-store"
    return r


@app.get("/api/content/catalog")
def content_catalog():
    return _json_call([CONTENT_BIN, "catalog", "--json"], 45, "map list")


@app.post("/api/content/<action>")
def content_action(action):
    d = request.get_json(silent=True) or {}
    if action == "url":
        url = str(d.get("url") or "").strip()[:300]
        return _json_call([CONTENT_BIN, "set-url", url, "--json"], 20, "content source")
    if action in ("pause", "resume"):
        return _json_call([CONTENT_BIN, action, "--json"], 20, action)
    if action in ("download", "cancel", "delete"):
        pid = str(d.get("id") or "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", pid):
            return jsonify(ok=False, error="bad map id"), 400
        return _json_call([CONTENT_BIN, action, pid, "--json"], 30, action)
    abort(404)


@app.get("/maps")
@app.get("/maps.html")
def maps_page():
    return _html("maps.html")


@app.get("/stations")
@app.get("/stations.html")
def stations_page():
    return _html("stations.html")


AIRCRAFT_DB = Path(os.environ.get("SDR_AIRCRAFT_DB", "/var/lib/sdr/aircraft/aircraft.sqlite"))
AIRCRAFT_BIN = os.environ.get("SDR_AIRCRAFT_BIN", "/usr/local/sbin/sdr-aircraft-db")
_ac = {"conn": None, "mtime": 0, "cache": {}, "lock": threading.Lock()}


def _ac_db():
    """Read-only SQLite handle to the offline aircraft DB (reopened when sdr-aircraft-db replaces the file)."""
    import sqlite3
    try:
        mt = AIRCRAFT_DB.stat().st_mtime
    except OSError:
        return None
    with _ac["lock"]:
        if _ac["conn"] is None or _ac["mtime"] != mt:
            try:
                if _ac["conn"] is not None:
                    _ac["conn"].close()
                _ac["conn"] = sqlite3.connect("file:%s?mode=ro" % AIRCRAFT_DB, uri=True, check_same_thread=False)
                _ac["mtime"] = mt
                _ac["cache"] = {}
            except Exception:
                _ac["conn"] = None
                return None
        return _ac["conn"]


def _ac_add(row):
    hx = str(row.get("hex") or "").lower()   # "~xxxxxx" = non-ICAO (TIS-B) address: no lookup
    c = _ac_db()
    if c is None or not re.fullmatch(r"[0-9a-f]{6}", hx):
        return
    cache = _ac["cache"]
    if hx not in cache:
        try:
            with _ac["lock"]:
                r = c.execute("select reg, type, model from a where hex=?", (hx,)).fetchone()
        except Exception:
            r = None
        if len(cache) > 5000:
            cache.clear()
        cache[hx] = r
    r = cache[hx]
    row["reg"], row["type"], row["model"] = (r[0] or None, r[1] or None, r[2] or None) if r else (None, None, None)


# 1.3.2 map icon class: bundled ICAO type table (aircraft_types.json) via the sdr-aircraft-db type code, else the ADS-B
# emitter category (A1 light, A2 bizjet/turboprop, A3 airliner, A4/A5 heavy, A7 helicopter), else "unknown"
_TYPES = {"map": None, "prefix": ()}
CAT_CLASS = {"A1": "light", "A2": "bizjet", "A3": "airliner", "A4": "heavy", "A5": "heavy", "A7": "heli"}


def _type_table():
    if _TYPES["map"] is None:
        m, pre = {}, ()
        try:
            d = json.loads((Path(__file__).resolve().parent / "aircraft_types.json").read_text())
            for k, v in d.items():
                if k.startswith("_"):
                    continue
                if k == "light_prefix":
                    pre = tuple(sorted(v, key=len, reverse=True))
                else:
                    for c in v:
                        m[c.upper()] = k
        except Exception:
            pass
        _TYPES.update(map=m, prefix=pre)
    return _TYPES


def ac_class(typecode, category):
    t = _type_table(); tc = str(typecode or "").strip().upper()
    if tc:
        if tc in t["map"]:
            return t["map"][tc]
        if any(tc.startswith(p) for p in t["prefix"]):
            return "light"
    cat = str(category or "").strip().upper()
    if cat == "A2" and tc:
        return "bizjet"
    return CAT_CLASS.get(cat, "unknown")


@app.get("/api/aircraft-db")
def aircraft_db_status():
    return _json_call([AIRCRAFT_BIN, "status", "--json"], 15, "aircraft database")


@app.post("/api/aircraft-db/update")
def aircraft_db_update():
    if _net_offline():
        return jsonify(ok=False, error=OFFLINE_MSG), 400
    return _json_call([AIRCRAFT_BIN, "fetch", "--json"], 300, "aircraft database update")


@app.get("/api/shots")
def shots_list():
    return _json_call([SHOT_BIN, "list", "--json"], 15, "screenshot list")


@app.post("/api/shots/take")
def shots_take():
    try:
        delay = max(0, min(30, int((request.get_json(silent=True) or {}).get("delay") or 0)))
    except (TypeError, ValueError):
        delay = 0
    return _json_call([SHOT_BIN, "take", str(delay), "--json"], delay + 60, "screenshot")


# 1.2.0: the kiosk shell reports which page it shows, so the screenshot fallback (headless render when grim
# cannot capture) renders that page instead of the default tab
_KIOSK_ROUTE = {"path": "/adsb", "t": 0}
_ROUTE_RE = re.compile(r"^/[A-Za-z0-9/_.-]{0,60}(\?[A-Za-z0-9=&._%-]{0,120})?$")


@app.route("/api/kiosk/route", methods=["GET", "POST"])
def kiosk_route():
    if request.method == "POST":
        path = str((request.get_json(silent=True) or {}).get("path") or "")
        if not _ROUTE_RE.match(path):
            return jsonify(ok=False, error="bad path"), 400
        _KIOSK_ROUTE.update(path=path, t=int(time.time()))
    return jsonify(ok=True, **_KIOSK_ROUTE)


@app.post("/api/shots/delete")
def shots_delete():
    name = str((request.get_json(silent=True) or {}).get("name") or "")
    if not re.fullmatch(r"trace-\d{8}-\d{6}\.png", name):
        return jsonify(ok=False, error="bad name"), 400
    return _json_call([SHOT_BIN, "delete", name, "--json"], 15, "delete")


@app.get("/shots/<name>")
def shots_file(name):
    if not re.fullmatch(r"trace-\d{8}-\d{6}\.png", name):
        abort(404)
    return send_from_directory(SHOT_DIR, name, mimetype="image/png", as_attachment=request.args.get("dl") == "1", max_age=0)


@app.post("/api/net/radio")
def net_radio():
    d = request.get_json(silent=True) or {}
    on = d.get("on")
    if not isinstance(on, bool):
        return jsonify(error="on: true|false required"), 400
    return _net_call(["radio", "on" if on else "off"], "wifi power")


@app.post("/api/station")
def add_station():
    data = request.get_json(silent=True) or {}
    sid = str(data.get("id") or "").strip()
    name = str(data.get("name") or "").strip()
    freq = str(data.get("freq") or "").strip()
    gain = str(data.get("gain") or "4").strip()
    if not all([sid, name, freq]):
        return jsonify(error="id, name, freq required"), 400
    try:
        r = _sudo([ADD_STATION, sid, name, freq, gain])
    except subprocess.TimeoutExpired:
        return jsonify(error="add timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "add failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "added").strip(), stations=stations())


# ---------- network (home Wi-Fi <-> hotspot) ----------
# Switching is done by sdr-net-mode, which detaches itself (systemd-run) so it finishes even
# though this request, and the phone's connection, drop when the radio changes. The endpoints
# below return 202 right away. Passwords go to sdr-net-mode on stdin, never on argv, and are
# never echoed back.

_SECRET_KEYS = ("pass", "psk", "secret")


def _scrub(obj):
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()
                if not any(x in k.lower() for x in _SECRET_KEYS) or k == "ap_password_set"}
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    return obj


def _net_json(r, what):
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        raise ValueError("bad %s output: %s" % (what, (r.stderr or r.stdout or "")[-300:]))


def _hostname():
    try:
        return socket.gethostname().split(".")[0] or "SDRpi"
    except Exception:
        return "SDRpi"


def _net_call(args, what, timeout=20, scrub=True):
    try:
        r = _sudo([NET_MODE, *args], timeout=timeout)
    except subprocess.TimeoutExpired:
        return jsonify(error="%s timed out" % what), 504
    try:
        data = _net_json(r, what)
    except ValueError as exc:
        return jsonify(error=str(exc)), 500
    if r.returncode != 0 and not data.get("ok"):
        return jsonify(_scrub(data) if scrub else data), 500
    return jsonify(_scrub(data) if scrub else data)


@app.get("/api/net")
def net_status():
    try:
        r = _sudo([NET_MODE, "status"], timeout=15)
    except subprocess.TimeoutExpired:
        return jsonify(error="net status timed out"), 504
    try:
        data = _net_json(r, "net status")
    except ValueError as exc:
        return jsonify(error=str(exc)), 500
    data = _scrub(data)
    data.setdefault("hostname", _hostname())
    data.setdefault("ap_ssid", "Trace")
    return jsonify(data)


@app.get("/api/net/scan")
def net_scan():
    return _net_call(["scan"], "wifi scan", timeout=30)


@app.route("/api/net/wifi-auto", methods=["GET", "POST"])
def net_wifi_auto():
    """1.3.2 auto-join: GET status (saved SSIDs, dBm, JOINED / TOO WEAK / NOT SEEN; never passwords).
    POST {enabled: bool} | {rescan: true} | {forget: "SSID"}."""
    if request.method == "GET":
        return _net_call(["autojoin", "status"], "auto-join status", timeout=15)
    body = request.get_json(silent=True) or {}
    if "forget" in body:
        ssid = str(body.get("forget") or "")
        if not ssid or len(ssid) > 64 or any(ord(ch) < 32 for ch in ssid):
            return jsonify(ok=False, error="pick a saved network"), 400
        _net_web_log("POST /api/net/wifi-auto forget")
        return _net_call(["forget", "--", ssid], "forget network", timeout=20)
    if body.get("rescan"):
        return _net_call(["autojoin", "rescan"], "auto-join scan", timeout=30)
    if "enabled" in body:
        _net_web_log("POST /api/net/wifi-auto enabled=%s" % bool(body["enabled"]))
        return _net_call(["autojoin", "on" if body["enabled"] else "off"], "auto-join", timeout=15)
    return jsonify(ok=False, error="nothing to do"), 400


@app.get("/api/net/saved")
def net_saved():
    return _net_call(["saved"], "saved networks", timeout=15)


@app.get("/api/net/last")
def net_last():
    return _net_call(["last", "--json"], "last switch", timeout=10)


@app.post("/api/net/ap-password")
def net_ap_password():
    """Explicit 'show hotspot password' action. POST only, so it is never prefetched or cached."""
    _net_web_log("POST /api/net/ap-password")
    return _net_call(["ap-pass"], "hotspot password", timeout=10, scrub=False)


@app.get("/api/net/log")
def net_log():
    try:
        r = _sudo([NET_MODE, "log"], timeout=10)
    except subprocess.TimeoutExpired:
        return jsonify(error="log read timed out"), 504
    if r.returncode != 0:
        try:
            raw = open("/tmp/sdr-web-net.log").read()[-8000:]
        except Exception:
            raw = (r.stderr or r.stdout or "log failed").strip()
        return jsonify(ok=True, log=raw)
    try:
        return jsonify(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception:
        return jsonify(ok=True, log=(r.stdout or "")[-8000:])


def _valid_ssid(ssid):
    b = ssid.encode("utf-8")
    return 0 < len(b) <= 32 and not any(ord(c) < 32 for c in ssid)


def _valid_psk(pw):
    if pw == "":
        return True
    if 8 <= len(pw) <= 63:
        return True
    return len(pw) == 64 and all(c in "0123456789abcdefABCDEF" for c in pw)


def _start_switch(args, password=None):
    """Kick off a detached switch. sdr-net-mode returns as soon as the worker is started."""
    try:
        r = subprocess.run(["/usr/bin/sudo", "-n", NET_MODE, *args], text=True, capture_output=True,
                           timeout=15, input=(password or "") + "\n")
    except subprocess.TimeoutExpired:
        return None, "could not start the switch (timed out)"
    try:
        data = _net_json(r, "switch")
    except ValueError as exc:
        return None, str(exc)
    if r.returncode != 0 or not data.get("ok"):
        return None, data.get("error") or (r.stderr or "switch failed").strip()
    return data, None


@app.post("/api/net/wifi")
def net_wifi():
    data = request.get_json(silent=True) or {}
    ssid = str(data.get("ssid") or "").strip()
    password = str(data.get("password") or "")
    if ssid and not _valid_ssid(ssid):
        return jsonify(error="Network name must be 1-32 bytes"), 400
    if not _valid_psk(password):
        return jsonify(error="Wi-Fi password must be 8-63 characters"), 400
    args = ["wifi", "--psk-stdin"]
    if ssid:
        args += ["--", ssid]
    _net_web_log("POST /api/net/wifi ssid=%r password=%s" % (ssid, "given" if password else "none"))
    started, err = _start_switch(args, password)
    if err:
        _net_web_log("wifi switch not started: %s" % err)
        return jsonify(error=err), (409 if "already running" in err else 500)
    host = _hostname()
    return jsonify(ok=True, accepted=True, action="wifi", ssid=ssid, hostname=host,
                   unit=started.get("unit", ""),
                   message="Switching to %s. Rejoin your home Wi-Fi and open http://%s.local "
                           "(or the hotspot at 10.42.0.1 if it falls back)."
                           % (ssid or "the saved home Wi-Fi", host)), 202


@app.post("/api/net/ap")
def net_ap():
    _net_web_log("POST /api/net/ap")
    started, err = _start_switch(["ap"])
    if err:
        _net_web_log("hotspot switch not started: %s" % err)
        return jsonify(error=err), (409 if "already running" in err else 500)
    host = _hostname()
    return jsonify(ok=True, accepted=True, action="ap", hostname=host, unit=started.get("unit", ""),
                   message="Starting the hotspot. Join it and open http://10.42.0.1 "
                           "(or http://%s.local on home Wi-Fi if the hotspot fails)." % host), 202


@app.post("/api/net/ap-config")
def net_ap_config():
    """1.2.0 Network page > Hotspot: name, password (8-63, empty = keep), band bg|a, start at boot."""
    data = request.get_json(silent=True) or {}
    ssid = str(data.get("ssid") or "").strip()
    password = str(data.get("password") or "")
    band = "a" if str(data.get("band", "bg")).lower() in ("a", "5", "5ghz") else "bg"
    boot = data.get("boot")
    boot_arg = "keep" if boot is None else ("1" if boot in (True, 1, "1", "true", "on") else "0")
    if not _valid_ssid(ssid):
        return jsonify(ok=False, error="Hotspot name must be 1-32 characters"), 400
    if password and not (8 <= len(password) <= 63):
        return jsonify(ok=False, error="Hotspot password must be 8-63 characters"), 400
    _net_web_log("POST /api/net/ap-config ssid=%r band=%s boot=%s password=%s" % (ssid, band, boot_arg, "given" if password else "kept"))
    try:
        r = subprocess.run(["/usr/bin/sudo", "-n", NET_MODE, "ap-config", "--", ssid, band, boot_arg], text=True,
                           capture_output=True, timeout=20, input=password + "\n")
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="saving the hotspot settings timed out"), 504
    try:
        out = _net_json(r, "ap-config")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    if r.returncode != 0 or not out.get("ok"):
        return jsonify(ok=False, error=out.get("error") or "could not save the hotspot settings"), 400
    return jsonify(out)


@app.get("/api/services")
def services():
    try:
        r = _sudo([SVC, "status"], timeout=10)
    except subprocess.TimeoutExpired:
        return jsonify(error="service status timed out"), 504
    units = {}
    for line in (r.stdout or "").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            units[k.strip()] = v.strip()
    return jsonify(ok=True, units=units)


@app.post("/api/services/restart")
def services_restart():
    data = request.get_json(silent=True) or {}
    which = str(data.get("which") or data.get("unit") or "").strip()
    allowed = {"sdr-fm", "sdr-web", "icecast2", "nginx", "radio", "all"}
    if which not in allowed:
        return jsonify(error="which must be sdr-fm, sdr-web, icecast2, nginx, radio, or all"), 400
    if which == "radio":
        cmd = [SVC, "restart-radio"]
    elif which == "all":
        cmd = [SVC, "restart-all"]
    else:
        cmd = [SVC, "restart", which]
    try:
        r = _sudo(cmd, timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(error="restart timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "restart failed").strip()), 500
    return jsonify(ok=True, message=(r.stdout or "restarted").strip())


# ---------- dongle mode (fm / spectrum / adsb) ----------

@app.get("/api/mode")
def mode_status():
    try:
        r = _sudo([MODE_BIN, "status"], timeout=10)
    except subprocess.TimeoutExpired:
        return jsonify(error="mode status timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "mode status failed").strip()), 500
    try:
        return jsonify(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception:
        return jsonify(error="bad mode status", raw=r.stdout[-500:]), 500


@app.post("/api/mode")
def mode_set():
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode") or "").strip().lower()
    if mode not in MODES:
        return jsonify(error="mode must be fm, spectrum, or adsb"), 400
    try:
        r = _sudo([MODE_BIN, "set", mode], timeout=40)
    except subprocess.TimeoutExpired:
        return jsonify(error="mode switch timed out"), 504
    if r.returncode != 0:
        return jsonify(error=(r.stderr or r.stdout or "mode switch failed").strip()), 500
    try:
        return jsonify(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception:
        return jsonify(ok=True, mode=mode, raw=r.stdout[-500:])


@app.route("/api/scope/<path:sub>", methods=["GET", "POST"])
def scope_proxy(sub):
    """Fallback for direct :8080 access. nginx sends /api/scope/ straight to :8081."""
    url = f"{SCOPE_URL}/api/scope/{sub}"
    body = request.get_data() if request.method == "POST" else None
    req = urllib.request.Request(url, data=body, method=request.method,
                                 headers={"Content-Type": request.headers.get("Content-Type", "application/json")})
    try:
        up = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as exc:
        return Response(exc.read(), status=exc.code, mimetype="application/json")
    except Exception as exc:
        return jsonify(error=f"spectrum service is not running ({exc}). Switch mode first."), 503
    ctype = up.headers.get("Content-Type", "application/json")
    if not ctype.startswith("text/event-stream"):
        data = up.read()
        up.close()
        return Response(data, status=up.status, mimetype=ctype)

    def gen():
        try:
            while True:
                chunk = up.read1(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                up.close()
            except Exception:
                pass

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


def _adsb_env():
    d = {}
    try:
        for line in ADSB_ENV.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip()
    except OSError:
        pass
    return d


RING_COUNTS = (0, 2, 3, 4, 6)
RING_SPACINGS = ("auto", "1", "2.5", "5", "10")


def _adsb_rings():
    """Range-ring setting from adsb.env (ADSB_RINGS, ADSB_RING_SPACING); defaults 3 / auto."""
    d = _adsb_env()
    try:
        count = int(d.get("ADSB_RINGS", "3"))
    except ValueError:
        count = 3
    spacing = d.get("ADSB_RING_SPACING", "auto").lower()
    return {"count": count if count in RING_COUNTS else 3, "spacing": spacing if spacing in RING_SPACINGS else "auto"}


def _adsb_home():
    """Saved receiver position from adsb.env, or None."""
    d = _adsb_env()
    try:
        return float(d.get("ADSB_LAT", "")), float(d.get("ADSB_LON", ""))
    except ValueError:
        return None


def _nm(lat1, lon1, lat2, lon2):
    r = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _receiver():
    home = _adsb_home()
    if home:
        return {"lat": home[0], "lon": home[1], "default": False}
    return {"lat": DEFAULT_RECEIVER[0], "lon": DEFAULT_RECEIVER[1], "default": True, "name": "LAX"}


def _map_packs():
    """1.2.6: downloaded regions, drawn on top of the built-in LA map (each limited to its own box)."""
    out = []
    d = MAPS_DIR / "packs"
    try:
        names = sorted(d.glob("*.json"))
    except OSError:
        names = []
    for j in names:
        t = j.with_suffix(".pmtiles")
        try:
            m = json.loads(j.read_text())
        except (OSError, ValueError):
            continue
        if t.is_file() and isinstance(m.get("bbox"), list) and len(m["bbox"]) == 4:
            out.append({"id": j.stem, "name": m.get("name", j.stem), "url": "/maps/packs/" + t.name, "bbox": m["bbox"],
                        "minzoom": int(m.get("minzoom", 0)), "maxzoom": int(m.get("maxzoom", 14)), "center": m.get("center")})
    return out


# ---- 1.3.1 AIS boats: AIS-catcher's own web server (localhost only, never exposed) -> /api/boats for the map
AIS_URL = os.environ.get("SDR_AIS_URL", "http://127.0.0.1:8100/api/ships.json")
AIS_TYPES = ((20, 29, "other"), (30, 30, "fishing"), (31, 32, "tug"), (36, 37, "sail"), (52, 52, "tug"), (60, 69, "passenger"), (70, 79, "cargo"), (80, 89, "tanker"))


def ais_kind(t):
    try: t = int(t or 0)
    except (TypeError, ValueError): t = 0
    for lo, hi, k in AIS_TYPES:
        if lo <= t <= hi: return k
    return "other"


def ais_boats(raw, now_s=None):
    """AIS-catcher ships.json -> [{mmsi,name,kind,lat,lon,sog,cog,hdg,dest,seen,op}]. Fades after 3 min, dropped after 10."""
    out = []
    for s in (raw or {}).get("ships", []):
        try: lat, lon = float(s.get("lat")), float(s.get("lon"))
        except (TypeError, ValueError): continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0): continue
        seen = s.get("last_signal")
        try: seen = int(seen)
        except (TypeError, ValueError): seen = 0
        if seen > 600: continue
        name = re.sub(r"\s+", " ", str(s.get("shipname") or "")).strip()
        out.append({"mmsi": int(s.get("mmsi") or 0), "name": name or str(s.get("mmsi") or ""), "named": bool(name), "kind": ais_kind(s.get("shiptype")),
                    "lat": lat, "lon": lon, "sog": s.get("speed"), "cog": s.get("cog"), "hdg": s.get("heading"),
                    "dest": re.sub(r"\s+", " ", str(s.get("destination") or "")).strip(), "seen": seen, "op": 1.0 if seen <= 180 else 0.45})
    return out


@app.get("/api/boats")
def boats():
    try:
        with urllib.request.urlopen(AIS_URL, timeout=2) as r:
            raw = json.loads(r.read(4 * 1024 * 1024))
    except Exception:
        return jsonify(ok=True, live=False, boats=[])
    return jsonify(ok=True, live=True, boats=ais_boats(raw))


@app.get("/api/maps")
def maps_status():
    tiles = MAPS_DIR / "la.pmtiles"
    try:
        manifest = json.loads((MAPS_DIR / "la.json").read_text())
    except (OSError, ValueError):
        manifest = None
    installed = tiles.is_file() and tiles.stat().st_size > 0
    # 1.3.5: "street" = the real LA street map (an outline / placeholder file under 10 MB still gets the GET MAP banner)
    street = installed and tiles.stat().st_size >= 10 * 1000 * 1000
    return jsonify(ok=True, installed=installed, street=street, url="/maps/la.pmtiles" if installed else None,
                   bytes=tiles.stat().st_size if installed else 0, manifest=manifest, packs=_map_packs(),
                   fallback="/maplib/fallback/la-lowzoom.geojson", receiver=_receiver(), rings=_adsb_rings())


# ---- 1.3.5 on-screen map downloads (LA street map, USA street map): sdr-maps job -> sdr-mapjob (background worker)
@app.get("/api/maps/job")
def maps_job_status():
    try:
        r = subprocess.run([MAPS_BIN, "job", "status"], text=True, capture_output=True, timeout=15)
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as exc:
        d = {"ok": False, "error": "map status unavailable (%s)" % str(exc)[:80]}
    resp = jsonify(d); resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/maps/job")
def maps_job_action():
    d = request.get_json(silent=True) or {}
    action, mid = str(d.get("action") or ""), str(d.get("id") or "")
    if action not in ("start", "cancel", "delete") or mid not in ("la", "usa"):
        return jsonify(ok=False, error="action must be start, cancel or delete and id la or usa"), 400
    if action == "delete" and mid != "usa":
        return jsonify(ok=False, error="only the USA map can be deleted"), 400
    try:
        r = _sudo([MAPS_BIN, "job", action, mid], timeout=40)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="the map helper timed out"), 504
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        out = {"ok": False, "reason": "error", "error": traceErr_clean(r.stderr or r.stdout or "map helper failed")}
    if action in ("delete",) and out.get("ok"):
        ui_bump("map deleted")
    return jsonify(out), 200


def traceErr_clean(m):
    m = str(m or "").strip()
    return "The map helper on this box did not answer." if re.search(r"sudo:|command not found|Traceback|No such file|Permission denied", m) else m[-200:]


# ---- 1.3.5 kiosk auto-reload: the kiosk shell polls /api/ui/epoch and reloads when it changes (web UI restart after an
# update, a map install, Settings > System > Reload screen)
_UI = {"start": int(time.time()), "bump": 0}


def ui_bump(why=""):
    _UI["bump"] += 1
    app.logger.info("ui reload: %s", why)


def _ui_epoch():
    m = 0
    for f in [MAPS_DIR / "la.json", MAPS_DIR / "packs"]:
        try: m = max(m, int(f.stat().st_mtime))
        except OSError: pass
    try:
        for f in (MAPS_DIR / "packs").glob("*.json"):
            m = max(m, int(f.stat().st_mtime))
    except OSError:
        pass
    return "%d.%d.%d" % (_UI["start"], _UI["bump"], m)


@app.get("/api/ui/epoch")
def ui_epoch():
    resp = jsonify(ok=True, epoch=_ui_epoch()); resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/ui/reload")
def ui_reload():
    ui_bump("Reload screen button")
    return jsonify(ok=True, epoch=_ui_epoch())


# ---- 1.3.5 Settings > Screen > Boot splash (sdr-boot-setup --splash on|off|status)
BOOT_SETUP = os.environ.get("SDR_BOOT_SETUP_BIN", "/usr/local/sbin/sdr-boot-setup")


@app.route("/api/screen/splash", methods=["GET", "POST"])
def screen_splash():
    if request.method == "POST":
        on = (request.get_json(silent=True) or {}).get("on")
        if on not in (True, False):
            return jsonify(ok=False, error="on must be true or false"), 400
        try:   # "on" rebuilds the initramfs: about a minute on a Pi 5
            r = _sudo([BOOT_SETUP, "--splash", "on" if on else "off"], timeout=300)
        except subprocess.TimeoutExpired:
            return jsonify(ok=False, error="Turning the splash " + ("on" if on else "off") + " took too long. Try again."), 504
        if r.returncode != 0:
            last = ((r.stderr or r.stdout or "").strip().splitlines() or ["could not change the splash"])[-1]
            return jsonify(ok=False, error=traceErr_clean(last)), 500
    try:
        r = _sudo([BOOT_SETUP, "--splash", "status"], timeout=20)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="splash status timed out"), 504
    out = r.stdout or ""
    m = re.search(r"^splash:\s*(on|off)", out, re.M)
    if not m:
        return jsonify(ok=False, error="Couldn't read the splash setting."), 500
    return jsonify(ok=True, on=m.group(1) == "on", plymouth="plymouth: installed" in out)


@app.post("/api/adsb/rings")
def adsb_rings():
    body = request.get_json(silent=True) or {}
    try:
        count = int(body.get("count"))
    except (TypeError, ValueError):
        count = -1
    spacing = str(body.get("spacing", "")).lower()
    if count not in RING_COUNTS or spacing not in RING_SPACINGS:
        return jsonify(ok=False, error="rings must be 0, 2, 3, 4 or 6 and spacing auto, 1, 2.5, 5 or 10"), 400
    try:
        r = _sudo([MAPS_BIN, "rings", str(count), spacing], timeout=15)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="saving the ring setting timed out"), 504
    try:
        data = _net_json(r, "rings")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    if not data.get("ok"):
        return jsonify(data), 400 if r.returncode == 2 else 500
    return jsonify(ok=True, rings=_adsb_rings())


ADSB_GAINS = (0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0, 29.7, 32.8,
              33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6)   # R820T gain table


def _adsb_gain():
    g = _adsb_env().get("ADSB_GAIN", "auto").strip().lower() or "auto"
    if g == "auto":
        return "auto"
    try:
        return "%.1f" % float(g)
    except ValueError:
        return "auto"


@app.route("/api/adsb/gain", methods=["GET", "POST"])
def adsb_gain():
    """1.2.0 Map gain stepper. GET -> current; POST {gain: dB|"auto"} or {step: +1|-1} (next R820T step)."""
    if request.method == "GET":
        return jsonify(ok=True, gain=_adsb_gain(), steps=ADSB_GAINS)
    body = request.get_json(silent=True) or {}
    want = body.get("gain")
    if body.get("step") in (1, -1, "1", "-1"):
        cur = _adsb_gain()
        st = int(body["step"])
        if cur == "auto":
            want = 38.6 if st < 0 else 40.2
        else:
            c = float(cur)
            nxt = [g for g in ADSB_GAINS if (g > c + 0.05 if st > 0 else g < c - 0.05)]
            want = (min(nxt) if st > 0 else max(nxt)) if nxt else c
    if str(want).lower() == "auto":
        arg = "auto"
    else:
        try:
            arg = "%.1f" % float(want)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="gain must be a number of dB or auto"), 400
    try:
        r = _sudo([MAPS_BIN, "gain", arg], timeout=20)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="saving the gain timed out"), 504
    try:
        data = _net_json(r, "gain")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    if not data.get("ok"):
        return jsonify(data), 400 if r.returncode == 2 else 500
    return jsonify(ok=True, gain=_adsb_gain(), restarted=bool(data.get("decoder_restarted")))


@app.post("/api/adsb/receiver")
def adsb_receiver():
    body = request.get_json(silent=True) or {}
    if body.get("clear"):
        args = ["receiver", "--clear"]
    else:
        try:
            lat, lon = float(body.get("lat")), float(body.get("lon"))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="enter latitude and longitude as numbers, e.g. 33.9425 and -118.4081"), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify(ok=False, error="latitude must be -90..90 and longitude -180..180"), 400
        args = ["receiver", "%.5f" % lat, "%.5f" % lon]
    try:
        r = _sudo([MAPS_BIN, *args], timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="saving the receiver position timed out"), 504
    try:
        data = _net_json(r, "receiver")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    if not data.get("ok"):
        return jsonify(data), 400 if r.returncode == 2 else 500
    data["receiver"] = _receiver()
    return jsonify(data)


@app.get("/api/adsb")
def adsb():
    try:
        raw = json.loads(ADSB_JSON.read_text())
        age = time.time() - ADSB_JSON.stat().st_mtime
    except FileNotFoundError:
        return jsonify(ok=False, running=False, aircraft=[], receiver=_receiver(),
                       error="ADS-B decoder not running (switch mode to ADS-B)")
    except (OSError, ValueError) as exc:
        return jsonify(ok=False, running=True, aircraft=[], receiver=_receiver(),
                       error=f"aircraft.json unreadable: {exc}")
    rcv = _receiver()
    home = (rcv["lat"], rcv["lon"])
    out = []
    for a in raw.get("aircraft", []):
        seen = a.get("seen", 0) or 0
        if seen > 60:
            continue
        alt = a.get("alt_baro", a.get("altitude"))
        row = {
            "hex": a.get("hex", ""),
            "flight": (a.get("flight") or "").strip(),
            "alt": alt,
            "gs": a.get("gs", a.get("speed")),
            "track": a.get("track"),
            "vr": a.get("baro_rate", a.get("vert_rate")),
            "squawk": a.get("squawk", ""),
            "lat": a.get("lat"),
            "lon": a.get("lon"),
            "rssi": a.get("rssi"),
            "msgs": a.get("messages", 0),
            "seen": round(float(seen), 1),
            "seen_pos": None if a.get("seen_pos") is None else round(float(a.get("seen_pos")), 1),
            "category": a.get("category", ""),
            "dist_nm": None,
        }
        _ac_add(row)
        row["cls"] = ac_class(row.get("type"), row.get("category"))
        if row["lat"] is not None and row["lon"] is not None:
            row["dist_nm"] = round(_nm(home[0], home[1], row["lat"], row["lon"]), 1)
        out.append(row)
    out.sort(key=lambda r: (r["dist_nm"] is None, r["dist_nm"] or 0, r["seen"]))
    return jsonify(ok=True, running=age < 15, age=round(age, 1), now=raw.get("now"), receiver=rcv,
                   messages=raw.get("messages"), count=len(out), model_db=_ac_db() is not None,
                   with_pos=sum(1 for r in out if r["lat"] is not None), aircraft=out)


@app.get("/play.mp3")
def play():
    """Browser-safe proxy. Icecast 2.4 rejects Range; urllib does not send it."""
    try:
        req = urllib.request.Request(ICECAST, headers={"Icy-MetaData": "0", "User-Agent": "sdr-web"})
        upstream = urllib.request.urlopen(req, timeout=8)
    except Exception as exc:
        return jsonify(error=f"stream offline: {exc}"), 503

    def gen():
        try:
            while True:
                chunk = upstream.read(8192)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                upstream.close()
            except Exception:
                pass

    return Response(
        gen(),
        mimetype="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "Accept-Ranges": "none",
            "Connection": "close",
        },
    )


# ---------- Audio output / Bluetooth speaker (sdr-bt) ----------
_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")


def _bt_call(args, what, timeout=20, ok_status=200):
    try:
        r = _sudo([BT, *args], timeout=timeout)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="%s timed out" % what), 504
    except FileNotFoundError:
        return jsonify(ok=False, error="sudo not available"), 500
    try:
        data = _net_json(r, what)
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    if not isinstance(data, dict):
        data = {"ok": True, "result": data}
    if data.get("ok") is False:
        busy = r.returncode == 3 or str(data.get("error", "")).startswith("busy")
        return jsonify(data), (409 if busy else 400 if r.returncode == 2 else 500)
    return jsonify(data), ok_status


def _bt_mac():
    body = request.get_json(silent=True) or {}
    mac = str(body.get("mac") or request.form.get("mac") or "").strip().upper()
    return mac if _MAC_RE.match(mac) else None


@app.get("/api/audio")
def audio_status():
    return _bt_call(["status"], "audio status", timeout=25)


@app.get("/api/audio/scan")
def audio_scan_results():
    return _bt_call(["scan-results"], "scan results", timeout=10)


@app.post("/api/audio/scan")
def audio_scan():
    return _bt_call(["scan", "--bg"], "speaker search", timeout=15, ok_status=202)


@app.post("/api/audio/pair")
def audio_pair():
    mac = _bt_mac()
    if not mac:
        return jsonify(ok=False, error="pick a speaker from the list"), 400
    return _bt_call(["pair", mac, "--bg"], "pair", timeout=15, ok_status=202)


@app.post("/api/audio/connect")
def audio_connect():
    mac = _bt_mac()
    return _bt_call(["connect", *([mac] if mac else []), "--bg"], "connect", timeout=15, ok_status=202)


@app.post("/api/audio/disconnect")
def audio_disconnect():
    mac = _bt_mac()
    return _bt_call(["disconnect", *([mac] if mac else [])], "disconnect", timeout=25)


@app.post("/api/audio/forget")
def audio_forget():
    mac = _bt_mac()
    if not mac:
        return jsonify(ok=False, error="which speaker?"), 400
    return _bt_call(["forget", mac], "forget", timeout=30)


@app.post("/api/audio/default")
def audio_default():
    mac = _bt_mac()
    return _bt_call(["set-default", *([mac] if mac else [])], "set default output", timeout=25)


AUDIO_ENV = Path(os.environ.get("SDR_AUDIO_ENV", "/etc/sdr/audio.env"))


@app.get("/api/audio/sink")
def audio_sink_get():
    k = "auto"
    try:
        for line in AUDIO_ENV.read_text().splitlines():
            if line.startswith("AUDIO_SINK="):
                k = line.split("=", 1)[1].strip().strip('"') or "auto"
    except OSError:
        pass
    return jsonify(ok=True, sink=k, edition=EDITION)


@app.post("/api/audio/sink")
def audio_sink():
    """1.0.8 (desktop Audio page): Pi output device hdmi | jack | bluetooth | auto."""
    k = str((request.get_json(silent=True) or {}).get("sink") or "")
    if k not in ("hdmi", "jack", "bluetooth", "auto"):
        return jsonify(ok=False, error="sink must be hdmi, jack, bluetooth or auto"), 400
    return _bt_call(["sink", k], "audio sink", timeout=30)


DISPLAY_RES = os.environ.get("SDR_DISPLAY_RES_BIN", "/usr/local/sbin/sdr-display-res")


@app.route("/api/display/resolution", methods=["GET", "POST"])
def display_resolution():
    """Desktop edition: HDMI output 720p (default) or 1080p, landscape; applies at the next reboot (1.3.6).
    Answers active_resolution (this boot), saved_resolution (next boot) and reboot_needed."""
    if EDITION != "desktop":
        return jsonify(ok=False, edition=EDITION, error="desktop edition only"), 200   # 1.3.6: 200, so the handheld console stays clean
    want = "status" if request.method == "GET" else str((request.get_json(silent=True) or {}).get("resolution") or "")
    if want not in ("status", "720p", "1080p"):
        return jsonify(ok=False, error="resolution must be 720p or 1080p"), 400
    try:
        r = _sudo([DISPLAY_RES, want], timeout=15)
        return jsonify(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500


@app.post("/api/audio/output")
def audio_output():
    body = request.get_json(silent=True) or {}
    mode = str(body.get("output") or request.form.get("output") or "")
    if mode not in ("phone", "speaker", "both"):
        return jsonify(ok=False, error="output must be phone, speaker or both"), 400
    return _bt_call(["output", mode], "audio output", timeout=30)


# ---------- Status strip (nav.js, top of every page) ----------
# One small JSON for the strip: SDR job, network, audio output, and one live number for the job.
# Every source is cached and refreshed in a background thread (stale-while-revalidate), so many
# open pages / phones share one helper call per source and a slow or broken helper (sudo, nmcli,
# bluetoothctl) never holds the request: that part is just null and the strip shows a dash.
import threading  # noqa: E402

_STRIP_TTL = {"mode": 5.0, "net": 10.0, "audio": 15.0, "scope": 5.0, "radios": 5.0}
_STRIP_WAIT = 3.0          # first request waits this long at most for a cold source
_strip_cache = {}          # name -> {"t": time, "data": dict|None, "busy": bool}
_strip_lock = threading.Lock()


def _helper_json(cmd, timeout):
    r = _sudo(cmd, timeout=timeout)
    data = json.loads(r.stdout.strip().splitlines()[-1])
    if not isinstance(data, dict) or data.get("error"):
        raise ValueError("helper error")
    return data


def _strip_mode():
    d = _helper_json([MODE_BIN, "status"], 8)
    return {"mode": d.get("mode") or "none", "saved": d.get("saved") or "",
            "adsb_available": bool(d.get("adsb_available")),
            "off": bool(d.get("off")), "dongles": d.get("dongles"), "dual": bool(d.get("dual")), "adsb_live": bool(d.get("adsb_live"))}


def _strip_net():
    d = _helper_json([NET_MODE, "status"], 10)
    mode = d.get("mode") or "unknown"
    if mode == "ap":
        name = d.get("ap_ssid") or "Trace"
    elif mode == "wifi":
        name = d.get("home_ssid") or d.get("active_connection") or ""
    else:
        name = ""
    return {"mode": mode, "name": name, "switching": bool(d.get("switching")), "hostname": d.get("hostname") or _hostname(),
            "ip": d.get("wifi_ip") if mode == "wifi" else (d.get("ap_ip") or "10.42.0.1") if mode == "ap" else None}


def _strip_audio():
    d = _helper_json([BT, "status"], 12)
    sp = d.get("speaker") or None
    return {"output": d.get("output") or "phone", "bluetooth": bool(d.get("bluetooth")),
            "speaker": (sp.get("name") or sp.get("mac")) if sp else None,
            "connected": bool(sp and sp.get("connected")),
            "speaker_default": bool(d.get("speaker_default")), "pulse": bool(d.get("pulse"))}


def _strip_scope():
    with urllib.request.urlopen(SCOPE_URL.rstrip("/") + "/api/scope/status", timeout=2) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    cfg = d.get("config") or {}
    st = d.get("status") or {}
    return {"mode": d.get("mode"), "running": bool(st.get("running")),
            "center_hz": cfg.get("center_hz"), "start_hz": cfg.get("start_hz"), "stop_hz": cfg.get("stop_hz")}


def _strip_radios():
    """1.2.5: radio roles summary for the header chips (no root needed: sysfs + /etc/sdr/sdr-roles.json)."""
    r = subprocess.run([DONGLES_BIN, "list", "--json"], capture_output=True, text=True, timeout=8)
    d = json.loads(r.stdout.strip().splitlines()[-1])
    return {"count": d.get("count"), "dual": bool(d.get("dual")), "assigned": bool(d.get("assigned")),
            "degraded": bool(d.get("degraded")), "missing": d.get("missing") or [], "duplicates": d.get("duplicates") or [],
            # 1.3.2: one top chip per dongle (SDR 1, SDR 2 in USB order): just the role, never serials
            "dongles": [{"role": x.get("role") or ""} for x in (d.get("dongles") or [])][:4]}


_STRIP_SRC = {"mode": _strip_mode, "net": _strip_net, "audio": _strip_audio, "scope": _strip_scope, "radios": _strip_radios}


def _strip_refresh(name):
    try:
        data = _STRIP_SRC[name]()
    except Exception:
        data = None
    with _strip_lock:
        _strip_cache[name] = {"t": time.time(), "data": data, "busy": False}


def _strip_get(names):
    now = time.time()
    threads = []
    with _strip_lock:
        for n in names:
            e = _strip_cache.get(n)
            if e and e["busy"]:
                if e["data"] is None and e.get("th"):
                    threads.append(e["th"])   # another request already asked: wait for the same answer
                continue
            if e and now - e["t"] < _STRIP_TTL[n]:
                continue
            dirty = bool(e and e.get("dirty"))
            _strip_cache[n] = {"t": e["t"] if e else 0, "data": e["data"] if e else None, "busy": True}
            th = threading.Thread(target=_strip_refresh, args=(n,), daemon=True)
            _strip_cache[n]["th"] = th
            th.start()
            if not e or e["data"] is None or dirty:
                threads.append(th)      # nothing to show yet, or just changed by a POST: worth a short wait
    end = now + _STRIP_WAIT
    for th in threads:
        th.join(max(0.0, end - time.time()))
    with _strip_lock:
        out = {n: (_strip_cache.get(n) or {}).get("data") for n in names}
        out["_pending"] = [n for n in names if (_strip_cache.get(n) or {}).get("busy")]
        return out


def _strip_invalidate(*names):
    with _strip_lock:
        for n in names:
            e = _strip_cache.get(n)
            if e and not e["busy"]:
                e["t"] = 0
                e["dirty"] = True


def _strip_metric(mode, scope):
    if mode == "fm":
        st = current_station()
        try:
            mhz = float(str(st.get("frequency", "")).upper().rstrip("M")) if str(st.get("frequency", "")).upper().endswith("M") \
                else float(st.get("frequency")) / 1e6
        except (TypeError, ValueError):
            mhz = None
        e = env()
        band = e.get("BAND") or "fm"
        return {"kind": "fm", "mhz": mhz, "name": st.get("name") or "", "band": band if band in ("airband", "noaa", "frs", "other") else "fm",
                "demod": e.get("DEMOD") or "wfm"}
    if mode == "adsb":
        try:
            raw = json.loads(ADSB_JSON.read_text())
            age = time.time() - ADSB_JSON.stat().st_mtime
        except (OSError, ValueError):
            return {"kind": "adsb", "count": None}
        if age > 15:
            return {"kind": "adsb", "count": None, "stale": True}
        n = sum(1 for a in raw.get("aircraft", []) if (a.get("seen", 0) or 0) <= 60)
        return {"kind": "adsb", "count": n}
    if mode == "spectrum":
        if not scope or scope.get("mode") != mode:
            return {"kind": mode}
        return {"kind": "spectrum", "center_hz": scope.get("center_hz"), "running": scope.get("running")}
    return None


# 1.3.2 radio chip live status (one chip per SDR) + the Pi's own playback (Listen strip LIVE on the Bluetooth speaker)
#   Tuning…   a tune / station / band change was POSTed in the last 20 s and the stream has no audio yet
#   Live      sdr-fm is active and Icecast is serving audio bytes (the same check as /api/stream-ready)
#   No signal NOAA only (a continuous broadcast): stream up, settled > 20 s after tuning, and the level meter
#             (sdr-level) has heard nothing for 20 s. Airband silence is normal (QUIET), and broadcast FM with no
#             carrier is loud hiss, so an audio level cannot tell "no station" there; those never show No signal.
#   Reconnecting…  sdr-fm is active but the stream gave no audio, outside the tuning window
_TUNE = {"t": 0.0}
_LIVE = {"t": 0.0, "data": None}


def _unit_active(u):
    try:
        return subprocess.run(["systemctl", "is-active", "--quiet", u], timeout=3).returncode == 0
    except Exception:
        return False


def _stream_bytes():
    try:
        req = urllib.request.Request(ICECAST, headers={"Icy-MetaData": "0", "User-Agent": "sdr-strip"})
        with urllib.request.urlopen(req, timeout=1.5) as up:
            return len(up.read(2048)) > 0
    except Exception:
        return False


def _ais_count():
    try:
        with urllib.request.urlopen(AIS_URL, timeout=1.5) as r:
            return {"live": True, "n": len(ais_boats(json.loads(r.read(4 * 1024 * 1024))))}
    except Exception:
        return {"live": False, "n": 0}


def _adsb_count():
    try:
        raw = json.loads(ADSB_JSON.read_text())
        if time.time() - ADSB_JSON.stat().st_mtime > 15:
            return None
        return sum(1 for a in raw.get("aircraft", []) if (a.get("seen", 0) or 0) <= 60)
    except (OSError, ValueError):
        return None


def strip_live(mode, audio, radios, metric):
    now = time.time()
    if _LIVE["data"] is not None and now - _LIVE["t"] < 3:
        return _LIVE["data"]
    fm_on = mode == "fm" and _unit_active("sdr-fm")
    stream = fm_on and _stream_bytes()
    # 1.3.4: Pi-speaker-only has no Icecast stream; count it live while the demod is running
    if fm_on and not stream and (audio or {}).get("output") == "speaker":
        try:
            stream = subprocess.run(["pgrep", "-x", "rtl_fm"], capture_output=True, timeout=2).returncode == 0
        except Exception:
            pass
    since = now - _TUNE["t"]
    state = "off"
    if fm_on:
        state = "live" if stream else ("tuning" if since < 20 else "reconnecting")
        if stream and since < 4:
            state = "tuning"
        band = (metric or {}).get("band")
        if state == "live" and band == "noaa" and since > 20:
            try:
                lv = json.loads(LEVEL_FILE.read_text())
                if now - float(lv.get("t") or 0) < 5 and float(lv.get("rx_age") or 0) > 20:
                    state = "nosignal"
            except (OSError, ValueError, TypeError):
                pass
    au = audio or {}
    pi_out = au.get("output") in ("speaker", "both")
    roles = [x.get("role") for x in ((radios or {}).get("dongles") or [])]
    d = {"radio": state, "pi_playing": bool(fm_on and pi_out and state in ("live", "nosignal")), "pi_out": pi_out,
         "adsb_count": _adsb_count(), "ais": _ais_count() if "ais" in roles else None}
    _LIVE.update(t=now, data=d)
    return d


@app.after_request
def _strip_after_post(resp):
    # a change made from any page shows up in the strip on its next poll, not after the cache TTL
    if request.method == "POST":
        p = request.path
        if p.startswith(("/api/listen/tune", "/api/station", "/api/tune", "/api/listen/band", "/api/listen/radio")):
            _TUNE["t"] = time.time(); _LIVE["data"] = None
        if p.startswith("/api/mode"):
            _strip_invalidate("mode", "scope")
        elif p.startswith("/api/listen") or p.startswith("/api/station") or p.startswith("/api/tune"):
            _strip_invalidate("mode")
        elif p.startswith("/api/net"):
            _strip_invalidate("net")
        elif p.startswith("/api/radios") or p.startswith("/api/dongles"):
            _strip_invalidate("radios", "mode")
        elif p.startswith("/api/audio"):
            _strip_invalidate("audio")
        elif p.startswith("/api/scope"):
            _strip_invalidate("scope")
    return resp


@app.get("/api/strip")
def strip_status():
    parts = _strip_get(["mode", "net", "audio", "radios"])
    mode = (parts["mode"] or {}).get("mode")
    pending = parts["_pending"]
    scope = None
    if mode == "spectrum":
        sp = _strip_get(["scope"])
        scope, pending = sp["scope"], pending + sp["_pending"]
        if not scope or scope.get("mode") != mode or not scope.get("running"):
            _strip_invalidate("scope")        # just switched: the scope service is still starting
            if "scope" not in pending:
                pending.append("scope")
    try:
        metric = _strip_metric(mode, scope)
    except Exception:
        metric = None
    psu_start()
    try:
        live = strip_live(mode, parts["audio"], parts.get("radios"), metric)
    except Exception:
        live = None
    resp = jsonify(ok=True, t=round(time.time(), 1), mode=parts["mode"], net=parts["net"],
                   audio=parts["audio"], metric=metric, pending=pending, psu=psu_state(), radios=parts.get("radios"), live=live)
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------- Updates (sdr-update) ----------
# The ONLY code path that goes online, and only from a button press (POST). Nothing here runs on
# a timer and no page calls these by itself; GET /api/update reads local state only.
import secrets as _secrets  # noqa: E402
import shutil as _shutil  # noqa: E402

app.config["MAX_CONTENT_LENGTH"] = 400 * 1024 * 1024   # 1.0.8.2: desktop bundles carry the ~55 MB map
OFFLINE_MSG = "Needs internet: connect to home Wi‑Fi, then try again."


def _edition():
    f = Path(os.environ.get("SDR_EDITION_FILE", str(WEBDIR.parent / "EDITION")))
    try:
        return "desktop" if f.read_text().strip() == "desktop" else "handheld"
    except OSError:
        return "handheld"


EDITION = _edition()
VER_RE = r"\d+(\.\d+){1,3}" + ("-desktop" if EDITION == "desktop" else "")


def _version():
    f = Path(os.environ.get("SDR_VERSION_FILE", str(WEBDIR.parent / "VERSION")))
    try:
        v = f.read_text().strip()
        return v if re.fullmatch(VER_RE, v) else "unknown"
    except OSError:
        return "unknown"


@app.get("/api/version")
def api_version():
    return jsonify(version=_version(), edition=EDITION)


def _update_call(args, timeout):
    try:
        r = _sudo([UPDATE_BIN, *args, "--json"], timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "timeout", "message": "The update helper took too long. Try again."}
    try:
        d = json.loads((r.stdout or "").strip().splitlines()[-1])
        if isinstance(d, dict):
            return d
    except (ValueError, IndexError):
        pass
    detail = (r.stderr or r.stdout or "").strip()[-400:]
    return {"ok": False, "reason": "helper", "message": "The update helper isn't working on this box. Reinstall the station package.",
            "detail": detail}


def _net_offline():
    """True when the box is on its own hotspot (or has no network): don't even try to go online."""
    try:
        n = _strip_get(["net"]).get("net") or {}
    except Exception:
        n = {}
    return n.get("mode") in ("ap",) or (n.get("mode") not in (None, "wifi", "unknown") and not n.get("ip"))


@app.get("/api/update")
def update_state():
    d = _update_call(["status"], 10)
    d.setdefault("version", _version())
    d["hotspot"] = _net_offline()
    return jsonify(d)


@app.post("/api/update/check")
def update_check():
    if _net_offline():
        return jsonify(ok=False, reason="offline", message=OFFLINE_MSG, version=_version())
    d = _update_call(["check"], 45)
    d.setdefault("version", _version())
    return jsonify(d)


@app.post("/api/update/install")
def update_install():
    body = request.get_json(silent=True) or {}
    want = str(body.get("version") or "")
    if not re.fullmatch(VER_RE, want):
        return jsonify(ok=False, message="Which version? Check for updates first."), 400
    if _net_offline():
        return jsonify(ok=False, reason="offline", message=OFFLINE_MSG)
    return jsonify(_update_call(["apply", "--expect", want], 30))


def normalize_url(u):
    """1.1.0: '192.168.1.50 8000', '192.168.1.50;8000', '192.168.1.50:8000' or a missing http:// -> http://192.168.1.50:8000/"""
    u = (u or "").strip()
    if not u:
        return ""
    m = re.fullmatch(r"(?i)(https?://)?([A-Za-z0-9.\-]+|\[[0-9A-Fa-f:]+\])\s*[;, ]\s*(\d{1,5})/?", u)
    if m:
        u = (m.group(1) or "http://") + m.group(2) + ":" + m.group(3) + "/"
    elif not re.match(r"(?i)https?://", u):
        u = "http://" + u.lstrip("/")
    p = __import__('urllib.parse').parse.urlparse(u)
    if p.netloc and p.path in ("",):
        u += "/"
    elif p.path and not p.path.endswith("/") and not p.path.split("?")[0].endswith(".json"):
        u += "/"
    return u


@app.post("/api/update/url")
def update_url():
    body = request.get_json(silent=True) or {}
    url = normalize_url(str(body.get("url") or ""))
    if url and not re.fullmatch(r"https?://[^\s\"'\\]+", url):
        return jsonify(ok=False, message="Use a full address starting with http:// or https://"), 400
    return jsonify(_update_call(["set-url", url], 10))


@app.errorhandler(413)
def _too_large(_e):
    return jsonify(ok=False, message="That file is larger than this box accepts (400 MB). Install it over SSH instead."), 413


def _upload_slot(token):
    if not re.fullmatch(r"[0-9a-f]{16}", token or ""):
        return None
    d = UPLOAD_DIR / token
    return d if d.is_dir() else None


@app.post("/api/update/upload")
def update_upload():
    files = [f for f in request.files.getlist("file") if f and f.filename]
    if not files:
        return jsonify(ok=False, message="Pick the update files first (the .tar.gz plus its .sig, or an .ota file)."), 400
    try:
        UPLOAD_DIR.mkdir(mode=0o700, exist_ok=True)
        for old in UPLOAD_DIR.iterdir():          # one upload at a time; drop earlier ones
            _shutil.rmtree(old, ignore_errors=True)
    except OSError:
        pass
    token = _secrets.token_hex(8)
    slot = UPLOAD_DIR / token
    slot.mkdir(mode=0o755, parents=True)
    main = sig = None
    for f in files[:3]:
        name = Path(f.filename).name.lower()
        if name.endswith(".sig"):
            sig = slot / "bundle.tar.gz.sig"; f.save(sig)
        elif name.endswith(".ota"):
            main = slot / "bundle.ota"; f.save(main)
        elif name.endswith((".tar.gz", ".tgz")):
            main = slot / "bundle.tar.gz"; f.save(main)
    for x in slot.iterdir():
        x.chmod(0o644)
    if not main:
        _shutil.rmtree(slot, ignore_errors=True)
        return jsonify(ok=False, message="That isn't a Trace update. Pick the .tar.gz plus its .sig (or an .ota file)."), 400
    if main.suffix != ".ota" and not sig:
        _shutil.rmtree(slot, ignore_errors=True)
        return jsonify(ok=False, message="The .sig file is missing. Pick the .tar.gz and its .sig together."), 400
    d = _update_call(["verify-file", str(main)], 240)
    d["token"] = token if d.get("ok") else None
    if not d.get("ok"):
        _shutil.rmtree(slot, ignore_errors=True)
    return jsonify(d)


@app.post("/api/update/install-file")
def update_install_file():
    body = request.get_json(silent=True) or {}
    slot = _upload_slot(str(body.get("token") or ""))
    if not slot:
        return jsonify(ok=False, message="Upload the file again (it expired)."), 400
    main = slot / "bundle.ota" if (slot / "bundle.ota").exists() else slot / "bundle.tar.gz"
    d = _update_call(["apply-file", str(main)], 60)
    return jsonify(d)


@app.get("/api/update/log")
def update_log():
    p = Path(os.environ.get("SDR_UPDATE_LOG", "/var/log/sdr-update.log"))
    try:
        lines = p.read_text(errors="replace").splitlines()[-80:]
    except OSError:
        lines = []
    return jsonify(lines=lines)


# ---------- Kiosk screen (sdr-screen) ----------
# GET reads the daemon's state file (no sudo, cheap: the kiosk page polls it every 2 s);
# changes go through the root helper. All local; nothing here goes online.
SCREEN_TIMEOUTS = [0, 30, 60, 120, 300, 600, 1800]


def _screen_conf_timeout():
    try:
        m = re.search(r"^\s*SCREEN_TIMEOUT=\"?(\d+)", SCREEN_CONF.read_text(), re.M)
        return int(m.group(1)) if m else 300
    except OSError:
        return 300


def _screen_state():
    try:
        d = json.loads(SCREEN_STATE.read_text())
        d = d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        d = {}
    running = False
    if d.get("running"):
        try:
            os.kill(int(d.get("pid") or 0), 0)
            running = True
        except PermissionError:          # alive, owned by root
            running = True
        except (OSError, ValueError, TypeError):
            running = False
        if running and time.time() - float(d.get("updated") or 0) > 40:
            running = False
    d["running"] = running
    if not running:
        d["state"] = "on"
        d["turning_off"] = False
        d.setdefault("timeout", _screen_conf_timeout())
    d.setdefault("timeouts", SCREEN_TIMEOUTS)
    try:
        n = json.loads(SCREEN_NOTICE.read_text())
        if isinstance(n, dict) and n.get("kind") in ("poweroff", "reboot"):
            d["shutdown"] = n["kind"]
    except (OSError, ValueError):
        pass
    d.pop("dsi", None)
    d.pop("pid", None)
    d["ok"] = True
    return d


def _screen_call(args, timeout=10):
    try:
        r = _sudo([SCREEN_BIN, *args, "--json"], timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "The screen helper took too long. Try again."}
    try:
        d = json.loads((r.stdout or "").strip().splitlines()[-1])
        if isinstance(d, dict):
            d.pop("dsi", None)
            d.pop("pid", None)
            return d
    except (ValueError, IndexError):
        pass
    return {"ok": False, "message": "The screen helper isn't working on this box. Reinstall the station package.",
            "detail": (r.stderr or r.stdout or "").strip()[-300:]}


def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/screen")
def screen_status():
    return _no_store(jsonify(_screen_state()))


@app.post("/api/screen/<action>")
def screen_action(action):
    body = request.get_json(silent=True) or {}
    phone = body.get("from") == "phone"
    if action in ("off", "on"):
        d = _screen_call([action] + (["--phone"] if phone else []))
    elif action == "timeout":
        try:
            t = int(body.get("seconds"))
        except (TypeError, ValueError):
            t = -1
        if t not in SCREEN_TIMEOUTS:
            return jsonify(ok=False, message="Pick one of the listed times."), 400
        d = _screen_call(["timeout", str(t)])
    elif action == "brightness":
        try:
            v = int(body.get("value"))
        except (TypeError, ValueError):
            return jsonify(ok=False, message="Brightness must be a number."), 400
        d = _screen_call(["brightness", str(max(0, min(1000, v)))])
    else:
        return jsonify(ok=False, message="unknown action"), 404
    return _no_store(jsonify(d))



# ---------- 1.2.4 power supply watch (under-voltage) ----------
# A light background check (every SDR_PSU_INTERVAL s, default 5) of the Pi's own power flags:
#   * vcgencmd get_throttled (Pi 4 and Pi 5): bit 0 = under-voltage now, bit 16 = under-voltage has occurred since boot
#   * /sys/class/hwmon/*/name == rpi_volt: in0_lcrit_alarm = 1 while the supply is too low
# Either source may be missing (Ubuntu without vcgencmd, older kernels): the other is used, or the state is "unknown".
# Nothing here touches I2C (the display chip at 0x45 is never read or written). The last event of THIS boot is kept in
# /run/sdr-power/psu.json (tmpfs: survives a web restart, cleared by a reboot) and logged to the journal.
PSU_STATE = Path(os.environ.get("SDR_PSU_STATE", "/run/sdr-power/psu.json"))
PSU_INTERVAL = float(os.environ.get("SDR_PSU_INTERVAL", "5"))
PSU_VCGENCMD = os.environ.get("SDR_VCGENCMD", "")
PSU_HWMON = Path(os.environ.get("SDR_HWMON_DIR", "/sys/class/hwmon"))
PSU_BOOT_ID = Path(os.environ.get("SDR_BOOT_ID_FILE", "/proc/sys/kernel/random/boot_id"))
_psu_lock = threading.Lock()
_psu = {"started": False, "vc": None, "hw": None, "hw_scan": 0.0, "prev_now": False, "prev_seen": False,
        "first": True, "weak_now": False, "event": 0, "last_ts": None, "source": None, "available": False,
        "checked": None, "boot": ""}


def parse_throttled(text):
    """'throttled=0x50005' -> {'raw': 0x50005, 'now': True, 'seen': True}; None when the text has no value."""
    m = re.search(r"throttled\s*=\s*(0x[0-9a-fA-F]+|\d+)", text or "")
    if not m:
        return None
    v = int(m.group(1), 0)
    return {"raw": v, "now": bool(v & 0x1), "seen": bool(v & 0x10000)}


def _psu_vcgencmd():
    if _psu["vc"] is None:
        c = PSU_VCGENCMD or _shutil.which("vcgencmd") or ("/usr/bin/vcgencmd" if os.path.exists("/usr/bin/vcgencmd") else "")
        _psu["vc"] = c
    return _psu["vc"]


def _psu_read_vc():
    cmd = _psu_vcgencmd()
    if not cmd:
        return None
    try:
        r = subprocess.run([cmd, "get_throttled"], capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_throttled(r.stdout) if r.returncode == 0 else None


def _psu_hwmon_file():
    now = time.monotonic()
    if _psu["hw"] is None and now - _psu["hw_scan"] > 60:      # look for rpi_volt at most once a minute
        _psu["hw_scan"] = now
        try:
            for d in sorted(PSU_HWMON.iterdir()):
                try:
                    if (d / "name").read_text().strip() == "rpi_volt" and (d / "in0_lcrit_alarm").exists():
                        _psu["hw"] = d / "in0_lcrit_alarm"
                        break
                except OSError:
                    continue
        except OSError:
            pass
    return _psu["hw"]


def _psu_read_hw():
    f = _psu_hwmon_file()
    if f is None:
        return None
    try:
        return f.read_text().strip() == "1"
    except OSError:
        _psu["hw"] = None
        return None


def _psu_boot_id():
    try:
        return PSU_BOOT_ID.read_text().strip()
    except OSError:
        return ""


def _psu_save():
    d = {"boot": _psu["boot"], "event": _psu["event"], "last_ts": _psu["last_ts"], "source": _psu["source"]}
    try:
        PSU_STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = PSU_STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, PSU_STATE)
    except OSError:
        pass


def _psu_load():
    _psu["boot"] = _psu_boot_id()
    try:
        d = json.loads(PSU_STATE.read_text())
    except (OSError, ValueError):
        return
    if isinstance(d, dict) and d.get("boot") == _psu["boot"] and isinstance(d.get("event"), int):
        _psu["event"], _psu["last_ts"], _psu["source"] = d["event"], d.get("last_ts"), d.get("source")


def _psu_hhmm(ts):
    return time.strftime("%H:%M", time.localtime(ts)) if ts else None


def _psu_poll_once(now_ts=None):
    """One check. Returns the public state. A NEW event = under-voltage starts (now: off -> on), or the sticky
    'occurred' bit appears between two checks (a dip shorter than the poll interval)."""
    vc, hw = _psu_read_vc(), _psu_read_hw()
    t = now_ts if now_ts is not None else time.time()
    with _psu_lock:
        avail = vc is not None or hw is not None
        now = bool((vc and vc["now"]) or hw)
        seen = bool(vc and vc["seen"])
        src = "+".join(n for n, x in (("vcgencmd", vc), ("hwmon", hw)) if x is not None) or None
        new = False
        if _psu["first"]:
            _psu["first"] = False
            # already flagged when we start (e.g. a sag during boot) and not yet recorded for this boot
            new = (now or seen) and _psu["event"] == 0
        else:
            new = (now and not _psu["prev_now"]) or (seen and not _psu["prev_seen"] and not now)
        if new:
            _psu["event"] += 1
            _psu["last_ts"] = t
            _psu["source"] = src
            _psu_save()
            print(f"[power] under-voltage {'now' if now else 'seen (short dip)'} at {_psu_hhmm(t)} "
                  f"({time.strftime('%Y-%m-%d %H:%M:%S %Z', time.localtime(t))}; source {src}; event #{_psu['event']})"
                  " - the supply is too weak: use 5 V, 3 A or more", flush=True)
        elif _psu["prev_now"] and not now and avail:
            print(f"[power] supply back above the limit at {_psu_hhmm(t)}", flush=True)
        _psu["prev_now"], _psu["prev_seen"] = now, seen
        _psu["weak_now"], _psu["available"], _psu["checked"] = now, avail, t
    return psu_state()


def psu_state():
    s = _psu
    if not s["available"] and s["checked"] is None and s["event"] == 0:
        state = "unknown"
    elif s["weak_now"]:
        state = "weak_now"
    elif s["event"]:
        state = "weak_seen"
    elif s["available"]:
        state = "ok"
    else:
        state = "unknown"
    return {"state": state, "weak_now": bool(s["weak_now"]), "event": s["event"],
            "seen_at": _psu_hhmm(s["last_ts"]), "seen_ts": s["last_ts"], "source": s["source"],
            "available": bool(s["available"]), "boot": (s["boot"] or "")[:8]}


def _psu_loop():
    while True:
        try:
            _psu_poll_once()
        except Exception as e:  # never let the watch die
            print(f"[power] check failed: {e}", flush=True)
        time.sleep(max(2.0, PSU_INTERVAL))


def psu_start():
    with _psu_lock:
        if _psu["started"] or PSU_INTERVAL <= 0:
            return
        _psu["started"] = True
        _psu_load()
    threading.Thread(target=_psu_loop, name="psu-watch", daemon=True).start()


@app.get("/api/power/supply")
def power_supply():
    psu_start()
    return _no_store(jsonify(ok=True, **psu_state()))

if __name__ == "__main__":
    psu_start()   # 1.2.4 power supply watch
    port = int(os.environ.get("SDR_WEB_PORT", "8080"))
    print(f"SDR web listening on 0.0.0.0:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
