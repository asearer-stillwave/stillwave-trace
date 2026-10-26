#!/usr/bin/env bash
set -eu

# 1.0.8.2: if a stream key is missing, reload fm.env (ExecStartPre sdr-fm-env heal has just repaired it)
if [[ -z "${ICECAST_SOURCE_PASSWORD:-}" || -z "${GAIN:-}" || -z "${AUDIO_RATE:-}" || -z "${MP3_BITRATE:-}" || -z "${HIGHPASS_HZ:-}" || -z "${LOWPASS_HZ:-}" ]]; then
  _env="${SDR_ENV_FILE:-/etc/sdr/fm.env}"
  if [[ -r "$_env" ]]; then
    while IFS='=' read -r _k _v; do
      [[ "$_k" =~ ^[A-Z][A-Z0-9_]*$ && -z "${!_k:-}" ]] && export "$_k=$_v"
    done < "$_env"
  fi
fi

: "${ICECAST_SOURCE_PASSWORD:?ICECAST_SOURCE_PASSWORD is not set}"
: "${STATION_NAME:?STATION_NAME is not set}"
: "${FREQ:?FREQ is not set}"
: "${GAIN:?GAIN is not set}"
: "${AUDIO_RATE:?AUDIO_RATE is not set}"
: "${MP3_BITRATE:?MP3_BITRATE is not set}"
: "${HIGHPASS_HZ:?HIGHPASS_HZ is not set}"
: "${LOWPASS_HZ:?LOWPASS_HZ is not set}"

ICECAST_HOST="${ICECAST_HOST:-127.0.0.1}"
ICECAST_PORT="${ICECAST_PORT:-8000}"
ICECAST_MOUNT="${ICECAST_MOUNT:-/live.mp3}"
RTL_PPM="${RTL_PPM:-0}"
# 1.0.8: DEMOD wfm (broadcast FM, default) | am (airband 118-137 MHz) | nfm (NOAA weather / other narrow FM)
DEMOD="${DEMOD:-wfm}"
SQUELCH="${SQUELCH:-0}"
case "$DEMOD" in wfm|am|nfm) ;; *) DEMOD=wfm ;; esac
[[ "$SQUELCH" =~ ^[0-9]+$ ]] || SQUELCH=0

# 1.3.1: FM band filters from the Listen gear (FM_AUDIO_RATE / FM_HIGHPASS / FM_LOWPASS) win over the preset's own
if [[ "${DEMOD:-wfm}" == wfm ]]; then
  [[ "${FM_AUDIO_RATE:-}" =~ ^[0-9]+$ ]] && AUDIO_RATE="$FM_AUDIO_RATE"
  [[ "${FM_HIGHPASS:-}" =~ ^[0-9]+$ ]] && HIGHPASS_HZ="$FM_HIGHPASS"
  [[ "${FM_LOWPASS:-}" =~ ^[0-9]+$ ]] && LOWPASS_HZ="$FM_LOWPASS"
fi
case "$AUDIO_RATE" in
  16000) RTL_AUDIO_RATE="16k" ;;
  24000) RTL_AUDIO_RATE="24k" ;;
  32000) RTL_AUDIO_RATE="32k" ;;
  44100) RTL_AUDIO_RATE="44.1k" ;;
  48000) RTL_AUDIO_RATE="48k" ;;
  *) echo "Unsupported AUDIO_RATE: $AUDIO_RATE" >&2; exit 2 ;;
esac

# Where the audio goes (AUDIO_OUT in /etc/sdr/audio.env, set by "sdr-bt output" / the Audio page):
#   phone   -> Icecast only (listen on the phone / browser), the original behavior
#   speaker -> the Pi's default PipeWire output (Bluetooth speaker when connected, else onboard)
#   both    -> both at once
# The speaker path needs the service user's PipeWire session (lingering user, pipewire-pulse).
# If it is not reachable the stream falls back to Icecast only, so the phone always works.
AUDIO_OUT="${AUDIO_OUT:-phone}"
case "$AUDIO_OUT" in phone|speaker|both) ;; *) AUDIO_OUT=phone ;; esac
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
# voice band: NOAA (narrow FM) fixed 200-3400 Hz; 1.3.1 airband (AM) from the Listen gear, default 200-3400 Hz
if [[ "$DEMOD" == am ]]; then
  HIGHPASS_HZ=200; LOWPASS_HZ=3400
  [[ "${AIRBAND_HIGHPASS:-}" =~ ^[0-9]+$ ]] && HIGHPASS_HZ="$AIRBAND_HIGHPASS"
  [[ "${AIRBAND_LOWPASS:-}" =~ ^[0-9]+$ ]] && LOWPASS_HZ="$AIRBAND_LOWPASS"
  (( LOWPASS_HZ > 11000 )) && LOWPASS_HZ=11000   # AM audio is 24 kHz
