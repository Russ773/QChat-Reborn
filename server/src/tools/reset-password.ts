/**
 * Emergency password reset, for when a member (or the only administrator) has forgotten their password
 * and there is no email to reset it with. Run this on the server:
 *
 *   QCHAT_DATA_DIR=/var/lib/qchat node server/dist/tools/reset-password.js Russ
 *
 * It sets a new random password, prints it once, and logs the member out everywhere. They sign in with it
 * and then change it from the account menu. Pass a password as a second argument to choose it yourself.
 */
import { randomBytes } from 'node:crypto';
import { accountExists, setPassword } from '../accounts.js';
import { db } from '../db.js';
import { passwordProblem } from '../security.js';

const [account, chosen] = process.argv.slice(2);

if (!account) {
  console.error('Usage: node server/dist/tools/reset-password.js <member> [new password]');
  process.exit(2);
}
if (!accountExists(account)) {
  console.error(`There is no member called "${account}".`);
  process.exit(1);
}

// A password people can type without confusion: no 0/O, 1/l/I.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const generate = () => Array.from(randomBytes(20), (b) => ALPHABET[b % ALPHABET.length]).join('');

const password = chosen ?? generate();
const weak = chosen ? passwordProblem(chosen, account) : null;
if (weak) {
  console.error(weak);
  process.exit(1);
}

setPassword(account, password);
db.prepare('INSERT INTO audit (ts, admin, action, target, detail) VALUES (?,?,?,?,?)').run(
  Date.now(),
  'server',
  'reset-password',
  account,
  'reset from the command line on the server',
);

console.log(`The password for ${account} has been reset, and ${account} has been logged out everywhere.`);
if (!chosen) {
  console.log(`New password (shown once, write it down): ${password}`);
}
console.log('Sign in with it, then change it from the account menu.');
db.close();
