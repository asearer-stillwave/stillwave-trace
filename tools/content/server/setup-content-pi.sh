#!/usr/bin/env bash
# Stillwave content server on a Raspberry Pi (Raspberry Pi OS Lite, Bookworm or later). Run as root:
#   sudo bash setup-content-pi.sh [PORT]          (default port 8080)
# Serves /srv/stillwave-content/ as plain static files with HTTP Range (map packs resume and stream),
# laid out exactly like the future Cloudflare R2 bucket:
#   catalog.json(.sig)  maps/<id>.pmtiles(.sig)  bank/stations.json(.sig) + bank/stations-<cycle>.sqlite.gz
#   updates/handheld/latest.json ...  updates/desktop/latest.json ...
# Nothing here holds a key: the folder is built and signed on the build machine (publish_content.py), then copied in.
set -euo pipefail
PORT="${1:-8080}"
ROOT=/srv/stillwave-content
[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 1; }
apt-get update -qq
apt-get install -y -qq nginx rsync >/dev/null
install -d -m 755 "$ROOT" "$ROOT/maps" "$ROOT/bank" "$ROOT/updates/handheld" "$ROOT/updates/desktop"
OWNER="${SUDO_USER:-pi}"; chown -R "$OWNER":"$OWNER" "$ROOT"     # so you can rsync into it without sudo
cat >/etc/nginx/sites-available/stillwave-content <<NGX
server {
    listen ${PORT};
    listen [::]:${PORT};
    server_name _;
    root ${ROOT};
    autoindex off;
    sendfile on;
    # JSON lists change; check every time. Big files are immutable per name/sha, cache is fine.
    location ~ \.(json|sig)\$ { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location /maps/ { types { application/vnd.pmtiles pmtiles; } add_header Accept-Ranges bytes; try_files \$uri =404; }
    location / { try_files \$uri =404; }
    location ~ /\. { deny all; }
    location ~ \.pem\$ { deny all; }
}
NGX
ln -sfn /etc/nginx/sites-available/stillwave-content /etc/nginx/sites-enabled/stillwave-content
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx
IP="$(hostname -I | awk '{print $1}')"
echo
echo "Content server ready: http://${IP}:${PORT}/   (folder ${ROOT}, owned by ${OWNER})"
echo "Copy a published folder in from the build machine, e.g.:"
echo "  rsync -av --delete content-126/ ${OWNER}@${IP}:${ROOT}/"
echo "On each radio: More > Download maps > Content source = http://${IP}:${PORT}/"
