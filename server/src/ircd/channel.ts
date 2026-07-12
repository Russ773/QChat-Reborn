import type { IrcMessage } from '@qchat/shared';
import type { User } from './user.js';

/** A chat channel and its current membership. */
export class Channel {
  topic = '';
  readonly members = new Set<User>();

  constructor(readonly name: string) {}

  /** Case-normalized key used to look channels up. */
  get key(): string {
    return this.name.toLowerCase();
  }

  add(user: User): void {
    this.members.add(user);
  }

  remove(user: User): void {
    this.members.delete(user);
  }

  has(user: User): boolean {
    return this.members.has(user);
  }

  get empty(): boolean {
    return this.members.size === 0;
  }

  /**
   * Relay a message to every member. When `except` is provided that user is
   * skipped (used so a sender doesn't receive an echo of their own PRIVMSG).
   */
  broadcast(message: IrcMessage, except?: User): void {
    for (const member of this.members) {
      if (member === except) continue;
      member.send(message);
    }
  }
}
