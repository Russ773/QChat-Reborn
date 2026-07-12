# QChat — Reborn

A web chatroom with a **bundled IRC backend** and **synchronized media playback**
(watch-party style). Chat runs over real IRC; sharing a link starts a shared,
server-synced player that everyone in the channel watches together.

## Architecture

```
shared/   TypeScript protocol: IRC line parser + media event types (used by both sides)
server/   Node/TS. Own IRC daemon (TCP :6667 + WebSocket /irc) + media-sync coordinator
client/   React + Vite. IRC-over-WebSocket client, chat UI, synchronized media player
```

- **Own IRC server** — a compact IRCd (`server/src/ircd`) implementing
  NICK/USER/JOIN/PART/PRIVMSG/NOTICE/NAMES/WHO/LIST/QUIT plus IRCv3 message tags.
  It listens on raw **TCP 6667** (so real IRC clients can connect too) and on a
  **WebSocket** at `/irc` (so browsers connect directly).
- **Media sync** rides on top of IRC via a custom `MEDIA` command whose payload
  is a JSON event. The server is authoritative: clients send intents
  (enqueue/play/pause/seek/skip/remove) and the server broadcasts a normalized
  playback snapshot so late-joiners and drifting clients reconcile. Non-media
  IRC clients still see a plain-text "shared a video: <url>" fallback.

## Getting started

```bash
npm install
npm run dev
```

- Client (Vite): http://localhost:5173
- Server: HTTP+WS on :8080, raw IRC on :6667

`npm run dev` builds `shared/` once, then runs all three workspaces in watch mode.
The Vite dev server proxies the `/irc` WebSocket to the backend.

## Two backend modes

- **Bundled ircd** (default, local dev): the Node server *is* the IRC server.
- **Gateway** (production against a real IRCd): set `IRC_UPSTREAM_HOST` and the
  server bridges each browser WebSocket to your InspIRCd/UnrealIRCd over TCP/TLS,
  keeping the `MEDIA` watch-party overlay server-side. See **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Production build

```bash
npm run build   # builds shared, server, and client
npm start       # serves the built client from the Node server on :8080
```

## Ports & env

| Var               | Default       | Purpose                     |
| ----------------- | ------------- | --------------------------- |
| `HTTP_PORT`       | `8080`        | HTTP + WebSocket (`/irc`)   |
| `IRC_TCP_PORT`    | `6667`        | Raw IRC for native clients  |
| `IRC_SERVER_NAME` | `qchat.local` | Server name in IRC prefixes |
