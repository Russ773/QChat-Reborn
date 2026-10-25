import type { IncomingMessage, ServerResponse } from 'node:http';
import { validAccount } from '@qchat/shared';
import { handleAdmin } from './admin.js';
import { accountForToken, changePassword, createSession, deleteAccount, getRole, login, logout, register, verifyAccountPassword } from './accounts.js';
import { eraseAccountData, exportAccount } from './account-data.js';
import { confirmVerification, emailOf, finishPasswordReset, removeEmail, startPasswordReset, startVerification, validEmail } from './emails.js';
import { mailEnabled } from './mail.js';
import {
  MAX_SOUNDS_PER_MEMBER,
  MAX_SOUND_BYTES,
  addSound,
  approvedSounds,
  deleteSound,
  deleteSoundsOf,
  getSound,
  sniffAudio,
  soundsOf,
  validSoundEmoji,
  validSoundName,
} from './sounds.js';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, removeAvatars, saveAvatar } from './avatars.js';
import type { ChatServer } from './chat/server.js';
import * as store from './chat/store.js';
import { bearer, readBody, readRawBody, send } from './httpUtil.js';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_TOTAL, UPLOAD_LIMIT, UPLOAD_WINDOW, removeUploadFiles, saveUploadFile, sniffImage } from './uploads.js';
import { getPrefs, getProfile, publicProfile, saveProfile, savePrefs, setAvatar } from './profiles.js';
import { getSettings } from './settings.js';
import {
  apiByIp,
  clientIp,
  emailChangeByAccount,
  resetByAccount,
  resetByIp,
  forLog,
  loginFailsByAccount,
  loginFailsByIp,
  loginFailsByPair,
  passwordChangeFails,
  signupsByIp,
  signupsGlobal,
  waitMessage,
} from './security.js';

/** Refuse a request politely when someone has tried too often. */
function tooMany(res: ServerResponse, waitMs: number): true {
  res.setHeader('retry-after', String(Math.max(1, Math.ceil(waitMs / 1000))));
  send(res, 429, { error: waitMessage(waitMs) });
  return true;
}

