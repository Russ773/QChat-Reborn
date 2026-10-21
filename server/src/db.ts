import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dataDir = process.env.QCHAT_DATA_DIR ?? join(serverRoot, 'data');
mkdirSync(dataDir, { recursive: true });

/** The single SQLite handle for the whole app. */
export const db = new DatabaseSync(join(dataDir, 'qchat.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS accounts (
    accountLower TEXT PRIMARY KEY,
    account      TEXT NOT NULL,
    email        TEXT,
    passHash     TEXT NOT NULL,
    createdAt    INTEGER NOT NULL
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
`);
