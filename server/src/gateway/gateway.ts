import {
  encodeMediaEvent,
  nickFromPrefix,
  parseMediaEvent,
  type IrcMessage,
  type MediaClientEvent,
  type MediaState,
} from '@qchat/shared';
import { classifyUrl, MediaCoordinator } from '../media/coordinator.js';
import type { AuthRegistry } from '../auth.js';
import type { Connection } from '../ircd/connection.js';
import type { Store } from '../store/store.js';
import { UpstreamConnection, type UpstreamOptions } from './upstream.js';

/** One browser session bridged to the real IRCd. */
interface Session {
  browser: Connection;
  upstream: UpstreamConnection;
  /** Registered nick, learned from the IRCd (RPL_WELCOME / NICK). */
  nick: string;
  /** Lowercased channels this session has joined (for media routing). */
  channels: Set<string>;
  supportsMedia: boolean;
  /** Services account once SASL succeeds (RPL_LOGGEDIN 900), else null. */
  account: string | null;
  /** API bearer token minted on login. */
  token: string | null;
}

export interface GatewayOptions extends UpstreamOptions {
  /** Server name used as the prefix of gateway-originated MEDIA messages. */
  serverName: string;
  /** If set, the gateway sends WEBIRC so the IRCd sees each user's real IP. */
  webircPassword?: string;
  webircName: string;
}

/**
 * Web-IRC gateway. Bridges each browser WebSocket to a real connection on an
 * upstream IRCd, forwarding chat transparently in both directions. The custom
 * `MEDIA` command is intercepted here (the upstream IRCd never sees it) so the
 * server-authoritative watch-party overlay works against any IRCd. Non-gateway
 * IRC users still see a plain "shared a …" ACTION when someone enqueues media.
 */
export class IrcGateway {
  private sessionsByChannel = new Map<string, Set<Session>>();
  private sessions = new Set<Session>();
  private media = new MediaCoordinator();

  constructor(
    private opts: GatewayOptions,
    private store: Store,
    private auth: AuthRegistry,
    private log: (msg: string) => void = () => {},
  ) {}

  /** Bridge a freshly accepted browser connection to the upstream IRCd. */
  accept(browser: Connection, clientIp: string): void {
    const upstream = new UpstreamConnection(this.opts);
    const session: Session = {
      browser,
      upstream,
      nick: '*',
      channels: new Set(),
      supportsMedia: browser.kind === 'ws',
      account: null,
      token: null,
    };
    this.sessions.add(session);

    upstream.onMessage = (message) => this.fromUpstream(session, message);
    upstream.onError = (err) => this.log(`upstream error: ${err.message}`);
    upstream.onClose = () => {
      this.cleanup(session);
      browser.close();
    };

    browser.onMessage = (message) => this.fromBrowser(session, message);
    browser.onClose = () => {
      this.cleanup(session);
      upstream.close();
    };

    // WEBIRC must precede NICK/USER; it's queued on the socket write buffer
    // ahead of anything the browser sends, so the IRCd processes it first.
    if (this.opts.webircPassword) {
      upstream.send({
        command: 'WEBIRC',
        params: [this.opts.webircPassword, this.opts.webircName, clientIp, clientIp],
      });
    }
    this.log(`bridged ${clientIp} -> ${this.opts.host}:${this.opts.port}`);
  }

  // --- Browser -> upstream ---------------------------------------------------

  private fromBrowser(session: Session, message: IrcMessage): void {
    if (message.command === 'MEDIA') {
      this.handleMedia(session, message);
      return; // never forward MEDIA to the real IRCd
    }
    session.upstream.send(message);
  }

  // --- Upstream -> browser ---------------------------------------------------

