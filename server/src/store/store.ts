import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Announcement, Profile, ProfileUpdate } from '@qchat/shared';

interface Data {
  /** keyed by lowercased account */
  profiles: Record<string, Profile>;
  roles: Record<string, string[]>;
  announcements: Announcement[];
}

/**
 * Tiny JSON-file persistence for profiles, roles, and announcements. No native
 * dependency — fine for a single-process chat server. Writes are atomic
 * (temp file + rename) so a crash mid-write can't corrupt the database.
 */
export class Store {
  private data: Data = { profiles: {}, roles: {}, announcements: [] };

  constructor(
    private file: string,
    seedAdmins: string[] = [],
  ) {
    if (existsSync(file)) {
      try {
        this.data = { profiles: {}, roles: {}, announcements: [], ...JSON.parse(readFileSync(file, 'utf8')) };
      } catch {
        /* start fresh on a corrupt file */
      }
    }
    for (const admin of seedAdmins) {
      const key = admin.toLowerCase();
      const roles = new Set(this.data.roles[key] ?? []);
      roles.add('admin');
      this.data.roles[key] = [...roles];
    }
    mkdirSync(dirname(file), { recursive: true });
    this.persist();
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  // --- Profiles --------------------------------------------------------------

  getProfile(account: string): Profile | null {
    return this.data.profiles[account.toLowerCase()] ?? null;
  }

  getProfiles(accounts: string[]): Profile[] {
    return accounts
      .map((a) => this.data.profiles[a.toLowerCase()])
      .filter((p): p is Profile => Boolean(p));
  }

  updateProfile(account: string, patch: ProfileUpdate): Profile {
    return this.mergeProfile(account, patch);
  }

  setAvatar(account: string, avatar: string): Profile {
    return this.mergeProfile(account, { avatar });
  }

  private mergeProfile(account: string, patch: Partial<Profile>): Profile {
    const key = account.toLowerCase();
    const prev = this.data.profiles[key] ?? { account, updatedAt: 0 };
    const next: Profile = { ...prev, ...patch, account, updatedAt: Date.now() };
    this.data.profiles[key] = next;
    this.persist();
    return next;
  }

  // --- Roles -----------------------------------------------------------------

  getRoles(account: string): string[] {
    return this.data.roles[account.toLowerCase()] ?? [];
  }

  isAdmin(account: string): boolean {
    return this.getRoles(account).includes('admin');
  }

  setRoles(account: string, roles: string[]): void {
    this.data.roles[account.toLowerCase()] = [...new Set(roles)];
    this.persist();
  }

  // --- Announcements ---------------------------------------------------------

  addAnnouncement(text: string, by: string): Announcement {
    const announcement: Announcement = { id: randomUUID(), text, by, at: Date.now() };
    this.data.announcements.unshift(announcement);
    this.data.announcements = this.data.announcements.slice(0, 50);
    this.persist();
    return announcement;
  }

  listAnnouncements(): Announcement[] {
    return this.data.announcements;
  }
}
