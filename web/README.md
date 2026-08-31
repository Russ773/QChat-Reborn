# QChat web app (PHP + MySQL)

The website side of QChat: landing page, sign up, log in, forgotten-password,
profile editor + avatars, public profile pages (`/u.php?a=Nick`), and a basic
admin panel. **One signup creates the NickServ account for web and IRC.**

## How identity works (two machines)
The IRCd/Anope run on a separate box, so the website does NOT touch Anope's
database. Instead, PHP calls the **Node gateway** (same machine, over
localhost), which performs the NickServ operations over its existing IRC link:

```
PHP  ->  gateway /internal/identity/*  ->  NickServ (on the IRCd box)
```

So there is **no Anope-to-MySQL migration**. MySQL here just holds the website's
own tables (profiles, roles, announcements, accounts, password resets).

## Prerequisites
1. The `qchat` MySQL database exists with the app tables (`schema.sql`).
2. The **gateway has the identity bridge enabled** (`BOT_ACCOUNT`,
   `BOT_PASSWORD`, `INTERNAL_API_SECRET` in the gateway's `.env`), and the
   `QBot` Services-admin account exists on the IRCd (used for password resets).

## Deploy (Virtualmin / Apache)
1. Copy the contents of `web/` into the site's `public_html`.
2. `cp config.example.php config.php` and fill in:
   - the database credentials,
   - `gateway.secret` = the gateway's `INTERNAL_API_SECRET`,
   - the mail `from` address.
3. Make the avatar folder writable:
   ```bash
   mkdir -p public_html/avatars && chmod 775 public_html/avatars
   ```
4. Visit `https://qchat.co.uk/` and try Sign up, Log in, and Forgot password.

## Applying the schema (via phpMyAdmin, no SSH)
Import `schema.sql` from the **Import** tab, or paste it into the **SQL** tab.
If you already imported an earlier version, just run the new `accounts` table
block again (the `CREATE TABLE IF NOT EXISTS` statements are safe to re-run).

## Routing note (build step 3)
When this PHP site goes to the web root, we repoint Apache so:
- `/`         -> this PHP app (public_html)
- `/chat`     -> the React chat (Node)
- `/irc`      -> the Node WebSocket
- `/internal` -> stays internal (never exposed publicly)
- `/avatars`  -> served by Apache from public_html/avatars

We will do that carefully so the live chat is never left broken.
