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
# 1.3.2: "-X off" = no community feed. AIS-catcher v0.70 turns its aiscatcher.org feed (185.77.96.227:4242, TCP,
# COMMUNITY_HUB format) ON by default whenever an output or web server (-N) is configured and -X was not given
# (Source/Application/Main.cpp: "Currently ON by default" -> state.createCommunityFeed(); "-X off" sets xshare_defined
# and skips it). Trace never shares AIS data with anyone.
exec "$BIN" "${SEL[@]}" "${GAIN[@]}" -o 0 -X off -N "$PORT" IP_BIND 127.0.0.1
