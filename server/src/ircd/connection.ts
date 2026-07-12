import type { Socket } from 'node:net';
import type { WebSocket } from 'ws';
import { formatIrcMessage, parseIrcLine, type IrcMessage } from '@qchat/shared';

let nextConnectionId = 1;

/**
 * Transport-agnostic IRC connection. Both raw TCP sockets and WebSockets are
 * wrapped so the server sees a uniform line-oriented stream. Incoming bytes are
 * buffered and split on CRLF (TCP) or per WS text frame; each complete line is
 * parsed and handed to {@link onMessage}.
 */
export abstract class Connection {
  readonly id = nextConnectionId++;
  /** Which transport this connection arrived on. */
  abstract readonly kind: 'tcp' | 'ws';
  /** Remote address for logging. */
  remote = 'unknown';
  /** Populated once the user issues NICK/USER and registration completes. */
  onMessage: (message: IrcMessage) => void = () => {};
  onClose: () => void = () => {};

  private buffer = '';
  private closed = false;

  /** Feed a raw chunk (which may contain 0..n complete lines). */
  protected ingest(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    // Accept both \r\n and bare \n as line terminators.
    while ((idx = this.buffer.search(/\r?\n/)) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(this.buffer.indexOf('\n', idx) + 1);
      this.deliver(line);
    }
  }

  /** WebSocket frames may arrive without a terminator; flush directly. */
  protected ingestFrame(frame: string): void {
    for (const line of frame.split(/\r?\n/)) {
      if (line.length > 0) this.deliver(line);
    }
  }

  private deliver(line: string): void {
    const message = parseIrcLine(line);
    if (message) this.onMessage(message);
  }

  send(message: IrcMessage): void {
    if (this.closed) return;
    this.write(formatIrcMessage(message) + '\r\n');
  }

  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  protected abstract write(data: string): void;
  abstract close(): void;
}

export class TcpConnection extends Connection {
  readonly kind = 'tcp' as const;

  constructor(private socket: Socket) {
    super();
    this.remote = socket.remoteAddress ?? 'tcp';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.ingest(chunk));
    socket.on('close', () => this.markClosed());
    socket.on('error', () => this.markClosed());
  }

  protected write(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
    this.markClosed();
  }
}

export class WsConnection extends Connection {
  readonly kind = 'ws' as const;

  constructor(private ws: WebSocket, remote: string) {
    super();
    this.remote = remote;
    ws.on('message', (data) => this.ingestFrame(data.toString()));
    ws.on('close', () => this.markClosed());
    ws.on('error', () => this.markClosed());
  }

  protected write(data: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(data);
  }

  close(): void {
    try {
      this.ws.close();
    } finally {
      this.markClosed();
    }
  }
}