elif [[ "$DEMOD" != wfm ]]; then HIGHPASS_HZ=200; LOWPASS_HZ=3400; fi
FILTER="highpass=f=${HIGHPASS_HZ},lowpass=f=${LOWPASS_HZ},acompressor=threshold=-18dB:ratio=1.5:attack=20:release=250"

if [[ "$AUDIO_OUT" != phone ]]; then
  speaker_ok=0
  if ! command -v pactl >/dev/null 2>&1; then
    echo "AUDIO_OUT=${AUDIO_OUT} but pactl is missing (install pulseaudio-utils); phone stream only" >&2
  elif ! ffmpeg -hide_banner -muxers 2>/dev/null | grep -qw pulse; then
    echo "AUDIO_OUT=${AUDIO_OUT} but this ffmpeg has no PulseAudio output; phone stream only" >&2
  else
    for _ in $(seq 1 15); do  # at boot the user's PipeWire may still be starting
      if pactl info >/dev/null 2>&1; then speaker_ok=1; break; fi
      sleep 1
    done
    [[ $speaker_ok -eq 1 ]] || echo "AUDIO_OUT=${AUDIO_OUT} but no PipeWire/Pulse server at ${XDG_RUNTIME_DIR}/pulse (is linger on for $(id -un)?); phone stream only" >&2
  fi
  [[ $speaker_ok -eq 1 ]] || AUDIO_OUT=phone
fi

ICE_OUT=(
  -c:a libmp3lame -b:a "$MP3_BITRATE" -f mp3 -content_type audio/mpeg
  -ice_name "Trace - ${STATION_NAME}" -ice_description "LAN FM receiver"
  "icecast://source:${ICECAST_SOURCE_PASSWORD}@${ICECAST_HOST}:${ICECAST_PORT}${ICECAST_MOUNT}"
)
# 1.0.8: AUDIO_SINK (audio.env) picks the Pi output: hdmi | jack | bluetooth | auto (default sink)
SINK_DEV=()
case "${AUDIO_SINK:-auto}" in
  hdmi|jack|bluetooth)
    pat="$(case "$AUDIO_SINK" in hdmi) echo 'hdmi';; jack) echo 'analog|headphone|bcm2835';; bluetooth) echo 'bluez';; esac)"
    sname="$(pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -Ei "$pat" | head -n1 || true)"
    if [[ -n "$sname" ]]; then SINK_DEV=(-device "$sname"); else echo "AUDIO_SINK=${AUDIO_SINK}: no matching output; using the default" >&2; fi ;;
esac
SPK_OUT=(-ac 2 -f pulse -buffer_duration 500 "${SINK_DEV[@]}" -name "Trace" "FM ${STATION_NAME}")
case "$AUDIO_OUT" in
  phone) OUT=(-af "$FILTER" "${ICE_OUT[@]}") ;;
  speaker) OUT=(-af "$FILTER" "${SPK_OUT[@]}") ;;
  both) OUT=(-filter_complex "[0:a]${FILTER},asplit=2[ice][spk]" -map "[ice]" "${ICE_OUT[@]}" -map "[spk]" "${SPK_OUT[@]}") ;;
esac

case "$AUDIO_OUT" in
  phone) TARGET="icecast://${ICECAST_HOST}:${ICECAST_PORT}${ICECAST_MOUNT}" ;;
  speaker) TARGET="Pi speaker (default PipeWire output)" ;;
  both) TARGET="icecast://${ICECAST_HOST}:${ICECAST_PORT}${ICECAST_MOUNT} + Pi speaker" ;;
