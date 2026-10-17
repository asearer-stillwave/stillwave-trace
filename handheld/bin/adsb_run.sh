#!/usr/bin/env bash
# Run whichever ADS-B decoder is installed, writing aircraft.json for the web UI.
# Usage: adsb_run.sh          (exec the decoder; used by sdr-adsb.service)
#        adsb_run.sh --which  (print decoder path, exit 1 if none)
# Settings come from /etc/sdr/adsb.env: ADSB_GAIN, ADSB_PPM, ADSB_LAT, ADSB_LON, ADSB_DECODER
set -eu

OUT="${ADSB_JSON_DIR:-/run/sdr-adsb}"
GAIN="${ADSB_GAIN:-auto}"
PPM="${ADSB_PPM:-0}"
LAT="${ADSB_LAT:-}"
LON="${ADSB_LON:-}"

find_decoder() {
  local c
  if [[ -n "${ADSB_DECODER:-}" ]] && command -v "$ADSB_DECODER" >/dev/null 2>&1; then
    command -v "$ADSB_DECODER"
    return 0
  fi
  for c in readsb dump1090-fa dump1090-mutability dump1090; do
    if command -v "$c" >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}

if [[ "${1:-}" == "--which" ]]; then
  find_decoder
  exit $?
fi

BIN="$(find_decoder || true)"
if [[ -z "$BIN" ]]; then
  echo "No ADS-B decoder found (readsb, dump1090-fa, dump1090-mutability). Re-run install.sh." >&2
  exit 3
fi

case "$GAIN" in
  auto|AUTO|"") GAIN_ARG="-10" ;;
  *) GAIN_ARG="$GAIN" ;;
esac

install -d "$OUT" 2>/dev/null || true
args=()
case "$(basename "$BIN")" in
  readsb)
    args+=(--device-type rtlsdr --gain "$GAIN_ARG" --ppm "$PPM")
    ;;
  *)
    args+=(--gain "$GAIN_ARG" --ppm "$PPM" --fix)
    ;;
esac
# 1.0.9 dual dongle: ADSB_DEVICE (serial label STILLWAVE-ADSB) picks the map's own dongle
if [[ -n "${ADSB_DEVICE:-}" ]]; then
  case "$(basename "$BIN")" in
    readsb) args+=(--device "$ADSB_DEVICE") ;;
    *) args+=(--device-index "$ADSB_DEVICE") ;;
  esac
elif [[ "${ADSB_REQUIRE_DEVICE:-0}" == 1 ]]; then
  echo "dual-dongle ADS-B started without ADSB_DEVICE (is STILLWAVE-ADSB plugged in?)" >&2
  exit 4
fi
args+=(--write-json "$OUT" --write-json-every 1 --quiet)
if [[ -n "$LAT" && -n "$LON" ]]; then
  args+=(--lat "$LAT" --lon "$LON")
fi

echo "Starting $(basename "$BIN") gain=${GAIN} ppm=${PPM} -> ${OUT}/aircraft.json" >&2
exec "$BIN" "${args[@]}"
