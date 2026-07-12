import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { formatIrcMessage, parseIrcLine, type IrcMessage } from '@qchat/shared';

export interface UpstreamOptions {
  host: string;
  port: number;
  /** Use a TLS socket (typically port 6697). */
  tls: boolean;
  /** Verify the IRCd's TLS certificate (disable only for self-signed test certs). */
  rejectUnauthorized: boolean;
}

/**
 * A single connection from the gateway up to the real IRCd, on behalf of one
 * browser session. Line-buffered and parsed like {@link Connection}, but this
 * end is a client rather than a server.
 */
export class UpstreamConnection {
  private socket: Socket;
  private buffer = '';
  private closed = false;

  onMessage: (message: IrcMessage) => void = () => {};
  onClose: () => void = () => {};
  onError: (err: Error) => void = () => {};

  constructor(opts: UpstreamOptions) {
    this.socket = opts.tls
      ? tlsConnect({
          host: opts.host,
          port: opts.port,
          servername: opts.host,
          rejectUnauthorized: opts.rejectUnauthorized,
        })
      : netConnect({ host: opts.host, port: opts.port });

    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this.ingest(chunk));
    this.socket.on('close', () => this.close());
    this.socket.on('error', (err: Error) => {
      this.onError(err);
      this.close();
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      const message = parseIrcLine(line);
      if (message) this.onMessage(message);
    }
  }

  /** Node buffers writes until the socket connects, so this is safe pre-connect. */
  send(message: IrcMessage): void {
    if (!this.closed) this.socket.write(formatIrcMessage(message) + '\r\n');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
