#!/usr/bin/env bash
#
# Build QChat Reborn and pack it into qchat-release.tar.gz, ready to upload to the server.
# Run this on your own computer, from anywhere inside the project:
#
#   bash deploy/pack.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Building from scratch (this also type-checks everything)"
# Start clean, so nothing left over from older versions can end up in the release.
rm -rf shared/dist server/dist client/dist
npm run build

say "Packing"
OUT="qchat-release.tar.gz"
rm -f "$OUT"
tar czf "$OUT" \
  --exclude='*.tar.gz' \
  package.json package-lock.json \
  shared/package.json shared/dist \
  server/package.json server/dist server/words \
  client/package.json client/dist \
  SECURITY.md \
  deploy

say "Done: $(pwd)/$OUT ($(du -h "$OUT" | cut -f1))"
echo "Next: follow DEPLOYMENT.md (upload this file, unpack it, run deploy/install.sh as root)."
