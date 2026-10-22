import type { MediaState } from './protocol.js';

/** Site-wide settings an administrator can change. */
export interface SiteSettings {
  /** When false, nobody new can create an account. */
  registrationOpen: boolean;
  /** When true, only administrators can log in or stay connected. */
  maintenance: boolean;
  /** A line shown to everyone as they join a room (empty for none). */
  welcomeMessage: string;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  registrationOpen: true,
  maintenance: false,
  welcomeMessage: '',
};

export const MAX_WELCOME = 300;

export interface AdminStats {
  members: number;
  online: number;
  rooms: number;
  videos: number;
  suspended: number;
  admins: number;
  newThisWeek: number;
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
  permanent: boolean;
  members: string[];
  media: MediaState | null;
  /** Saved messages in the room. */
  lines: number;
  owner?: string | null;
  topic?: string | null;
}

export interface AuditEntry {
  id: number;
  ts: number;
  admin: string;
  action: string;
  target: string | null;
  detail: string | null;
}
