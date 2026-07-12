#!/usr/bin/env bash
#
# QChat one-shot deploy for a Virtualmin / Apache box. Run as ROOT.
#
#   sudo bash -c 'cd /home/qchat && mkdir -p qchat-app \
#     && tar xzf qchat-deploy.tar.gz -C qchat-app \
#     && SITE_IP=<your-site-server-ip> bash qchat-app/deploy-virtualmin.sh'
#
# It: installs Node if needed, builds as the app user, writes server/.env,
# installs+starts the systemd service, enables Apache proxy modules, and
# injects the reverse-proxy into the domain's Apache vhost (with backup +
# configtest + automatic rollback). Safe to re-run.
set -uo pipefail

DOMAIN="${DOMAIN:-qchat.co.uk}"
APP_USER="${APP_USER:-qchat}"
APP_DIR="${APP_DIR:-/home/$APP_USER/qchat-app}"
TARBALL="${TARBALL:-/home/$APP_USER/qchat-deploy.tar.gz}"
IRC_HOST="${IRC_HOST:-irc.qchat.co.uk}"
ADMIN_ACCOUNTS="${ADMIN_ACCOUNTS:-Russ}"
HTTP_PORT="${HTTP_PORT:-8080}"
SITE_IP="${SITE_IP:-}"
WEBIRC_PASSWORD="${WEBIRC_PASSWORD:-}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root:  sudo bash $0"
id "$APP_USER" >/dev/null 2>&1 || die "User '$APP_USER' not found (set APP_USER=...)."
if [ -z "$WEBIRC_PASSWORD" ]; then WEBIRC_PASSWORD="$(openssl rand -hex 24)"; GEN=1; fi

# 1. Node 20+
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs \
    || die "Node install failed"
fi
NODE_BIN="$(command -v node)"
say "Node $(node -v)"

# 2. Ensure the app is unpacked
if [ ! -f "$APP_DIR/package.json" ]; then
  [ -f "$TARBALL" ] || die "No app at $APP_DIR and no tarball at $TARBALL"
  say "Extracting $TARBALL -> $APP_DIR"
  mkdir -p "$APP_DIR" && tar xzf "$TARBALL" -C "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# 3. server/.env
say "Writing server/.env"
cat > "$APP_DIR/server/.env" <<ENV
HTTP_PORT=$HTTP_PORT
IRC_UPSTREAM_HOST=$IRC_HOST
IRC_UPSTREAM_PORT=6697
IRC_UPSTREAM_TLS=1
IRC_UPSTREAM_TLS_REJECT_UNAUTHORIZED=1
IRC_SERVER_NAME=qchat.local
ADMIN_ACCOUNTS=$ADMIN_ACCOUNTS
WEBIRC_PASSWORD=$WEBIRC_PASSWORD
WEBIRC_NAME=qchat
QCHAT_DATA_DIR=$APP_DIR/server/data
ENV
chown "$APP_USER:$APP_USER" "$APP_DIR/server/.env"

# 4. Build as the app user (keeps file ownership correct)
say "Building (npm install + build) as $APP_USER — this can take a minute"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install && npm run build" || die "Build failed"

# 5. systemd service
say "Installing + starting systemd service 'qchat'"
cat > /etc/systemd/system/qchat.service <<UNIT
[Unit]
Description=QChat web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$NODE_BIN --env-file-if-exists=.env dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now qchat
sleep 3
if curl -fsS "http://127.0.0.1:$HTTP_PORT/healthz" >/dev/null 2>&1; then
  say "App is running on 127.0.0.1:$HTTP_PORT ✔"
else
  warn "App not answering on :$HTTP_PORT yet — check: journalctl -u qchat -n 40 --no-pager"
fi

# 6. Apache reverse proxy
say "Enabling Apache proxy modules"
a2enmod proxy proxy_http proxy_wstunnel >/dev/null 2>&1

read -r -d '' BLOCK <<APA
    # >>> QCHAT-PROXY (added by deploy; safe to leave) >>>
    ProxyPreserveHost On
    ProxyPass /.well-known !
    ProxyPass /irc ws://127.0.0.1:$HTTP_PORT/irc
    ProxyPassReverse /irc ws://127.0.0.1:$HTTP_PORT/irc
    ProxyPass / http://127.0.0.1:$HTTP_PORT/
    ProxyPassReverse / http://127.0.0.1:$HTTP_PORT/
    # <<< QCHAT-PROXY <<<
APA

mapfile -t VHOSTS < <(grep -rlE "ServerName[[:space:]]+$DOMAIN([[:space:]]|\$)|ServerAlias[[:space:]].*$DOMAIN" /etc/apache2/sites-available/ 2>/dev/null)

if [ "${#VHOSTS[@]}" -eq 0 ]; then
  warn "No Apache vhost for $DOMAIN found (set up the domain + SSL in Virtualmin first,"
  warn "then re-run me). For now, add these directives via Virtualmin -> Edit Directives:"
  printf '%s\n' "$BLOCK"
else
  changed=0
  for f in "${VHOSTS[@]}"; do
    grep -q 'QCHAT-PROXY' "$f" && continue
    cp -a "$f" "$f.qchat-bak"
    awk -v blk="$BLOCK" '/<\/VirtualHost>/{print blk} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    changed=1
  done
  if [ "$changed" = "1" ]; then
    if apache2ctl configtest >/dev/null 2>&1; then
      systemctl reload apache2
      say "Apache reverse proxy configured on: ${VHOSTS[*]} ✔"
    else
      warn "Apache configtest FAILED — rolling back your vhost, no changes kept."
      for f in "${VHOSTS[@]}"; do [ -f "$f.qchat-bak" ] && mv "$f.qchat-bak" "$f"; done
      systemctl reload apache2 >/dev/null 2>&1
      warn "Add the proxy directives via Virtualmin -> Edit Directives instead:"
      printf '%s\n' "$BLOCK"
    fi
  else
    say "Apache proxy already present ✔ (nothing to change)"
  fi
fi

# 7. Final instructions
say "APP SIDE DONE."
cat <<FINAL

──────────────────────────────────────────────────────────────────────
 Three things left — all OUTSIDE this box:

 1) DNS:  $DOMAIN  A  ->  ${SITE_IP:-<this server's public IP>}
          (and delete/repoint the old IPv6 'AAAA' record)

 2) TLS:  Virtualmin -> $DOMAIN -> Server Configuration -> SSL Certificate
          -> Let's Encrypt -> Request  (do AFTER DNS resolves here).
          Then re-run this script once so the proxy lands in the SSL vhost.

 3) IRCd VPS: add to unrealircd.conf, then  ./unrealircd rehash.
    Put the allow{} block ABOVE the default 'allow { mask *; }':

      webirc { mask ${SITE_IP:-<SITE_IP>}; password "$WEBIRC_PASSWORD"; }
      except throttle { mask { ip ${SITE_IP:-<SITE_IP>}; } }
      allow { match { ip ${SITE_IP:-<SITE_IP>}; } class clients; maxperip 200; }

 Then open  https://$DOMAIN  — connect as guest, then log in as Russ.
 Live logs:  journalctl -u qchat -f
──────────────────────────────────────────────────────────────────────
FINAL
[ "${GEN:-0}" = "1" ] && printf '\nNOTE: generated WEBIRC secret (also in server/.env): %s\n' "$WEBIRC_PASSWORD"
