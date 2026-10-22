import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const dataDir = process.env.QCHAT_DATA_DIR ?? join(serverRoot, 'data');
mkdirSync(dataDir, { recursive: true });

/** The single SQLite handle for the whole app. */
export const db = new DatabaseSync(join(dataDir, 'qchat.db'));

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

  CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    accountLower TEXT NOT NULL,
    createdAt    INTEGER NOT NULL
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
`);

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
