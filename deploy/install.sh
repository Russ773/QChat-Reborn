#!/usr/bin/env bash
#
# Install or upgrade QChat Reborn on a Linux server (Debian, Ubuntu, Fedora, Rocky, Alma).
# Run it ON the server, as root, from the unpacked release folder:
#
#   mkdir qchat-release && tar xzf qchat-release.tar.gz -C qchat-release
#   sudo bash qchat-release/deploy/install.sh
#
# Safe to run again for every update. It never touches your data (/var/lib/qchat) or your
# settings (/etc/qchat/qchat.env), and it keeps the previous version in /opt/qchat.prev
# so you can roll back.
set -euo pipefail

APP_USER="${APP_USER:-qchat}"
APP_DIR="${APP_DIR:-/opt/qchat}"
DATA_DIR="${DATA_DIR:-/var/lib/qchat}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qchat}"
ENV_DIR="/etc/qchat"
ENV_FILE="$ENV_DIR/qchat.env"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this as root: sudo bash $0"
[ -f "$SRC/server/dist/index.js" ] || die "This does not look like an unpacked QChat release (no server/dist/index.js in $SRC)."
command -v systemctl >/dev/null 2>&1 || die "This server does not use systemd, so this script cannot set up the service."

# 1. Node.js 24 (the app uses the database built into Node, which needs a recent version).
# The system's own Node is NEVER changed, because other sites on the server may depend on it.
# If it is not 24 or newer, a private copy is kept in $NODE_DIR just for QChat.
NODE_DIR="${NODE_DIR:-/opt/qchat-node}"
node_major() { "$1" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0; }

install_private_node() {
  command -v curl >/dev/null 2>&1 || die "curl is needed to download Node.js."
  command -v xz >/dev/null 2>&1 || die "xz is needed to unpack Node.js (install the xz-utils package)."
  local arch
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "Unsupported processor type: $(uname -m)" ;;
  esac
  local base="https://nodejs.org/dist/latest-v24.x" sums file sha tmp
  say "Downloading Node.js 24 (a private copy in $NODE_DIR)"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "Could not reach nodejs.org."
  file="$(printf '%s\n' "$sums" | awk -v suffix="linux-$arch.tar.xz" 'length($2) >= length(suffix) && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }')"
  sha="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')"
  [ -n "$file" ] && [ -n "$sha" ] || die "Could not find a Node.js 24 download for $arch."
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$file" -o "$tmp/$file" || die "Download failed."
  ( cd "$tmp" && echo "$sha  $file" | sha256sum -c - >/dev/null ) || die "The Node.js download did not match its checksum. Not installing it."
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
}

NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1 && [ "$(node_major "$(command -v node)")" -ge 24 ]; then
    NODE_BIN="$(command -v node)"
  elif [ -x "$NODE_DIR/bin/node" ] && [ "$(node_major "$NODE_DIR/bin/node")" -ge 24 ]; then
    NODE_BIN="$NODE_DIR/bin/node"
  else
    install_private_node
    NODE_BIN="$NODE_DIR/bin/node"
  fi
fi
[ "$(node_major "$NODE_BIN")" -ge 24 ] || die "Node.js 24 or newer is required (found $("$NODE_BIN" -v))."
# Use this Node (and its npm) for the install step below.
export PATH="$(dirname "$NODE_BIN"):$PATH"
say "Using Node $("$NODE_BIN" -v) at $NODE_BIN"

# 2. A user with no login and no shell, to run the app as
if ! id "$APP_USER" >/dev/null 2>&1; then
  say "Creating the '$APP_USER' user"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$ENV_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
chown root:"$APP_USER" "$BACKUP_DIR" && chmod 770 "$BACKUP_DIR"

# 3. Put the new version in place (the old one is kept as $APP_DIR.prev)
say "Installing the app into $APP_DIR"
systemctl stop qchat 2>/dev/null || true
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -a "$SRC"/. "$APP_DIR.new"/
rm -f "$APP_DIR.new"/*.tar.gz
( cd "$APP_DIR.new" && npm ci --omit=dev --workspace server --workspace shared --no-audit --no-fund )
rm -rf "$APP_DIR.prev"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.prev"
mv "$APP_DIR.new" "$APP_DIR"
# The app can read its own code but not change it.
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
chmod +x "$APP_DIR"/deploy/*.sh

# 4. Settings, written once and never overwritten
if [ ! -f "$ENV_FILE" ]; then
  say "Creating $ENV_FILE"
  cp "$APP_DIR/deploy/qchat.env.example" "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  warn "Check $ENV_FILE before relying on it (admin name, allowed origins, port)."
else
  say "Keeping your existing $ENV_FILE"
fi

# 5. The service
say "Installing the service"
sed "s#__NODE__#$NODE_BIN#g; s#__APP_DIR__#$APP_DIR#g; s#__DATA_DIR__#$DATA_DIR#g; s#__USER__#$APP_USER#g" \
  "$APP_DIR/deploy/qchat.service" > /etc/systemd/system/qchat.service
systemctl daemon-reload
systemctl enable qchat >/dev/null 2>&1
systemctl restart qchat

# 6. Nightly backup at 03:30
cat > /etc/cron.d/qchat-backup <<CRON
# QChat Reborn nightly backup (keeps the last 14)
30 3 * * * $APP_USER QCHAT_DATA_DIR=$DATA_DIR BACKUP_DIR=$BACKUP_DIR $APP_DIR/deploy/backup.sh >> $BACKUP_DIR/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/qchat-backup

# 7. Is it up?
PORT="$(grep -E '^HTTP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 || true)"; PORT="${PORT:-8300}"
say "Checking the app answers on 127.0.0.1:$PORT"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
done
if [ "$ok" -eq 1 ]; then
  say "QChat Reborn is running."
else
  warn "It did not answer. Look at the log:  journalctl -u qchat -n 50 --no-pager"
fi

cat <<NEXT

Next steps
  1. Point your web server at it: copy the right file from $APP_DIR/deploy/
     (apache-vhost.conf.example, nginx.conf.example or Caddyfile.example). It must be
     HTTPS, and it must pass on the Host header and the visitor's address.
  2. Open https://your-domain and create the admin account (the name in ADMIN_ACCOUNTS) first.
  3. Make sure the firewall only allows 22, 80 and 443. Port $PORT must NOT be open to the internet.

Handy
  Status:   systemctl status qchat
  Logs:     journalctl -u qchat -f
  Backups:  $BACKUP_DIR
  Roll back to the previous version: see DEPLOYMENT.md
NEXT
