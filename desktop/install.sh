#!/usr/bin/env bash
# Stillwave Trace DESKTOP edition installer (HDMI monitor on a Pi 4; output fixed at 1280x720 landscape).
#   sudo bash install.sh --display hdmi  install the station + the full-screen HDMI kiosk (720p) (then reboot)
#   sudo bash install.sh                 install / update the station only (keeps /etc/sdr settings)
#   sudo bash install.sh --display-only  only the HDMI display/kiosk part (fieldnote-display-setup --hdmi)
#   sudo bash install.sh --upgrade       non-interactive upgrade (used by sdr-update): no apt / internet, no network
#                                        or display/kiosk changes, keeps Icecast passwords and every /etc/sdr file
# The installer never switches the network: if the Pi is on Wi-Fi it stays on Wi-Fi.
DO_DISPLAY=0
DISPLAY_ONLY=0
UPGRADE=0
RESUME=0
[[ "${SDR_UPDATE_RUN:-}" == 1 ]] && UPGRADE=1
FORCE_EDITION=0
prev=""
for arg in "$@"; do
  if [[ "$prev" == --display ]]; then
    prev=""
    case "$arg" in hdmi) continue ;; dsi|touch) echo "This is Trace Desktop (HDMI). For the 5\" touch display use the handheld Trace installer." >&2; exit 2 ;; esac
  fi
  case "$arg" in
    --display|--display=hdmi) DO_DISPLAY=1; prev="$arg" ;;
    --display=*) echo "This is Trace Desktop: only --display hdmi is supported." >&2; exit 2 ;;
    --display-only) DO_DISPLAY=1; DISPLAY_ONLY=1 ;;
    --force-edition) FORCE_EDITION=1 ;;
    --upgrade) UPGRADE=1 ;;
    --resume) RESUME=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
if [[ $UPGRADE -eq 1 ]]; then DO_DISPLAY=0; DISPLAY_ONLY=0; fi
echo "Stillwave Trace installer starting ($( [[ $UPGRADE -eq 1 ]] && echo upgrade || echo install ) of $(cat "$(dirname "${BASH_SOURCE[0]}")/VERSION" 2>/dev/null || echo '?'))..."
if [[ ${EUID} -ne 0 ]]; then
  echo "Run: sudo bash install.sh $*" >&2
  exit 1
fi
set -eu
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- 1.0.8: SSH-safe. A full install over SSH re-runs itself as a detached systemd unit (log: /var/log/trace-install.log),
# so a dropped SSH session or Ctrl-C only stops the log view, never the install. ----
ILOG=/var/log/trace-install.log
if [[ $UPGRADE -eq 0 && -n "${SSH_CONNECTION:-}${SSH_TTY:-}" && -z "${SDR_INSTALL_DETACHED:-}" && -z "${SDR_INSTALL_FOREGROUND:-}" ]]; then
  : >"$ILOG"; chmod 644 "$ILOG"
  UNIT="trace-install-$(date +%s)"
  echo "Over SSH: the install runs in the background as $UNIT, so it survives a dropped session or Ctrl-C."
  echo "Watching $ILOG (Ctrl-C stops watching only; re-attach: tail -f $ILOG)"
  if command -v systemd-run >/dev/null 2>&1 && systemd-run --unit "$UNIT" --collect --property=StandardOutput=append:"$ILOG" \
       --property=StandardError=append:"$ILOG" --setenv=SDR_INSTALL_DETACHED=1 --setenv=SUDO_USER="${SUDO_USER:-}" \
       --setenv=SDR_RUN_USER="${SDR_RUN_USER:-}" /bin/bash "$SRC/install.sh" "$@" >/dev/null; then
    sleep 1
    tail -n +1 -f "$ILOG" --pid="$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null | grep -v '^0$' || echo $$)" 2>/dev/null &
    TP=$!
    while systemctl is-active --quiet "$UNIT" 2>/dev/null; do sleep 2; done
    sleep 1; kill "$TP" 2>/dev/null
    grep -q '^TRACE-INSTALL: OK' "$ILOG" && exit 0
    echo "Install did not finish cleanly; see $ILOG"; exit 1
  fi
  SDR_INSTALL_DETACHED=1 nohup /bin/bash "$SRC/install.sh" "$@" >>"$ILOG" 2>&1 &
  echo "Started with nohup (pid $!). Follow: tail -f $ILOG"; exit 0
fi
STEPS=/var/lib/sdr-station/install-steps
step_done() { [[ -f "$STEPS/$1.done" ]] && grep -qx "$(cat "$SRC/VERSION")" "$STEPS/$1.done" 2>/dev/null; }
mark_step() { install -d -m 755 "$STEPS"; cat "$SRC/VERSION" >"$STEPS/$1.done"; echo "TRACE-INSTALL step done: $1"; }
if [[ $UPGRADE -eq 0 ]]; then
  install -d -m 755 /run /var/lib/sdr-station
  touch /run/sdr-installing      # sdr-net-mode never starts the hotspot while this exists
  trap 'rc=$?; rm -f /run/sdr-installing; if [[ $rc -ne 0 ]]; then echo; echo "TRACE-INSTALL: FAILED (exit $rc). Fix the problem above, then resume (finished steps are skipped):"; echo "  sudo bash $SRC/install.sh --resume $*"; fi' EXIT
  # ---- Wi-Fi regulatory domain, early (fresh Ubuntu Server has none: 5 GHz channels stay blocked) ----
  REGDOM="${SDR_REGDOM:-US}"
  iw reg set "$REGDOM" 2>/dev/null || true
  if [[ -f /etc/default/crda ]] && grep -q '^REGDOMAIN=' /etc/default/crda; then sed -i "s/^REGDOMAIN=.*/REGDOMAIN=$REGDOM/" /etc/default/crda; else echo "REGDOMAIN=$REGDOM" >>/etc/default/crda; fi
  for CMDL in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    [[ -f "$CMDL" ]] || continue
    grep -q 'cfg80211.ieee80211_regdom=' "$CMDL" && sed -i "s/cfg80211.ieee80211_regdom=[A-Z0-9]*/cfg80211.ieee80211_regdom=$REGDOM/" "$CMDL" \
      || sed -i "1 s/\$/ cfg80211.ieee80211_regdom=$REGDOM/" "$CMDL"
    break
  done
  echo "Wi-Fi country: $REGDOM (iw reg set + /etc/default/crda + kernel cmdline; set SDR_REGDOM=XX to change)"
  # ---- online preflight: the full install downloads packages (and Chromium for --display) ----
  if ! step_done packages || { [[ $DO_DISPLAY -eq 1 ]] && ! step_done display; }; then
    if ! curl -fsS --max-time 10 -o /dev/null http://ports.ubuntu.com/ 2>/dev/null && ! curl -fsS --max-time 10 -o /dev/null http://archive.ubuntu.com/ 2>/dev/null \
       && ! curl -fsS --max-time 10 -o /dev/null https://api.snapcraft.io/ 2>/dev/null; then
      echo "ERROR: no internet. The installer needs it once for packages (and Chromium for the display)." >&2
      echo "Check Wi-Fi/Ethernet (ping -c2 ports.ubuntu.com), then run the same command again." >&2
      exit 3
    fi
  fi
  # ---- keep the Imager / cloud-init Wi-Fi: copy it into a NetworkManager profile now (password kept),
  # hand wlan0 to NetworkManager at the NEXT reboot (netplan renderer), never restart networking mid-install ----
  NM_MIGRATED="$(python3 - "$SRC" <<'PY' || true
import glob, os, sys, uuid, shutil, re
try:
    import yaml
