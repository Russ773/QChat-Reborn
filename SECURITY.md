# QChat Reborn security notes

What the server does to protect itself, the settings that control it, and what you must
do when you put it on the internet.

## What is built in

| Area | Protection |
| --- | --- |
| Passwords | scrypt with a random salt per password. At least 8 characters, no common passwords, not the same as the username. |
| Logins | Kept by the browser only for as long as the window or tab stays open (closing it signs you out), and stored on the server only as a SHA-256 hash, so a copy of the database cannot be used to log in. A login lapses after 30 days unused and never lasts more than 90 days. Logging out, suspending, resetting a password or deleting an account ends them. |
| Guessing passwords | 6 wrong tries per person per address, 30 per address, 40 per account, each per window (15 minutes, 15 minutes, 1 hour). Even the right password is refused while blocked. A success clears the personal count. |
| Fake accounts | 5 new accounts per address per hour, 200 per hour for the whole site. |
| Request floods | 600 API calls a minute per address. 40 new chat connections a minute and 60 open at once per address. A connection that does not log in within 15 seconds is dropped. |
| Browser | Content-Security-Policy (our own scripts only, plus the YouTube player and Google Fonts), no framing, no content sniffing, strict referrer, camera and microphone off, HSTS on https. |
| Other websites | A chat socket can only be opened from our own site (browsers always send the origin). |
| Pictures | Real image bytes are checked, SVG and HTML are refused, random file names, served with a locked-down policy. |
| Admin | The admin role is checked in the database on every request, every action is in the audit log. |

## Settings (environment variables)

| Variable | Meaning |
| --- | --- |
| `ADMIN_ACCOUNTS` | Comma separated names that are always administrators. Set this, and register that account first. |
| `TRUST_PROXY=1` | Set when running behind nginx or Caddy so the real visitor address is used for the limits above. Never set it when the app is reachable directly, because visitors could then forge their address. |
| `ALLOWED_ORIGINS` | Extra sites allowed to open the chat socket, comma separated, e.g. `https://www.qchat.co.uk`. |
| `SESSION_IDLE_DAYS` | Days a login can sit unused (default 30). |
| `NODE_ENV=production` | Stops localhost origins being accepted for the socket. Set it on the live server. |
| `RATE_LIMITS=off` | Turns the rate limits off. For automated tests only. Never use it live. |

## Before going live

1. Put the app behind HTTPS (nginx or Caddy with a certificate) and redirect http to https.
   The proxy must **overwrite** the forwarded address, not append to it:

   ```
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header Host $host;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

2. Run with `NODE_ENV=production TRUST_PROXY=1 ADMIN_ACCOUNTS=YourName`.
3. Register your admin account straight away, with a long unique password.
4. Back up the data folder (`server/data`, or `QCHAT_DATA_DIR`) regularly. It holds the database,
   avatars and uploads.
5. Keep Node.js and the packages up to date (`npm audit` should report nothing).

## Known limits

* Private messages are not encrypted in the database. An administrator cannot read them in the
  app, but whoever runs the server can read the file.
* There is no email check or CAPTCHA at sign up, and no password reset by email. Admins reset
  passwords by hand, and a forgotten admin password is recovered with the command-line tool in
  DEPLOYMENT.md. The sign up limits above are the only brake on bots.
* Members can download their data and delete their own account (it needs their password, and wrong
  guesses are throttled like the change-password screen). Deleted data stays in the nightly backups
  until they are rotated out (14 days).
* Housekeeping keeps the disk in check: private messages are trimmed to the newest 2,000 per
  conversation, pictures no message uses are removed after a day, and each member has 100 MB of
  picture space.
* A determined attacker spread across thousands of addresses can still try 40 passwords an hour
  against one account. Strong passwords are the answer to that.
* The limits are held in memory, so they reset when the server restarts.
