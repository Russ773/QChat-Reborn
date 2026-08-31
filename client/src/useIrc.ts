import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  nickFromPrefix,
  parseMediaEvent,
  type Announcement,
  type IrcMessage,
  type MediaClientEvent,
} from '@qchat/shared';
import { IrcClient, type IrcClientStatus, type LoginCreds } from './irc/client.js';
import type { AppState, ChannelState, ChatEvent, ChatEventKind, WhoisInfo } from './types.js';

let eventSeq = 0;
const nextId = () => `e${++eventSeq}`;

function makeEvent(kind: ChatEventKind, text: string, from?: string, self = false): ChatEvent {
  return { id: nextId(), kind, text, from, ts: Date.now(), self };
}

function emptyChannel(name: string): ChannelState {
  return { name, members: [], events: [], unread: 0 };
}

const SERVER_BUFFER = '$server';

type Action =
  | { type: 'irc'; message: IrcMessage }
  | { type: 'localEcho'; channel: string; text: string }
  | { type: 'localAction'; channel: string; text: string }
  | { type: 'setActive'; buffer: string }
  | { type: 'setNick'; nick: string }
  | { type: 'setAccount'; account: string | null }
  | { type: 'setAuth'; token: string; account: string; roles: string[] }
  | { type: 'announcement'; announcement: Announcement }
  | { type: 'system'; text: string }
  | { type: 'listReset' }
  | { type: 'reset' };

function initialState(nick: string): AppState {
  return {
    nick,
    account: null,
    roles: [],
    token: null,
    latestAnnouncement: null,
    buffers: [SERVER_BUFFER],
    channels: {},
    active: SERVER_BUFFER,
    serverLog: [makeEvent('system', 'Connecting…')],
    whois: {},
    channelList: { items: [], loading: false },
  };
}

/** Merge a patch into the WHOIS record for a nick. */
function patchWhois(state: AppState, nick: string, patch: Partial<WhoisInfo>): AppState {
  const key = nick.toLowerCase();
  const prev = state.whois[key] ?? { nick, loading: true };
  return { ...state, whois: { ...state.whois, [key]: { ...prev, ...patch, nick } } };
}

/** Append an event to a channel buffer, bumping unread when it isn't active. */
function pushEvent(state: AppState, channelKey: string, event: ChatEvent): AppState {
  const channel = state.channels[channelKey];
  if (!channel) return state;
  const isActive = state.active === channelKey;
  return {
    ...state,
    channels: {
      ...state.channels,
      [channelKey]: {
        ...channel,
        events: [...channel.events, event],
        unread: isActive ? 0 : channel.unread + 1,
      },
    },
  };
}

function pushServer(state: AppState, event: ChatEvent): AppState {
  return { ...state, serverLog: [...state.serverLog, event] };
}

/** Normalize a channel name to its buffer key (case-insensitive). */
const chanKey = (name: string) => name.toLowerCase();

function stripMemberPrefix(name: string): string {
  return name.replace(/^[@%+~&]+/, '');
}

