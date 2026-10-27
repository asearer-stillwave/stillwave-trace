#!/usr/bin/env bash
# Stillwave Trace: health check of an installed station (read-only)
#   bash verify.sh                  full report (also installed as: sdr-verify)
#   bash verify.sh --health [VER]   pass/fail gate used by sdr-update after an upgrade: the web app and
#                                   nginx answer, the pages load and (if given) the running version is VER
if [[ "${1:-}" == "--health" ]]; then
  # 1.1.0.1: hard time budget (SDR_HEALTH_BUDGET, default 170 s) so it ALWAYS ends with a HEALTH line before an
  # updater's kill timer (240 s in the 1.0.9 updater, 600 s from 1.1.0.1). One "[health]" line per sub-check with timings.
  WANT="${2:-}"; BASE="${SDR_HEALTH_BASE:-http://127.0.0.1}"
  BUDGET="${SDR_HEALTH_BUDGET:-${SDR_HEALTH_TIMEOUT:-170}}"; T0=$SECONDS; end=$((T0 + BUDGET))
  hl() { echo "[health] +$((SECONDS - T0))s $*"; }
  left() { local l=$((end - SECONDS)); (( l < 1 )) && l=1; (( l > $1 )) && l=$1; echo "$l"; }
  hl "start: want version ${WANT:-any}, budget ${BUDGET}s"
  # boot splash (1.0.5+): boot files + initramfs must be right, else turn the splash off (normal text boot) and fail.
  # The initramfs result is cached by sdr-splash; an uncached listing gets at most 40 s and is then reported "not checked".
  SPL="${SDR_HEALTH_SPLASH:-/usr/local/lib/sdr-station/bin/sdr-splash}"
  if [[ -x "$SPL" && $EUID -eq 0 ]]; then
    t=$SECONDS
    if out="$(SDR_SPLASH_LS_TIMEOUT=40 timeout 75 bash "$SPL" gate 2>&1)"; then
      hl "boot splash OK in $((SECONDS - t))s: $(echo "$out" | tail -n1)"
    elif rc=$?; [[ $rc -eq 3 ]]; then
      # 1.3.1: splash wanted but skipped (no plymouth / initramfs). Reported as FAILED, but not worth a rollback.
      SPLASH_FAIL="$(echo "$out" | tail -n1)"; hl "boot splash FAILED (skipped): $SPLASH_FAIL"; echo "HEALTH WARN: boot splash FAILED: $SPLASH_FAIL"
    elif [[ $rc -eq 124 ]]; then
      hl "boot splash check took over 75s; not checked this time (splash left as is)"
    else
      echo "$out"; hl "boot splash check failed in $((SECONDS - t))s"
      echo "HEALTH FAILED: boot splash check failed (splash turned off; the Pi boots in text mode)"; exit 1
    fi
  else
    hl "boot splash check skipped (not root or no sdr-splash)"
  fi
  why="not checked yet"; n=0; lastwhy=""
  while (( SECONDS < end )); do
    n=$((n + 1))
    if [[ -z "${SDR_HEALTH_NO_SYSTEMD:-}" ]] && ! systemctl is-active --quiet sdr-web nginx; then
      why="sdr-web/nginx not active"
    elif ! curl -sf --max-time "$(left 4)" "$BASE/health" >/dev/null; then
      why="$BASE/health not answering"
    else
      v="$(curl -sf --max-time "$(left 4)" "$BASE/api/version" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null)"
      if [[ -n "$WANT" && "$v" != "$WANT" ]]; then
        why="running version '${v:-?}', expected $WANT"
      else
        why=""
        for pth in / /more /updates /nav.js; do
          curl -sf --max-time "$(left 10)" -o /dev/null "$BASE$pth" || { why="page $pth did not load"; break; }
        done
        if [[ -z "$why" ]] && ! curl -sf --max-time "$(left 12)" "$BASE/api/strip" | grep -q '"ok"'; then
          why="/api/strip not answering"
        fi
        if [[ -z "$why" ]]; then
          hl "web, version and pages OK (try $n)"
          echo "HEALTH OK (version ${v:-?}) in $((SECONDS - T0))s"; exit 0
        fi
      fi
    fi
    [[ "$why" != "$lastwhy" || $((n % 10)) -eq 0 ]] && hl "waiting (try $n): $why"; lastwhy="$why"
    sleep 2
  done
  echo "HEALTH FAILED after $((SECONDS - T0))s: $why"; exit 1
