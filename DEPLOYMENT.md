# Deploying QChat Reborn

QChat Reborn is one small Node.js program that serves the website and the live chat. You put it
on your server, run it as a service, and let your web server (Apache, nginx or Caddy) handle
HTTPS and pass visitors to it.

Everything needed is in the `deploy/` folder. It has been tested end to end on a clean copy:
packing, installing production dependencies, running in production mode, the origin and HTTPS
behaviour behind a proxy, and the nightly backup.

## What you need

* A Linux server with `systemd` and root access (Debian, Ubuntu, Fedora, Rocky or Alma). Node.js 24
  is installed for you if it is missing.
* A web server on it that can do HTTPS. qchat.co.uk currently points at `85.190.112.89`, which runs
  Apache, so the Apache steps are below. nginx and Caddy files are included too.
* The domain's DNS pointing at the server (it already does for qchat.co.uk).

## 1. Build the release (on your own computer)

```bash
bash deploy/pack.sh
```

This builds everything from scratch and makes `qchat-release.tar.gz` (about 200 KB).

## 2. Upload and install (on the server)

```bash
scp qchat-release.tar.gz youruser@85.190.112.89:~
ssh youruser@85.190.112.89
mkdir qchat-release && tar xzf qchat-release.tar.gz -C qchat-release
sudo bash qchat-release/deploy/install.sh
```

The installer:

* installs Node.js 24 if needed,
* makes a `qchat` user that cannot log in,
* puts the app in `/opt/qchat`, keeps your data in `/var/lib/qchat`, your settings in
  `/etc/qchat/qchat.env`,
* starts it as a locked-down service called `qchat` that restarts itself if it ever stops,
* sets up a nightly backup at 03:30 (the newest 14 are kept in `/var/backups/qchat`),
* checks the app answers.

The app listens on `127.0.0.1:8080` only, so nobody can reach it except through your web server.

## 3. Check your settings

Open `/etc/qchat/qchat.env` (the defaults suit qchat.co.uk):

| Setting | Meaning |
| --- | --- |
| `ADMIN_ACCOUNTS=Russ` | Always administrators. Register this name first. |
| `ALLOWED_ORIGINS` | The website addresses allowed to open the chat connection. |
| `TRUST_PROXY=1` | Use the visitor address your web server passes along. Keep it on while the app is only reachable through the proxy. |
| `HTTP_PORT=8080` | The local port. |
| `SESSION_IDLE_DAYS=30` | How long a login can sit unused. |

After editing: `sudo systemctl restart qchat`.

## 4. Connect your web server

**Apache (what 85.190.112.89 runs).** Follow `deploy/apache-vhost.conf.example`. In short: enable
`proxy proxy_http proxy_wstunnel rewrite headers`, add the proxy lines to the HTTPS virtual host
for qchat.co.uk (in Virtualmin: Server Configuration, Edit Proxy Website or Apache Directives),
redirect port 80 to HTTPS, then `apachectl configtest && systemctl reload apache2` (or `httpd`).

**nginx:** use `deploy/nginx.conf.example`, then `sudo certbot --nginx -d qchat.co.uk -d www.qchat.co.uk`.

**Caddy:** use `deploy/Caddyfile.example`. It gets the certificate by itself.

Whichever you use, it must (a) use HTTPS, (b) keep the `Host` header, (c) pass the chat connection
(WebSocket) through, and (d) set the visitor address header itself rather than passing along one
the visitor sent. The example files do all four.

## 5. First visit

1. Open `https://qchat.co.uk`.
2. Choose **Create account** and register the admin name (`Russ`) first, with a long password
   nobody could guess.
3. Open your account menu, then **Admin area**, and look around. Sign ups can be switched off there
   while you test.

The old "Relaunching soon" page is replaced by the app once the proxy is on. If you want to keep it
visible until you are ready, point the proxy at the app on a test address first (for example a
subdomain), or do step 4 last.

## 6. Firewall

Only ports 22 (SSH), 80 and 443 should be open to the internet. Port 8080 must not be. For example
with `ufw`: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`.

## Updating later

On your computer: `bash deploy/pack.sh`, upload the new `qchat-release.tar.gz`, unpack it into a new
folder on the server and run `sudo bash that-folder/deploy/install.sh` again. Your data and
settings are never touched. The previous version is kept in `/opt/qchat.prev`.

**Rolling back:**

```bash
sudo systemctl stop qchat
sudo rm -rf /opt/qchat && sudo mv /opt/qchat.prev /opt/qchat
sudo systemctl start qchat
```

## Backups and restoring

* Backups: `/var/backups/qchat/qchat-DATE.tar.gz` (database, profile photos and pictures). Take one
  now with `sudo -u qchat QCHAT_DATA_DIR=/var/lib/qchat BACKUP_DIR=/var/backups/qchat /opt/qchat/deploy/backup.sh`.
* Copy them off the server now and then, so one dead disk cannot take everything.
* To restore:

```bash
sudo systemctl stop qchat
sudo tar xzf /var/backups/qchat/qchat-DATE.tar.gz -C /var/lib/qchat
sudo chown -R qchat:qchat /var/lib/qchat
sudo systemctl start qchat
```

## Everyday commands

```bash
systemctl status qchat          # is it running?
journalctl -u qchat -f          # live log (failed logins and blocked attempts show here)
sudo systemctl restart qchat    # after changing settings
```

## If something is wrong

| Problem | Likely cause |
| --- | --- |
| The page loads but chat says it cannot connect | The proxy is not passing the WebSocket (`/ws`), or the Host header is not kept. See step 4. |
| Everyone shares one address in the logs, and people get "too many attempts" | `TRUST_PROXY=1` is on but the proxy does not set the visitor address. See step 4 (d). |
| The page cannot be reached | The service is down (`systemctl status qchat`) or the proxy is not set up. |
| "node:sqlite" errors in the log | Node.js is older than 24. Run the installer again. |

See `SECURITY.md` for what the app protects against, and what is still your job.
