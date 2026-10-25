import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const dataDir = process.env.QCHAT_DATA_DIR ?? join(serverRoot, 'data');
mkdirSync(dataDir, { recursive: true });

/** The single SQLite handle for the whole app. */
export const db = new DatabaseSync(join(dataDir, 'qchat.db'));

/** What we store for a login token: a one-way hash, so a copy of the database cannot be used to log in. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

// Logins used to be stored as the raw token. If this database still has that older table,
// set those rows aside now, and carry them over (hashed) once the new table exists.
let oldSessions: { token: string; accountLower: string; createdAt: number }[] = [];
{
  const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === 'tokenHash')) {
    oldSessions = db.prepare('SELECT token, accountLower, createdAt FROM sessions').all() as typeof oldSessions;
    db.exec('DROP TABLE sessions');
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS accounts (
    accountLower    TEXT PRIMARY KEY,
    account         TEXT NOT NULL,
    email           TEXT,
    passHash        TEXT NOT NULL,
    createdAt       INTEGER NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',
    suspended       INTEGER NOT NULL DEFAULT 0,
    suspendedReason TEXT,
    lastLogin       INTEGER
  );

  CREATE TABLE IF NOT EXISTS profiles (
    accountLower TEXT PRIMARY KEY,
    account      TEXT NOT NULL,
    displayName  TEXT,
    pronouns     TEXT,
    status       TEXT,
    age          INTEGER,
    gender       TEXT,
    location     TEXT,
    timezone     TEXT,
    relationship TEXT,
    lookingFor   TEXT,
    occupation   TEXT,
    interests    TEXT,
    favourites   TEXT,
    bio          TEXT,
    avatar       TEXT,
    accent       TEXT,
    prefs        TEXT,
    updatedAt    INTEGER NOT NULL
  );

  -- Only a hash of each login token is kept. lastUsed makes idle logins lapse.
  CREATE TABLE IF NOT EXISTS sessions (
    tokenHash    TEXT PRIMARY KEY,
    accountLower TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    lastUsed     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    admin  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT
  );

  -- Rooms persist, with an owner and a topic. Built-in rooms have no owner.
  CREATE TABLE IF NOT EXISTS rooms (
    name       TEXT PRIMARY KEY,
    owner      TEXT,
    topic      TEXT,
    topicBy    TEXT,
    topicAt    INTEGER,
    permanent  INTEGER NOT NULL DEFAULT 0,
    createdAt  INTEGER NOT NULL,
    lastActive INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_mods (
    room         TEXT NOT NULL,
    accountLower TEXT NOT NULL,
    PRIMARY KEY (room, accountLower)
  );
  CREATE TABLE IF NOT EXISTS room_bans (
    room         TEXT NOT NULL,
    accountLower TEXT NOT NULL,
    account      TEXT NOT NULL,
    bannedBy     TEXT,
    reason       TEXT,
    ts           INTEGER NOT NULL,
    PRIMARY KEY (room, accountLower)
  );
  CREATE TABLE IF NOT EXISTS room_mutes (
    room         TEXT NOT NULL,
    accountLower TEXT NOT NULL,
    until        INTEGER,
    mutedBy      TEXT,
    reason       TEXT,
    PRIMARY KEY (room, accountLower)
  );

  -- Room messages (saved history). seq gives a stable order for paging.
  CREATE TABLE IF NOT EXISTS messages (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    id        TEXT NOT NULL UNIQUE,
    room      TEXT NOT NULL,
    fromName  TEXT NOT NULL,
    fromLower TEXT NOT NULL,
    kind      TEXT,
    text      TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    editedAt  INTEGER,
    deleted   INTEGER NOT NULL DEFAULT 0,
    deletedBy TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room, seq);

  -- Private messages, and who has read how far.
  CREATE TABLE IF NOT EXISTS dms (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    id        TEXT NOT NULL UNIQUE,
    fromName  TEXT NOT NULL,
    fromLower TEXT NOT NULL,
    toName    TEXT NOT NULL,
    toLower   TEXT NOT NULL,
    kind      TEXT,
    text      TEXT NOT NULL,
    ts        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dms_from ON dms (fromLower, toLower, seq);
  CREATE INDEX IF NOT EXISTS idx_dms_to ON dms (toLower, fromLower, seq);
  CREATE TABLE IF NOT EXISTS dm_state (
    accountLower TEXT NOT NULL,
    partnerLower TEXT NOT NULL,
    lastRead     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (accountLower, partnerLower)
  );

  CREATE TABLE IF NOT EXISTS blocks (
    accountLower TEXT NOT NULL,
    blockedLower TEXT NOT NULL,
    PRIMARY KEY (accountLower, blockedLower)
  );

  -- Emoji reactions on room messages.
  CREATE TABLE IF NOT EXISTS reactions (
    messageId    TEXT NOT NULL,
    accountLower TEXT NOT NULL,
    account      TEXT NOT NULL,
    emoji        TEXT NOT NULL,
    PRIMARY KEY (messageId, accountLower, emoji)
  );

  -- Messages members have reported, for admins to review.
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    reporter    TEXT NOT NULL,
    reporterLower TEXT NOT NULL,
    room        TEXT NOT NULL,
    messageId   TEXT NOT NULL,
    author      TEXT NOT NULL,
    text        TEXT NOT NULL,
    image       TEXT,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    resolvedBy  TEXT,
    resolvedAt  INTEGER,
    resolution  TEXT,
    UNIQUE (reporterLower, messageId)
  );

  -- Friends are mutual: an accepted friendship is stored once per direction.
  CREATE TABLE IF NOT EXISTS friends (
    accountLower TEXT NOT NULL,
    friendLower  TEXT NOT NULL,
    PRIMARY KEY (accountLower, friendLower)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    fromLower TEXT NOT NULL,
    fromName  TEXT NOT NULL,
    toLower   TEXT NOT NULL,
    toName    TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    PRIMARY KEY (fromLower, toLower)
  );

  -- Bots that live in rooms. QBot is built in and is in every room.
  CREATE TABLE IF NOT EXISTS bots (
    nameLower   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT '🤖',
    builtin     INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    allRooms    INTEGER NOT NULL DEFAULT 1,
    createdBy   TEXT,
    createdAt   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_rooms (
    botLower TEXT NOT NULL,
    room     TEXT NOT NULL,
    PRIMARY KEY (botLower, room)
  );

  -- Members QBot has already welcomed (each is welcomed once, ever).
  CREATE TABLE IF NOT EXISTS bot_greeted (
    accountLower TEXT PRIMARY KEY,
    ts           INTEGER NOT NULL
  );

  -- QBot reminders (saved, so a restart does not lose them).
  CREATE TABLE IF NOT EXISTS reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    accountLower TEXT NOT NULL,
    nick         TEXT NOT NULL,
    room         TEXT NOT NULL,
    dueAt        INTEGER NOT NULL,
    text         TEXT NOT NULL,
    createdAt    INTEGER NOT NULL
  );

  -- TriviaBot's scores, kept for good.
  CREATE TABLE IF NOT EXISTS trivia_scores (
    accountLower TEXT PRIMARY KEY,
    account      TEXT NOT NULL,
    points       INTEGER NOT NULL DEFAULT 0,
    correct      INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    played       INTEGER NOT NULL DEFAULT 0
  );

  -- Pictures members have uploaded.
  CREATE TABLE IF NOT EXISTS uploads (
    name       TEXT PRIMARY KEY,
    ownerLower TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    size       INTEGER NOT NULL
  );
`);

// Carry over logins from the older table, so nobody is logged out by the upgrade.
for (const o of oldSessions) {
  db.prepare('INSERT OR IGNORE INTO sessions (tokenHash, accountLower, createdAt, lastUsed) VALUES (?,?,?,?)')
    .run(hashToken(o.token), o.accountLower, o.createdAt, Date.now());
}

/** Add a column to an existing table if an older database lacks it. */
function addColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// Migrations for databases created before the admin features existed.
addColumn('accounts', 'role', "TEXT NOT NULL DEFAULT 'user'");
addColumn('accounts', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
addColumn('accounts', 'suspendedReason', 'TEXT');
addColumn('accounts', 'lastLogin', 'INTEGER');
addColumn('accounts', 'termsAcceptedAt', 'INTEGER');
addColumn('accounts', 'emailVerifiedAt', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS mail_bad (address TEXT PRIMARY KEY, ts INTEGER NOT NULL);`);
db.exec(`
  CREATE TABLE IF NOT EXISTS email_tokens (
    tokenHash    TEXT PRIMARY KEY,
    accountLower TEXT NOT NULL,
    kind         TEXT NOT NULL,
    email        TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    expiresAt    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_email_tokens_account ON email_tokens (accountLower, kind);
`);
addColumn('messages', 'replyTo', 'TEXT');
db.exec(`
  CREATE TABLE IF NOT EXISTS error_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stats_daily (
    day        TEXT PRIMARY KEY,
    messages   INTEGER NOT NULL DEFAULT 0,
    dms        INTEGER NOT NULL DEFAULT 0,
    peakOnline INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS activity (
    day          TEXT NOT NULL,
    accountLower TEXT NOT NULL,
    PRIMARY KEY (day, accountLower)
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_sounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner      TEXT NOT NULL,
    ownerLower TEXT NOT NULL,
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    file       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    ts         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sounds_owner ON custom_sounds (ownerLower);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS word_games (
    id        TEXT PRIMARY KEY,
    room      TEXT NOT NULL,
    status    TEXT NOT NULL,
    creator   TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    state     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wg_room ON word_games (room, updatedAt);
`);
addColumn('profiles', 'birthday', 'TEXT');
addColumn('rooms', 'videoOn', 'INTEGER NOT NULL DEFAULT 0');
addColumn('rooms', 'radioOn', 'INTEGER NOT NULL DEFAULT 0');
addColumn('rooms', 'radioPos', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE TABLE IF NOT EXISTS radio_tracks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    room     TEXT NOT NULL,
    provider TEXT NOT NULL,
    ref      TEXT NOT NULL,
    title    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_radio_room ON radio_tracks (room, id);
`);
addColumn('rooms', 'rules', 'TEXT');
addColumn('rooms', 'rulesBy', 'TEXT');
addColumn('rooms', 'rulesAt', 'INTEGER');
db.exec(`
  CREATE TABLE IF NOT EXISTS pins (
    room      TEXT NOT NULL,
    messageId TEXT NOT NULL,
    pinnedBy  TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    PRIMARY KEY (room, messageId)
  );
`);
addColumn('messages', 'image', 'TEXT');
