#!/usr/bin/env bash
# Build a signed Stillwave Trace update into /workspace/sdr/out/updates/<version>/.
#   make-release.sh [--src DIR] [--notes "text"] [--min-version 1.0.0] [--out DIR]
# The version comes from DIR/VERSION. Serve the <version> folder as-is (python3 -m http.server).
set -euo pipefail
exec python3 "$(dirname "$0")/make_release.py" "$@"
