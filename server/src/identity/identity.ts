import { nickFromPrefix, type IrcMessage } from '@qchat/shared';
import { UpstreamConnection, type UpstreamOptions } from '../gateway/upstream.js';

const NUL = String.fromCharCode(0);
const toB64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export interface IdentityOptions extends UpstreamOptions {
  /** A registered Services-admin account the gateway uses for privileged ops. */
  botAccount: string;
  botPassword: string;
}

export interface IdentityResult {
  ok: boolean;
  error?: string;
}

/**
 * Bridges PHP account operations to NickServ over IRC. Each call opens a short
 * lived connection to the upstream IRCd, drives one NickServ interaction, and
 * disconnects. This keeps all the IRC knowledge in the gateway (which already
 * speaks to the network) so PHP only makes a local HTTP call.
 */
export class IdentityService {
  constructor(
    private opts: IdentityOptions,
    private log: (msg: string) => void = () => {},
  ) {}

  private isNickServ(msg: IrcMessage): boolean {
    return (nickFromPrefix(msg.prefix) ?? '').toLowerCase() === 'nickserv';
  }

  /** Run one short IRC session; `setup` wires the state machine and calls done(). */
  private session<T>(
    fallback: T,
    setup: (conn: UpstreamConnection, done: (value: T) => void) => (msg: IrcMessage) => void,
    timeoutMs = 12000,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const conn = new UpstreamConnection(this.opts);
      let finished = false;
      const finish = (value: T) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          conn.send({ command: 'QUIT', params: ['bye'] });
        } catch {
          /* ignore */
        }
        conn.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(fallback), timeoutMs);
      const handler = setup(conn, finish);
      conn.onMessage = (msg) => {
        if (msg.command === 'PING') {
          conn.send({ command: 'PONG', params: [msg.params[0] ?? ''] });
          return;
        }
        handler(msg);
      };
      conn.onError = (err) => {
        this.log(`identity session error: ${err.message}`);
        finish(fallback);
      };
      conn.onClose = () => finish(fallback);
    });
  }

  /** Register a brand-new account by connecting as that nick and asking NickServ. */
  register(nick: string, password: string, email: string): Promise<IdentityResult> {
    return this.session<IdentityResult>({ ok: false, error: 'timed out' }, (conn, done) => {
      let sentRegister = false;
      conn.send({ command: 'NICK', params: [nick] });
      conn.send({ command: 'USER', params: [nick, '0', '*', 'qchat web'] });
      return (msg) => {
        if (msg.command === '001' && !sentRegister) {
          sentRegister = true;
          conn.send({ command: 'PRIVMSG', params: ['NickServ', `REGISTER ${password} ${email}`] });
        } else if (msg.command === '433') {
          done({ ok: false, error: 'That nickname is already in use.' });
        } else if (msg.command === 'NOTICE' && this.isNickServ(msg)) {
          const text = (msg.params[1] ?? '').toLowerCase();
          if (text.includes('registered')) {
            done({ ok: true });
          } else if (
            text.includes('already') ||
            text.includes('denied') ||
            text.includes('invalid') ||
            text.includes('not complete') ||
            text.includes('may not') ||
            text.includes('too ')
          ) {
            done({ ok: false, error: msg.params[1] ?? 'Registration failed.' });
          }
        }
      };
    });
  }

  /**
   * Verify a password by doing a SASL login. Returns the canonical account name
   * on success (from RPL_LOGGEDIN), or null on failure.
   */
  verify(nick: string, password: string): Promise<string | null> {
    return this.session<string | null>(null, (conn, done) => {
      let capReqSent = false;
      let account: string | null = null;
      conn.send({ command: 'CAP', params: ['LS', '302'] });
      conn.send({ command: 'NICK', params: [nick] });
      conn.send({ command: 'USER', params: [nick, '0', '*', 'qchat web'] });
      return (msg) => {
        if (msg.command === 'CAP') {
          const sub = (msg.params[1] ?? '').toUpperCase();
          if (sub === 'LS') {
            const caps = msg.params.slice(2).join(' ');
            if (!capReqSent && /\bsasl\b/.test(caps)) {
              capReqSent = true;
              conn.send({ command: 'CAP', params: ['REQ', 'sasl'] });
            } else if (msg.params[2] !== '*' && !capReqSent) {
              done(null);
            }
          } else if (sub === 'ACK') {
            conn.send({ command: 'AUTHENTICATE', params: ['PLAIN'] });
          } else if (sub === 'NAK') {
            done(null);
          }
        } else if (msg.command === 'AUTHENTICATE' && msg.params[0] === '+') {
          conn.send({ command: 'AUTHENTICATE', params: [toB64(NUL + nick + NUL + password)] });
        } else if (msg.command === '900') {
          account = msg.params[2] ?? nick;
        } else if (msg.command === '903') {
          done(account ?? nick);
        } else if (['902', '904', '905', '906'].includes(msg.command)) {
          done(null);
        }
      };
    });
  }

  /** Set a new password for an account (reset flow), using the bot's admin rights. */
  setPassword(nick: string, newPassword: string): Promise<IdentityResult> {
    return this.session<IdentityResult>({ ok: false, error: 'timed out' }, (conn, done) => {
      let capReqSent = false;
      let sentSaset = false;
      // A distinct nick so we do not collide with the persistent bot; SASL still
      // logs us into the QBot account, which is what grants the admin rights.
      const nick = `${this.opts.botAccount}-r${Math.floor(Math.random() * 100000)}`;
      conn.send({ command: 'CAP', params: ['LS', '302'] });
      conn.send({ command: 'NICK', params: [nick] });
      conn.send({ command: 'USER', params: [this.opts.botAccount, '0', '*', 'qchat bot'] });
      return (msg) => {
        if (msg.command === 'CAP') {
          const sub = (msg.params[1] ?? '').toUpperCase();
          if (sub === 'LS') {
            const caps = msg.params.slice(2).join(' ');
            if (!capReqSent && /\bsasl\b/.test(caps)) {
              capReqSent = true;
              conn.send({ command: 'CAP', params: ['REQ', 'sasl'] });
            } else if (msg.params[2] !== '*' && !capReqSent) {
              done({ ok: false, error: 'server does not offer SASL' });
            }
          } else if (sub === 'ACK') {
            conn.send({ command: 'AUTHENTICATE', params: ['PLAIN'] });
          } else if (sub === 'NAK') {
            done({ ok: false, error: 'bot login rejected' });
          }
        } else if (msg.command === 'AUTHENTICATE' && msg.params[0] === '+') {
          const creds = NUL + this.opts.botAccount + NUL + this.opts.botPassword;
          conn.send({ command: 'AUTHENTICATE', params: [toB64(creds)] });
        } else if (msg.command === '903') {
          conn.send({ command: 'CAP', params: ['END'] });
        } else if (['902', '904', '905', '906'].includes(msg.command)) {
          done({ ok: false, error: 'bot login failed (check BOT_ACCOUNT / BOT_PASSWORD)' });
        } else if (msg.command === '001' && !sentSaset) {
          sentSaset = true;
          conn.send({ command: 'PRIVMSG', params: ['NickServ', `SASET ${nick} PASSWORD ${newPassword}`] });
        } else if (msg.command === 'NOTICE' && this.isNickServ(msg) && sentSaset) {
          const text = (msg.params[1] ?? '').toLowerCase();
          if (text.includes('password') && (text.includes('changed') || text.includes('set'))) {
            done({ ok: true });
          } else if (text.includes('denied') || text.includes('permission') || text.includes('access')) {
            done({ ok: false, error: 'the bot lacks permission (is its oper block loaded?)' });
          } else if (text.includes('not registered') || text.includes('isn')) {
            done({ ok: false, error: 'no such account' });
          }
        }
      };
    });
  }
}