esac
echo "Starting ${STATION_NAME} at ${FREQ} gain=${GAIN} -> ${TARGET}" >&2
# 1.0.9: per-band gain / squelch (FM_GAIN, AIRBAND_GAIN/AIRBAND_SQUELCH, NOAA_GAIN/NOAA_SQUELCH in fm.env, written only by
# sdr-fm-env via sdr-listen band). FM: FM_GAIN when set, else the station's GAIN. Airband / NOAA default to gain 40, squelch off
# (the settings verified on hardware: rtl_fm -M am|fm -s 24k -g 40 -l 0 -E dc).
case "$DEMOD" in
  wfm) EFF_GAIN="${FM_GAIN:-$GAIN}"; EFF_SQ=0 ;;
  am)  EFF_GAIN="${AIRBAND_GAIN:-40}"; EFF_SQ="${AIRBAND_SQUELCH:-0}" ;;
  nfm) EFF_GAIN="${NOAA_GAIN:-40}"; EFF_SQ="${NOAA_SQUELCH:-0}" ;;
esac
[[ "$EFF_GAIN" =~ ^[0-9]+(\.[0-9]+)?$ ]] || EFF_GAIN="$GAIN"
[[ "$EFF_SQ" =~ ^[0-9]+$ ]] || EFF_SQ=0
# 1.0.9 fix: AM / narrow FM used -s 12k / 12.5k with -r resampling, which gave silence. They now sample at the audio
# rate itself (-s 24k, no -r), so rtl_fm's output rate is IN_RATE and ffmpeg reads exactly that.
case "$DEMOD" in
  wfm) IN_RATE="$AUDIO_RATE"; RTL=(-M fm -s 170k -A fast -r "$RTL_AUDIO_RATE" -l 0 -E deemp -E dc) ;;
  am)  IN_RATE=24000; RTL=(-M am -s 24k -l "$EFF_SQ" -E dc) ;;
  nfm) IN_RATE=24000; RTL=(-M fm -s 24k -l "$EFF_SQ" -E dc) ;;
esac
# 1.0.9 dual dongle: RADIO_DEVICE (from /etc/sdr/dongles.env, set by sdr-dongles) picks the STILLWAVE-RADIO dongle by serial.
DEV=(); [[ -n "${RADIO_DEVICE:-}" ]] && DEV=(-d "$RADIO_DEVICE")
echo "Demod ${DEMOD}: gain ${EFF_GAIN}, squelch ${EFF_SQ}, ${IN_RATE} Hz${RADIO_DEVICE:+, dongle ${RADIO_DEVICE}}" >&2
if [[ -n "${FM_STREAM_DRY:-}" ]]; then
  printf '%q ' rtl_fm "${DEV[@]}" -f "$FREQ" "${RTL[@]}" -p "$RTL_PPM" -g "$EFF_GAIN" -; echo
  [[ "$DEMOD" != wfm ]] && echo "| sdr-level $IN_RATE"
  printf 'ffmpeg -f s16le -ar %s -ac 1 -i pipe:0 ' "$IN_RATE"
  printf '%q ' ffmpeg "${OUT[@]}"; echo; exit 0
fi

# 1.2.5: AM / narrow FM go through sdr-level (pass-through meter for the map listen strip: QUIET / TALKING). Broadcast FM is unchanged.
LEVEL="${SDR_LEVEL_BIN:-/usr/local/lib/sdr-station/bin/sdr-level}"
METER=(cat)
if [[ "$DEMOD" != wfm && -x "$LEVEL" ]] && command -v python3 >/dev/null 2>&1; then METER=("$LEVEL" "$IN_RATE"); fi
exec rtl_fm \
  "${DEV[@]}" \
  -f "$FREQ" \
  "${RTL[@]}" \
  -p "$RTL_PPM" \
  -g "$EFF_GAIN" \
  - | "${METER[@]}" | ffmpeg \
  -hide_banner \
  -loglevel warning \
  -f s16le \
  -ar "$IN_RATE" \
  -ac 1 \
  -i pipe:0 \
  "${OUT[@]}"
