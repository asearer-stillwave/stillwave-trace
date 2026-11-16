#!/usr/bin/env bash
# Stillwave Trace 1.3.7 installer, both editions in one package (trace-1.3.7.zip).
#   sudo bash install.sh                  asks which edition, then installs it:
#                                           1) Handheld (5" touch display)
#                                           2) Desktop (HDMI)
#   sudo bash install.sh --display dsi    handheld edition + 5" touch display kiosk, no question (scripts, SD images)
#   sudo bash install.sh --display hdmi   desktop edition + HDMI kiosk, no question
#   sudo bash install.sh --upgrade       keeps this box's edition (/usr/local/lib/sdr-station/EDITION), no question
#   Other options (--resume, --no-os-upgrade, --display-only, --force-edition, --dsi-port 0|1) go to the edition installer.
# The question is asked here, BEFORE the edition installer moves itself into the background over SSH, so typing 1 or 2
# works in an SSH session. The edition tree is put together from common/ + handheld/ or desktop/ in
# /var/lib/sdr-station/stage/<version>-<edition>/ and its own install.sh does the work (same as the 1.3.6 zips).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_VERSION="$(cat "$ROOT/VERSION" 2>/dev/null || echo '?')"
STAGE_ROOT="${SDR_STAGE_ROOT:-/var/lib/sdr-station/stage}"
EDITION_FILE="${SDR_EDITION_FILE:-/usr/local/lib/sdr-station/EDITION}"
DRYRUN="${SDR_INSTALL_DRYRUN:-}"          # 1 = assemble + print the command, run nothing (tests)
TTY="${SDR_INSTALL_TTY:-/dev/tty}"        # where the edition question is read from (tests point it at a file)

usage() { sed -n '2,12p' "$ROOT/install.sh"; }
UPGRADE=0; RESUME=0; DISP=""; PASS=(); prev=""
[[ "${SDR_UPDATE_RUN:-}" == 1 ]] && UPGRADE=1
for arg in "$@"; do
  if [[ "$prev" == --display ]]; then
    prev=""
    case "$arg" in
      dsi|touch|handheld) DISP=dsi; continue ;;
      hdmi|desktop) DISP=hdmi; continue ;;
      *) DISP=dsi ;;   # bare --display (1.3.6 handheld wording) = the 5" touch display; this arg is handled below
    esac
  fi
  case "$arg" in
    --display) prev=--display ;;
    --display=dsi|--display=touch) DISP=dsi ;;
    --display=hdmi) DISP=hdmi ;;
    --display=*) echo "--display must be dsi (5\" touch display, handheld) or hdmi (desktop)" >&2; exit 2 ;;
    --upgrade) UPGRADE=1 ;;
    --resume) RESUME=1; PASS+=("$arg") ;;
    -h|--help) usage; exit 0 ;;
    *) PASS+=("$arg") ;;
  esac
done
[[ "$prev" == --display ]] && DISP=dsi

if [[ -z "$DRYRUN" && ${EUID} -ne 0 ]]; then
  echo "Run: sudo bash $ROOT/install.sh $*" >&2
  exit 1
fi
for d in common handheld desktop; do
  [[ -d "$ROOT/$d" ]] || { echo "This package is incomplete: $ROOT/$d is missing. Unzip trace-$PKG_VERSION.zip again." >&2; exit 1; }
done

installed_edition() { local e; e="$(cat "$EDITION_FILE" 2>/dev/null || true)"; e="${e//[[:space:]]/}"; echo "${e:-handheld}"; }
ED=""
if [[ $UPGRADE -eq 1 ]]; then
  ED="$(installed_edition)"
  [[ "$ED" == desktop ]] || ED=handheld
  [[ -n "$DISP" ]] && echo "--upgrade keeps this box's edition ($ED); --display ignored."
  echo "Upgrade: keeping this box's edition: $ED"
elif [[ -n "$DISP" ]]; then
  [[ "$DISP" == hdmi ]] && ED=desktop || ED=handheld
elif [[ $RESUME -eq 1 && -s "$STAGE_ROOT/last-edition" ]]; then
  ED="$(cat "$STAGE_ROOT/last-edition")"
  echo "Resume: same edition as before: $ED"
else
  if ! { exec 3<"$TTY"; } 2>/dev/null; then
    echo "No terminal to ask which edition. Run one of:" >&2
    echo "  sudo bash $ROOT/install.sh --display dsi     (handheld, 5\" touch display)" >&2
    echo "  sudo bash $ROOT/install.sh --display hdmi    (desktop, HDMI)" >&2
    exit 2
  fi
  echo "Stillwave Trace $PKG_VERSION: which edition is this?"
  [[ -s "$EDITION_FILE" ]] && echo "(this box runs: $(installed_edition))"
  for i in 1 2 3; do
    echo "  1) Handheld (5\" touch display)"
    echo "  2) Desktop (HDMI)"
    printf 'Type 1 or 2, then Enter: '
    ans=""; IFS= read -r ans <&3 || true; ans="${ans//[[:space:]]/}"
    case "$ans" in
      1) ED=handheld; break ;;
      2) ED=desktop; break ;;
      *) echo; echo "Please type 1 or 2." ;;
    esac
  done
  exec 3<&-
  [[ -n "$ED" ]] || { echo "No edition chosen; nothing was installed." >&2; exit 2; }
fi
echo "Edition: $ED"

# ---- put the edition tree together: common/ + <edition>/ (the edition's own files win) ----
STAGE="$STAGE_ROOT/$PKG_VERSION-$ED"
mkdir -p "$STAGE_ROOT" || { echo "cannot create $STAGE_ROOT" >&2; exit 1; }
rm -rf "$STAGE.tmp"
mkdir -p "$STAGE.tmp" && cp -R "$ROOT/common/." "$STAGE.tmp/" && cp -R "$ROOT/$ED/." "$STAGE.tmp/" \
  || { rm -rf "$STAGE.tmp"; echo "could not copy the $ED files to $STAGE" >&2; exit 1; }
# exec bits (an unzip tool that drops file modes must not break the install)
find "$STAGE.tmp/bin" -type f -exec chmod 755 {} + 2>/dev/null
chmod 755 "$STAGE.tmp"/*.sh 2>/dev/null
[[ -s "$STAGE.tmp/install.sh" && -s "$STAGE.tmp/VERSION" ]] || { rm -rf "$STAGE.tmp"; echo "the $ED tree is incomplete" >&2; exit 1; }
rm -rf "$STAGE" && mv "$STAGE.tmp" "$STAGE"
[[ $UPGRADE -eq 1 ]] || echo "$ED" >"$STAGE_ROOT/last-edition"

ARGS=()
if [[ $UPGRADE -eq 1 ]]; then ARGS+=(--upgrade)
elif [[ "$ED" == desktop && -n "$DISP" ]]; then ARGS+=(--display hdmi)
elif [[ "$ED" == desktop ]]; then ARGS+=(--display hdmi)        # picked 2) Desktop (HDMI): station + HDMI kiosk
else ARGS+=(--display)                                          # picked 1) or --display dsi: station + 5" touch kiosk
fi
ARGS+=(${PASS[@]+"${PASS[@]}"})
echo "Running: bash $STAGE/install.sh ${ARGS[*]}"
if [[ -n "$DRYRUN" ]]; then echo "DRYRUN edition=$ED version=$(cat "$STAGE/VERSION")"; exit 0; fi
exec /bin/bash "$STAGE/install.sh" "${ARGS[@]}"
