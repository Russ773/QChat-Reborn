import {
  encodeMediaEvent,
  formatIrcMessage,
  parseIrcLine,
  type IrcMessage,
  type MediaClientEvent,
} from '@qchat/shared';

export type IrcClientStatus = 'idle' | 'connecting' | 'registered' | 'closed' | 'error';

/** NickServ credentials for SASL login (#9). */
export interface LoginCreds {
  account: string;
  password: string;
}

interface IrcClientHandlers {
  onMessage: (message: IrcMessage) => void;
  onStatus: (status: IrcClientStatus) => void;
  /** SASL outcome: ok + the account we authenticated as, or a failure. */
  onSasl?: (ok: boolean, account?: string) => void;
  /** Gateway handed us an API token (QAUTH) after login. */
  onAuth?: (token: string, account: string, roles: string[]) => void;
  /** A live announcement (QANNOUNCE) arrived from an admin. */
  onAnnounce?: (by: string, text: string) => void;
}

/**
 * Browser-side IRC client speaking IRC-over-WebSocket to the QChat server.
 * It is transport + protocol only — all UI state lives in React.
 */
export class IrcClient {
  private ws: WebSocket | null = null;
  private handlers: IrcClientHandlers;
  status: IrcClientStatus = 'idle';
  nick = '';
  account: string | null = null;

  // SASL negotiation state (null when not logging in).
  private sasl: LoginCreds | null = null;
  private capReqSent = false;

  // Nick-contention handling during registration.
  private desiredNick = '';
  private nickTries = 0;
  private retryNickAfterSasl = false;

  constructor(handlers: IrcClientHandlers) {
    this.handlers = handlers;
  }

  connect(nick: string, creds?: LoginCreds, url = defaultWsUrl()): void {
    this.nick = nick;
    this.desiredNick = nick;
    this.nickTries = 0;
    this.retryNickAfterSasl = false;
    this.account = null;
    this.sasl = creds ?? null;
    this.capReqSent = false;
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      // When logging in, open CAP negotiation first; the server holds
      // registration until CAP END, letting SASL complete before 001.
      if (this.sasl) this.sendRaw({ command: 'CAP', params: ['LS', '302'] });
      this.sendRaw({ command: 'NICK', params: [nick] });
      this.sendRaw({ command: 'USER', params: [nick, '0', '*', nick] });
    };

