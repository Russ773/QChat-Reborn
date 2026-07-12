# Deploying the QChat site (separate server, SFTP)

The web app runs on its own Linux server and connects to your IRCd at
`irc.qchat.co.uk:6697` (TLS). Public URL via nginx + Let's Encrypt, e.g.
`https://chat.qchat.co.uk`.

Replace these placeholders as you go:
- `<user>` — the Linux user you run the app as (not root)
- `<SITE_IP>` — the site server's **public** IP
- `chat.qchat.co.uk` — your chosen subdomain

---

## 1. Upload + extract

SFTP `qchat-deploy.tar.gz` (from your Desktop) to the server, then:

```bash
mkdir -p ~/qchat && tar xzf ~/qchat-deploy.tar.gz -C ~/qchat
cd ~/qchat
```

## 2. Node 20+ and build

```bash
# If Node isn't installed (Ubuntu/Debian):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version        # expect v20+ (v22/24 fine)
npm install
npm run build         # builds shared, server, and client
```

## 3. Configure `server/.env`

```bash
cp server/.env.example server/.env
nano server/.env
```

```ini
HTTP_PORT=8080
IRC_UPSTREAM_HOST=irc.qchat.co.uk
IRC_UPSTREAM_PORT=6697
IRC_UPSTREAM_TLS=1
IRC_UPSTREAM_TLS_REJECT_UNAUTHORIZED=1
IRC_SERVER_NAME=qchat.local
ADMIN_ACCOUNTS=Russ
WEBIRC_PASSWORD=choose-a-strong-secret
WEBIRC_NAME=qchat
QCHAT_DATA_DIR=/home/<user>/qchat/server/data
```

Do **not** set `QCHAT_DEV_TOKEN` in production — it's a test-only auth bypass.

## 4. Run under systemd

```bash
sudo tee /etc/systemd/system/qchat.service >/dev/null <<'EOF'
[Unit]
Description=QChat web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/qchat/server
ExecStart=/usr/bin/node --env-file-if-exists=.env dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now qchat
systemctl status qchat --no-pager       # should log "mode: GATEWAY -> irc.qchat.co.uk:6697 (TLS)"
```

## 5. DNS + nginx + TLS

1. Add a DNS **A record**: `chat.qchat.co.uk` → `<SITE_IP>`.
2. Get a cert:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo certbot certonly --nginx -d chat.qchat.co.uk    # or --standalone if nginx isn't up yet
```

3. nginx site (`/etc/nginx/sites-available/qchat`, then symlink into `sites-enabled` and `sudo nginx -t && sudo systemctl reload nginx`):

```nginx
server {
    listen 80;
    server_name chat.qchat.co.uk;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name chat.qchat.co.uk;

    ssl_certificate     /etc/letsencrypt/live/chat.qchat.co.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.qchat.co.uk/privkey.pem;

    client_max_body_size 2m;    # avatar uploads (1 MB + overhead)

    # IRC-over-WebSocket
    location /irc {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 3600s;
    }

    # App + API + avatars
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

The client auto-selects `wss://` because the page is HTTPS — no client config needed.

## 6. On the IRCd VPS — allow the site server (REQUIRED for multi-user)

Every web user connects to your IRCd **from `<SITE_IP>`**, so add to
`unrealircd.conf` and `./unrealircd rehash`:

```
/* Real client IPs for QChat web users */
webirc {
    mask <SITE_IP>;
    password "choose-a-strong-secret";   /* must equal WEBIRC_PASSWORD */
}

/* Don't throttle the gateway's many connections */
except throttle { mask { ip <SITE_IP>; } }

/* Raise the per-IP client limit for the gateway. IMPORTANT: place this ABOVE
 * the default `allow { mask *; maxperip 3; }` block — UnrealIRCd uses the first
 * matching allow, so the catch-all would otherwise cap web users at 3.
 * (Use allow::match, not the deprecated allow::ip.) */
allow {
    match { ip <SITE_IP>; }
    class    clients;
    maxperip 200;
}
```

(See DEPLOYMENT.md §4/§4a for the reasoning.)

## 7. Test

1. Open `https://chat.qchat.co.uk` — connect as a guest → chat + share a video.
2. Join `#test` from a native IRC client — messages flow both ways.
3. **Log in** with your NickServ account (`Russ`) → the ✎ button lets you upload
   an avatar and edit your profile; the 📢 button posts a live announcement.

### Prerequisites
- **`Russ` must be registered with NickServ** for SASL login to work (guests can
  chat but can't edit profiles / use admin).
- The WEBIRC + throttle exemption (step 6) must be in place, or a second
  simultaneous web user gets dropped by connect-throttle.

## Updating later
Re-upload the tarball (or `git pull` if you set up a repo), then:
`npm install && npm run build && sudo systemctl restart qchat`. The `data/`
directory (profiles + avatars) persists across updates.
