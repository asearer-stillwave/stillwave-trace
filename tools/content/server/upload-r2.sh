#!/usr/bin/env bash
# Upload a published Stillwave content folder to Cloudflare R2 with rclone (no credentials in this file).
#   bash upload-r2.sh CONTENT_DIR [REMOTE:BUCKET]        default remote/bucket: r2:stillwave-content
# One-time setup on the machine that uploads:
#   1. Cloudflare dashboard > R2 > Create bucket "stillwave-content"; Settings > Public access: connect a custom
#      domain (e.g. content.stillwave.example) or enable the r2.dev URL.
#   2. R2 > Manage API tokens > Create token with "Object Read & Write" on that bucket. Note Access Key ID,
#      Secret Access Key and the account's S3 endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   3. rclone config  -> new remote "r2", type s3, provider Cloudflare, paste the keys + endpoint, acl private.
#      (keys stay in ~/.config/rclone/rclone.conf on your computer; never commit that file)
# Order matters: big files first, the signed lists last, so a radio never sees a catalog pointing at a missing file.
set -euo pipefail
SRC="${1:?content folder}"; DST="${2:-r2:stillwave-content}"
command -v rclone >/dev/null || { echo "install rclone first: https://rclone.org/install/"; exit 1; }
if grep -rlq "PRIVATE KEY-----" --include='*' "$SRC" 2>/dev/null || find "$SRC" -name '*.pem' | grep -q .; then
  echo "refusing: private key material in $SRC"; exit 1
fi
rclone copy "$SRC/maps" "$DST/maps" --include '*.pmtiles' --s3-no-check-bucket --progress
rclone copy "$SRC/bank" "$DST/bank" --include '*.gz' --s3-no-check-bucket --progress
[[ -d "$SRC/updates" ]] && rclone copy "$SRC/updates" "$DST/updates" --exclude 'latest.json' --s3-no-check-bucket --progress
rclone copy "$SRC" "$DST" --include '/maps/*.sig' --include '/bank/stations.json*' --include '/updates/*/latest.json' --s3-no-check-bucket
rclone copy "$SRC" "$DST" --include '/catalog.json' --include '/catalog.json.sig' --header-upload "Cache-Control: no-cache" --s3-no-check-bucket
echo "Uploaded. Check: curl -sI https://<your R2 domain>/catalog.json ; then set each radio's Content source to that https:// address."
echo "Old packs are not deleted automatically; prune with: rclone delete --dry-run $DST/maps --exclude-from <list of current files>"