fi
echo "==== Stillwave Trace verify ($(hostname), $(date '+%Y-%m-%d %H:%M %Z')) ===="
echo "version: $(cat /usr/local/lib/sdr-station/VERSION 2>/dev/null || echo 'unknown (installed before versioning)')"
echo "==== boot splash ===="
if sp="$(bash /usr/local/lib/sdr-station/bin/sdr-splash check 2>&1)"; then echo "$sp"; else echo "FAIL: $sp"; fi
echo "==== services ===="
systemctl is-active icecast2 sdr-web sdr-net sdr-mode nginx
echo "==== dongle mode ===="
cat /etc/sdr/mode.env 2>/dev/null || echo "no /etc/sdr/mode.env (defaults to fm)"
/usr/local/sbin/sdr-mode status
for u in sdr-fm sdr-spectrum sdr-adsb sdr-ais; do
  echo "$u=$(systemctl is-active "$u" 2>/dev/null)"
done
MODE="$(/usr/local/sbin/sdr-mode current 2>/dev/null)"
echo "==== net mode ===="
sudo -n /usr/local/sbin/sdr-net-mode status || echo "(sdr-net-mode status needs sudo)"
sudo -n /usr/local/sbin/sdr-net-mode last || true
echo "==== audio / bluetooth ===="
sudo -n /usr/local/sbin/sdr-bt status || echo "(sdr-bt status needs sudo)"
echo "bluetooth=$(systemctl is-active bluetooth 2>/dev/null) linger=$(loginctl show-user "${SUDO_USER:-$USER}" -p Linger --value 2>/dev/null)"
systemctl is-enabled sdr-net || true
echo "==== ports ===="
ss -lptn | grep -E ':80 |:8000|:8080|:8081' || true
echo "==== files ===="
ls -l /usr/local/lib/sdr-station/web/radio.html /usr/local/lib/sdr-station/web/radio_control.py \
  /usr/local/lib/sdr-station/web/sdr_scope.py /usr/local/lib/sdr-station/web/spectrum.html \
  /usr/local/lib/sdr-station/web/aircraft_types.json /usr/local/lib/sdr-station/web/adsb.html \
  /usr/local/lib/sdr-station/web/mode.js /usr/local/lib/sdr-station/web/nav.js /usr/local/lib/sdr-station/web/more.html \
  /usr/local/lib/sdr-station/web/fieldnote.css /etc/nginx/sites-enabled/sdr
echo -n "ADS-B decoder: "; /usr/local/lib/sdr-station/bin/adsb_run.sh --which || echo "not installed"
echo "==== health ===="
echo -n "flask :8080 "; curl -sS --max-time 3 http://127.0.0.1:8080/health; echo
echo -n "nginx :80   "; curl -sS --max-time 3 http://127.0.0.1/health; echo
echo "==== page title ===="
curl -sS --max-time 3 http://127.0.0.1/ | tr '\n' ' ' | grep -o '<title>[^<]*</title>'
for p in spectrum adsb network audio settings; do
  echo -n "/$p: "; curl -sS --max-time 3 "http://127.0.0.1/$p" | tr '\n' ' ' | grep -o '<title>[^<]*</title>'
done
echo "==== ADS-B map (offline) ===="
/usr/local/sbin/sdr-maps status | head -c 300; echo
echo -n "tiles via nginx (Range): "; curl -sS --max-time 3 -o /dev/null -r 0-126 -w '%{http_code} %{content_type} %{size_download} bytes\n' http://127.0.0.1/maps/la.pmtiles
echo -n "map library: "; curl -sS --max-time 3 -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1/maplib/maplibre-gl.mjs
echo -n "UI fonts: "; for f in anton-latin.woff2 jetbrainsmono-latin.woff2; do curl -sS --max-time 3 -o /dev/null -w "$f %{http_code} %{content_type}  " "http://127.0.0.1/fonts/$f"; done; echo
echo "==== power + kiosk pointer ===="
echo -n "display setup: "; ls /usr/local/sbin/fieldnote-display-setup /usr/local/sbin/trace-display-setup 2>/dev/null | tr '\n' ' '; echo
ls -l /usr/local/sbin/sdr-power 2>/dev/null || echo "sdr-power missing"
sudo -n -l /usr/local/sbin/sdr-power reboot >/dev/null 2>&1 && echo "sudoers: sdr-power reboot/poweroff allowed for $(id -un)" || echo "sudoers: sdr-power not allowed for $(id -un) (the web Power menu needs it for the sdr-web user)"
tail -3 /var/log/sdr-power.log 2>/dev/null || true
echo "==== power supply (1.2.4) ===="
if [[ -x /usr/local/sbin/sdr-psu ]]; then /usr/local/sbin/sdr-psu status 2>/dev/null || echo "sdr-psu status failed"; else echo "sdr-psu missing"; fi
curl -s -m 3 http://127.0.0.1:8080/api/power/supply 2>/dev/null || echo "(web power API not answering)"; echo
grep -n 'stillwave-trace-power\|usb_max_current_enable' /boot/firmware/config.txt /boot/config.txt 2>/dev/null || echo "config.txt: no usb_max_current_enable (expected on a Pi 4)"
if [[ -f /etc/systemd/system/fieldnote-kiosk.service.d/fieldnote-cursor.conf ]]; then
  echo "kiosk pointer: hidden ($(systemctl show fieldnote-kiosk -p Environment --value 2>/dev/null | tr ' ' '\n' | grep XCURSOR_PATH))"
