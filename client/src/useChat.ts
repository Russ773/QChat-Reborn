import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ServerMsg } from '@qchat/shared';
import { ChatClient, type ChatStatus } from './chat/client.js';
import type { AppState, ChatEvent, ChatEventKind, RoomState } from './types.js';

export const DEFAULT_ROOM = '#lobby';

let seq = 0;
function makeEvent(kind: ChatEventKind, text: string, from?: string, self?: boolean): ChatEvent {
  return { id: `e${Date.now()}-${seq++}`, kind, text, from, ts: Date.now(), self };
}

function initialState(nick: string): AppState {
  return {
    nick,
    account: null,
    status: 'idle',
    available: [],
    rooms: {},
    order: [],
    active: null,
    serverLog: [makeEvent('system', 'Connecting…')],
  };
}

type Action =
  | { type: 'server'; msg: ServerMsg }
  | { type: 'status'; status: ChatStatus }
  | { type: 'setActive'; room: string };

function patchRoom(state: AppState, name: string, fn: (r: RoomState) => RoomState): AppState {
  const room = state.rooms[name];
  if (!room) return state;
  return { ...state, rooms: { ...state.rooms, [name]: fn(room) } };
}

function pushEvent(state: AppState, name: string, event: ChatEvent): AppState {
  return patchRoom(state, name, (r) => ({
    ...r,
    events: [...r.events, event],
    unread: state.active === name ? 0 : r.unread + 1,
  }));
}

function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'status') return { ...state, status: action.status };
  if (action.type === 'setActive') {
    const r = state.rooms[action.room];
    const rooms = r ? { ...state.rooms, [action.room]: { ...r, unread: 0 } } : state.rooms;
    return { ...state, active: action.room, rooms };
  }

  const msg = action.msg;
  switch (msg.t) {
    case 'welcome':
      return {
        ...state,
        nick: msg.you.nick,
        account: msg.you.account ?? null,
        status: 'online',
        available: msg.rooms,
      };

    case 'joined': {
      const events: ChatEvent[] = msg.history.map((l) => ({
        id: l.id,
        kind: 'message',
        from: l.from,
        text: l.text,
        ts: l.ts,
        self: l.from === state.nick,
      }));
      const room: RoomState = { name: msg.room, members: msg.members, events, unread: 0 };
      const order = state.order.includes(msg.room) ? state.order : [...state.order, msg.room];
      return { ...state, rooms: { ...state.rooms, [msg.room]: room }, order, active: msg.room };
    }

    case 'left': {
      const rooms = { ...state.rooms };
      delete rooms[msg.room];
      const order = state.order.filter((r) => r !== msg.room);
      const active = state.active === msg.room ? (order[order.length - 1] ?? null) : state.active;
      return { ...state, rooms, order, active };
    }

    case 'message':
      return pushEvent(state, msg.room, {
        id: msg.line.id,
        kind: 'message',
        from: msg.line.from,
        text: msg.line.text,
        ts: msg.line.ts,
        self: msg.line.from === state.nick,
      });

    case 'presence':
      return patchRoom(state, msg.room, (r) => ({ ...r, members: msg.members }));

    case 'joinNotice':
      return pushEvent(state, msg.room, makeEvent('join', `${msg.nick} joined`, msg.nick));

    case 'leaveNotice': {
      const why = msg.reason ? ` (${msg.reason})` : '';
      return pushEvent(state, msg.room, makeEvent('part', `${msg.nick} left${why}`, msg.nick));
    }

    case 'nickNotice':
      return pushEvent(state, msg.room, makeEvent('nick', `${msg.from} is now ${msg.to}`, msg.to));

    case 'nickChanged':
      return { ...state, nick: msg.nick };

    case 'system':
      return msg.room && state.rooms[msg.room]
        ? pushEvent(state, msg.room, makeEvent('system', msg.text))
        : { ...state, serverLog: [...state.serverLog, makeEvent('system', msg.text)] };

    case 'error':
      return { ...state, serverLog: [...state.serverLog, makeEvent('notice', msg.text)] };

    default:
      return state;
  }
}

export interface UseChat {
  state: AppState;
  status: ChatStatus;
  connect: (nick: string, token?: string | null) => void;
  join: (room: string) => void;
  leave: (room: string) => void;
  say: (room: string, text: string) => void;
  setActive: (room: string) => void;
  changeNick: (nick: string) => void;
}

export function useChat(): UseChat {
  const [state, dispatch] = useReducer(reducer, '', () => initialState(''));
  const clientRef = useRef<ChatClient | null>(null);
  const autoJoined = useRef(false);

  const connect = useCallback((nick: string, token?: string | null) => {
    const client = new ChatClient({
      onMessage: (msg) => dispatch({ type: 'server', msg }),
      onStatus: (status) => dispatch({ type: 'status', status }),
    });
    clientRef.current = client;
    client.connect(nick, token);
  }, []);

  // Auto-join the lobby once the server welcomes us.
  useEffect(() => {
    if (state.status === 'online' && state.nick && !autoJoined.current) {
      autoJoined.current = true;
      clientRef.current?.join(DEFAULT_ROOM);
    }
  }, [state.status, state.nick]);

  useEffect(() => () => clientRef.current?.close(), []);

  const join = useCallback((room: string) => clientRef.current?.join(room), []);
  const leave = useCallback((room: string) => clientRef.current?.leave(room), []);
  const say = useCallback((room: string, text: string) => clientRef.current?.say(room, text), []);
  const changeNick = useCallback((nick: string) => clientRef.current?.nick(nick), []);
  const setActive = useCallback((room: string) => dispatch({ type: 'setActive', room }), []);

  return { state, status: state.status, connect, join, leave, say, setActive, changeNick };
}
