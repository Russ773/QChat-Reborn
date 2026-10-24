import type { MediaState } from './protocol.js';

/** Site-wide settings an administrator can change. */
export interface SiteSettings {
  /** When false, nobody new can create an account. */
  registrationOpen: boolean;
  /** When true, only administrators can log in or stay connected. */
  maintenance: boolean;
  /** A line shown to everyone as they join a room (empty for none). */
  welcomeMessage: string;
  /** QBot welcomes members the first time they join a room. */
  qbotWelcome: boolean;
  /** QBot answers ! commands such as !help and !roll. */
  qbotCommands: boolean;
  /** Where members can reach the administrators (shown on the terms and privacy pages). Empty for none. */
  contactEmail: string;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  registrationOpen: true,
  maintenance: false,
  welcomeMessage: '',
  qbotWelcome: true,
  qbotCommands: true,
  contactEmail: '',
};

export const MAX_WELCOME = 300;
export const MAX_CONTACT = 120;

/** An email address, or empty for none. */
export const validContact = (s: string): boolean =>
  s === '' || (s.length <= MAX_CONTACT && /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(s));

export interface AdminStats {
  members: number;
  online: number;
  rooms: number;
  videos: number;
  suspended: number;
  admins: number;
  newThisWeek: number;
  /** Reported messages waiting for an admin. */
  openReports: number;
}

/** A message someone reported, for the admin review queue. */
export interface AdminReport {
  id: number;
  ts: number;
  reporter: string;
  room: string;
  messageId: string;
  author: string;
  /** The message text as it was when reported. */
  text: string;
  /** A picture on the message, if any. */
  image: string | null;
  reason: string | null;
  status: 'open' | 'resolved';
  resolvedBy: string | null;
  resolvedAt: number | null;
  /** What was done: 'deleted', 'dismissed' or 'handled'. */
  resolution: string | null;
}

export interface AdminUser {
  account: string;
  email: string | null;
  role: 'admin' | 'user';
  suspended: boolean;
  suspendedReason: string | null;
  createdAt: number;
  lastLogin: number | null;
  online: boolean;
  displayName?: string;
  avatar?: string;
}

export interface AdminRoom {
  name: string;
  /** Kept for good: built in, or created by an administrator as a server room. */
  permanent: boolean;
  /** One of the rooms every QChat starts with (cannot be deleted). */
  builtin: boolean;
  members: string[];
  media: MediaState | null;
  /** Saved messages in the room. */
  lines: number;
  owner?: string | null;
  topic?: string | null;
}

/** A bot as the admin area manages it. */
export interface AdminBot {
  name: string;
  description: string;
  emoji: string;
  builtin: boolean;
  enabled: boolean;
  /** True when the bot is in every room. */
  allRooms: boolean;
  /** The rooms it is in when allRooms is false. */
  rooms: string[];
  createdBy: string | null;
  createdAt: number;
}

export interface AuditEntry {
  id: number;
  ts: number;
  admin: string;
  action: string;
  target: string | null;
  detail: string | null;
}