except ImportError:
    print("WARNING: python3-yaml missing; netplan Wi-Fi not copied to NetworkManager", file=sys.stderr)
    sys.exit(0)
out = []
for f in sorted(glob.glob("/etc/netplan/*.yaml")):
    try: d = yaml.safe_load(open(f)) or {}
    except Exception: continue
    net = d.get("network") or {}
    wifis = net.get("wifis") or {}
    if not wifis or net.get("renderer") == "NetworkManager": continue
    for ifc, cfg in wifis.items():
        for ssid, ap in ((cfg or {}).get("access-points") or {}).items():
            ap = ap or {}
            pw = ap.get("password") or ((ap.get("auth") or {}).get("password"))
            name = "trace-home-" + re.sub(r"[^A-Za-z0-9_-]", "_", str(ssid))[:24]
            path = "/etc/NetworkManager/system-connections/%s.nmconnection" % name
            os.makedirs(os.path.dirname(path), exist_ok=True)
            sec = "\n[wifi-security]\nkey-mgmt=wpa-psk\npsk=%s\n" % pw if pw else ""
            open(path, "w").write("[connection]\nid=%s\nuuid=%s\ntype=wifi\ninterface-name=%s\nautoconnect=true\nautoconnect-priority=200\n\n"
                                  "[wifi]\nmode=infrastructure\nssid=%s\n%s\n[ipv4]\nmethod=auto\n\n[ipv6]\nmethod=auto\n" % (name, uuid.uuid4(), ifc, ssid, sec))
            os.chmod(path, 0o600)
            out.append("%s|%s" % (name, ssid))
    bk = "/var/lib/sdr-station/netplan-backup"; os.makedirs(bk, exist_ok=True); shutil.copy2(f, bk)
    net.pop("wifis", None); net["renderer"] = "NetworkManager"; d["network"] = net
    open(f, "w").write("# Trace 1.0.8: Wi-Fi moved to NetworkManager (original in %s)\n" % bk + yaml.safe_dump(d, default_flow_style=False)); os.chmod(f, 0o600)
if out:
    os.makedirs("/etc/cloud/cloud.cfg.d", exist_ok=True)
    open("/etc/cloud/cloud.cfg.d/99-trace-disable-network-config.cfg", "w").write("network: {config: disabled}\n")
print(out[0] if out else "")
PY
)"
  if [[ -n "$NM_MIGRATED" ]]; then
    install -d -m 755 /etc/sdr; touch /etc/sdr/net.env; chmod 600 /etc/sdr/net.env
    sed -i '/^MODE=/d;/^HOME_CON=/d;/^HOME_SSID=/d' /etc/sdr/net.env
    printf 'MODE=wifi\nHOME_CON=%s\nHOME_SSID=%s\n' "${NM_MIGRATED%%|*}" "${NM_MIGRATED#*|}" >>/etc/sdr/net.env
    echo "Home Wi-Fi '${NM_MIGRATED#*|}' copied from netplan into NetworkManager (takes over wlan0 at the next reboot; this SSH session stays up)."
  fi
  # NetworkManager may be installed below: block its postinst from starting it mid-install (that would grab wlan0 and drop SSH)
  if [[ ! -e /usr/sbin/policy-rc.d ]]; then
    printf '#!/bin/sh\ncase "$1" in NetworkManager|network-manager|wpa_supplicant|hostapd|dnsmasq) exit 101 ;; esac\nexit 0\n' >/usr/sbin/policy-rc.d
    chmod 755 /usr/sbin/policy-rc.d; TRACE_POLICY=1
  fi
fi
# ---- edition guard: Trace Desktop never goes onto a handheld Trace box (and vice versa) ----
EDITION="$(cat "$SRC/EDITION" 2>/dev/null || echo handheld)"
if [[ "$EDITION" != desktop ]]; then echo "This installer tree is missing EDITION=desktop; refusing." >&2; exit 1; fi
if [[ -f /usr/local/lib/sdr-station/VERSION ]]; then
  HERE_ED="$(cat /usr/local/lib/sdr-station/EDITION 2>/dev/null || echo handheld)"
  if [[ "$HERE_ED" != desktop && $FORCE_EDITION -ne 1 ]]; then
    echo "This box already runs handheld Trace ($(cat /usr/local/lib/sdr-station/VERSION)). Trace Desktop will not install over it." >&2
    echo "(To convert this box on purpose: sudo bash install.sh --display hdmi --force-edition)" >&2
    exit 1
  fi
fi

VERSION="$(cat "$SRC/VERSION" 2>/dev/null || echo 0.0.0)"
# The user the services already run as (an upgrade from sdr-update runs as root with no SUDO_USER)
EXIST_USER="$(sed -n 's/^User=//p' /etc/systemd/system/sdr-web.service 2>/dev/null | head -n1)"
if [[ -n "$EXIST_USER" ]] && ! id "$EXIST_USER" >/dev/null 2>&1; then EXIST_USER=""; fi
if [[ -n "${SDR_RUN_USER:-}" ]]; then
  RUN_USER="$SDR_RUN_USER"
elif [[ $UPGRADE -eq 1 && -n "$EXIST_USER" ]]; then
  RUN_USER="$EXIST_USER"
elif [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  RUN_USER="$SUDO_USER"
elif [[ -n "$EXIST_USER" ]]; then
  RUN_USER="$EXIST_USER"
elif id ubuntu >/dev/null 2>&1; then
  RUN_USER=ubuntu
elif id neo >/dev/null 2>&1; then
  RUN_USER=neo
else
  RUN_USER="$(logname 2>/dev/null || echo root)"
fi
RUN_GROUP="$(id -gn "$RUN_USER")"
echo "[progress] 10 Checking the system"
echo "Service user: $RUN_USER"

if [[ $DISPLAY_ONLY -eq 1 ]]; then
  install -m 755 "$SRC/bin/fieldnote-display-setup" /usr/local/sbin/fieldnote-display-setup
  ln -sfn fieldnote-display-setup /usr/local/sbin/trace-display-setup   # same script, new-brand name
  exec /usr/local/sbin/fieldnote-display-setup --hdmi --user "$RUN_USER"
fi

rand_pw() {
  python3 -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(16)))'
}
echo "[progress] 20 Checking packages (apt)"
SOURCE_PW="${ICECAST_SOURCE_PASSWORD:-$(rand_pw)}"
ADMIN_PW="${ICECAST_ADMIN_PASSWORD:-$(rand_pw)}"

export DEBIAN_FRONTEND=noninteractive
# 1.2.0: grim (screenshots of the real kiosk screen) is bundled for Ubuntu 24.04 arm64. Offline-safe: dpkg only, and only
# when its libraries are already there (cage pulls them in); otherwise it is rolled back and Screenshots use a page render.
install_grim_bundled() {
  command -v grim >/dev/null 2>&1 && return 0
  local deb; deb="$(ls "$SRC"/vendor/grim_*_arm64.deb 2>/dev/null | head -n1)"
  if [[ -z "$deb" || "$(dpkg --print-architecture 2>/dev/null)" != arm64 ]]; then
    echo "NOTE: grim not installed (no bundled package for this system); Screenshots fall back to a page render."; return 0
  fi
  if dpkg -i "$deb" >/dev/null 2>&1 && command -v grim >/dev/null 2>&1; then echo "grim installed from the package (offline)"; return 0; fi
  dpkg -r grim >/dev/null 2>&1 || true
  echo "NOTE: bundled grim needs libraries this system lacks (libpixman-1-0 libpng16-16t64 libwayland-client0); online: sudo apt-get install -y grim"
  return 0
}
if [[ $UPGRADE -eq 1 ]]; then
  echo "Upgrade mode: no package downloads (the station stays offline); checking what is installed"
  for c in python3 nginx ffmpeg rtl_fm curl openssl; do
    command -v "$c" >/dev/null 2>&1 || echo "WARNING: $c is missing; run the full installer (sudo bash install.sh) once with internet"
  done
  install_grim_bundled   # 1.2.0: grim ships in the package (vendor/*.deb), no internet needed