/** Handle /api/* routes. Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, chat: ChatServer): Promise<boolean> {
  const [path, query = ''] = (req.url ?? '').split('?');
  if (!path.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';
  const ip = clientIp(req);

  // One address cannot hammer the API, and nothing here should ever be cached by a browser or proxy.
  const apiWait = apiByIp.hit(ip);
  if (apiWait > 0) return tooMany(res, apiWait);
  res.setHeader('cache-control', 'no-store');

  if (path.startsWith('/api/admin/')) return handleAdmin(req, res, path, query, chat);

  // What the login screen needs to know before anyone is logged in.
  if (path === '/api/site' && method === 'GET') {
    const s = getSettings();
    send(res, 200, { registrationOpen: s.registrationOpen, maintenance: s.maintenance, contactEmail: s.contactEmail, mailEnabled: mailEnabled() });
    return true;
  }

  if (path === '/api/register' && method === 'POST') {
    const wait = Math.max(signupsByIp.wait(ip), signupsGlobal.wait('site'));
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const email = String(b.email ?? '').trim();
    if (email && !validEmail(email)) {
      send(res, 422, { error: 'That does not look like an email address. You can leave it empty.' });
      return true;
    }
    const r = register(String(b.account ?? ''), email, String(b.password ?? ''), b.agree === true);
    if (!r.ok) {
      send(res, r.status ?? 422, { error: r.error });
    } else {
      signupsByIp.hit(ip);
      signupsGlobal.hit('site');
      // If they gave an address, send the link that confirms it (the sign up does not wait for it).
      if (email && mailEnabled()) void startVerification(r.account!, email);
      send(res, 200, {
        token: createSession(r.account!),
        account: r.account,
        role: r.role,
        profile: getProfile(r.account!),
      });
    }
    return true;
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const name = String(b.account ?? '').trim().toLowerCase().slice(0, 40);
    const pair = `${ip}|${name}`;
    // Guessing passwords is slowed down per person at one address, per address, and per account.
    const wait = Math.max(loginFailsByPair.wait(pair), loginFailsByIp.wait(ip), loginFailsByAccount.wait(name));
    if (wait > 0) {
      console.log(`[qchat] login blocked (too many failures) for "${forLog(name)}" from ${forLog(ip)}`);
      return tooMany(res, wait);
    }
    const r = login(String(b.account ?? ''), String(b.password ?? ''));
    if (!r.ok && r.status === 401) {
      loginFailsByPair.hit(pair);
      loginFailsByIp.hit(ip);
      loginFailsByAccount.hit(name);
      console.log(`[qchat] failed login for "${forLog(name)}" from ${forLog(ip)}`);
    }
    if (r.ok) loginFailsByPair.reset(pair);
    if (!r.ok) {
      send(res, r.status ?? 401, { error: r.error });
    } else {
      send(res, 200, {
        token: createSession(r.account!),
        account: r.account,
        role: r.role,
        profile: getProfile(r.account!),
      });
    }
    return true;
  }

  if (path === '/api/password' && method === 'POST') {
    const token = bearer(req);
    const acct = accountForToken(token);
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const key = acct.toLowerCase();
    const wait = passwordChangeFails.wait(key);
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const r = changePassword(acct, String(b.current ?? ''), String(b.next ?? ''), token);
    if (!r.ok) {
      if (r.status === 403) {
        passwordChangeFails.hit(key);
        console.log(`[qchat] wrong current password on a password change for "${forLog(acct)}" from ${forLog(ip)}`);
      }
      send(res, r.status, { error: r.error });
    } else {
      passwordChangeFails.reset(key);
      console.log(`[qchat] ${forLog(acct)} changed their password`);
      send(res, 200, { ok: true });
    }
    return true;
  }

  // Add, change or remove the email on your account. Changing it needs your password; the new address
  // only counts once its link has been opened.
  if (path === '/api/email' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const key = acct.toLowerCase();
    const wait = Math.max(passwordChangeFails.wait(key), emailChangeByAccount.wait(key), resetByIp.wait(ip));
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    if (!verifyAccountPassword(acct, String(b.password ?? ''))) {
      passwordChangeFails.hit(key);
      send(res, 403, { error: 'That password is not right.' });
      return true;
    }
    const email = String(b.email ?? '').trim();
    if (!email) {
      removeEmail(acct);
      send(res, 200, { ok: true, removed: true });
      return true;
    }
    emailChangeByAccount.hit(key);
    resetByIp.hit(ip); // emails sent because of a visitor count against their address, whatever they asked for
    const r = await startVerification(acct, email);
    send(res, r.ok ? 200 : 422, r.ok ? { ok: true, pending: email } : { error: r.error });
    return true;
  }

  if (path === '/api/email/confirm' && method === 'POST') {
    const b = await readBody(req);
    const r = await confirmVerification(String(b.token ?? '').slice(0, 100));
    send(res, r.ok ? 200 : 400, r.ok ? { ok: true, email: r.email } : { error: r.error });
    return true;
  }

  // "I forgot my password." The answer never says whether the name or address exists.
  if (path === '/api/password/forgot' && method === 'POST') {
    if (!mailEnabled()) {
      send(res, 503, { error: 'Password reset by email is not set up on this site. Ask an administrator to reset it for you.' });
      return true;
    }
    const wait = resetByIp.hit(ip);
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const who = String(b.identifier ?? '').trim().toLowerCase().slice(0, 130);
    if (who && resetByAccount.hit(who) === 0) void startPasswordReset(who);
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/password/reset' && method === 'POST') {
    const wait = resetByIp.wait(ip);
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const r = await finishPasswordReset(String(b.token ?? '').slice(0, 100), String(b.password ?? ''));
    if (!r.ok) resetByIp.hit(ip);
    send(res, r.ok ? 200 : 400, r.ok ? { ok: true, account: r.account } : { error: r.error });
    return true;
  }

  // Everything QChat holds about you, as a file you can keep.
  if (path === '/api/account/export' && method === 'GET') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="qchat-data-${acct}.json"`,
    });
    res.end(JSON.stringify(exportAccount(acct), null, 2));
    return true;
  }

  // Delete your own account and everything tied to it. Needs your password.
  if (path === '/api/account' && method === 'DELETE') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    if (getRole(acct) === 'admin') {
      send(res, 409, { error: 'Administrators cannot delete their own account. Ask another administrator to remove your admin rights first.' });
      return true;
    }
    const key = acct.toLowerCase();
    const wait = passwordChangeFails.wait(key);
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    if (!verifyAccountPassword(acct, String(b.password ?? ''))) {
      passwordChangeFails.hit(key);
      console.log(`[qchat] wrong password when "${forLog(acct)}" tried to delete their account, from ${forLog(ip)}`);
      send(res, 403, { error: 'That password is not right.' });
      return true;
    }
    chat.forgetWordGames(acct);
    chat.kickAccount(acct, 'Your account has been deleted.');
    removeAvatars(acct);
    deleteSoundsOf(acct.toLowerCase());
    removeUploadFiles(eraseAccountData(acct));
    deleteAccount(acct);
    console.log(`[qchat] ${forLog(acct)} deleted their account`);
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/logout' && method === 'POST') {
    logout(bearer(req));
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me' && method === 'GET') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else if (getSettings().maintenance && getRole(acct) !== 'admin') {
      send(res, 503, { error: 'QChat is down for maintenance. Please try again soon.' });
    } else {
      const mail = emailOf(acct.toLowerCase());
      send(res, 200, { account: acct, role: getRole(acct), profile: getProfile(acct), prefs: getPrefs(acct), email: mail.email, emailVerified: mail.verified });
    }
    return true;
  }

  if (path === '/api/profile' && method === 'GET') {
    const a = (new URLSearchParams(query).get('a') ?? '').trim();
    if (!validAccount(a)) send(res, 404, { error: 'No such user.' });
    else send(res, 200, { profile: publicProfile(a), allowPm: getPrefs(a).allowPm });
    return true;
  }

  if (path === '/api/preferences' && method === 'PUT') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else {
      const b = await readBody(req);
      send(res, 200, { ok: true, prefs: savePrefs(acct, b) });
    }
    return true;
  }

  if (path === '/api/avatar' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const ext = AVATAR_TYPES[String(req.headers['content-type'] ?? '').split(';')[0].trim()];
    if (!ext) {
      send(res, 415, { error: 'Image must be PNG, JPG, WebP or GIF.' });
      return true;
    }
    const buf = await readRawBody(req, MAX_AVATAR_BYTES);
    if (!buf) {
      send(res, 413, { error: 'Image is too large (max 2 MB).' });
    } else if (buf.length === 0) {
      send(res, 422, { error: 'No image received.' });
    } else {
      const url = saveAvatar(acct, ext, buf);
      setAvatar(acct, url);
      send(res, 200, { avatar: url });
    }
    return true;
  }

  if (path === '/api/upload' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    if (store.countUploadsSince(acct.toLowerCase(), Date.now() - UPLOAD_WINDOW) >= UPLOAD_LIMIT) {
      send(res, 429, { error: 'You are uploading too quickly. Wait a few minutes and try again.' });
      return true;
    }
    if (store.uploadBytesOf(acct.toLowerCase()) >= MAX_UPLOAD_TOTAL) {
      send(res, 413, { error: 'You have used all of your picture space. Delete some of your messages that have pictures, then try again.' });
      return true;
    }
    const buf = await readRawBody(req, MAX_UPLOAD_BYTES);
    if (!buf) {
      send(res, 413, { error: 'That picture is too big (the limit is 3 MB).' });
      return true;
    }
    const ext = sniffImage(buf);
    if (!ext) {
      send(res, 415, { error: 'Only PNG, JPG, GIF and WebP pictures can be shared.' });
      return true;
    }
    const name = saveUploadFile(buf, ext);
    store.addUpload(name, acct.toLowerCase(), buf.length);
    send(res, 200, { name, url: `/uploads/${name}` });
    return true;
  }

  // The soundboard's extra sounds: everyone's approved ones, plus your own (waiting or not).
  if (path === '/api/sounds' && method === 'GET') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    send(res, 200, { sounds: approvedSounds().map(publicSound), mine: soundsOf(acct.toLowerCase()).map(publicSound) });
    return true;
  }

  if (path === '/api/sounds' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const params = new URLSearchParams(req.url?.split('?')[1] ?? '');
    const name = (params.get('name') ?? '').trim();
    const emoji = (params.get('emoji') ?? '').trim() || '🔊';
    if (!validSoundName(name)) {
      send(res, 422, { error: 'Give the sound a short name (up to 20 letters, numbers and spaces).' });
      return true;
    }
    if (!validSoundEmoji(emoji)) {
      send(res, 422, { error: 'Pick a single emoji for the sound.' });
      return true;
    }
    if (soundsOf(acct.toLowerCase()).length >= MAX_SOUNDS_PER_MEMBER) {
      send(res, 429, { error: `You can have ${MAX_SOUNDS_PER_MEMBER} sounds. Delete one to add another.` });
      return true;
    }
    const buf = await readRawBody(req, MAX_SOUND_BYTES);
    if (!buf) {
      send(res, 413, { error: `That clip is too big. Keep it short (under ${Math.round(MAX_SOUND_BYTES / 1024)} KB, about 8 seconds).` });
      return true;
    }
    const ext = sniffAudio(buf);
    if (!ext) {
      send(res, 415, { error: 'Only MP3, OGG, WAV, M4A and WebM audio can be used.' });
      return true;
    }
    const sound = addSound(acct, name, emoji, buf, ext);
    chat.notifyAdmins(`${acct} added a soundboard clip called "${name}" for approval.`);
    console.log(`[qchat] ${forLog(acct)} submitted sound ${sound.id}`);
    send(res, 200, { sound: publicSound(sound) });
    return true;
  }

  const soundDel = /^\/api\/sounds\/c(\d{1,9})$/.exec(path);
  if (soundDel && method === 'DELETE') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const s = getSound(Number(soundDel[1]));
    if (!s || s.by.toLowerCase() !== acct.toLowerCase()) {
      send(res, 404, { error: 'No such sound of yours.' });
      return true;
    }
    deleteSound(Number(soundDel[1]));
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/profile' && method === 'PUT') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else {
      const b = await readBody(req);
      send(res, 200, { ok: true, profile: saveProfile(acct, b) });
    }
    return true;
  }

  send(res, 404, { error: 'Not found.' });
  return true;
}

/** What a member (or the soundboard) sees of a clip: no file size, no timestamps. */
function publicSound(s: { id: string; name: string; emoji: string; by: string; status: string; url: string }) {
  return { id: s.id, name: s.name, emoji: s.emoji, by: s.by, status: s.status, url: s.url };
}
