/**
 * QChat account profiles and admin data (#9, #5).
 *
 * Identity comes from NickServ (via SASL); these records hold the QChat-side
 * profile extras keyed to the services account name (case-insensitive).
 */

export interface Profile {
  /** Services account name (canonical case as first seen). */
  account: string;
  displayName?: string;
  bio?: string;
  pronouns?: string;
  /** A few personal links (website, socials). */
  links?: string[];
  /** Freeform custom status line. */
  status?: string;
  /** Server path to the uploaded avatar, e.g. "/avatars/russ.png". */
  avatar?: string;
  updatedAt: number;
}

/** Fields a user may edit on their own profile. */
export interface ProfileUpdate {
  displayName?: string;
  bio?: string;
  pronouns?: string;
  links?: string[];
  status?: string;
}

export interface Announcement {
  id: string;
  text: string;
  by: string;
  at: number;
}

/** Who am I — returned by GET /api/me. */
export interface MeResponse {
  account: string;
  roles: string[];
}

/** Field length caps, enforced on the server and mirrored in the UI. */
export const PROFILE_LIMITS = {
  displayName: 40,
  bio: 300,
  pronouns: 24,
  status: 80,
  link: 200,
  links: 5,
  /** Max avatar upload size in bytes (1 MiB). */
  avatarBytes: 1024 * 1024,
} as const;

export const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