elif [[ $RESUME -eq 1 ]] && step_done packages; then
  echo "Resume: packages already installed (step done)"
else
echo "icecast2 icecast2/icecast-setup boolean false" | debconf-set-selections || true
apt-get update -y
apt-get install -y software-properties-common ca-certificates || true
add-apt-repository -y universe || true
apt-get update -y
apt-get install -y rtl-sdr sox ffmpeg icecast2 python3 python3-flask python3-numpy coreutils xmlstarlet nginx network-manager dnsmasq-base dnsmasq hostapd iw rfkill iptables curl avahi-daemon

# Pi speaker / Bluetooth audio: PipeWire (+ pulse shim for ffmpeg/pactl) and BlueZ. Non-fatal:
# without these the station still streams to the phone.
apt-get install -y --no-install-recommends grim || install_grim_bundled   # 1.0.9 (1.2.0: bundled .deb if apt fails)
apt-get install -y bluez pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth pulseaudio-utils \
  || echo "WARNING: Bluetooth/PipeWire packages did not install; Pi speaker output will be unavailable."

python3 -c "import flask" 
python3 -c "import numpy"

# Optional ADS-B decoder. readsb (Ubuntu 25.10+/Debian) or dump1090-mutability (Ubuntu 24.04).
# Their own boot services are turned off so they never grab the dongle; sdr-adsb.service runs
# the binary on demand. --no-install-recommends matters: dump1090-mutability recommends
# lighttpd, which would fight nginx for port 80.
if ! command -v readsb >/dev/null 2>&1 && ! command -v dump1090-mutability >/dev/null 2>&1 && ! command -v dump1090-fa >/dev/null 2>&1; then
  # readsb's postinst tolerates a masked unit, so it never starts during install
  systemctl mask readsb.service >/dev/null 2>&1 || true
  echo "dump1090-mutability dump1090-mutability/auto-start boolean false" | debconf-set-selections || true
  echo "dump1090-mutability dump1090-mutability/use-lighttpd boolean false" | debconf-set-selections || true
  apt-get install -y --no-install-recommends readsb \
    || apt-get install -y --no-install-recommends dump1090-mutability \
    || echo "WARNING: no ADS-B decoder package available; ADS-B mode will be disabled (FM, spectrum, detect still work)."
fi
if [[ -f /etc/default/dump1090-mutability ]]; then
  sed -i 's/^START_DUMP1090=.*/START_DUMP1090=no/' /etc/default/dump1090-mutability || true
fi
for u in readsb dump1090-mutability dump1090-fa; do
  systemctl disable --now "$u.service" >/dev/null 2>&1 || true
done
systemctl mask readsb.service >/dev/null 2>&1 || true
mark_step packages
fi   # end of package installs (skipped by --upgrade)
[[ "${TRACE_POLICY:-0}" == 1 ]] && rm -f /usr/sbin/policy-rc.d
if [[ $UPGRADE -eq 0 ]]; then systemctl enable NetworkManager >/dev/null 2>&1 || true; fi   # enabled for the next boot, not started now
echo "[progress] 40 Installing Trace programs"
python3 -c "import flask"
python3 -c "import numpy"

install -m 644 "$SRC/config/rtl-sdr-blacklist.conf" /etc/modprobe.d/rtl-sdr-blacklist.conf
echo "options usbcore usbfs_memory_mb=0" > /etc/modprobe.d/usbcore-usbfs.conf
echo 0 > /sys/module/usbcore/parameters/usbfs_memory_mb 2>/dev/null || true
rmmod dvb_usb_rtl28xxu rtl2832 rtl2830 2>/dev/null || true

install -d -m 755 /usr/local/lib/sdr-station/bin /usr/local/lib/sdr-station/web /etc/sdr
install -m 755 "$SRC/bin/fm_stream.sh" /usr/local/lib/sdr-station/bin/fm_stream.sh
install -m 755 "$SRC/bin/sdr-select-station" /usr/local/sbin/sdr-select-station
install -m 755 "$SRC/bin/sdr-scan" /usr/local/sbin/sdr-scan
install -m 755 "$SRC/bin/sdr-tune-freq" /usr/local/sbin/sdr-tune-freq
install -m 755 "$SRC/bin/sdr-fm-env" /usr/local/sbin/sdr-fm-env          # 1.0.8.2: safe fm.env writer + self-heal
install -m 755 "$SRC/bin/sdr-add-station" /usr/local/sbin/sdr-add-station
install -m 755 "$SRC/bin/sdr-apply-settings" /usr/local/sbin/sdr-apply-settings
install -m 755 "$SRC/bin/sdr-save-preset" /usr/local/sbin/sdr-save-preset
install -m 755 "$SRC/bin/sdr-delete-preset" /usr/local/sbin/sdr-delete-preset
install -m 755 "$SRC/bin/sdr-net-mode" /usr/local/sbin/sdr-net-mode
install -m 755 "$SRC/bin/sdr-mode" /usr/local/sbin/sdr-mode
install -m 755 "$SRC/bin/sdr-listen" /usr/local/sbin/sdr-listen          # 1.0.8: airband / NOAA tune + presets
install -m 755 "$SRC/bin/sdr-usb-reset" /usr/local/sbin/sdr-usb-reset    # 1.0.8: Reset SDR USB
install -m 755 "$SRC/bin/sdr-dongles" /usr/local/sbin/sdr-dongles      # 1.0.9: dual dongle labels / roles
install -m 755 "$SRC/bin/sdr-shot" /usr/local/sbin/sdr-shot            # 1.0.9: screenshots saved on the Pi
install -d -m 755 /var/lib/sdr/screenshots
install -m 755 "$SRC/bin/sdr-display-res" /usr/local/sbin/sdr-display-res  # desktop: HDMI 720p only
install -d -m 755 /usr/local/lib/sdr-station/config
install -m 644 "$SRC/config/listen-presets.json" /usr/local/lib/sdr-station/config/listen-presets.json
install -m 644 "$SRC/config/airports.json" /usr/local/lib/sdr-station/config/airports.json        # 1.2.5: airport focus frequencies (KLAX)
install -m 755 "$SRC/bin/sdr-level" /usr/local/lib/sdr-station/bin/sdr-level                   # 1.2.5: airband level meter (map listen strip)
install -m 755 "$SRC/bin/sdr-aircraft-db" /usr/local/sbin/sdr-aircraft-db                      # 1.2.5: offline aircraft models (ODC-By)
install -d -m 755 /var/lib/sdr/aircraft
install -m 755 "$SRC/bin/sdr-content" /usr/local/sbin/sdr-content                              # 1.2.6: map packs + station bank from CONTENT_URL
install -m 644 "$SRC/web/bank.py" /usr/local/lib/sdr-station/web/bank.py                         # 1.2.6: station bank queries
install -d -m 755 /var/lib/sdr/maps/packs /var/lib/sdr/content /var/lib/sdr/bank
if [[ -s "$SRC/vendor/station-bank/stations.sqlite.gz" ]]; then
  install -d -m 755 /usr/local/lib/sdr-station/vendor/station-bank
  install -m 644 "$SRC/vendor/station-bank/stations.sqlite.gz" "$SRC/vendor/station-bank/SOURCE.txt" /usr/local/lib/sdr-station/vendor/station-bank/
  /usr/local/sbin/sdr-content bank-install-local /usr/local/lib/sdr-station/vendor/station-bank/stations.sqlite.gz \
    || echo "WARNING: station bank not installed; Stations shows nothing (try: More > About > Update station bank)"