function renameEverywhere(state: AppState, oldNick: string, newNick: string): AppState {
  const channels = { ...state.channels };
  for (const key of Object.keys(channels)) {
    const ch = channels[key];
    if (ch.members.includes(oldNick)) {
      channels[key] = {
        ...ch,
        members: ch.members.map((m) => (m === oldNick ? newNick : m)),
        events: [...ch.events, makeEvent('nick', `${oldNick} is now known as ${newNick}`)],
      };
    }
  }
  return { ...state, channels };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'reset':
      return initialState(state.nick);

    case 'setNick':
      return { ...state, nick: action.nick };

    case 'setAccount':
      return { ...state, account: action.account };

    case 'setAuth':
      return { ...state, token: action.token, account: action.account, roles: action.roles };

    case 'announcement': {
      // Show it live in every joined channel, and stash it for the banner.
      const channels = { ...state.channels };
      const text = `📢 ${action.announcement.text}`;
      for (const key of Object.keys(channels)) {
        channels[key] = {
          ...channels[key],
          events: [...channels[key].events, makeEvent('announcement', text, action.announcement.by)],
        };
      }
      return { ...state, channels, latestAnnouncement: action.announcement };
    }

    case 'setActive': {
      const ch = state.channels[action.buffer];
      const channels = ch
        ? { ...state.channels, [action.buffer]: { ...ch, unread: 0 } }
        : state.channels;
      return { ...state, active: action.buffer, channels };
    }

    case 'system':
      return pushServer(state, makeEvent('system', action.text));

    case 'listReset':
      return { ...state, channelList: { items: [], loading: true } };

    case 'localEcho': {
      const key = chanKey(action.channel);
      return pushEvent(state, key, makeEvent('message', action.text, state.nick, true));
    }

    case 'localAction': {
      const key = chanKey(action.channel);
      return pushEvent(state, key, makeEvent('action', action.text, state.nick, true));
    }

    case 'irc':
      return reduceIrc(state, action.message);

    default:
      return state;
  }
}

