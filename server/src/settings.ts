import { DEFAULT_SETTINGS, MAX_WELCOME, type SiteSettings } from '@qchat/shared';
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
  if (typeof patch.welcomeMessage === 'string') {
    put.run('welcomeMessage', JSON.stringify(patch.welcomeMessage.trim().slice(0, MAX_WELCOME)));
  }
  return getSettings();
}