fi
if [[ -s "$SRC/vendor/aircraft-db/aircraft.csv.gz" ]]; then
  install -d -m 755 /usr/local/lib/sdr-station/vendor/aircraft-db
  install -m 644 "$SRC/vendor/aircraft-db/aircraft.csv.gz" "$SRC/vendor/aircraft-db/SOURCE.txt" /usr/local/lib/sdr-station/vendor/aircraft-db/
  /usr/local/sbin/sdr-aircraft-db install-local /usr/local/lib/sdr-station/vendor/aircraft-db/aircraft.csv.gz \
    || echo "WARNING: aircraft model database not built; the map shows no aircraft models (try: sudo sdr-aircraft-db fetch)"
fi
for u in sdr-net-retry.service sdr-net-retry.timer sdr-firstboot-done.service sdr-firstboot-done.timer; do install -m 644 "$SRC/systemd/$u" /etc/systemd/system/$u; done
install -m 755 "$SRC/bin/fieldnote-display-setup" /usr/local/sbin/fieldnote-display-setup
ln -sfn fieldnote-display-setup /usr/local/sbin/trace-display-setup   # alias (same script; internal names stay fieldnote-*)
install -m 755 "$SRC/bin/adsb_run.sh" /usr/local/lib/sdr-station/bin/adsb_run.sh
install -m 644 "$SRC/systemd/sdr-net.service" /etc/systemd/system/sdr-net.service

install -d -m 755 /etc/sdr /var/log /var/lib/sdr-station
touch /var/log/sdr-net.log /tmp/sdr-web-net.log
chmod 644 /var/log/sdr-net.log /tmp/sdr-web-net.log || true
chown "$RUN_USER:$RUN_GROUP" /tmp/sdr-web-net.log || true
# net.env holds the hotspot password; only root (and sdr-net-mode via sudo) reads it
[[ -f /etc/sdr/net.env ]] && chmod 600 /etc/sdr/net.env
cat >/etc/logrotate.d/sdr-net <<'LR'
/var/log/sdr-net.log {
  weekly
  rotate 4
  missingok
  notifempty
  compress
}
/var/log/sdr-power.log {
  monthly
  rotate 3
  missingok
  notifempty
}
/var/log/sdr-bt.log {
  weekly
  rotate 4
  missingok
  notifempty
  compress
}
/var/log/sdr-update.log {
  monthly
  rotate 4
  missingok
  notifempty
  compress
}
LR
install -m 755 "$SRC/bin/sdr-svc" /usr/local/sbin/sdr-svc
install -m 755 "$SRC/bin/sdr-bt" /usr/local/sbin/sdr-bt
echo "[progress] 50 Writing settings"
install -m 755 "$SRC/bin/sdr-power" /usr/local/sbin/sdr-power
install -m 755 "$SRC/bin/sdr-psu" /usr/local/sbin/sdr-psu          # 1.2.4: power supply status (desktop = Pi 4: config.txt is never changed)
install -m 755 "$SRC/bin/sdr-boot-setup" /usr/local/lib/sdr-station/bin/sdr-boot-setup
touch /var/log/sdr-power.log && chmod 644 /var/log/sdr-power.log
# ---- kiosk screen: off button, timeout, wake on touch, brightness, dark screen at power-off (sdr-screen) ----
install -m 755 "$SRC/bin/sdr-screen" /usr/local/sbin/sdr-screen
install -m 644 "$SRC/systemd/sdr-screen.service" /etc/systemd/system/sdr-screen.service
install -m 644 "$SRC/systemd/sdr-screen-final.service" /etc/systemd/system/sdr-screen-final.service
install -d -m 755 /var/lib/sdr-screen
if [[ ! -f /etc/sdr/screen.env ]]; then
  install -m 644 "$SRC/config/screen.env.example" /etc/sdr/screen.env
else
  echo "Keeping existing /etc/sdr/screen.env ($(grep -E '^SCREEN_TIMEOUT=' /etc/sdr/screen.env || echo 'SCREEN_TIMEOUT default'))"
