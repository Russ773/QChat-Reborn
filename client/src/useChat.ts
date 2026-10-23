import { useCallback, useEffect, useReducer, useRef } from 'react';
import { mentions, type ChatLine, type Dm, type ServerMsg } from '@qchat/shared';
import { ChatClient, type ChatStatus } from './chat/client.js';
import { soundLabel } from './media/sounds.js';
import {
  dmKey,
  isDmKey,
  type AppState,
  type ChatEvent,
  type ChatEventKind,
  type DmState,
  type RoomState,
} from './types.js';

export const DEFAULT_ROOM = '#lobby';

const roomsKey = (account: string) => `qchat_rooms_${account.toLowerCase()}`;

/** The rooms this account was in last time (stored in this browser). */
function loadSavedRooms(account: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(roomsKey(account)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  } catch {
    return [];
  }
}

function saveRooms(account: string, rooms: string[]): void {
  try {
    localStorage.setItem(roomsKey(account), JSON.stringify(rooms));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

let seq = 0;
let soundSeq = 0;
let announceSeq = 0;
let alertSeq = 0;

function makeEvent(kind: ChatEventKind, text: string, from?: string, self?: boolean): ChatEvent {
  return { id: `e${Date.now()}-${seq++}`, kind, text, from, ts: Date.now(), self };
}

/** Turn a saved line into a display event. `inRoom` is false for private chats, where nothing needs a mention highlight. */
const lineToEvent = (l: ChatLine | Dm, me: string, inRoom = true): ChatEvent => ({
  id: l.id,
  seq: l.seq,
  kind: l.kind === 'action' ? 'action' : 'message',
  from: l.from,
  text: l.text,
  ts: l.ts,
  self: l.from === me,
  bot: 'bot' in l && l.bot ? true : undefined,
  edited: 'edited' in l ? l.edited : undefined,
  mention: inRoom && l.from !== me && mentions(l.text, me),
  replyTo: 'replyTo' in l ? l.replyTo : undefined,
  image: 'image' in l ? l.image : undefined,
  reactions: 'reactions' in l ? l.reactions : undefined,
});

/** Put older events before the ones we already have, without duplicates. */
const prepend = (older: ChatEvent[], existing: ChatEvent[]): ChatEvent[] => {
  const have = new Set(existing.map((e) => e.id));
  return [...older.filter((e) => !have.has(e.id)), ...existing];
};

function initialState(nick: string): AppState {
  return {
    nick,
    account: null,
    status: 'idle',
    roomList: [],
    rooms: {},
    order: [],
    dms: {},
    threads: [],
    active: null,
    serverLog: [makeEvent('system', 'Connecting…')],
    announcement: null,
    lastSound: null,
    alert: null,
    friends: [],
    requests: { incoming: [], outgoing: [] },
    roomAdmin: null,
  };
}

type Action =
  | { type: 'server'; msg: ServerMsg }
  | { type: 'status'; status: ChatStatus }
  | { type: 'setActive'; key: string }
  | { type: 'openDm'; name: string }
  | { type: 'clearRoom'; room: string }
  | { type: 'clearSearch'; room: string }
  | { type: 'closeRoomAdmin' }
  | { type: 'loadingMore'; key: string }
  | { type: 'dismissAnnouncement' };

function patchRoom(state: AppState, name: string, fn: (r: RoomState) => RoomState): AppState {
  const room = state.rooms[name];
  if (!room) return state;
  return { ...state, rooms: { ...state.rooms, [name]: fn(room) } };
}

function patchDm(state: AppState, key: string, fn: (d: DmState) => DmState): AppState {
  const dm = state.dms[key];
  if (!dm) return state;
  return { ...state, dms: { ...state.dms, [key]: fn(dm) } };
}

const newDm = (name: string): DmState => ({ with: name, events: [], more: false, loadingMore: false, loaded: false, typingUntil: 0 });

/** Add an event to a room, tracking unread and mention counts when you are not looking at it. */
function pushEvent(state: AppState, name: string, event: ChatEvent): AppState {
  return patchRoom(state, name, (r) => {
    const looking = state.active === name;
    return {
      ...r,
      events: [...r.events, event],
      unread: looking ? 0 : r.unread + 1,
      mentions: looking ? 0 : r.mentions + (event.mention ? 1 : 0),
    };
  });
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status };

    case 'dismissAnnouncement':
      return { ...state, announcement: null };

    case 'clearRoom':
      return patchRoom(state, action.room, (r) => ({ ...r, events: [], more: false }));

    case 'clearSearch':
      return patchRoom(state, action.room, (r) => ({ ...r, search: null }));

    case 'closeRoomAdmin':
      return { ...state, roomAdmin: null };

    case 'loadingMore':
      return isDmKey(action.key)
        ? patchDm(state, action.key, (d) => ({ ...d, loadingMore: true }))
        : patchRoom(state, action.key, (r) => ({ ...r, loadingMore: true }));

    case 'openDm': {
      const key = dmKey(action.name);
      const dms = state.dms[key] ? state.dms : { ...state.dms, [key]: newDm(action.name) };
      return { ...state, dms, active: key };
    }

    case 'setActive': {
      if (isDmKey(action.key)) {
        const known = state.threads.find((t) => dmKey(t.with) === action.key)?.with ?? action.key.slice(1);
        const dms = state.dms[action.key] ? state.dms : { ...state.dms, [action.key]: newDm(known) };
        return { ...state, dms, active: action.key };
      }
      const r = state.rooms[action.key];
      const rooms = r ? { ...state.rooms, [action.key]: { ...r, unread: 0, mentions: 0 } } : state.rooms;
      return { ...state, active: action.key, rooms };
    }

    case 'server':
      break;
  }

  const msg = action.msg;
  const me = state.nick;
  switch (msg.t) {
    case 'welcome':
      return { ...state, nick: msg.you.nick, account: msg.you.account ?? null, status: 'online' };

    case 'rooms':
      return { ...state, roomList: msg.rooms };

    case 'joined': {
      const room: RoomState = {
        name: msg.room,
        members: msg.members,
        events: msg.history.map((l) => lineToEvent(l, me)),
        unread: 0,
        mentions: 0,
        media: state.rooms[msg.room]?.media ?? null,
        topic: msg.topic,
        roles: msg.roles,
        away: msg.away,
        bots: msg.bots,
        more: msg.more,
        loadingMore: false,
        typing: {},
        search: null,
      };
      const isNew = !state.order.includes(msg.room);
      const order = isNew ? [...state.order, msg.room] : state.order;
      // Joining something new takes you there; quietly rejoining after a reconnect does not.
      const active = isNew || state.active === null ? msg.room : state.active;
      return { ...state, rooms: { ...state.rooms, [msg.room]: room }, order, active };
    }

    case 'left': {
      const rooms = { ...state.rooms };
      delete rooms[msg.room];
      const order = state.order.filter((r) => r !== msg.room);
      const active = state.active === msg.room ? (order[order.length - 1] ?? null) : state.active;
      return { ...state, rooms, order, active };
    }

    case 'message': {
      const ev = lineToEvent(msg.line, me);
      let next = pushEvent(state, msg.room, ev);
      // The sender has stopped typing.
      next = patchRoom(next, msg.room, (r) => {
        if (!(msg.line.from in r.typing)) return r;
        const typing = { ...r.typing };
        delete typing[msg.line.from];
        return { ...r, typing };
      });
      if (ev.mention) {
        next = { ...next, alert: { id: ++alertSeq, kind: 'mention', from: msg.line.from, text: msg.line.text } };
      }
      return next;
    }

    case 'reactions':
      return patchRoom(state, msg.room, (r) => ({
        ...r,
        events: r.events.map((e) => (e.id === msg.id ? { ...e, reactions: msg.reactions } : e)),
        // Keep any open search results in step too.
        search: r.search
          ? { ...r.search, events: r.search.events.map((e) => (e.id === msg.id ? { ...e, reactions: msg.reactions } : e)) }
          : null,
      }));

    case 'searchResults':
      return patchRoom(state, msg.room, (r) => ({
        ...r,
        search: { q: msg.q, events: msg.lines.map((l) => lineToEvent(l, me)) },
      }));

    case 'roomAdmin':
      return { ...state, roomAdmin: { room: msg.room, owner: msg.owner, bans: msg.bans, mods: msg.mods, mutes: msg.mutes } };

    case 'friends':
      return { ...state, friends: msg.friends, requests: { incoming: msg.incoming, outgoing: msg.outgoing } };

    case 'info':
      // A friendly confirmation: shown as a toast, like an error but not alarming.
      return { ...state, serverLog: [...state.serverLog, makeEvent('notice', msg.text)] };

    case 'history':
      return patchRoom(state, msg.room, (r) => ({
        ...r,
        events: prepend(msg.lines.map((l) => lineToEvent(l, me)), r.events),
        more: msg.more,
        loadingMore: false,
      }));

    case 'presence':
      return patchRoom(state, msg.room, (r) => ({ ...r, members: msg.members, roles: msg.roles, away: msg.away, bots: msg.bots }));

    case 'topic':
      return patchRoom(state, msg.room, (r) => ({ ...r, topic: msg.topic }));

    case 'typing':
      return patchRoom(state, msg.room, (r) => ({ ...r, typing: { ...r.typing, [msg.nick]: Date.now() + 4000 } }));

    case 'edited':
      return patchRoom(state, msg.room, (r) => ({
        ...r,
        events: r.events.map((e) => (e.id === msg.id ? { ...e, text: msg.text, edited: msg.edited } : e)),
      }));

    case 'deleted':
      return patchRoom(state, msg.room, (r) => ({ ...r, events: r.events.filter((e) => e.id !== msg.id) }));

    case 'media':
      return patchRoom(state, msg.room, (r) => ({ ...r, media: msg.state }));

    case 'announce': {
      let next = state;
      const targets = msg.room ? [msg.room] : Object.keys(state.rooms);
      for (const r of targets) {
        next = pushEvent(next, r, makeEvent('announcement', `📢 ${msg.by}: ${msg.text}`, msg.by));
      }
      return { ...next, announcement: { id: ++announceSeq, text: msg.text, by: msg.by } };
    }

    case 'sound': {
      const ev = makeEvent('system', `${msg.from} played ${soundLabel(msg.sound)} 🔊`, msg.from);
      const next = state.rooms[msg.room] ? pushEvent(state, msg.room, ev) : state;
      return { ...next, lastSound: { id: ++soundSeq, room: msg.room, sound: msg.sound, from: msg.from } };
    }

    case 'joinNotice':
      return pushEvent(state, msg.room, makeEvent('join', `${msg.nick} joined`, msg.nick));

    case 'leaveNotice': {
      const why = msg.reason ? ` (${msg.reason})` : '';
      return pushEvent(state, msg.room, makeEvent('part', `${msg.nick} left${why}`, msg.nick));
    }

    // --- Private messages ---
    case 'dms':
      return { ...state, threads: msg.threads };

    case 'dm': {
      const m = msg.msg;
      const mine = m.from.toLowerCase() === me.toLowerCase();
      const other = mine ? m.to : m.from;
      const key = dmKey(other);
      const viewing = state.active === key;
      const ev = lineToEvent(m, me, false);

      const dm = state.dms[key] ?? newDm(other);
      const dms = {
        ...state.dms,
        [key]: { ...dm, with: other, events: dm.events.some((e) => e.id === ev.id) ? dm.events : [...dm.events, ev], typingUntil: 0 },
      };

      const prev = state.threads.find((t) => dmKey(t.with) === key);
      const thread = {
        with: other,
        last: m.kind === 'action' ? `* ${m.text}` : m.text,
        ts: m.ts,
        unread: (prev?.unread ?? 0) + (!mine && !viewing ? 1 : 0),
      };
      const threads = [thread, ...state.threads.filter((t) => dmKey(t.with) !== key)];

      const next = { ...state, dms, threads };
      return mine
        ? next
        : { ...next, alert: viewing && !document.hidden ? next.alert : { id: ++alertSeq, kind: 'dm', from: other, text: m.text } };
    }

    case 'dmHistory': {
      const key = dmKey(msg.with);
      const base = state.dms[key] ? state : { ...state, dms: { ...state.dms, [key]: newDm(msg.with) } };
      return patchDm(base, key, (d) => ({
        ...d,
        with: msg.with,
        events: prepend(msg.lines.map((l) => lineToEvent(l, me, false)), d.events),
        more: msg.more,
        loaded: true,
        loadingMore: false,
      }));
    }

    case 'dmTyping':
      return patchDm(state, dmKey(msg.from), (d) => ({ ...d, typingUntil: Date.now() + 4000 }));

    case 'dmNotice': {
      const key = dmKey(msg.with);
      return patchDm(state, key, (d) => ({ ...d, events: [...d.events, makeEvent('system', msg.text)] }));
    }

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
  reconnect: () => void;
  join: (room: string, topic?: string) => void;
  leave: (room: string) => void;
  say: (room: string, text: string, extra?: { replyTo?: string; image?: string }) => void;
  react: (room: string, id: string, emoji: string) => void;
  report: (room: string, id: string, reason?: string) => void;
  search: (room: string, q: string) => void;
  clearSearch: (room: string) => void;
  openRoomAdmin: (room: string) => void;
  closeRoomAdmin: () => void;
  friendRequest: (to: string) => void;
  friendRespond: (from: string, accept: boolean) => void;
  friendRemove: (who: string) => void;
  setActive: (key: string) => void;
  playSound: (room: string, sound: string) => void;
  playYouTube: (room: string, ref: string, title?: string) => void;
  mediaControl: (room: string, op: 'pause' | 'resume' | 'seek' | 'stop', pos?: number) => void;
  listRooms: () => void;
  dismissAnnouncement: () => void;
  loadEarlier: (key: string) => void;
  typing: (key: string) => void;
  editMessage: (room: string, id: string, text: string) => void;
  deleteMessage: (room: string, id: string) => void;
  clearRoom: (room: string) => void;
  openDm: (name: string) => void;
  sendDm: (to: string, text: string) => void;
}

export function useChat(): UseChat {
  const [state, dispatch] = useReducer(reducer, '', () => initialState(''));
  const clientRef = useRef<ChatClient | null>(null);
  const credsRef = useRef<{ nick: string; token?: string | null } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const attempts = useRef(0);
  const lastErrorAt = useRef(0);
  const requestedDm = useRef(new Set<string>());
  const persistRooms = useRef(false);

  const connect = useCallback((nick: string, token?: string | null) => {
    credsRef.current = { nick, token };
    clientRef.current?.close();
    const client = new ChatClient({
      onMessage: (msg) => {
        if (msg.t === 'welcome') attempts.current = 0;
        if (msg.t === 'error') lastErrorAt.current = Date.now();
        dispatch({ type: 'server', msg });
      },
      onStatus: (status) => dispatch({ type: 'status', status }),
    });
    clientRef.current = client;
    client.connect(nick, token);
  }, []);

  const reconnect = useCallback(() => {
    const c = credsRef.current;
    if (c) connect(c.nick, c.token);
  }, [connect]);

  // Once welcomed: rejoin the rooms you were in (after a reconnect, or from your last visit),
  // or start in the lobby. Remembered rooms are rejoined quietly.
  useEffect(() => {
    if (state.status === 'online' && state.nick) {
      const now = stateRef.current.order;
      const saved = loadSavedRooms(stateRef.current.account ?? state.nick);
      const rooms = now.length ? now : saved.length ? saved : [DEFAULT_ROOM];
      // A brand new member starts in the lobby with a normal join (so QBot can welcome them);
      // everything remembered is rejoined quietly.
      const firstVisit = now.length === 0 && saved.length === 0;
      for (const r of rooms) clientRef.current?.join(r, !firstVisit);
      persistRooms.current = true;
      requestedDm.current.clear();
    }
  }, [state.status, state.nick]);

  // Remember your rooms for next time.
  useEffect(() => {
    if (persistRooms.current && state.account) saveRooms(state.account, state.order);
  }, [state.order, state.account]);

  // Try again by itself if the connection drops (unless the server turned us away on purpose).
  useEffect(() => {
    if (state.status !== 'closed' && state.status !== 'error') return;
    if (!credsRef.current || !stateRef.current.nick) return;
    if (Date.now() - lastErrorAt.current < 2000) return;
    const delay = Math.min(15000, 1500 * 2 ** attempts.current);
    const t = window.setTimeout(() => {
      attempts.current += 1;
      reconnect();
    }, delay);
    return () => window.clearTimeout(t);
  }, [state.status, reconnect]);

  // Opening a private chat loads its saved history, and viewing it marks it read.
  const active = state.active;
  const activeDm = isDmKey(active) ? state.dms[active] : undefined;
  const activeUnread = activeDm ? (state.threads.find((t) => dmKey(t.with) === active)?.unread ?? 0) : 0;
  useEffect(() => {
    if (!activeDm || state.status !== 'online') return;
    if (!activeDm.loaded && !requestedDm.current.has(activeDm.with.toLowerCase())) {
      requestedDm.current.add(activeDm.with.toLowerCase());
      clientRef.current?.dmHistory(activeDm.with);
    }
    if (activeUnread > 0) clientRef.current?.dmRead(activeDm.with);
  }, [activeDm?.with, activeDm?.loaded, activeUnread, state.status]);

  useEffect(() => () => clientRef.current?.close(), []);

  const join = useCallback((room: string, topic?: string) => clientRef.current?.join(room, false, topic), []);
  const leave = useCallback((room: string) => clientRef.current?.leave(room), []);
  const say = useCallback(
    (room: string, text: string, extra?: { replyTo?: string; image?: string }) => clientRef.current?.say(room, text, extra),
    [],
  );
  const react = useCallback((room: string, id: string, emoji: string) => clientRef.current?.react(room, id, emoji), []);
  const report = useCallback((room: string, id: string, reason?: string) => clientRef.current?.report(room, id, reason), []);
  const search = useCallback((room: string, q: string) => clientRef.current?.search(room, q), []);
  const clearSearch = useCallback((room: string) => dispatch({ type: 'clearSearch', room }), []);
  const openRoomAdmin = useCallback((room: string) => clientRef.current?.roomAdmin(room), []);
  const closeRoomAdmin = useCallback(() => dispatch({ type: 'closeRoomAdmin' }), []);
  const friendRequest = useCallback((to: string) => clientRef.current?.friendRequest(to), []);
  const friendRespond = useCallback((from: string, accept: boolean) => clientRef.current?.friendRespond(from, accept), []);
  const friendRemove = useCallback((who: string) => clientRef.current?.friendRemove(who), []);
  const setActive = useCallback((key: string) => dispatch({ type: 'setActive', key }), []);
  const playSound = useCallback((room: string, sound: string) => clientRef.current?.playSound(room, sound), []);
  const listRooms = useCallback(() => clientRef.current?.listRooms(), []);
  const dismissAnnouncement = useCallback(() => dispatch({ type: 'dismissAnnouncement' }), []);
  const playYouTube = useCallback(
    (room: string, ref: string, title?: string) => clientRef.current?.playYouTube(room, ref, title),
    [],
  );
  const mediaControl = useCallback(
    (room: string, op: 'pause' | 'resume' | 'seek' | 'stop', pos?: number) => clientRef.current?.mediaControl(room, op, pos),
    [],
  );

  const loadEarlier = useCallback((key: string) => {
    const s = stateRef.current;
    if (isDmKey(key)) {
      const d = s.dms[key];
      const first = d?.events.find((e) => e.seq !== undefined)?.seq;
      if (!d || d.loadingMore || !first) return;
      dispatch({ type: 'loadingMore', key });
      clientRef.current?.dmHistory(d.with, first);
    } else {
      const r = s.rooms[key];
      const first = r?.events.find((e) => e.seq !== undefined)?.seq;
      if (!r || r.loadingMore || !first) return;
      dispatch({ type: 'loadingMore', key });
      clientRef.current?.history(key, first);
    }
  }, []);

  const typing = useCallback((key: string) => {
    if (isDmKey(key)) clientRef.current?.dmTyping(stateRef.current.dms[key]?.with ?? key.slice(1));
    else clientRef.current?.typing(key);
  }, []);

  const editMessage = useCallback((room: string, id: string, text: string) => clientRef.current?.edit(room, id, text), []);
  const deleteMessage = useCallback((room: string, id: string) => clientRef.current?.remove(room, id), []);
  const clearRoom = useCallback((room: string) => dispatch({ type: 'clearRoom', room }), []);
  const openDm = useCallback((name: string) => dispatch({ type: 'openDm', name }), []);
  const sendDm = useCallback((to: string, text: string) => clientRef.current?.dm(to, text), []);

  return {
    state,
    status: state.status,
    connect,
    reconnect,
    join,
    leave,
    say,
    react,
    report,
    search,
    clearSearch,
    openRoomAdmin,
    closeRoomAdmin,
    friendRequest,
    friendRespond,
    friendRemove,
    setActive,
    playSound,
    playYouTube,
    mediaControl,
    listRooms,
    dismissAnnouncement,
    loadEarlier,
    typing,
    editMessage,
    deleteMessage,
    clearRoom,
    openDm,
    sendDm,
  };
}
