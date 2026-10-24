# Tests

About 700 automated checks that exercise the real server: they start it on a throwaway database,
connect like a browser would (HTTP and WebSocket), and check what comes back.

```bash
npm run build      # the tests run the built server
npm test           # everything (roughly 12 minutes)
npm run test:list  # what the groups are
node tests/run.mjs core security   # only some groups
```

The runner uses port 8199 and temporary data, so it never touches a real QChat database and it is
safe to run while your own server is running on another port.

| Group | What it covers |
| --- | --- |
| core | sign in, rooms, messages, private messages, commands, moderation, admin area |
| social | reactions, replies, reports, search, pictures, friends |
| bots | bots, QBot, the admin bot controls |
| qbot | QBot's welcome and commands |
| features | change password, server rooms, topics, polls, reminders, TriviaBot |
| presence | "left chat" notices and reloads |
| media | finished videos |
| moderation | blocked words, the new-member link rule, admin settings for them |
| account | terms and privacy pages, data export, deleting your account, password reset tool, disk housekeeping |
| security | headers, passwords, rate limits, sessions, sockets |

Other checks:

* `node tests/live.mjs https://your-site` looks at a live site from outside. It is read only: it
  creates nothing and posts nothing.
* `node tests/kit.mjs` packs a release, unpacks it somewhere clean, runs it in production mode and
  takes a backup. It needs internet access (it installs the production packages).

## Adding tests

Put a new file in `tests/suites/`, print `PASS ...` or `FAIL ...` for every check, exit with a
non-zero code if anything failed, and list it in a group in `tests/run.mjs`. A test file receives
`QCHAT_DATA_DIR` (the server's data folder) in its environment and the server is on
`localhost:8199`.

Some groups switch rate limits off, because the tests create many accounts from one address. The
`security` group keeps them on, since that is what it tests.