fi
chmod 644 /etc/sdr/screen.env
install -m 644 "$SRC/README.md" /usr/local/lib/sdr-station/README.md
install -m 644 "$SRC/web/radio_control.py" /usr/local/lib/sdr-station/web/radio_control.py
for f in "$SRC"/web/*.html "$SRC"/web/*.js "$SRC"/web/*.css; do install -m 644 "$f" /usr/local/lib/sdr-station/web/; done   # 1.0.8: every page
rm -f /usr/local/lib/sdr-station/web/dashboard.html   # 1.0.8: desktop dashboard removed
install -m 644 "$SRC/web/sdr_scope.py" /usr/local/lib/sdr-station/web/sdr_scope.py
install -d -m 755 /usr/local/lib/sdr-station/web/fonts   # UI fonts (Anton, JetBrains Mono; SIL OFL 1.1, bundled, offline)
for f in anton-latin.woff2 jetbrainsmono-latin.woff2 OFL-Anton.txt OFL-JetBrainsMono.txt README.txt; do
  install -m 644 "$SRC/web/fonts/$f" "/usr/local/lib/sdr-station/web/fonts/$f"
done
rm -f /usr/local/lib/sdr-station/web/fonts/inter-latin.woff2 /usr/local/lib/sdr-station/web/fonts/OFL-Inter.txt
install -d -m 755 /usr/local/lib/sdr-station/web/img   # kiosk shutdown art (same picture as the boot splash)
install -m 644 "$SRC/web/img/trace-art.png" /usr/local/lib/sdr-station/web/img/trace-art.png
# boot + shutdown splash: Plymouth theme files + sdr-splash (turned on at the end of this script)
install -d -m 755 /usr/local/lib/sdr-station/plymouth/stillwave-trace
for f in stillwave-trace.plymouth stillwave-trace.script bg.png bg-shutdown.png bg-wide.png bg-wide-shutdown.png sweep.png hub.png; do
  install -m 644 "$SRC/plymouth/stillwave-trace/$f" "/usr/local/lib/sdr-station/plymouth/stillwave-trace/$f"
done
install -m 755 "$SRC/bin/sdr-splash" /usr/local/lib/sdr-station/bin/sdr-splash
ln -sfn /usr/local/lib/sdr-station/bin/sdr-boot-setup /usr/local/sbin/sdr-boot-setup
# ---- over-the-air updates (sdr-update): the only part that goes online, and only when asked ----
install -m 644 "$SRC/VERSION" /usr/local/lib/sdr-station/VERSION
install -m 644 "$SRC/EDITION" /usr/local/lib/sdr-station/EDITION   # desktop: sdr-update only takes desktop packages
install -d -m 755 /usr/local/lib/sdr-station/keys
install -m 644 "$SRC/config/stillwave-update.pub" /usr/local/lib/sdr-station/keys/stillwave-update.pub
install -m 755 "$SRC/bin/sdr-update" /usr/local/sbin/sdr-update
install -m 755 "$SRC/verify.sh" /usr/local/sbin/sdr-verify
if [[ ! -f /etc/sdr/update.env ]]; then
  install -m 644 "$SRC/config/update.env.example" /etc/sdr/update.env
else
  echo "Keeping existing /etc/sdr/update.env ($(grep '^UPDATE_URL=' /etc/sdr/update.env || echo 'UPDATE_URL not set'))"
fi
install -d -m 755 /var/lib/sdr-update /var/lib/sdr-update/releases
touch /var/log/sdr-update.log && chmod 644 /var/log/sdr-update.log
# ---- ADS-B map: vendored MapLibre/pmtiles/fonts/sprites + offline LA tiles (works with no internet) ----
install -m 755 "$SRC/bin/sdr-maps" /usr/local/sbin/sdr-maps
rm -rf /usr/local/lib/sdr-station/web/maplib.new
cp -r "$SRC/web/maplib" /usr/local/lib/sdr-station/web/maplib.new
find /usr/local/lib/sdr-station/web/maplib.new -type d -exec chmod 755 {} +
find /usr/local/lib/sdr-station/web/maplib.new -type f -exec chmod 644 {} +
rm -rf /usr/local/lib/sdr-station/web/maplib
mv /usr/local/lib/sdr-station/web/maplib.new /usr/local/lib/sdr-station/web/maplib
echo "[progress] 58 Map and station files"
install -d -m 755 /var/lib/sdr /var/lib/sdr/maps
if [[ -s "$SRC/maps/la.pmtiles" ]]; then
  # copies only when missing or different (sha256), and never replaces a newer "sdr-maps fetch" build
  /usr/local/sbin/sdr-maps install-local "$SRC/maps/la.pmtiles" || echo "WARNING: map tiles not installed; the ADS-B map falls back to a basic outline"
elif [[ -s /var/lib/sdr/maps/la.pmtiles ]]; then
  echo "Map tiles: this package has none (app-only zip); keeping the installed /var/lib/sdr/maps/la.pmtiles"
else
  echo "No map tiles in this package: the ADS-B map shows a basic outline until you run (with internet, once): sudo sdr-maps fetch"
fi
if [[ ! -f /etc/sdr/stations.conf ]]; then
  install -m 644 "$SRC/stations.conf" /etc/sdr/stations.conf
else
  echo "Keeping existing /etc/sdr/stations.conf"
fi

# Icecast can also serve the page next to the stream
if [[ -d /usr/share/icecast2/web ]]; then
  install -m 644 "$SRC/web/radio.html" /usr/share/icecast2/web/radio.html
fi

if [[ ! -f /etc/sdr/fm.env ]]; then
  sed "s|^ICECAST_SOURCE_PASSWORD=.*|ICECAST_SOURCE_PASSWORD=${SOURCE_PW}|" \
    "$SRC/config/fm.env.example" > /etc/sdr/fm.env
else
  echo "Keeping existing /etc/sdr/fm.env"
  SOURCE_PW="$(awk -F= '/^ICECAST_SOURCE_PASSWORD=/{print $2; exit}' /etc/sdr/fm.env || true)"
fi
chown root:"$RUN_GROUP" /etc/sdr/fm.env /etc/sdr/stations.conf
chmod 644 /etc/sdr/fm.env /etc/sdr/stations.conf
# 1.0.8.2: restore any stream key an older Listen save dropped (password from icecast.xml, installer defaults otherwise)
/usr/local/sbin/sdr-fm-env heal || true
SOURCE_PW="$(awk -F= '/^ICECAST_SOURCE_PASSWORD=/{print $2; exit}' /etc/sdr/fm.env || true)"

# Dongle mode (fm / spectrum / detect / adsb). Default fm = same behavior as before.
if [[ ! -f /etc/sdr/mode.env ]]; then
  install -m 644 "$SRC/config/mode.env.example" /etc/sdr/mode.env
else
  echo "Keeping existing /etc/sdr/mode.env ($(grep '^MODE=' /etc/sdr/mode.env || echo MODE=fm))"
fi
if [[ ! -f /etc/sdr/adsb.env ]]; then
  install -m 644 "$SRC/config/adsb.env.example" /etc/sdr/adsb.env
else
  echo "Keeping existing /etc/sdr/adsb.env"
fi
# 1.0.4: map range-ring defaults, added only when missing (existing values are kept)
[[ -s /etc/sdr/adsb.env && -n "$(tail -c1 /etc/sdr/adsb.env)" ]] && echo >> /etc/sdr/adsb.env
grep -q '^ADSB_RINGS=' /etc/sdr/adsb.env || printf 'ADSB_RINGS=3\n' >> /etc/sdr/adsb.env
grep -q '^ADSB_RING_SPACING=' /etc/sdr/adsb.env || printf 'ADSB_RING_SPACING=auto\n' >> /etc/sdr/adsb.env

sed -e "s/^\\[Service\\]/[Service]\\nUser=${RUN_USER}\\nGroup=${RUN_GROUP}/" \
  "$SRC/systemd/sdr-fm.service" > /etc/systemd/system/sdr-fm.service
sed -e "s/^\\[Service\\]/[Service]\\nUser=${RUN_USER}\\nGroup=${RUN_GROUP}/" \
  "$SRC/systemd/sdr-web.service" > /etc/systemd/system/sdr-web.service
for u in sdr-spectrum sdr-detect sdr-adsb sdr-adsb-dual; do   # 1.0.9: + dual-dongle map unit
  sed -e "s/^\\[Service\\]/[Service]\\nUser=${RUN_USER}\\nGroup=${RUN_GROUP}/" \
    "$SRC/systemd/$u.service" > "/etc/systemd/system/$u.service"
done
install -m 644 "$SRC/systemd/sdr-mode.service" /etc/systemd/system/sdr-mode.service
/usr/local/sbin/sdr-dongles env >/dev/null 2>&1 || true   # 1.0.9: /etc/sdr/dongles.env (DUAL / RADIO_DEVICE / ADSB_DEVICE)

# ---- Pi speaker / Bluetooth audio (sdr-bt) ----
# PipeWire runs in RUN_USER's systemd --user session; linger starts it at boot without a login.
if [[ ! -f /etc/sdr/audio.env ]]; then
  install -m 644 "$SRC/config/audio.env.example" /etc/sdr/audio.env
fi
if ! grep -q '^AUDIO_USER=' /etc/sdr/audio.env; then
  echo "AUDIO_USER=\"${RUN_USER}\"" >>/etc/sdr/audio.env
fi
chmod 644 /etc/sdr/audio.env
if ! grep -q '^AUDIO_SINK=' /etc/sdr/audio.env; then   # desktop 1.0.8: play on the Pi by default, HDMI when the monitor has audio
  if aplay -l 2>/dev/null | grep -qi hdmi || ls /proc/asound 2>/dev/null | grep -qi hdmi; then DSINK=hdmi; else DSINK=jack; fi
  echo "AUDIO_SINK=$DSINK" >>/etc/sdr/audio.env
  sed -i 's/^AUDIO_OUT=.*/AUDIO_OUT=speaker/' /etc/sdr/audio.env; grep -q '^AUDIO_OUT=' /etc/sdr/audio.env || echo 'AUDIO_OUT=speaker' >>/etc/sdr/audio.env
  echo "Audio output: $DSINK (Audio page: HDMI / headphone jack / Bluetooth / phone stream)"
fi
touch /var/log/sdr-bt.log && chmod 644 /var/log/sdr-bt.log
AUDIO_UID=""
if [[ "$RUN_USER" != root ]]; then
  AUDIO_UID="$(id -u "$RUN_USER")"
  loginctl enable-linger "$RUN_USER" || true
  getent group bluetooth >/dev/null && usermod -aG bluetooth "$RUN_USER" || true
  systemctl --global enable pipewire.socket pipewire-pulse.socket wireplumber.service >/dev/null 2>&1 || true
  # sdr-fm plays into that session, so start it after the user manager is up
  sed -i "s/^\\[Unit\\]/[Unit]\\nAfter=user@${AUDIO_UID}.service\\nWants=user@${AUDIO_UID}.service/" /etc/systemd/system/sdr-fm.service
