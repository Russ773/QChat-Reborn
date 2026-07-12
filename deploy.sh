#!/usr/bin/env bash
#
# QChat site deploy — run this ON the site server (Ubuntu) as your normal user
# (it calls sudo where needed). It builds the app, writes server/.env, installs
# a systemd service, and sets up an nginx site (HTTP; run certbot after DNS).
#
# Usage:
#   mkdir -p ~/qchat && tar xzf ~/qchat-deploy.tar.gz -C ~/qchat
#   cd ~/qchat && WEBIRC_PASSWORD='your-secret' bash deploy.sh
#
# Override any of these via env vars:
set -euo pipefail

DOMAIN="${DOMAIN:-qchat.co.uk}"
APP_USER="${APP_USER:-$(whoami)}"
APP_DIR="${APP_DIR:-$HOME/qchat}"
IRC_HOST="${IRC_HOST:-irc.qchat.co.uk}"
ADMIN_ACCOUNTS="${ADMIN_ACCOUNTS:-Russ}"
HTTP_PORT="${HTTP_PORT:-8080}"
WEBIRC_PASSWORD="${WEBIRC_PASSWORD:-}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ -z "$WEBIRC_PASSWORD" ]; then
  WEBIRC_PASSWORD="$(openssl rand -hex 24)"
  GENERATED_SECRET=1
fi

say "QChat deploy — domain=$DOMAIN user=$APP_USER dir=$APP_DIR upstream=$IRC_HOST"

# 1. Node 20+
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
say "Node $(node -v)"

# 2. Extract if the app isn't unpacked yet
if [ ! -f "$APP_DIR/package.json" ]; then
  say "Extracting tarball to $APP_DIR"
  mkdir -p "$APP_DIR"
  tar xzf "${TARBALL:-$HOME/qchat-deploy.tar.gz}" -C "$APP_DIR"
fi
cd "$APP_DIR"

# 3. Build
say "Installing dependencies + building"
npm install
npm run build

# 4. server/.env
say "Writing server/.env"
cat > server/.env <<ENV
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

# 5. systemd service
say "Installing systemd service 'qchat'"
sudo tee /etc/systemd/system/qchat.service >/dev/null <<UNIT
[Unit]
Description=QChat web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) --env-file-if-exists=.env dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now qchat
sleep 2
sudo systemctl --no-pager --lines=8 status qchat || true

# 6. nginx (HTTP only; certbot adds TLS afterwards)
# Skip on Virtualmin/cPanel boxes where Apache already owns 80/443 — set
# SKIP_NGINX=1 and reverse-proxy via the control panel / Apache instead.
if [ "${SKIP_NGINX:-0}" = "1" ]; then
  say "SKIP_NGINX=1 — leaving the web server to you (Apache/Virtualmin reverse proxy)"
else
say "Configuring nginx"
sudo apt-get install -y nginx >/dev/null
sudo tee /etc/nginx/sites-available/qchat >/dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 2m;

    location /irc {
        proxy_pass http://127.0.0.1:$HTTP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_read_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:$HTTP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/qchat /etc/nginx/sites-enabled/qchat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
fi

say "APP DEPLOYED ✔  (systemctl status qchat / journalctl -u qchat -f)"
echo
echo "──────────────────────────────────────────────────────────────────"
echo " NEXT — two things only you can do:"
echo
echo " 1) DNS: point  $DOMAIN  (A) -> this server, then get a cert:"
echo "      sudo apt-get install -y certbot python3-certbot-nginx"
echo "      sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo
echo " 2) On the IRCd VPS (unrealircd.conf), add these and ./unrealircd rehash."
echo "    Put the allow{} block ABOVE the default 'allow { mask *; }' block:"
echo
echo "      webirc { mask ${SITE_IP:-<this-server-public-IP>}; password \"$WEBIRC_PASSWORD\"; }"
echo "      except throttle { mask { ip ${SITE_IP:-<this-server-public-IP>}; } }"
echo "      allow { match { ip ${SITE_IP:-<this-server-public-IP>}; } class clients; maxperip 200; }"
echo "──────────────────────────────────────────────────────────────────"
if [ "${GENERATED_SECRET:-0}" = "1" ]; then
  echo " NOTE: a WEBIRC secret was generated for you (also in server/.env):"
  echo "       $WEBIRC_PASSWORD"
fi
