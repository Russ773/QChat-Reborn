import { DEFAULT_SETTINGS, MAX_WELCOME, validContact, type SiteSettings } from '@qchat/shared';
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
  if (typeof patch.qbotWelcome === 'boolean') put.run('qbotWelcome', JSON.stringify(patch.qbotWelcome));
  if (typeof patch.qbotCommands === 'boolean') put.run('qbotCommands', JSON.stringify(patch.qbotCommands));
  if (typeof patch.welcomeMessage === 'string') {
    put.run('welcomeMessage', JSON.stringify(patch.welcomeMessage.trim().slice(0, MAX_WELCOME)));
  }
  return getSettings();
}