fi
# Bluetooth audio without an active login seat (headless / before the kiosk starts)
WP_CHANGED=0
for pair in "80-fieldnote-headless.lua:/etc/wireplumber/bluetooth.lua.d" \
            "80-fieldnote-headless.conf:/etc/wireplumber/wireplumber.conf.d"; do
  f="${pair%%:*}"; d="${pair#*:}"
  if ! cmp -s "$SRC/config/wireplumber/$f" "$d/$f"; then
    install -d -m 755 "$d" && install -m 644 "$SRC/config/wireplumber/$f" "$d/$f" && WP_CHANGED=1
  fi
done
sed -e "s/FIELDNOTE_UID/${AUDIO_UID:-0}/g" "$SRC/systemd/sdr-bt-reconnect.service" \
  > /etc/systemd/system/sdr-bt-reconnect.service
[[ -n "$AUDIO_UID" ]] || sed -i 's/ user@0.service//' /etc/systemd/system/sdr-bt-reconnect.service

cat >/etc/sudoers.d/sdr-station <<EOF
${RUN_USER} ALL=(root) NOPASSWD: /usr/local/sbin/sdr-select-station, /usr/local/sbin/sdr-scan, /usr/local/sbin/sdr-tune-freq, /usr/local/sbin/sdr-add-station, /usr/local/sbin/sdr-apply-settings, /usr/local/sbin/sdr-save-preset, /usr/local/sbin/sdr-delete-preset, /usr/local/sbin/sdr-net-mode, /usr/local/sbin/sdr-svc, /usr/local/sbin/sdr-mode, /usr/local/sbin/sdr-bt, /usr/local/sbin/sdr-maps, /usr/local/sbin/sdr-update, /usr/local/sbin/sdr-screen, /usr/local/sbin/sdr-listen, /usr/local/sbin/sdr-usb-reset, /usr/local/sbin/sdr-display-res, /usr/local/sbin/sdr-dongles, /usr/local/sbin/sdr-aircraft-db, /usr/local/sbin/sdr-content, /usr/local/sbin/sdr-shot, /usr/local/sbin/sdr-power reboot, /usr/local/sbin/sdr-power poweroff
EOF
chmod 440 /etc/sudoers.d/sdr-station

if [[ $UPGRADE -eq 1 ]]; then
  ADMIN_PW="(unchanged)"
  echo "Keeping the Icecast passwords"
elif [[ -f /etc/icecast2/icecast.xml ]]; then
  xmlstarlet ed -L \
    -u "/icecast/authentication/source-password" -v "$SOURCE_PW" \
    -u "/icecast/authentication/relay-password" -v "$SOURCE_PW" \
    -u "/icecast/authentication/admin-password" -v "$ADMIN_PW" \
    -u "/icecast/hostname" -v "localhost" \
    /etc/icecast2/icecast.xml || true
fi
if [[ -f /etc/default/icecast2 ]]; then
  grep -q '^ENABLE=' /etc/default/icecast2 && sed -i 's/^ENABLE=.*/ENABLE=true/' /etc/default/icecast2 || echo 'ENABLE=true' >> /etc/default/icecast2
fi
usermod -aG plugdev "$RUN_USER" || true

echo "[progress] 70 Enabling services"
# nginx on port 80 -> flask :8080 and stream :8000
rm -f /etc/nginx/sites-enabled/default
install -m 644 "$SRC/config/nginx-sdr.conf" /etc/nginx/sites-available/sdr
ln -sfn /etc/nginx/sites-available/sdr /etc/nginx/sites-enabled/sdr
nginx -t
systemctl enable nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 8000/tcp || true
  ufw allow 8080/tcp || true
  ufw allow 53 || true
  ufw allow 67/udp || true
fi
# ---- network: repair leftovers from older packages, then record the LIVE mode ----
# (nothing here brings Wi-Fi down; changes to NetworkManager config apply at the next reboot)
# An over-the-air upgrade (--upgrade) skips this whole block: Wi-Fi, hotspot and net.env stay exactly as they are.
NET_SEED=""   # 1.0.8: the network block runs after the display step (see below)

systemctl daemon-reload
# sdr-fm is no longer enabled directly: sdr-mode.service starts the saved dongle mode at boot.
systemctl disable sdr-fm >/dev/null 2>&1 || true
rm -f /etc/systemd/system/multi-user.target.wants/sdr-fm.service
systemctl daemon-reload
systemctl enable icecast2 sdr-web sdr-net sdr-mode nginx
# 1.2.0: the first-boot grace is a timer now (the old service slept 10 min inside multi-user.target)
systemctl disable sdr-firstboot-done.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/multi-user.target.wants/sdr-firstboot-done.service
systemctl enable sdr-net-retry.timer sdr-firstboot-done.timer >/dev/null 2>&1 || true
[[ $UPGRADE -eq 0 ]] && { install -d -m 755 /var/lib/sdr-station; touch /var/lib/sdr-station/first-boot; }   # no hotspot fallback during the first boot
systemctl enable sdr-bt-reconnect >/dev/null 2>&1 || true
systemctl enable sdr-screen sdr-screen-final >/dev/null 2>&1 || echo "WARNING: could not enable sdr-screen"
if systemctl list-unit-files bluetooth.service >/dev/null 2>&1; then
  systemctl enable --now bluetooth >/dev/null 2>&1 || true
fi
if [[ -n "$AUDIO_UID" ]]; then
  # bring the user's audio session up now (linger), and reload WirePlumber if its config changed
  as_audio_user() {
    runuser -u "$RUN_USER" -- env XDG_RUNTIME_DIR="/run/user/$AUDIO_UID" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$AUDIO_UID/bus" "$@"
  }
  for _ in 1 2 3 4 5; do [[ -S "/run/user/$AUDIO_UID/bus" ]] && break; sleep 1; done
  as_audio_user systemctl --user daemon-reload >/dev/null 2>&1 || true
  as_audio_user systemctl --user start pipewire.socket pipewire-pulse.socket wireplumber.service >/dev/null 2>&1 || true
  if [[ $WP_CHANGED -eq 1 ]]; then
echo "[progress] 80 Restarting services"
    as_audio_user systemctl --user restart wireplumber.service >/dev/null 2>&1 || true
  fi
fi
systemctl restart icecast2 || true
sleep 1
systemctl restart sdr-web nginx || true
systemctl start sdr-screen-final >/dev/null 2>&1 || true
systemctl restart sdr-screen >/dev/null 2>&1 || echo "WARNING: sdr-screen did not start (journalctl -u sdr-screen)"
DONGLE_MODE="$(/usr/local/sbin/sdr-mode current 2>/dev/null || echo fm)"
[[ "$DONGLE_MODE" == "none" ]] && DONGLE_MODE=spectrum
/usr/local/sbin/sdr-mode stop-all >/dev/null 2>&1 || true
/usr/local/sbin/sdr-mode set "$DONGLE_MODE" >/dev/null || /usr/local/sbin/sdr-mode set fm >/dev/null || true
systemctl start sdr-mode >/dev/null 2>&1 || true
sleep 2

