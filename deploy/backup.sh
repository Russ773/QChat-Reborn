#!/usr/bin/env bash
#
# Back up QChat Reborn: a safe copy of the database (taken while the site is running),
# plus profile photos and shared pictures, in one dated .tar.gz. Keeps the newest 14.
#
#   deploy/backup.sh            (the installer runs this every night)
#
# Settings, if you need to change them:
#   QCHAT_DATA_DIR   where the data lives      (default /var/lib/qchat)
#   BACKUP_DIR       where backups are kept    (default /var/backups/qchat)
#   KEEP             how many backups to keep  (default 14)
set -euo pipefail
umask 077

DATA_DIR="${QCHAT_DATA_DIR:-/var/lib/qchat}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qchat}"
KEEP="${KEEP:-14}"

[ -f "$DATA_DIR/qchat.db" ] || { echo "No database at $DATA_DIR/qchat.db" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# VACUUM INTO makes a consistent copy even while people are chatting.
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1] + '/qchat.db', { readOnly: true });
db.exec(\"VACUUM INTO '\" + process.argv[2] + \"/qchat.db'\");
db.close();
" "$DATA_DIR" "$tmp" 2>&1 | grep -v -i "ExperimentalWarning\|node --trace-warnings" || true

[ -f "$tmp/qchat.db" ] || { echo "The database copy failed" >&2; exit 1; }
for d in avatars uploads; do [ -d "$DATA_DIR/$d" ] && cp -a "$DATA_DIR/$d" "$tmp/$d"; done

out="$BACKUP_DIR/qchat-$stamp.tar.gz"
tar czf "$out" -C "$tmp" .
echo "$(date '+%F %T') wrote $out ($(du -h "$out" | cut -f1))"

# Keep only the newest $KEEP
ls -1t "$BACKUP_DIR"/qchat-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
