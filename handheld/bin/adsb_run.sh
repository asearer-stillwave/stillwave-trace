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

# 1.2.8: /usr/local/bin first (a readsb built with RTLSDR=yes by sdr-adsb-fix wins over the distro one), and a readsb
# without rtlsdr support (Raspberry Pi OS's package) is skipped, never started into a restart loop.
SEARCH="${SDR_ADSB_SEARCH:-/usr/local/bin:/usr/bin:/usr/sbin:/usr/local/sbin:${PATH:-}}"
NOCAP=""
has_rtlsdr() {
  case "$(basename "$1")" in
    readsb*) "$1" --help 2>&1 | grep -qi rtlsdr ;;
    *) return 0 ;;
  esac
}
find_decoder() {
  local c d
  if [[ -n "${ADSB_DECODER:-}" ]] && command -v "$ADSB_DECODER" >/dev/null 2>&1; then
    command -v "$ADSB_DECODER"
    return 0
  fi
  IFS=: read -ra DIRS <<<"$SEARCH"
  for c in readsb dump1090-fa dump1090-mutability dump1090; do
    for d in "${DIRS[@]}"; do
      [[ -x "$d/$c" ]] || continue
      if has_rtlsdr "$d/$c"; then echo "$d/$c"; return 0; fi
      NOCAP="${NOCAP:+$NOCAP }$d/$c"
    done
  done
  [[ -n "$NOCAP" ]] && echo "ADS-B: $NOCAP was built without RTL-SDR support ('Unknown device type: rtlsdr'). Fix: sudo sdr-adsb-fix (builds readsb with RTLSDR=yes, needs internet once), then sudo sdr-mode adsb" >&2
  return 1
}

if [[ "${1:-}" == "--which" ]]; then
  find_decoder
  exit $?
fi

BIN="$(find_decoder || true)"
if [[ -z "$BIN" ]]; then
  echo "No rtlsdr-capable ADS-B decoder found (readsb, dump1090-fa, dump1090-mutability). Fix: sudo sdr-adsb-fix, then sudo sdr-mode adsb" >&2
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