# ---- Pi 4 bootloader power setting (POWER_OFF_ON_HALT=1, WAKE_ON_GPIO=0: full power-off after a shutdown) ----
# Only the EEPROM configuration changes (never the bootloader itself); it applies at the next reboot.
echo "Bootloader power setting POWER_OFF_ON_HALT=1 WAKE_ON_GPIO=0: the Pi powers fully off after a shutdown; start it by unplugging and replugging the power (log: /var/log/sdr-power.log):"
timeout 240 /usr/local/sbin/sdr-power eeprom-setup || echo "WARNING: bootloader setting reported a problem (sudo sdr-power eeprom-status)"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "============================================================"
echo "Control page (use this):  http://${IP:-HOST}/"
echo "Same page via Icecast:    http://${IP:-HOST}:8000/radio.html"
echo "Direct Flask:             http://${IP:-HOST}:8080/"
echo "Stream:                   http://${IP:-HOST}:8000/live.mp3"
echo "Spectrum / waterfall:     http://${IP:-HOST}/spectrum"
echo "RF detect:                http://${IP:-HOST}/detect"
echo "ADS-B aircraft:           http://${IP:-HOST}/adsb   (decoder: $(/usr/local/lib/sdr-station/bin/adsb_run.sh --which 2>/dev/null || echo 'not installed'))"
[[ $UPGRADE -eq 1 ]] || echo "Icecast admin:            http://${IP:-HOST}:8000/admin/  user=admin pass=${ADMIN_PW}"
echo "By name (mDNS):           http://$(hostname).local/"
echo
if [[ -n "$NET_SEED" ]]; then
  echo "Network now: $(echo "$NET_SEED" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("%s (%s) - after a reboot: %s" % (d.get("mode"), d.get("active_connection") or "-", d.get("saved_mode") or "unchanged"))' 2>/dev/null || echo unknown)"
  echo "Switch networks: Network page, or  sudo sdr-net-mode wifi | ap   (result: sudo sdr-net-mode last)"
fi
echo -n "icecast2="; systemctl is-active icecast2 || true
echo -n "sdr-fm="; systemctl is-active sdr-fm || true
echo -n "dongle mode="; /usr/local/sbin/sdr-mode current || true
echo -n "sdr-web="; systemctl is-active sdr-web || true
echo -n "nginx="; systemctl is-active nginx || true
echo "audio: $(/usr/local/sbin/sdr-bt status 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("speaker") or {}; print("FM to %s; bluetooth=%s; pipewire=%s; speaker=%s" % (d.get("output"), "ok" if d.get("bluetooth") else "missing", "ok" if d.get("pulse") else "not running", (s.get("name") or s.get("mac") or "none") + (" (connected)" if s.get("connected") else "")))' 2>/dev/null || echo unknown)"
echo "screen: $(/usr/local/sbin/sdr-screen status 2>/dev/null | head -n 4 | tr '\n' ';' || echo unknown)"
echo "Bluetooth speaker: Audio page, or  sudo sdr-bt scan / pair MAC / output both"
echo "ADS-B map: $(/usr/local/sbin/sdr-maps status 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d.get("manifest") or {}; print("offline LA map installed (%d MB, build %s)" % (d["bytes"] // 1048576, m.get("build", "?")) if d.get("installed") else "basic outline only (run: sudo sdr-maps fetch)")' 2>/dev/null || echo unknown)"
ss -lptn | grep -E ':80 |:8000|:8080' || true
echo -n "flask health: "; curl -s --max-time 3 http://127.0.0.1:8080/health || echo FAIL
echo
echo -n "nginx health: "; curl -s --max-time 3 http://127.0.0.1/health || echo FAIL
echo
if ! curl -sf --max-time 3 http://127.0.0.1:8080/health >/dev/null; then
  echo "WARNING: Flask did not come up. Last web log:"
  journalctl -u sdr-web -n 30 --no-pager || true
fi
echo "============================================================"
echo "[progress] 90 Saving a rollback copy"