function reduceIrc(state: AppState, message: IrcMessage): AppState {
  const from = nickFromPrefix(message.prefix) ?? undefined;
  const self = from === state.nick;

  switch (message.command) {
    case '001':
      return pushServer(state, makeEvent('system', message.params.at(-1) ?? 'Welcome'));

    case 'JOIN': {
      const name = message.params[0];
      const key = chanKey(name);
      let next = state;
      if (self && !next.channels[key]) {
        next = {
          ...next,
          buffers: [...next.buffers, key],
          channels: { ...next.channels, [key]: emptyChannel(name) },
          active: key,
        };
      }
      const ch = next.channels[key];
      if (ch && from) {
        const members = ch.members.includes(from) ? ch.members : [...ch.members, from];
        next = {
          ...next,
          channels: { ...next.channels, [key]: { ...ch, members } },
        };
        if (!self) {
          next = pushEvent(next, key, makeEvent('join', `${from} joined`, from));
        }
      }
      return next;
    }

    case 'PART': {
      const key = chanKey(message.params[0] ?? '');
      const ch = state.channels[key];
      if (!ch || !from) return state;
      const members = ch.members.filter((m) => m !== from);
      let next = {
        ...state,
        channels: { ...state.channels, [key]: { ...ch, members } },
      };
      const reason = message.params[1] ? ` (${message.params[1]})` : '';
      next = pushEvent(next, key, makeEvent('part', `${from} left${reason}`, from));
      return next;
    }

    case 'QUIT': {
      if (!from) return state;
      const reason = message.params[0] ? ` (${message.params[0]})` : '';
      const channels = { ...state.channels };
      for (const key of Object.keys(channels)) {
        const ch = channels[key];
        if (ch.members.includes(from)) {
          channels[key] = {
            ...ch,
            members: ch.members.filter((m) => m !== from),
            events: [...ch.events, makeEvent('quit', `${from} quit${reason}`, from)],
          };
        }
      }
      return { ...state, channels };
    }

    case 'NICK': {
      const newNick = message.params[0];
      if (!from || !newNick) return state;
      let next = renameEverywhere(state, from, newNick);
      if (self) next = { ...next, nick: newNick };
      return next;
    }

    case 'PRIVMSG':
    case 'NOTICE': {
      const target = message.params[0];
      const text = message.params[1] ?? '';
      const isNotice = message.command === 'NOTICE';
      const action = parseCtcpAction(text);

      if (target && (target.startsWith('#') || target.startsWith('&'))) {
        const key = chanKey(target);
        if (action !== null) {
          return pushEvent(state, key, makeEvent('action', action, from, self));
        }
        return pushEvent(
          state,
          key,
          makeEvent(isNotice ? 'notice' : 'message', text, from, self),
        );
      }
      // Direct message / server notice -> server buffer for now.
      return pushServer(state, makeEvent('notice', `${from ?? '*'}: ${text}`, from));
    }

    case '332': {
      // RPL_TOPIC: <nick> <channel> :<topic>
      const key = chanKey(message.params[1] ?? '');
      const ch = state.channels[key];
      if (!ch) return state;
      return pushEvent(state, key, makeEvent('system', `Topic: ${message.params[2] ?? ''}`));
    }

    case '353': {
      // RPL_NAMREPLY: <nick> <sym> <channel> :<names>
      const key = chanKey(message.params[2] ?? '');
      const ch = state.channels[key];
      if (!ch) return state;
      const names = (message.params[3] ?? '')
        .split(' ')
        .filter(Boolean)
        .map(stripMemberPrefix);
      const members = Array.from(new Set([...ch.members, ...names]));
      return { ...state, channels: { ...state.channels, [key]: { ...ch, members } } };
    }

    case 'MEDIA': {
      const key = chanKey(message.params[0] ?? '');
      const ch = state.channels[key];
      const event = parseMediaEvent(message.params[1] ?? '');
      if (!ch || !event || event.t !== 'state') return state;
      return { ...state, channels: { ...state.channels, [key]: { ...ch, media: event.state } } };
    }

    // --- WHOIS replies feed the right-click mini-profile (#8) ---
    case '311': {
      // RPL_WHOISUSER: <me> <nick> <user> <host> * :<realname>
      const nick = message.params[1];
      if (!nick) return state;
      return patchWhois(state, nick, {
        user: message.params[2],
        host: message.params[3],
        realname: message.params[5],
        loading: true,
      });
    }
    case '312': {
      // RPL_WHOISSERVER: <me> <nick> <server> :<info>
      const nick = message.params[1];
      return nick ? patchWhois(state, nick, { server: message.params[2] }) : state;
    }
    case '317': {
      // RPL_WHOISIDLE: <me> <nick> <idle> <signon> :...
      const nick = message.params[1];
      const idle = Number(message.params[2]);
      return nick ? patchWhois(state, nick, { idleSeconds: Number.isFinite(idle) ? idle : undefined }) : state;
    }
    case '319': {
      // RPL_WHOISCHANNELS: <me> <nick> :<channels>
      const nick = message.params[1];
      return nick ? patchWhois(state, nick, { channels: message.params[2] }) : state;
    }
    case '330': {
      // RPL_WHOISACCOUNT: <me> <nick> <account> :is logged in as
      const nick = message.params[1];
      return nick ? patchWhois(state, nick, { account: message.params[2] }) : state;
    }
    case '318': {
      // RPL_ENDOFWHOIS: <me> <nick> :End of /WHOIS
      const nick = message.params[1];
      return nick ? patchWhois(state, nick, { loading: false }) : state;
    }

    case '321':
      // RPL_LISTSTART
      return { ...state, channelList: { items: [], loading: true } };
    case '322': {
      // RPL_LIST: <me> <channel> <#users> :<topic>
      const name = message.params[1];
      if (!name) return state;
      const users = Number(message.params[2]);
      const item = { name, users: Number.isFinite(users) ? users : 0, topic: message.params[3] ?? '' };
      return { ...state, channelList: { items: [...state.channelList.items, item], loading: true } };
    }
    case '323':
      // RPL_LISTEND
      return { ...state, channelList: { ...state.channelList, loading: false } };

    // Ignore common no-op numerics; surface everything else to the server log.
    case '002':
    case '003':
    case '004':
    case '366':
    case '315':
    // Extra WHOIS detail lines (consumed by the mini-profile, not the log).
    case '276':
    case '307':
    case '310':
    case '313':
    case '320':
    case '338':
    case '378':
    case '379':
    case '671':
    case 'PONG':
    case 'CAP':
      return state;

    default:
      if (/^\d{3}$/.test(message.command)) {
        return pushServer(state, makeEvent('system', message.params.slice(1).join(' ')));
      }
      return state;
  }
}

/** Extract the text of a CTCP ACTION (/me), tolerating the server's fallback form. */
function parseCtcpAction(text: string): string | null {
  const ctcp = /^ACTION (.*)?$/.exec(text);
  if (ctcp) return ctcp[1];
  if (text.startsWith('ACTION ')) return text.slice('ACTION '.length);
  return null;
}

