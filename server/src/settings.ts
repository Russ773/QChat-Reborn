import { DEFAULT_SETTINGS, MAX_BLOCKED_WORDS, MAX_LINK_MINUTES, MAX_WELCOME, validContact, type SiteSettings } from '@qchat/shared';
import { db } from './db.js';

export function getSettings(): SiteSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: SiteSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    try {
      const v = JSON.parse(value);
      if (key === 'registrationOpen' && typeof v === 'boolean') out.registrationOpen = v;
      else if (key === 'maintenance' && typeof v === 'boolean') out.maintenance = v;
      else if (key === 'welcomeMessage' && typeof v === 'string') out.welcomeMessage = v;
      else if (key === 'qbotWelcome' && typeof v === 'boolean') out.qbotWelcome = v;
      else if (key === 'qbotCommands' && typeof v === 'boolean') out.qbotCommands = v;
      else if (key === 'webcamsEnabled' && typeof v === 'boolean') out.webcamsEnabled = v;
      else if (key === 'dailyPost' && typeof v === 'boolean') out.dailyPost = v;
      else if (key === 'autoMuteSpam' && typeof v === 'boolean') out.autoMuteSpam = v;
      else if (key === 'blockedWords' && typeof v === 'string') out.blockedWords = v.slice(0, MAX_BLOCKED_WORDS);
      else if (key === 'newMemberLinkMinutes' && Number.isInteger(v) && v >= 0 && v <= MAX_LINK_MINUTES) out.newMemberLinkMinutes = v;
      else if (key === 'contactEmail' && typeof v === 'string' && validContact(v)) out.contactEmail = v;
    } catch {
      /* ignore a corrupt row and keep the default */
    }
  }
  return out;
}

/** Validate and store the settings present in `patch`; returns the new state. */
export function saveSettings(patch: Record<string, unknown>): SiteSettings {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (typeof patch.registrationOpen === 'boolean') put.run('registrationOpen', JSON.stringify(patch.registrationOpen));
  if (typeof patch.maintenance === 'boolean') put.run('maintenance', JSON.stringify(patch.maintenance));
  if (typeof patch.contactEmail === 'string' && validContact(patch.contactEmail.trim())) {
    put.run('contactEmail', JSON.stringify(patch.contactEmail.trim()));
  }
  if (typeof patch.blockedWords === 'string') {
    put.run('blockedWords', JSON.stringify(patch.blockedWords.replace(/\r/g, '').trim().slice(0, MAX_BLOCKED_WORDS)));
  }
  if (Number.isInteger(patch.newMemberLinkMinutes) && (patch.newMemberLinkMinutes as number) >= 0 && (patch.newMemberLinkMinutes as number) <= MAX_LINK_MINUTES) {
    put.run('newMemberLinkMinutes', JSON.stringify(patch.newMemberLinkMinutes));
  }
  if (typeof patch.webcamsEnabled === 'boolean') put.run('webcamsEnabled', JSON.stringify(patch.webcamsEnabled));
  if (typeof patch.dailyPost === 'boolean') put.run('dailyPost', JSON.stringify(patch.dailyPost));
  if (typeof patch.autoMuteSpam === 'boolean') put.run('autoMuteSpam', JSON.stringify(patch.autoMuteSpam));
  if (typeof patch.qbotWelcome === 'boolean') put.run('qbotWelcome', JSON.stringify(patch.qbotWelcome));
  if (typeof patch.qbotCommands === 'boolean') put.run('qbotCommands', JSON.stringify(patch.qbotCommands));
  if (typeof patch.welcomeMessage === 'string') {
    put.run('welcomeMessage', JSON.stringify(patch.welcomeMessage.trim().slice(0, MAX_WELCOME)));
  }
  return getSettings();
}