echo "Version: ${VERSION}"
# Remember this tree (minus map tiles) so an over-the-air update can roll back to it.
if [[ $UPGRADE -eq 0 && "$SRC" != /var/lib/sdr-update/* ]]; then
  REL=/var/lib/sdr-update/releases
  rm -rf "$REL/$VERSION.tmp" && mkdir -p "$REL/$VERSION.tmp/sdr-station"
  if tar -C "$SRC" --exclude='./maps/*.pmtiles' --exclude='__pycache__' -cf - . | tar -C "$REL/$VERSION.tmp/sdr-station" -xf -; then
    rm -rf "$REL/$VERSION" && mv "$REL/$VERSION.tmp" "$REL/$VERSION"
    OLD="$(readlink /var/lib/sdr-update/current 2>/dev/null || true)"
    if [[ -n "$OLD" && "$OLD" != "releases/$VERSION" && -d "/var/lib/sdr-update/$OLD" ]]; then
      ln -sfn "$OLD" /var/lib/sdr-update/previous
    fi
    ln -sfn "releases/$VERSION" /var/lib/sdr-update/current
    echo "Saved this version ($VERSION) for over-the-air rollback: $REL/$VERSION"
  else
    rm -rf "$REL/$VERSION.tmp"; echo "WARNING: could not save a rollback copy of this version"
  fi
fi

# desktop 1.0.8.2: HDMI output is fixed at 720p (Pi 4 limit). Every upgraded HDMI kiosk is migrated:
# any video=HDMI-A-* mode in cmdline.txt -> 1280x720@60, RESOLUTION=720p in /etc/sdr/display.env. Applies at the next reboot.
if [[ $UPGRADE -eq 1 ]] && grep -qx 'DISPLAY_MODE=hdmi' /etc/sdr/display.env 2>/dev/null; then
  echo "[progress] Setting HDMI output to 720p landscape"
  SDR_DISPLAY_NO_INITRAMFS=1 /usr/local/sbin/sdr-display-res migrate >/dev/null && echo "HDMI output set to 720p (1280x720@60 + 720p-only EDID override; applies at the next reboot; undo: sudo sdr-display-res edid-off)"
fi
# 1.1.0: explicit US keyboard map for the cage kiosk (some Bluetooth keyboards, e.g. Logitech K830, lost Shift).
# A drop-in, so a hand-edited fieldnote-kiosk.service is untouched. Idempotent; applies at the next kiosk start/reboot.
if [[ -f /etc/systemd/system/fieldnote-kiosk.service ]]; then
  XKBD=/etc/systemd/system/fieldnote-kiosk.service.d; XKBF="$XKBD/10-xkb.conf"
  XKBT="$(printf '[Service]\nEnvironment=XKB_DEFAULT_RULES=evdev XKB_DEFAULT_MODEL=pc105 XKB_DEFAULT_LAYOUT=us XKB_DEFAULT_OPTIONS=\n')"
  if [[ "$(cat "$XKBF" 2>/dev/null)" != "$XKBT" ]]; then
    install -d -m 755 "$XKBD"; printf '%s\n' "$XKBT" > "$XKBF"; systemctl daemon-reload || true
    echo "Kiosk keyboard map set to US (applies at the next reboot)"
  fi
fi
# 1.2.0: drop --enable-gpu-rasterization from an installed HDMI kiosk launcher (forced GPU raster on the Pi 4 lost the
# side-rail icons on the TV while grim still showed them). Only that one flag is edited; applies at the next kiosk start.
if [[ -f /usr/local/bin/fieldnote-kiosk ]] && grep -q -- '--enable-gpu-rasterization' /usr/local/bin/fieldnote-kiosk; then
  sed -i 's/ --enable-gpu-rasterization//' /usr/local/bin/fieldnote-kiosk && echo "Kiosk: GPU rasterization flag removed (side-rail icons; applies at the next reboot)"
fi
if [[ $UPGRADE -eq 1 ]]; then
  # over-the-air upgrade: never rewrite the display setup / kiosk unit. Desktop: the HDMI pointer stays visible,
  # so the handheld blank-pointer step is never applied here.
  :
elif [[ $DO_DISPLAY -eq 1 ]]; then
  echo
  /usr/local/sbin/fieldnote-display-setup --hdmi --user "$RUN_USER" && mark_step display || echo "WARNING: display setup reported a problem (see above). Resume: sudo bash $SRC/install.sh --resume --display"
elif [[ ! -f /etc/sdr/display.env ]]; then
  echo "For the full-screen HDMI kiosk run:  sudo bash install.sh --display-only   (then sudo reboot)"
fi

# ---- network (1.0.8: after the display step, so a network change can never stop the kiosk setup) ----
if [[ $UPGRADE -eq 0 ]]; then
NMCONF=/etc/NetworkManager/conf.d/99-sdr-wlan.conf
if [[ -f "$NMCONF" ]] && grep -q 'unmanaged-devices=interface-name:eth0' "$NMCONF" \
   && ! systemctl is-active --quiet systemd-networkd 2>/dev/null; then
  sed -i '/^\[keyfile\]/d; /unmanaged-devices=interface-name:eth0/d' "$NMCONF"
  echo "NetworkManager will manage eth0 again after a reboot (Ethernet works as a back door)."
fi
if systemctl is-active --quiet NetworkManager 2>/dev/null \
   && [[ "$(systemctl is-enabled wpa_supplicant 2>/dev/null)" == "disabled" ]]; then
  systemctl enable wpa_supplicant >/dev/null 2>&1 || true   # older sdr-net-mode disabled NM's supplicant
fi
# A system-wide dnsmasq on :53 breaks DHCP for NetworkManager's hotspot. Turn it off only when
# it has no configuration of its own (stock package).
if [[ "$(systemctl is-enabled dnsmasq 2>/dev/null)" == "enabled" ]] \
   && ! grep -hvE '^[[:space:]]*(#|$)' /etc/dnsmasq.conf /etc/dnsmasq.d/*.conf 2>/dev/null | grep -q .; then
  systemctl disable --now dnsmasq >/dev/null 2>&1 && echo "Disabled the unused system dnsmasq service (hotspot DHCP uses NetworkManager's own)."
fi
systemctl enable --now avahi-daemon >/dev/null 2>&1 || true   # http://$(hostname).local
# Record what the Pi is doing right now (on Wi-Fi -> MODE=wifi) so neither this install nor
# the next reboot flips it into hotspot mode.
if command -v nmcli >/dev/null 2>&1; then
  NET_SEED="$(/usr/local/sbin/sdr-net-mode seed 2>/dev/null | tail -n1 || true)"
fi
fi   # end of network block (skipped by --upgrade)
if [[ -n "$NET_SEED" ]]; then echo "Network now: $(echo "$NET_SEED" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("mode"), d.get("active_connection") or "-")' 2>/dev/null || echo unknown)"; fi

# ---- boot + shutdown splash (Plymouth theme stillwave-trace), display stations only ----
# Also on over-the-air upgrades. Skips itself when plymouth / an initramfs boot is missing; any failure
# undoes its own changes, so the worst case is the normal text boot. Undo: sudo sdr-boot-setup --splash off
if [[ -f /etc/systemd/system/fieldnote-kiosk.service || -f /etc/sdr/display.env ]]; then
  echo
  echo "[progress] 92 Boot splash + initramfs (a rebuild can take a few minutes on a Pi)"
  t0=$SECONDS
  bash /usr/local/lib/sdr-station/bin/sdr-splash auto || echo "WARNING: boot splash not turned on (see above); the Pi keeps its normal text boot."
  echo "boot splash step took $((SECONDS - t0))s"
fi
# 1.1.0.1: the 720p EDID must be in the initramfs when the display driver loads from it. The splash step above
# rebuilds it (the EDID is part of its stamp); if the splash is off/skipped, rebuild here, still before the health check.
BOOTD=/boot/firmware; [[ -f $BOOTD/initrd.img ]] || BOOTD=/boot
if [[ -f /etc/initramfs-tools/hooks/trace-edid && -f /lib/firmware/edid/trace-720p.bin && -s $BOOTD/initrd.img ]] \
   && [[ /lib/firmware/edid/trace-720p.bin -nt $BOOTD/initrd.img ]] && command -v update-initramfs >/dev/null; then
  echo "[progress] 96 Adding the 720p EDID to the initramfs (a few minutes on a Pi)"
  t0=$SECONDS
  timeout 900 update-initramfs -u >/var/log/trace-edid-initramfs.log 2>&1 || echo "WARNING: update-initramfs failed (see /var/log/trace-edid-initramfs.log); the TV's own EDID is used if the 720p file can't load early"
  echo "initramfs rebuild took $((SECONDS - t0))s"
fi
[[ $UPGRADE -eq 0 ]] && mark_step install
# ---- 1.2.0 faster boot: turn off cloud-init and (only when nothing needs it) snapd ----
# cloud-init: its network config was already copied into NetworkManager (see above) and the netplan file stays, so
# disabling it only skips its boot stages.
# snapd (1.2.1 fix): on Ubuntu the kiosk browser is the Chromium SNAP, which needs snapd. 1.2.0 turned snapd off whenever no
# snap app was installed YET, so a first run whose display step failed (no internet) left snapd off and every retry
# could not install Chromium. Now snapd is left alone whenever this box is (or is about to be) a kiosk: --display was
# asked for, a kiosk is configured, or a display is attached. It is only turned off on a headless box with no snap apps,
# and it is turned back on when a kiosk box has it off and no Chromium yet.
wants_kiosk() {
  [[ ${DO_DISPLAY:-0} -eq 1 ]] || [[ -f /etc/systemd/system/fieldnote-kiosk.service || -f /etc/sdr/display.env ]] \
    || ls /sys/class/drm/card*-DSI-* >/dev/null 2>&1
}
boot_trim() {
  if [[ -d /etc/cloud && ! -e /etc/cloud/cloud-init.disabled ]]; then
    touch /etc/cloud/cloud-init.disabled && echo "Boot: cloud-init turned off (/etc/cloud/cloud-init.disabled; rm it to undo)"
  fi
  if command -v snap >/dev/null 2>&1 && systemctl list-unit-files snapd.service >/dev/null 2>&1; then
    local apps
    apps="$(snap list 2>/dev/null | awk 'NR>1 && $1 !~ /^(core[0-9]*|snapd|bare|gtk-common-themes|gnome-[0-9-]+|mesa-[0-9a-z-]+)$/ {print $1}' | xargs)"
    if wants_kiosk; then
      if ! [[ -x /snap/bin/chromium ]] && ! systemctl is-enabled --quiet snapd.service 2>/dev/null; then
        systemctl unmask snapd.service snapd.socket >/dev/null 2>&1 || true
        systemctl enable --now snapd.socket snapd.service snapd.seeded.service >/dev/null 2>&1 \
          && echo "Boot: snapd turned back on (the kiosk browser, the Chromium snap, needs it)"
      else
        echo "Boot: snapd kept on (kiosk box; the Chromium snap needs it)"
      fi
    elif [[ -z "$apps" ]] && ! [[ -x /snap/bin/chromium ]]; then
      systemctl disable snapd.service snapd.socket snapd.seeded.service >/dev/null 2>&1 && echo "Boot: snapd turned off (headless, no snap apps installed)"
    else
      echo "Boot: snapd kept on (snap apps in use: ${apps:-chromium})"
    fi
  fi
}
boot_trim || true
echo "TRACE-INSTALL: OK ($VERSION). Reboot to finish: sudo reboot"
