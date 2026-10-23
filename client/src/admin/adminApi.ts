import type { AdminBot, AdminReport, AdminRoom, AdminStats, AdminUser, AuditEntry, SiteSettings } from '@qchat/shared';
import { authHeaders, jreq, jsonAuth } from '../api.js';

const get = (token: string, path: string) => jreq(`/api/admin/${path}`, { headers: authHeaders(token) });
const post = (token: string, path: string, body: unknown = {}) =>
  jreq(`/api/admin/${path}`, { method: 'POST', headers: jsonAuth(token), body: JSON.stringify(body) });

const enc = encodeURIComponent;

export interface BotForm {
  name?: string;
  description?: string;
  emoji?: string;
  enabled?: boolean;
  allRooms?: boolean;
  rooms?: string[];
}

export const adminApi = {
  stats: (t: string): Promise<AdminStats> => get(t, 'stats').then((d) => d.stats),
  audit: (t: string): Promise<AuditEntry[]> => get(t, 'audit').then((d) => d.entries),

  reports: (t: string, status: 'open' | 'all'): Promise<AdminReport[]> =>
    get(t, `reports?status=${status}`).then((d) => d.reports),
  resolveReport: (t: string, id: number, action: 'delete' | 'dismiss' | 'handled') =>
    post(t, `reports/${id}/resolve`, { action }),

  bots: (t: string): Promise<AdminBot[]> => get(t, 'bots').then((d) => d.bots),
  createBot: (t: string, bot: BotForm) => post(t, 'bots', bot),
  updateBot: (t: string, name: string, bot: BotForm) =>
    jreq(`/api/admin/bots/${enc(name)}`, { method: 'PUT', headers: jsonAuth(t), body: JSON.stringify(bot) }),
  deleteBot: (t: string, name: string) =>
    jreq(`/api/admin/bots/${enc(name)}`, { method: 'DELETE', headers: authHeaders(t) }),
  botSay: (t: string, name: string, room: string, text: string) => post(t, `bots/${enc(name)}/say`, { room, text }),

  users: (t: string, q: string): Promise<AdminUser[]> => get(t, `users?q=${enc(q)}&limit=200`).then((d) => d.users),
  setRole: (t: string, account: string, role: 'admin' | 'user') => post(t, `users/${enc(account)}/role`, { role }),
  suspend: (t: string, account: string, suspended: boolean, reason?: string) =>
    post(t, `users/${enc(account)}/suspend`, { suspended, reason }),
  resetPassword: (t: string, account: string, password: string) => post(t, `users/${enc(account)}/password`, { password }),
  forceLogout: (t: string, account: string) => post(t, `users/${enc(account)}/logout`),
  deleteUser: (t: string, account: string) =>
    jreq(`/api/admin/users/${enc(account)}`, { method: 'DELETE', headers: authHeaders(t) }),

  rooms: (t: string): Promise<AdminRoom[]> => get(t, 'rooms').then((d) => d.rooms),
  closeRoom: (t: string, room: string) => post(t, `rooms/${enc(room)}/close`),
  stopMedia: (t: string, room: string) => post(t, `rooms/${enc(room)}/stopmedia`),
  kick: (t: string, room: string, nick: string) => post(t, `rooms/${enc(room)}/kick`, { nick }),

  announce: (t: string, text: string, room?: string): Promise<{ reached: number }> =>
    post(t, 'announce', { text, room }),

  settings: (t: string): Promise<SiteSettings> => get(t, 'settings').then((d) => d.settings),
  saveSettings: (t: string, patch: Partial<SiteSettings>): Promise<SiteSettings> =>
    jreq('/api/admin/settings', { method: 'PUT', headers: jsonAuth(t), body: JSON.stringify(patch) }).then((d) => d.settings),
};
