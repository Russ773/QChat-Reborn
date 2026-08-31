# QChat web app (PHP + MySQL)

The website side of QChat: landing page, sign up, log in, forgotten-password,
profile editor + avatars, public profile pages (`/u.php?a=Nick`), and a basic
admin panel. It shares one MySQL database with Anope, so **one signup creates
the NickServ account for both web and IRC**.

The real-time chat stays as the Node gateway; this app does not touch it.

## Prerequisites
1. MySQL is set up and **Anope has been migrated onto it** (see `ANOPE-MYSQL.md`).
2. The app tables exist (`mysql -u qchat -p qchat < schema.sql`).

## Deploy (Virtualmin / Apache)
1. Copy the contents of `web/` into the site's `public_html`.
2. Create the config:
   ```bash
   cp config.example.php config.php
   ```
   Edit `config.php`: database credentials, `site_url`, and the mail `from`
   address.
3. Make the avatar folder writable by the web server:
   ```bash
   mkdir -p public_html/avatars && chmod 775 public_html/avatars
   ```
4. Visit `https://qchat.co.uk/` and try Sign up.

## One thing to verify after the MySQL migration
`register` inserts into Anope's account tables, whose exact columns are version
specific. After migrating, check the layout and adjust `lib/anope.php` if a
signup errors:
```sql
SHOW CREATE TABLE anope_db_NickCore;
SHOW CREATE TABLE anope_db_NickAlias;
SELECT display, LEFT(pass, 8) AS pass_prefix FROM anope_db_NickCore LIMIT 1;
```
Login and password reset only read/update the `pass` column, so they are safe.

## Routing note (comes with build step 3)
Right now Apache proxies `/` to the Node chat. When this PHP site goes to the
web root, we repoint Apache so:
- `/`        -> this PHP app (public_html)
- `/chat`    -> the React chat (Node)
- `/irc`     -> the Node WebSocket
- `/avatars` -> served by Apache from public_html/avatars

We will do that carefully so the live chat is never left broken.