  private fromUpstream(session: Session, message: IrcMessage): void {
    const fromNick = nickFromPrefix(message.prefix);

    switch (message.command) {
      case '001': // RPL_WELCOME carries our final, IRCd-approved nick
        session.nick = message.params[0] ?? session.nick;
        break;
      case '900': // RPL_LOGGEDIN: <nick> <mask> <account> :...
        session.account = message.params[2] ?? session.account;
        break;
      case '903': // RPL_SASLSUCCESS -> mint an API token bound to the account
        this.issueToken(session);
        break;
      case 'NICK':
        if (fromNick && fromNick === session.nick) {
          session.nick = message.params[0] ?? session.nick;
        }
        break;
      case 'JOIN':
        if (fromNick === session.nick) {
          const name = message.params[0] ?? '';
          this.onSelfJoin(session, name);
        }
        break;
      case 'PART':
        if (fromNick === session.nick) this.onSelfLeave(session, message.params[0] ?? '');
        break;
      case 'KICK':
        if (message.params[1] === session.nick) this.onSelfLeave(session, message.params[0] ?? '');
        break;
    }

    session.browser.send(message);
  }

  private onSelfJoin(session: Session, channelName: string): void {
    const key = channelName.toLowerCase();
    if (!key) return;
    session.channels.add(key);
    let set = this.sessionsByChannel.get(key);
    if (!set) this.sessionsByChannel.set(key, (set = new Set()));
    set.add(session);

    // Sync the newcomer to any watch-party already in progress.
    const state = this.media.getState(key);
    if (state && session.supportsMedia) this.sendState(session, state);
  }

  private onSelfLeave(session: Session, channelName: string): void {
    const key = channelName.toLowerCase();
    session.channels.delete(key);
    const set = this.sessionsByChannel.get(key);
    if (set) {
      set.delete(session);
      if (set.size === 0) {
        this.sessionsByChannel.delete(key);
        this.media.dispose(key);
      }
    }
  }

  // --- Media overlay ---------------------------------------------------------

  private handleMedia(session: Session, message: IrcMessage): void {
    const target = message.params[0];
    const payload = message.params[1];
    if (!target || payload === undefined) return;

    const key = target.toLowerCase();
    if (!session.channels.has(key)) return; // must be joined to control media

    const event = parseMediaEvent(payload);
    if (!event || event.t === 'state') return; // ignore malformed / server-only

    const state = this.media.handle(key, target, event as MediaClientEvent, session.nick);
    if (!state) return;

    for (const member of this.sessionsByChannel.get(key) ?? []) {
      if (member.supportsMedia) this.sendState(member, state);
    }

    // Let real IRC users (and our own chat log) see what was shared.
    if (event.t === 'enqueue') {
      const { kind } = classifyUrl(event.url);
      const noun = kind === 'audio' ? 'audio' : kind === 'unknown' ? 'link' : 'video';
      session.upstream.send({
        command: 'PRIVMSG',
        params: [target, `ACTION shared a ${noun}: ${event.url}`],
      });
    }
  }

  private sendState(session: Session, state: MediaState): void {
    session.browser.send({
      prefix: this.opts.serverName,
      command: 'MEDIA',
      params: [state.channel, encodeMediaEvent({ t: 'state', state })],
    });
  }

  // --- Auth bridge -----------------------------------------------------------

  /** Mint an API token for the session's account and hand it to the client. */
  private issueToken(session: Session): void {
    if (!session.account) return;
    const roles = this.store.getRoles(session.account);
    const token = this.auth.mint(session.account, roles);
    session.token = token;
    session.browser.send({
      prefix: this.opts.serverName,
      command: 'QAUTH',
      params: [token, session.account, roles.join(',')],
    });
    this.log(`login: ${session.account} (roles: ${roles.join(',') || 'none'})`);
  }

  // --- Announcements (#5) ----------------------------------------------------

  /** Push a live announcement to every connected browser session. */
  broadcastAnnouncement(text: string, by: string): void {
    for (const session of this.sessions) {
      session.browser.send({
        prefix: this.opts.serverName,
        command: 'QANNOUNCE',
        params: [by, text],
      });
    }
  }

  // --- Teardown --------------------------------------------------------------

  private cleanup(session: Session): void {
    for (const key of session.channels) {
      const set = this.sessionsByChannel.get(key);
      if (!set) continue;
      set.delete(session);
      if (set.size === 0) {
        this.sessionsByChannel.delete(key);
        this.media.dispose(key);
      }
    }
    session.channels.clear();
    if (session.token) this.auth.revoke(session.token);
    this.sessions.delete(session);
  }
}