else
  echo "kiosk pointer: visible (hide: sudo trace-display-setup --hide-cursor)"
fi
echo "==== kiosk screen (sdr-screen) ===="
echo "sdr-screen=$(systemctl is-active sdr-screen 2>/dev/null)  sdr-screen-final=$(systemctl is-active sdr-screen-final 2>/dev/null)"
/usr/local/sbin/sdr-screen status 2>/dev/null || echo "sdr-screen missing"
if grep -q 'Raspberry Pi 5\|Compute Module 5' /proc/device-tree/model 2>/dev/null; then
  echo "==== Pi 5 touch display helpers (1.2.2) ===="
  echo "sdr-touch-reload=$(systemctl is-active sdr-touch-reload 2>/dev/null)"
  # 1.2.3: nothing may write to the display chip (I2C 0x45) while the box reboots: no sdr-panel-off, and "sdr-screen final" only at power-off
  if [[ -e /usr/local/sbin/sdr-panel-off || -e /etc/systemd/system/sdr-panel-off.service ]]; then
    echo "WARNING: the 1.2.2 sdr-panel-off hook is still installed (it can leave the panel blank after a warm reboot); run: sudo bash install.sh --upgrade"
  else
    echo "shutdown hooks: no sdr-panel-off (ok); sdr-screen-final=$(systemctl is-enabled sdr-screen-final 2>/dev/null) (it writes the backlight at power-off only)"
  fi
  /usr/local/sbin/sdr-touch-reload --check 2>/dev/null || true
  echo "full report: sudo sdr-panel-diag   (save: sudo sdr-panel-diag --save NAME)"
fi
echo -n "api/screen: "; curl -sS --max-time 3 http://127.0.0.1/api/screen | head -c 300; echo
echo "==== bootloader power setting ===="
if [[ $EUID -eq 0 ]]; then
  /usr/local/sbin/sdr-power eeprom-status 2>/dev/null || echo "sdr-power eeprom-status not available"
else
  echo "(run with sudo to see: sudo sdr-power eeprom-status)"
fi
echo "==== updates (only online when asked) ===="
echo "version: $(cat /usr/local/lib/sdr-station/VERSION 2>/dev/null || echo unknown)   $(grep '^UPDATE_URL=' /etc/sdr/update.env 2>/dev/null || echo 'UPDATE_URL not set')"
echo -n "rollback copies: "; ls /var/lib/sdr-update/releases 2>/dev/null | tr '\n' ' '; echo "(current -> $(readlink /var/lib/sdr-update/current 2>/dev/null || echo none))"
echo -n "last update: "; python3 -c 'import json; d=json.load(open("/var/lib/sdr-update/last.json")); print(d.get("state"), "-", d.get("message"))' 2>/dev/null || echo "none"
echo -n "api/version: "; curl -sS --max-time 3 http://127.0.0.1/api/version; echo
echo "==== api ===="
echo -n "status strip: "; curl -sS --max-time 8 http://127.0.0.1/api/strip; echo
echo -n "nav.js: "; curl -sS --max-time 3 -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1/nav.js
curl -sS --max-time 3 http://127.0.0.1/api/status; echo
curl -sS --max-time 3 http://127.0.0.1/api/mode; echo
case "$MODE" in
  fm)
    echo "==== icecast mount ===="
    curl -sS --max-time 3 -o /tmp/live-direct.mp3 -D - http://127.0.0.1:8000/live.mp3 | head -15
    ls -l /tmp/live-direct.mp3
    echo "==== flask play proxy ===="
    curl -sS --max-time 3 -o /tmp/live-play.mp3 -D - http://127.0.0.1/play.mp3 | head -15
    ls -l /tmp/live-play.mp3
    ;;
  spectrum)
    echo "==== scope ($MODE) ===="
    curl -sS --max-time 3 http://127.0.0.1:8081/health; echo
    curl -sS --max-time 3 http://127.0.0.1/api/scope/status | head -c 600; echo
    echo "---- 4 s of SSE (should show data: lines) ----"
    curl -sSN --max-time 4 http://127.0.0.1/api/scope/stream | cut -c1-160 | head -8
    ;;
  adsb)
    echo "==== adsb ===="
    ls -l /run/sdr-adsb/ 2>/dev/null || true
    curl -sS --max-time 3 http://127.0.0.1/api/adsb | head -c 600; echo
    ;;
esac
echo "==== web log tail ===="
journalctl -u sdr-web -n 15 --no-pager
echo "==== dongle log tail ($MODE) ===="
journalctl -u "sdr-$MODE" -n 15 --no-pager