    ws.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : '';
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        const message = parseIrcLine(line);
        if (!message) continue;
        this.intercept(message);
        this.handlers.onMessage(message);
      }
    };

    ws.onerror = () => this.setStatus('error');
    ws.onclose = () => this.setStatus('closed');
  }

  /** React to protocol-level messages that affect connection state. */
  private intercept(message: IrcMessage): void {
    switch (message.command) {
      case 'CAP':
        this.handleCap(message);
        break;
      case 'AUTHENTICATE':
        if (message.params[0] === '+' && this.sasl) {
          // SASL PLAIN: base64( authzid \0 authcid \0 password ), authzid empty.
          const payload = toBase64Utf8(`\u0000${this.sasl.account}\u0000${this.sasl.password}`);
          this.sendRaw({ command: 'AUTHENTICATE', params: [payload] });
        }
        break;
      case '900': // RPL_LOGGEDIN: <nick> <mask> <account> :...
        this.account = message.params[2] ?? null;
        break;
      case '903': // RPL_SASLSUCCESS
        this.handlers.onSasl?.(true, this.account ?? this.sasl?.account);
        // Now identified: if our nick was held, ask services to release the
        // hold and reclaim it. Falls back to an alternate nick if it's really
        // taken (see the 433/437 handler).
        if (this.retryNickAfterSasl) {
          this.retryNickAfterSasl = false;
          this.sendRaw({ command: 'PRIVMSG', params: ['NickServ', `RELEASE ${this.desiredNick}`] });
          this.sendRaw({ command: 'NICK', params: [this.desiredNick] });
        }
        this.endSasl();
        break;
      case '902': // nick locked
      case '904': // ERR_SASLFAIL
      case '905': // ERR_SASLTOOLONG
      case '906': // ERR_SASLABORTED
        this.handlers.onSasl?.(false);
        if (this.retryNickAfterSasl) {
          this.retryNickAfterSasl = false;
          this.sendRaw({ command: 'NICK', params: [this.altNick()] });
        }
        this.endSasl();
        break;
      case '432': // ERR_ERRONEUSNICKNAME
      case '433': // ERR_NICKNAMEINUSE
      case '437': // nick unavailable (e.g. "held for registered user")
        if (this.status !== 'registered') {
          if (this.sasl) {
            // Nick likely held until we identify; retry it after SASL succeeds.
            this.retryNickAfterSasl = true;
          } else {
            this.sendRaw({ command: 'NICK', params: [this.altNick()] });
          }
        }
        break;
      case '001': // RPL_WELCOME
        if (message.params[0]) this.nick = message.params[0];
        this.setStatus('registered');
        break;
      case 'QAUTH': // gateway: [token, account, rolesCsv]
        this.account = message.params[1] ?? this.account;
        this.handlers.onAuth?.(
          message.params[0] ?? '',
          message.params[1] ?? '',
          (message.params[2] ?? '').split(',').filter(Boolean),
        );
        break;
      case 'QANNOUNCE': // gateway: [by, text]
        this.handlers.onAnnounce?.(message.params[0] ?? '', message.params[1] ?? '');
        break;
      case 'PING':
        this.sendRaw({ command: 'PONG', params: [message.params[0] ?? ''] });
        break;
    }
  }

  private handleCap(message: IrcMessage): void {
    if (!this.sasl) return;
    const sub = (message.params[1] ?? '').toUpperCase();
    if (sub === 'LS') {
      // `CAP LS 302` may span multiple lines; a non-final line has "*" in params[2].
      const capText = message.params.slice(2).join(' ');
      const isFinal = message.params[2] !== '*';
      if (!this.capReqSent && /\bsasl\b/.test(capText)) {
        this.capReqSent = true;
        this.sendRaw({ command: 'CAP', params: ['REQ', 'sasl'] });
      } else if (isFinal && !this.capReqSent) {
        this.abortSasl(); // server doesn't offer SASL
      }
    } else if (sub === 'ACK') {
      this.sendRaw({ command: 'AUTHENTICATE', params: ['PLAIN'] });
    } else if (sub === 'NAK') {
      this.abortSasl();
    }
  }

  /** SASL finished (success or fail): release registration with CAP END. */
  private endSasl(): void {
    this.sasl = null;
    this.sendRaw({ command: 'CAP', params: ['END'] });
  }

  private abortSasl(): void {
    this.handlers.onSasl?.(false);
    if (this.retryNickAfterSasl) {
      this.retryNickAfterSasl = false;
      this.sendRaw({ command: 'NICK', params: [this.altNick()] });
    }
    this.endSasl();
  }

  /** Pick the next fallback nick when the desired one is unavailable. */
  private altNick(): string {
    this.nickTries += 1;
    const base = (this.desiredNick || 'guest').slice(0, 12);
    const alt =
      this.nickTries <= 4 ? base + '_'.repeat(this.nickTries) : base + Math.floor(Math.random() * 10000);
    this.nick = alt;
    return alt;
  }

  private setStatus(status: IrcClientStatus): void {
    this.status = status;
    this.handlers.onStatus(status);
  }

  sendRaw(message: IrcMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(formatIrcMessage(message) + '\r\n');
    }
  }

  join(channel: string): void {
    this.sendRaw({ command: 'JOIN', params: [channel] });
  }

  part(channel: string, reason?: string): void {
    this.sendRaw({ command: 'PART', params: reason ? [channel, reason] : [channel] });
  }

  say(target: string, text: string): void {
    this.sendRaw({ command: 'PRIVMSG', params: [target, text] });
  }

  changeNick(nick: string): void {
    this.sendRaw({ command: 'NICK', params: [nick] });
  }

  whois(nick: string): void {
    this.sendRaw({ command: 'WHOIS', params: [nick] });
  }

  list(): void {
    this.sendRaw({ command: 'LIST', params: [] });
  }

  media(channel: string, event: MediaClientEvent): void {
    this.sendRaw({ command: 'MEDIA', params: [channel, encodeMediaEvent(event)] });
  }

  quit(reason = 'Bye'): void {
    this.sendRaw({ command: 'QUIT', params: [reason] });
    this.ws?.close();
  }
}

/** Build the ws:// URL for the IRC endpoint from the current page origin. */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/irc`;
}

/** UTF-8 safe base64 (btoa only handles Latin-1), used for the SASL payload. */
function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
