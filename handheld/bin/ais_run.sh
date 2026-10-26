#!/usr/bin/env bash
# Stillwave Trace 1.3.1: AIS boats decoder (AIS-catcher) on the dongle with the AIS role (AIS_DEVICE in /etc/sdr/dongles.env).
# Both AIS channels (161.975 / 162.025 MHz) from one dongle. JSON for the map at http://127.0.0.1:8100/api/ships.json
# (bound to localhost; the web UI proxies it as /api/boats). No AIS dongle -> exit 0 (the unit just stays inactive).
set -u
BIN="${SDR_AIS_BIN:-/usr/local/bin/AIS-catcher}"
DEV="${AIS_DEVICE:-}"
PORT="${AIS_HTTP_PORT:-8100}"
if [[ -z "$DEV" ]]; then echo "no dongle has the AIS role; AIS stays off"; exit 0; fi
if [[ ! -x "$BIN" ]]; then echo "AIS-catcher is not installed yet (sudo sdr-ais-fix, needs internet once)" >&2; exit 0; fi
if [[ "$DEV" =~ ^[0-9]+$ ]]; then SEL=(-d:"$DEV"); else SEL=(-d "$DEV"); fi
GAIN=(); [[ "${AIS_GAIN:-auto}" =~ ^[0-9]+(\.[0-9]+)?$ ]] && GAIN=(-gr TUNER "$AIS_GAIN")
exec "$BIN" "${SEL[@]}" "${GAIN[@]}" -o 0 -N "$PORT" IP_BIND 127.0.0.1
