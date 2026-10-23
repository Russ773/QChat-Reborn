# QChat Reborn

Media Webchat, Reborn. A real-time chat site with rooms, private messages, friends, a shared
YouTube player, a soundboard, picture sharing, and an admin area. It runs as one small Node.js
program with a built-in database, so there is nothing else to install.

## What is in it

* **Chat:** rooms you can create and own, saved history and search, replies, reactions, pictures,
  private messages, friends, mentions, desktop notifications, slash commands.
* **Media:** paste a YouTube link and play it to the whole room (kept in sync for late joiners) or
  just for yourself, plus a bundled soundboard.
* **Moderation:** room owners and moderators (kick, mute, ban), a report queue, and a full admin
  area with an audit log. Right-click a member for the menu.
* **Bots:** QBot lives in every room, welcomes new members and answers `!help`, `!roll`, `!8ball`, `!choose`,
  `!joke`, `!poll`, `!remind`, `!time`, `!topic`, `!stats` and more. TriviaBot runs trivia games in the trivia room
  (`!trivia`, `!score`, `!top`). Admins can add more bots, move them between rooms, and switch QBot's jobs on and off.
* **Rooms:** anyone can create a room and set its topic. Admins can also create server owned rooms that are kept
  for good and run by the administrators.
* **Accounts:** change your own password from your account menu.
* **Security:** login throttling, hashed expiring sessions, strict browser policy. See `SECURITY.md`.

## Layout

```
shared/   Types and the message protocol used by both sides
server/   Node.js: web server, WebSocket chat, database, admin API
client/   React + Vite: the website
deploy/   Everything needed to put it on a server
web/      The original landing page
heritage/ Artwork recovered from the old qchat.co.uk (reference only)
```

## Run it on your own computer

You need Node.js 24 or newer.

```bash
npm install
npm run build
ADMIN_ACCOUNTS=YourName npm start
```

Then open http://localhost:8080 and create the account named in `ADMIN_ACCOUNTS`. It becomes the
administrator. Data is kept in `server/data/`.

For development with live reload: `npm run dev` (site on http://localhost:5173).

## Put it on the internet

See `DEPLOYMENT.md`. For the security side, see `SECURITY.md`.
