import { decodeMsg, encodeMsg, type ClientMsg, type ServerMsg } from '@qchat/shared';

export type ChatStatus = 'idle' | 'connecting' | 'online' | 'closed' | 'error';

export interface ChatHandlers {
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: ChatStatus) => void;
}

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Thin transport: speaks the native JSON protocol over a WebSocket. */
export class ChatClient {
  private ws: WebSocket | null = null;

  constructor(private handlers: ChatHandlers) {}

  connect(nick: string, token?: string | null, url = defaultWsUrl()): void {
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', nick, token: token ?? undefined });
      this.handlers.onStatus('online');
    };
    ws.onmessage = (e) => {
      const msg = decodeMsg<ServerMsg>(typeof e.data === 'string' ? e.data : '');
      if (msg) this.handlers.onMessage(msg);
    };
    ws.onerror = () => this.handlers.onStatus('error');
    ws.onclose = () => this.handlers.onStatus('closed');
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMsg(msg));
    }
  }

  join(room: string, restore = false, topic?: string): void {
    this.send({ t: 'join', room, restore: restore || undefined, topic: topic || undefined });
  }
  leave(room: string): void {
    this.send({ t: 'leave', room });
  }
  say(room: string, text: string, extra: { replyTo?: string; image?: string } = {}): void {
    this.send({ t: 'say', room, text, ...extra });
  }
  pin(room: string, id: string, pin: boolean): void {
    this.send({ t: 'pin', room, id, pin });
  }
  react(room: string, id: string, emoji: string): void {
    this.send({ t: 'react', room, id, emoji });
  }
  report(room: string, id: string, reason?: string): void {
    this.send({ t: 'report', room, id, reason });
  }
  search(room: string, q: string): void {
    this.send({ t: 'search', room, q });
  }
  roomAdmin(room: string): void {
    this.send({ t: 'roomAdmin', room });
  }
  friendRequest(to: string): void {
    this.send({ t: 'friendRequest', to });
  }
  friendRespond(from: string, accept: boolean): void {
    this.send({ t: 'friendRespond', from, accept });
  }
  friendRemove(who: string): void {
    this.send({ t: 'friendRemove', who });
  }
  nick(nick: string): void {
    this.send({ t: 'nick', nick });
  }
  playYouTube(room: string, ref: string, title?: string): void {
    this.send({ t: 'playYouTube', room, ref, title });
  }
  playMedia(room: string, url: string): void {
    this.send({ t: 'playMedia', room, url });
  }
  queueAdd(room: string, url: string): void {
    this.send({ t: 'queueAdd', room, url });
  }
  queueRemove(room: string, id: string): void {
    this.send({ t: 'queueRemove', room, id });
  }
  mediaSkip(room: string): void {
    this.send({ t: 'mediaSkip', room });
  }
  mediaControl(room: string, op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended', pos?: number, ref?: string): void {
    this.send({ t: 'mediaControl', room, op, pos, ref });
  }
  playSound(room: string, sound: string): void {
    this.send({ t: 'playSound', room, sound });
  }
  listRooms(): void {
    this.send({ t: 'listRooms' });
  }
  history(room: string, before: number): void {
    this.send({ t: 'history', room, before });
  }
  typing(room: string): void {
    this.send({ t: 'typing', room });
  }
  edit(room: string, id: string, text: string): void {
    this.send({ t: 'edit', room, id, text });
  }
  remove(room: string, id: string): void {
    this.send({ t: 'delete', room, id });
  }
  dm(to: string, text: string): void {
    this.send({ t: 'dm', to, text });
  }
  dmHistory(withName: string, before?: number): void {
    this.send({ t: 'dmHistory', with: withName, before });
  }
  dmRead(withName: string): void {
    this.send({ t: 'dmRead', with: withName });
  }
  dmTyping(to: string): void {
    this.send({ t: 'dmTyping', to });
  }
  close(): void {
    this.ws?.close();
  }
}
