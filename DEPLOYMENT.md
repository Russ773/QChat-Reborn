# Deploying QChat against a hosted IRCd

You're hosting the **site** and the **IRCd** on separate infrastructure. QChat
runs in **gateway mode**: each browser's WebSocket is bridged to a real
connection on your InspIRCd/UnrealIRCd, and the `MEDIA` watch-party overlay
stays on the QChat server (your IRCd never sees it).

```
                    ┌─────────────────────────── site host ───────────────────────────┐
browser ── wss ────▶│  nginx (TLS)  ──▶  QChat Node server (gateway + media overlay)    │── TCP/TLS ──▶  your IRCd
  (https)           └──────────────────────────────────────────────────────────────────┘              (InspIRCd / UnrealIRCd)
```

Chat + presence come from your real IRC network (so HexChat/IRCCloud users share
the same channels). QChat adds the synchronized player on top.

---

## 1. Build

On the **site host** (Node 20+):

```bash
git clone <your repo> && cd "QChat - Reborn"
npm install
npm run build          # builds shared, server, and client (client → client/dist)
```

## 2. Configure

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```ini
HTTP_PORT=8080
IRC_UPSTREAM_HOST=irc.yourdomain.com   # your IRCd
IRC_UPSTREAM_PORT=6697
IRC_UPSTREAM_TLS=1                      # 6697 = TLS; use 0 + port 6667 for plaintext
IRC_UPSTREAM_TLS_REJECT_UNAUTHORIZED=1 # keep 1 unless the cert is self-signed
IRC_SERVER_NAME=qchat.yourdomain.com
WEBIRC_PASSWORD=change-me-strong       # see step 4 (leave empty to skip WEBIRC)
WEBIRC_NAME=qchat
```

Setting `IRC_UPSTREAM_HOST` is what flips the server into gateway mode. Unset it
and you're back to the self-contained bundled ircd (local dev).

## 3. Run

```bash
npm start            # node --env-file-if-exists=server/.env dist/index.js
```

The server serves the built client **and** the `/irc` WebSocket on `HTTP_PORT`.
Use a process manager for production, e.g. pm2:

```bash
npm i -g pm2
pm2 start "npm start" --name qchat
pm2 save
```

or a systemd unit running `node --env-file=/opt/qchat/server/.env /opt/qchat/server/dist/index.js`.

## 4. WEBIRC — show each user's real IP (recommended)

Without WEBIRC, **every** QChat user connects to your IRCd from the site host's
single IP. Your IRCd will likely hit per-IP connection limits and all users
share one hostmask. WEBIRC lets the gateway tell the IRCd each visitor's real IP.

QChat already sends the WEBIRC line (using `X-Forwarded-For` from your reverse
proxy) when `WEBIRC_PASSWORD` is set. You must add a matching block on the IRCd
whose **mask is the site host's public IP**.

**InspIRCd** (`inspircd.conf`):

```xml
<module name="cgiirc">
<cgihost type="webirc" mask="203.0.113.10" password="change-me-strong">
```

**UnrealIRCd** (`unrealircd.conf`):

```
webirc {
    mask 203.0.113.10;          // the site host's public IP
    password "change-me-strong";
}
```

Replace `203.0.113.10` with your site host's public IP and use the same secret
as `WEBIRC_PASSWORD`. Security note: a WEBIRC peer can assert any client IP, so
keep the mask tight (just the gateway IP) and the password secret.

### 4a. Connection throttling — required for multi-user (verified against irc.qchat.co.uk)

Because every QChat browser session opens its own TCP connection **from the site
host's IP**, your IRCd sees many connections from one address and will throttle
them. Live testing against the UnrealIRCd hit exactly this:

```
ERROR :Closing Link: (Throttled: Reconnecting too fast ...)
```

UnrealIRCd's connect-throttle is evaluated on the **real TCP source IP** (the
gateway), *before* WEBIRC is processed — so WEBIRC alone does **not** avoid it.
You must exempt the gateway/site host IP and raise its per-IP client limit
(`unrealircd.conf`):

```
/* Allow the QChat gateway host to open many connections */
except throttle {
    mask { ip 203.0.113.10; }   /* the SITE HOST's public IP, not the IRCd's */
}

/* Place ABOVE the default `allow { mask *; maxperip 3; }` — first match wins. */
allow {
    match { ip 203.0.113.10; }   /* the SITE HOST's public IP (allow::match, not ip) */
    class    clients;
    maxperip 200;                /* headroom for concurrent web users */
}
```

Then `./unrealircd rehash`. Keep WEBIRC (step 4) as well so per-user bans/whois
still see real IPs. Verify your version's exact block syntax in the UnrealIRCd
docs (this targets UnrealIRCd 6.x).

## 5. TLS + reverse proxy (required for a public https site)

Browsers refuse a `ws://` connection from an `https://` page, so terminate TLS
at nginx and proxy both the app and the WebSocket. Crucially, forward
`X-Forwarded-For` so WEBIRC gets the real client IP.

```nginx
server {
    listen 443 ssl;
    server_name qchat.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/qchat.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qchat.yourdomain.com/privkey.pem;

    # IRC-over-WebSocket
    location /irc {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 3600s;   # keep long-lived IRC sessions open
    }

    # App + static client
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

The client auto-selects `wss://` when the page is served over `https://`, so no
client config is needed.

## 6. Smoke test

1. Open `https://qchat.yourdomain.com`, connect with a nick, join `#test`.
2. From a native IRC client on your network, join `#test` — you should see the
   web user, and messages should flow both ways.
3. In QChat, paste a YouTube link and hit **＋ queue**. Web users get the synced
   player; native IRC users see `* nick shared a video: <url>`.

---

## Notes & limits (current state)

- **Media is a QChat-side overlay.** Only browser users get synced playback;
  native IRC clients just see the shared link as an ACTION. Late-joining browser
  users are synced to the current position automatically.
- **Clock sync** currently assumes the server/client clocks agree (fine on one
  machine; good enough on the same continent). A client↔server time-offset
  handshake is a planned refinement for tighter drift correction.
- **One upstream connection per browser tab.** Consider your IRCd's
  `maxconnections`/`connectfreq` for the WEBIRC mask, and QChat's own rate needs.
- **DMs / private queries** currently surface in the server buffer rather than a
  dedicated tab — a planned client improvement.
```
