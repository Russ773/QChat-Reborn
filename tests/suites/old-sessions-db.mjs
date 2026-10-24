// Rewrite a data directory's sessions table into the OLD format (raw tokens), as a database from before the upgrade would be.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
const dir = process.argv[2];
const db = new DatabaseSync(dir + '/qchat.db');
db.exec('DROP TABLE sessions; CREATE TABLE sessions (token TEXT PRIMARY KEY, accountLower TEXT NOT NULL, createdAt INTEGER NOT NULL);');
const token = randomBytes(32).toString('hex');
db.prepare('INSERT INTO sessions (token, accountLower, createdAt) VALUES (?,?,?)').run(token, 'russ', Date.now() - 86400000);
db.close();
console.log(token);
