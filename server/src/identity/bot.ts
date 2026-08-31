import { nickFromPrefix } from '@qchat/shared';
import { UpstreamConnection, type UpstreamOptions } from '../gateway/upstream.js';

const NUL = String.fromCharCode(0);
const toB64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export interface BotOptions extends UpstreamOptions {
  account: string;
  password: string;
  /** Nick the bot holds (usually the same as the account). */
  nick: string;
  /** Channels it joins and stays in, so it is always in the userlist. */
  channels: string[];
  /**
   * When true, the bot registers each channel with ChanServ (becoming its
   * founder) the first time it joins, so it "owns" them. Op is then reclaimed
   * from ChanServ on every (re)join regardless of this flag.
   */
  own: boolean;
}

/**
 * A persistent bot presence. It logs in as the QBot services account, joins the
 * configured channels, and stays there (auto-reconnecting) so it is always
 * visible in the userlist, the way the classic QChat bot was.
 */
export class BotPresence {
  private conn: UpstreamConnection | null = null;
  private stopped = false;
  private reconnectDelay = 3000;
  /** Channels we have already tried to register this process (avoids re-spam). */
  private registerAttempted = new Set<string>();

  constructor(
    private opts: BotOptions,
    private log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.conn?.close();
    this.conn = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const conn = new UpstreamConnection(this.opts);
    this.conn = conn;
    let capReqSent = false;

    conn.onMessage = (msg) => {
      if (msg.command === 'PING') {
        conn.send({ command: 'PONG', params: [msg.params[0] ?? ''] });
        return;
      }
      if (msg.command === 'CAP') {
        const sub = (msg.params[1] ?? '').toUpperCase();
        if (sub === 'LS') {
          const caps = msg.params.slice(2).join(' ');
          if (!capReqSent && /\bsasl\b/.test(caps)) {
            capReqSent = true;
            conn.send({ command: 'CAP', params: ['REQ', 'sasl'] });
          } else if (msg.params[2] !== '*' && !capReqSent) {
            conn.send({ command: 'CAP', params: ['END'] });
          }
        } else if (sub === 'ACK') {
          conn.send({ command: 'AUTHENTICATE', params: ['PLAIN'] });
        } else if (sub === 'NAK') {
          conn.send({ command: 'CAP', params: ['END'] });
        }
      } else if (msg.command === 'AUTHENTICATE' && msg.params[0] === '+') {
        conn.send({
          command: 'AUTHENTICATE',
          params: [toB64(NUL + this.opts.account + NUL + this.opts.password)],
        });
      } else if (msg.command === '903') {
        conn.send({ command: 'CAP', params: ['END'] });
      } else if (['902', '904', '905', '906'].includes(msg.command)) {
        this.log('bot: SASL login failed (check BOT_ACCOUNT / BOT_PASSWORD)');
        conn.send({ command: 'CAP', params: ['END'] });
      } else if (msg.command === '001') {
        // Registered. Flag as a bot and join the channels.
        conn.send({ command: 'MODE', params: [this.opts.nick, '+B'] });
        for (const ch of this.opts.channels) {
          conn.send({ command: 'JOIN', params: [ch] });
        }
        this.reconnectDelay = 3000;
        this.log(`bot: online as ${this.opts.nick}, in ${this.opts.channels.join(', ')}`);
      } else if (msg.command === 'KICK' && msg.params[1] === this.opts.nick) {
        // Rejoin if kicked, so it stays present.
        conn.send({ command: 'JOIN', params: [msg.params[0] ?? ''] });
      } else if (
        msg.command === 'JOIN' &&
        (nickFromPrefix(msg.prefix) ?? '').toLowerCase() === this.opts.nick.toLowerCase()
      ) {
        // We just (re)joined a channel. Take ownership / reclaim op via services.
        const chan = (msg.params[0] ?? '').replace(/^:/, '');
        if (!chan) return;
        // Register it once so QBot becomes the founder and keeps op forever.
        if (this.opts.own && !this.registerAttempted.has(chan.toLowerCase())) {
          this.registerAttempted.add(chan.toLowerCase());
          conn.send({ command: 'PRIVMSG', params: ['ChanServ', `REGISTER ${chan}`] });
        }
        // Ask ChanServ to op us based on our access (regained on every reconnect).
        conn.send({ command: 'PRIVMSG', params: ['ChanServ', `OP ${chan}`] });
      }
    };

    conn.onClose = () => {
      this.conn = null;
      if (!this.stopped) this.scheduleReconnect();
    };
    conn.onError = (err) => this.log(`bot connection error: ${err.message}`);

    conn.send({ command: 'CAP', params: ['LS', '302'] });
    conn.send({ command: 'NICK', params: [this.opts.nick] });
    conn.send({ command: 'USER', params: [this.opts.account, '0', '*', 'QChat helper bot'] });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 60000);
    this.log(`bot: reconnecting in ${Math.round(delay / 1000)}s`);
    setTimeout(() => this.connect(), delay);
  }
}
