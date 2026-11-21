# Stillwave content server (home Pi now, Cloudflare R2 later)

Radios download **map packs**, the **station bank** and (when no `UPDATE_URL` is set) **updates** from one base
address, `CONTENT_URL`, set on the radio under **More › Download maps › Content source** (or
`sudo sdr-content set-url http://IP:8080/`). It is stored in `/etc/sdr/update.env`.

```
CONTENT_URL/
  catalog.json  catalog.json.sig            signed map list (Ed25519, Stillwave update key)
  maps/<id>.pmtiles  maps/<id>.pmtiles.sig  map packs (sha256 + size in the signed catalog)
  bank/stations.json(.sig)  bank/stations-<cycle>.sqlite.gz
  updates/handheld/latest.json …            same files as out/updates/<ver>/
  updates/desktop/latest.json …             same files as out/desktop/updates/<ver>-desktop/
```
A radio refuses anything not signed by the key baked into its package. The server itself holds no keys.

## 1. Build and sign the folder (build machine, where the key lives)
```
cd tools/content
./build_map_pack.py --out ~/content us-nv-las-vegas us-ca-san-diego     # needs the pmtiles CLI; --dry-run shows sizes
../build_station_bank.py 2026-10-29 ~/bank                               # every 28 days (FAA cycle)
./publish_content.py --out ~/content --key /path/to/stillwave-update-ed25519.pem --bank ~/bank/stations.sqlite \
    --updates-handheld out/updates/1.2.6 --updates-desktop out/desktop/updates/1.2.6-desktop
```

## 2. Home Pi (Raspberry Pi OS Lite)
1. Flash Pi OS Lite with Raspberry Pi Imager (set hostname `stillwave-content`, your Wi-Fi, SSH on).
2. Copy this folder over and run: `sudo bash setup-content-pi.sh 8080`
3. From the build machine: `rsync -av --delete ~/content/ pi@stillwave-content.local:/srv/stillwave-content/`
4. Check from any computer: `curl -s http://stillwave-content.local:8080/catalog.json | head`
5. On the radio: More › Download maps › Content source → `http://<Pi IP>:8080/` → Save.
   Give the Pi a fixed IP (DHCP reservation in the router) so the address never changes.

No Pi handy? Any computer works for a quick test: `cd ~/content && python3 -m http.server 8080`
(python's server has no Range support, so a paused download restarts from zero; nginx resumes).

## 3. Cloudflare R2 (by Nov 1)
See `upload-r2.sh` header for the one-time bucket + token + `rclone config` steps, then
`bash upload-r2.sh ~/content r2:stillwave-content`, and point radios at `https://<your R2 domain>/`.
R2 serves Range requests, so downloads resume. R2 has no egress fees; storage is billed per GB-month.
