import type { Announcement, MediaState } from '@qchat/shared';

export type ChatEventKind =
  | 'message'
  | 'action'
  | 'notice'
  | 'system'
  | 'join'
  | 'part'
  | 'quit'
  | 'nick'
  | 'announcement';

export interface ChatEvent {
  id: string;
  kind: ChatEventKind;
  from?: string;
  text: string;
  ts: number;
  /** True when the local user is the author. */
  self?: boolean;
}

export interface ChannelState {
  name: string;
  members: string[];
  events: ChatEvent[];
  media?: MediaState;
  /** Unread count while the channel is not active. */
  unread: number;
}

/** WHOIS-derived profile for the right-click mini-profile (#8). */
export interface WhoisInfo {
  nick: string;
  user?: string;
  host?: string;
  realname?: string;
  /** Services account the user is logged in as (RPL_WHOISACCOUNT 330). */
  account?: string;
  channels?: string;
  server?: string;
  idleSeconds?: number;
  loading: boolean;
}

export interface AppState {
  nick: string;
  /** NickServ account once SASL login succeeds (#9), else null. */
  account: string | null;
  /** Roles for the logged-in account (e.g. "admin"), from the gateway. */
  roles: string[];
  /** API bearer token minted by the gateway after SASL (null for guests). */
  token: string | null;
  /** Most recent live announcement, for the top banner (#5). */
  latestAnnouncement: Announcement | null;
  /** Ordered list of channel names (buffers), including the server buffer. */
  buffers: string[];
  channels: Record<string, ChannelState>;
  active: string | null;
  /** Server/system buffer messages (numerics, notices, errors). */
  serverLog: ChatEvent[];
  /** WHOIS results keyed by lowercased nick. */
  whois: Record<string, WhoisInfo>;
}