export interface UseIrc {
  state: AppState;
  status: IrcClientStatus;
  connect: (nick: string, creds?: LoginCreds) => void;
  reconnect: () => void;
  join: (channel: string) => void;
  part: (channel: string) => void;
  say: (channel: string, text: string) => void;
  sendMedia: (channel: string, event: MediaClientEvent) => void;
  setActive: (buffer: string) => void;
  changeNick: (nick: string) => void;
  whois: (nick: string) => void;
  listChannels: () => void;
  serverBuffer: string;
}

/** Top-level hook wiring an {@link IrcClient} to reducer-managed UI state. */
export function useIrc(): UseIrc {
  const [state, dispatch] = useReducer(reducer, '', () => initialState(''));
  const clientRef = useRef<IrcClient | null>(null);
  const autoJoinedRef = useRef(false);
  const [status, setStatus] = useReducer(
    (_: IrcClientStatus, s: IrcClientStatus) => s,
    'idle',
  );

  const lastCredsRef = useRef<LoginCreds | undefined>(undefined);

  const connect = useCallback((nick: string, creds?: LoginCreds) => {
    autoJoinedRef.current = false;
    lastCredsRef.current = creds;
    dispatch({ type: 'setNick', nick });
    dispatch({ type: 'setAccount', account: null });
    const client = new IrcClient({
      onMessage: (message) => dispatch({ type: 'irc', message }),
      onStatus: setStatus,
      onSasl: (ok, account) => {
        if (ok) {
          dispatch({ type: 'setAccount', account: account ?? null });
          dispatch({ type: 'system', text: `Logged in as ${account ?? nick}` });
        } else {
          dispatch({ type: 'system', text: 'Login failed — check your account and password' });
        }
      },
      onAuth: (token, account, roles) => dispatch({ type: 'setAuth', token, account, roles }),
      onAnnounce: (by, text) =>
        dispatch({ type: 'announcement', announcement: { id: `a${Date.now()}`, text, by, at: Date.now() } }),
    });
    clientRef.current = client;
    client.connect(nick, creds);
  }, []);

  const reconnect = useCallback(() => {
    // Replay the last connect (nick + creds) so SASL login is preserved.
    const nick = clientRef.current?.nick;
    if (nick) connect(nick, lastCredsRef.current);
  }, [connect]);

  const join = useCallback((channel: string) => {
    const name = channel.startsWith('#') ? channel : `#${channel}`;
    clientRef.current?.join(name);
  }, []);

  const part = useCallback((channel: string) => {
    clientRef.current?.part(channel);
  }, []);

  const say = useCallback((channel: string, text: string) => {
    clientRef.current?.say(channel, text);
    dispatch({ type: 'localEcho', channel, text });
  }, []);

  const sendMedia = useCallback((channel: string, event: MediaClientEvent) => {
    clientRef.current?.media(channel, event);
  }, []);

  const changeNick = useCallback((nick: string) => {
    clientRef.current?.changeNick(nick);
  }, []);

  const whois = useCallback((nick: string) => {
    clientRef.current?.whois(nick);
  }, []);

  const listChannels = useCallback(() => {
    dispatch({ type: 'listReset' });
    clientRef.current?.list();
  }, []);

  const setActive = useCallback((buffer: string) => {
    dispatch({ type: 'setActive', buffer });
  }, []);

  // Auto-join the main channel once registered (#4).
  useEffect(() => {
    if (status === 'registered' && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      clientRef.current?.join('#Lobby');
    }
  }, [status]);

  useEffect(() => {
    return () => clientRef.current?.quit();
  }, []);

  return {
    state,
    status,
    connect,
    reconnect,
    join,
    part,
    say,
    sendMedia,
    setActive,
    changeNick,
    whois,
    listChannels,
    serverBuffer: SERVER_BUFFER,
  };
}
