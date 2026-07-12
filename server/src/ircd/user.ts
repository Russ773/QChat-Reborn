import type { IrcMessage } from '@qchat/shared';
import type { Connection } from './connection.js';

/** A connected user, whether registered yet or not. */
export class User {
  nick = '*';
  username = '';
  realname = '';
  /** Set once both NICK and USER have been received. */
  registered = false;
  /** Whether this connection speaks the QChat MEDIA extension. */
  supportsMedia = false;
  /** Lowercased channel names this user is a member of. */
  readonly channels = new Set<string>();

  constructor(
    readonly connection: Connection,
    /** The server's own name, used as the prefix of server-originated messages. */
    readonly serverName: string,
  ) {}

  get hostmask(): string {
    return `${this.nick}!${this.username || '~' + this.nick}@${this.connection.remote}`;
  }

  /** Send a message that originates from the server itself. */
  sendFromServer(command: string, params: string[], tags?: IrcMessage['tags']): void {
    this.connection.send({ prefix: this.serverName, command, params, tags });
  }

  /** Send a numeric reply (the client's nick is always the first parameter). */
  sendNumeric(numeric: string, params: string[]): void {
    this.connection.send({
      prefix: this.serverName,
      command: numeric,
      params: [this.nick, ...params],
    });
  }

  send(message: IrcMessage): void {
    this.connection.send(message);
  }
}
