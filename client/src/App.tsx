import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BotInfo, Profile, RoomRole } from '@qchat/shared';
import { dmKey, isDmKey, type ChatEvent } from './types.js';
import {
  fetchMyData,
  getProfile,
  getToken,
  logout,
  me,
  saveProfile,
  setToken,
  uploadAvatar,
  uploadImage,
  type AuthResult,
  type Role,
} from './api.js';
import { adminApi } from './admin/adminApi.js';
import { AdminPage } from './admin/AdminPage.js';
import { Avatar } from './components/Avatar.js';
import { BotModal } from './components/BotModal.js';
import { ConfirmModal } from './components/ConfirmModal.js';
import { ContextMenu, type MenuItem } from './components/ContextMenu.js';
import { Conversation } from './components/Conversation.js';
import { Gate } from './components/Gate.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { MediaPanel } from './components/MediaPanel.js';
import { NewMessageModal } from './components/NewMessageModal.js';
import { PasswordModal } from './components/PasswordModal.js';
import { DeleteAccountModal } from './components/DeleteAccountModal.js';
import { PreferencesModal } from './components/PreferencesModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { ReportModal } from './components/ReportModal.js';
import { RoomSettingsModal } from './components/RoomSettingsModal.js';
import { RoomsModal } from './components/RoomsModal.js';
import { RoomTabs } from './components/RoomTabs.js';
import { SearchPanel } from './components/SearchPanel.js';
import { SoundPicker } from './components/SoundPicker.js';
import { playSound as playSoundFx } from './media/sounds.js';
import { showDesktopNotification } from './notify.js';
import { useAvatars } from './useAvatars.js';
import { useChat } from './useChat.js';

interface ModalTarget {
  account: string;
  profile: Profile | null;
  editable: boolean;
  allowPm: boolean;
}

/** Opened as its own small window ("pop-out chat")? Then it also says which room or chat to show first. */
const POPOUT = new URLSearchParams(window.location.search).get('popout') === '1';
const POPOUT_FOCUS = new URLSearchParams(window.location.search).get('focus') ?? '';

const isAdminPath = () => window.location.pathname.replace(/\/+$/, '') === '/admin';
const roomLabel = (name: string) => name.replace(/^#/, '');
const roleRank = (r?: RoomRole) => (r === 'admin' ? 4 : r === 'owner' ? 3 : r === 'mod' ? 2 : 0);
const ROLE_ICON: Record<RoomRole, string> = { admin: '⭐', owner: '👑', mod: '🛡️' };
const ROLE_NAME: Record<RoomRole, string> = { admin: 'Admin', owner: 'Room owner', mod: 'Moderator' };

export default function App() {
  const chat = useChat();
  const { state, status } = chat;
  const { avatarFor, setAvatar } = useAvatars();
  const [token, setTok] = useState<string | null>(getToken());
  const [role, setRole] = useState<Role | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'admin'>(() => (isAdminPath() ? 'admin' : 'chat'));
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searching, setSearching] = useState(false);
  // On a narrow screen (a phone, or the pop-out) the menu and the member list slide in over the chat.
  const [drawer, setDrawer] = useState<'menu' | 'members' | null>(null);
  const focused = useRef(false);
  const [reporting, setReporting] = useState<{ room: string; msg: ChatEvent } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<React.ComponentProps<typeof ConfirmModal> | null>(null);
  const [botCard, setBotCard] = useState<BotInfo | null>(null);
  const [autoplay, setAutoplay] = useState(true);

  // Keep the page address and the view in step (so /admin works and Back works).
  const go = useCallback((next: 'chat' | 'admin') => {
    setView(next);
    const path = next === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, []);
  useEffect(() => {
    const onPop = () => setView(isAdminPath() ? 'admin' : 'chat');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Only admins get the admin area; anyone else landing on /admin goes to the chat.
  useEffect(() => {
    if (view === 'admin' && role && role !== 'admin') go('chat');
  }, [view, role, go]);

  // Switching to another room or chat closes room-specific panels.
  useEffect(() => {
    setSearching(false);
    setShowSettings(false);
    setDrawer(null);
  }, [state.active]);

  // Surface server messages (bad room name, "friend request sent"...) as a short toast.
  const lastLog = state.serverLog[state.serverLog.length - 1];
  useEffect(() => {
    if (lastLog?.kind !== 'notice') return;
    setToast(lastLog.text);
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [lastLog?.id]);

  // Play incoming sounds (your own always play; others respect autoplay).
  useEffect(() => {
    const ls = state.lastSound;
    if (ls && (autoplay || ls.from === state.nick)) playSoundFx(ls.sound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastSound?.id]);

  // A mention or a new private message: a soft sound, and a desktop notification if allowed.
  useEffect(() => {
    const a = state.alert;
    if (!a) return;
    if (autoplay) playSoundFx(a.kind === 'dm' ? 'ding' : 'pop');
    showDesktopNotification(a.kind === 'dm' ? `Message from ${a.from}` : `${a.from} mentioned you`, a.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.alert?.id]);

  // Unread private messages, mentions and friend requests show in the browser tab.
  const unreadDms = state.threads.reduce((n, t) => n + t.unread, 0);
  const unreadMentions = Object.values(state.rooms).reduce((n, r) => n + r.mentions, 0);
  const attention = unreadDms + unreadMentions + state.requests.incoming.length;
  useEffect(() => {
    const where = POPOUT && state.active ? `${state.active.replace(/^[#@]/, '')} | ` : '';
    document.title = attention > 0 ? `(${attention}) ${where}QChat Reborn` : `${where}QChat Reborn`;
  }, [attention, state.active]);

  // A pop-out window opens on the room or private chat it was launched from.
  useEffect(() => {
    if (!POPOUT || focused.current || state.status !== 'online' || !POPOUT_FOCUS) return;
    if (POPOUT_FOCUS.startsWith('@')) {
      focused.current = true;
      chat.openDm(POPOUT_FOCUS.slice(1));
    } else if (state.rooms[POPOUT_FOCUS]) {
      focused.current = true;
      chat.setActive(POPOUT_FOCUS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.rooms]);

  // Show your own photo wherever your name appears.
  useEffect(() => {
    if (state.account && myProfile) setAvatar(state.account, myProfile.avatar);
  }, [state.account, myProfile?.avatar, setAvatar]);

  // Resume a stored session on first load.
  useEffect(() => {
    const t = getToken();
    if (!t) return;
    let cancelled = false;
    me(t)
      .then((res) => {
        if (cancelled) return;
        setMyProfile(res.profile);
        setRole(res.role);
        setAutoplay(res.prefs?.autoplay ?? true);
        chat.connect(res.account, t);
        setBooting(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setToken(null);
        setTok(null);
        if (err.message !== 'Not logged in.') setGateNotice(err.message);
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAuthed = (res: AuthResult) => {
    setGateNotice(null);
    setToken(res.token);
    setTok(res.token);
    setRole(res.role);
    setMyProfile(res.profile);
    chat.connect(res.account, res.token);
    me(res.token).then((r) => setAutoplay(r.prefs?.autoplay ?? true)).catch(() => {});
  };
  const doLogout = () => {
    if (token) logout(token);
    setToken(null);
    window.location.assign('/');
  };

  /** Open this chat in its own small window, so it stays in view while you browse elsewhere. */
  const openPopout = () => {
    // No "noopener": the new window copies this window's login, so you do not sign in again.
    // A roomy window (about 1260 x 780) that fits on smaller screens, a little in from the top left of this one.
    const width = Math.min(1260, Math.max(520, window.screen.availWidth - 120));
    const height = Math.min(780, Math.max(480, window.screen.availHeight - 160));
    const left = Math.round(window.screenX + 40);
    const top = Math.round(window.screenY + 40);
    const w = window.open(
      `/?popout=1&focus=${encodeURIComponent(state.active ?? '')}`,
      'qchat-popout',
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (w) w.focus();
    else setToast('Your browser blocked the pop-out window. Allow pop-ups for this site, then try again.');
  };

  const openOwnProfile = () => {
    if (state.account) setModal({ account: state.account, profile: myProfile, editable: true, allowPm: true });
  };
  const openMember = (nick: string) => {
    const editable = !!state.account && state.account.toLowerCase() === nick.toLowerCase();
    getProfile(nick)
      .then((r) => setModal({ account: nick, profile: r.profile, editable, allowPm: r.allowPm }))
      .catch(() => setModal({ account: nick, profile: null, editable, allowPm: true }));
  };
  const onSaveProfile = async (patch: Partial<Profile>) => {
    if (!token) throw new Error('Not logged in.');
    const p = await saveProfile(token, patch);
    setMyProfile(p);
    setModal((m) => (m ? { ...m, profile: p } : m));
  };
  const onUploadAvatar = async (file: File): Promise<string> => {
    if (!token) throw new Error('Not logged in.');
    const url = await uploadAvatar(token, file);
    setMyProfile((p) => ({ ...(p ?? { account: state.account! }), avatar: url }));
    setModal((m) => (m ? { ...m, profile: { ...(m.profile ?? { account: m.account }), avatar: url } } : m));
    return url;
  };

  const friendStatus = (name: string): 'none' | 'friends' | 'sent' | 'incoming' => {
    const l = name.toLowerCase();
    if (state.friends.some((f) => f.name.toLowerCase() === l)) return 'friends';
    if (state.requests.outgoing.some((n) => n.toLowerCase() === l)) return 'sent';
    if (state.requests.incoming.some((n) => n.toLowerCase() === l)) return 'incoming';
    return 'none';
  };

  // Conversations to list in the sidebar: the saved ones, plus any chat you just opened.
  const dmList = useMemo(() => {
    const seen = new Set(state.threads.map((t) => dmKey(t.with)));
    const fresh = Object.entries(state.dms)
      .filter(([k]) => !seen.has(k))
      .map(([, d]) => ({ with: d.with, last: '', ts: 0, unread: 0 }));
    return [...fresh, ...state.threads];
  }, [state.threads, state.dms]);

  if (booting) return <Splash />;
  if (status === 'idle' || state.nick === '') {
    const serverNotice = lastLog?.kind === 'notice' ? lastLog.text : null;
    return <Gate onAuthed={onAuthed} notice={gateNotice ?? serverNotice} />;
  }
  if (view === 'admin' && role === 'admin' && token) {
    return <AdminPage token={token} me={state.nick} onBack={() => go('chat')} />;
  }

  const active = state.active;
  const room = active && !isDmKey(active) ? state.rooms[active] : null;
  const dm = isDmKey(active) ? state.dms[active] : null;
  const myRank = room ? roleRank(room.roles[state.nick]) : 0;
  const disconnected = status === 'closed' || status === 'error';
  const ann = state.announcement;

  /** Moderator buttons for a member's profile, limited to what you are allowed to do to them. */
  const modToolsFor = (target: string) => {
    if (!room || myRank < 2 || target.toLowerCase() === state.nick.toLowerCase()) return undefined;
    const theirs = roleRank(room.roles[target]);
    if (theirs >= myRank) return undefined;
    const run = (cmd: string) => () => {
      chat.say(room.name, cmd);
      setModal(null);
    };
    const tools = [
      { label: 'Kick', run: run(`/kick ${target}`), danger: true },
      { label: 'Mute 10 min', run: run(`/mute ${target} 10`), danger: true },
      { label: 'Mute 1 hour', run: run(`/mute ${target} 60`), danger: true },
      { label: 'Unmute', run: run(`/unmute ${target}`), danger: false },
      {
        label: 'Ban',
        danger: true,
        run: () =>
          setConfirm({
            title: `Ban ${target}?`,
            message: `${target} will be removed from ${roomLabel(room.name)} and cannot come back until you unban them.`,
            confirmLabel: 'Ban',
            danger: true,
            onConfirm: () => {
              chat.say(room.name, `/ban ${target}`);
              setModal(null);
            },
            onClose: () => setConfirm(null),
          }),
      },
    ];
    if (myRank >= 3) {
      tools.push(
        theirs === 2
          ? { label: 'Remove moderator', run: run(`/unmod ${target}`), danger: false }
          : { label: 'Make moderator', run: run(`/mod ${target}`), danger: false },
      );
    }
    return tools;
  };

  /** Site-wide actions, for administrators only. */
  const siteAdminTools = (target: string) => {
    if (role !== 'admin' || !token || target.toLowerCase() === state.nick.toLowerCase()) return [];
    if (room?.roles[target] === 'admin') return []; // demote an admin before acting on them
    const done = (msg: string) => setToast(msg);
    const fail = (e: Error) => setToast(e.message);
    return [
      {
        label: 'Suspend account…',
        danger: true,
        run: () =>
          setConfirm({
            title: `Suspend ${target}?`,
            message: `${target} will be logged out and cannot log in until you unsuspend them in the admin area.`,
            confirmLabel: 'Suspend',
            danger: true,
            askReason: true,
            onConfirm: (reason) =>
              adminApi.suspend(token, target, true, reason || undefined).then(() => done(`${target} was suspended.`)).catch(fail),
            onClose: () => setConfirm(null),
          }),
      },
      {
        label: 'Log out everywhere',
        danger: false,
        run: () => adminApi.forceLogout(token, target).then(() => done(`${target} was logged out.`)).catch(fail),
      },
    ];
  };

  /** The right-click menu for someone in the Members list. */
  const openMemberMenu = (target: string, x: number, y: number) => {
    const self = target.toLowerCase() === state.nick.toLowerCase();
    const items: MenuItem[] = [{ label: 'View profile', icon: '👤', onClick: () => openMember(target) }];
    if (!self) {
      items.push({ label: 'Send message', icon: '✉️', onClick: () => chat.openDm(target) });
      const fs = friendStatus(target);
      if (fs === 'none') items.push({ label: 'Add friend', icon: '➕', onClick: () => chat.friendRequest(target) });
      if (fs === 'incoming') items.push({ label: 'Accept friend request', icon: '✅', onClick: () => chat.friendRespond(target, true) });
      if (fs === 'friends') items.push({ label: 'Remove friend', icon: '➖', onClick: () => chat.friendRemove(target) });
    }
    const mod = modToolsFor(target) ?? [];
    if (mod.length > 0) {
      items.push({ kind: 'divider' }, { kind: 'heading', label: 'Room moderation' });
      for (const t of mod) items.push({ label: t.label, danger: t.danger, onClick: t.run });
    }
    const site = siteAdminTools(target);
    if (site.length > 0) {
      items.push({ kind: 'divider' }, { kind: 'heading', label: 'Site admin' });
      for (const t of site) items.push({ label: t.label, danger: t.danger, onClick: t.run });
    }
    setMenu({ x, y, items });
  };

  /** The menu behind your own name: profile, preferences, admin area, log out. */
  const openAccountMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const items: MenuItem[] = [
      { label: 'My profile', icon: '👤', onClick: openOwnProfile },
      { label: 'Preferences', icon: '⚙️', onClick: () => setShowPrefs(true) },
      { label: 'Change password', icon: '🔑', onClick: () => setShowPassword(true) },
    ];
    if (role === 'admin') items.push({ label: 'Admin area', icon: '🛠️', onClick: () => go('admin') });
    items.push(
      { kind: 'divider' },
      {
        label: 'Download my data',
        icon: '📥',
        onClick: () => {
          if (token) fetchMyData(token).catch((e: Error) => setToast(e.message));
        },
      },
      { label: 'Delete my account', icon: '🗑️', danger: true, onClick: () => setShowDelete(true) },
      { label: 'Terms of use', icon: '📄', onClick: () => window.open('/terms', '_blank', 'noopener') },
      { label: 'Privacy notice', icon: '🔒', onClick: () => window.open('/privacy', '_blank', 'noopener') },
      { kind: 'divider' },
      { label: 'Log out', icon: '⏻', danger: true, onClick: doLogout },
    );
    setMenu({ x: r.left, y: r.bottom + 6, items });
  };

  return (
    <div className="app">
      {disconnected && (
        <div className="disconnect-banner" role="alert">
          <span>⚠ Lost connection. Trying to reconnect…</span>
          <button onClick={chat.reconnect}>Reconnect now</button>
        </div>
      )}
      {ann && (
        <div className="announce-bar" role="status">
          <span>
            📢 <b>{ann.by}:</b> {ann.text}
          </span>
          <button onClick={chat.dismissAnnouncement} aria-label="Dismiss announcement">✕</button>
        </div>
      )}

      <div className={`drawer-backdrop ${drawer ? 'show' : ''}`} onClick={() => setDrawer(null)} />
      <aside className={`sidebar ${drawer === 'menu' ? 'open' : ''}`}>
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>

        <button
          type="button"
          className="profile-chip editable"
          onClick={(e) => openAccountMenu(e.currentTarget)}
          aria-haspopup="menu"
          title="Your account"
        >
          <Avatar name={state.nick} src={myProfile?.avatar} size={34} />
          <div className="profile-meta">
            <span className="profile-nick">{myProfile?.displayName || state.nick}</span>
            <span className="profile-status">
              <span className={`dot ${status}`} />
              {role === 'admin' ? 'Admin' : 'Member'}
            </span>
          </div>
          <span className="chip-edit">▾</span>
        </button>

        <button className="rooms-btn" onClick={() => setShowRooms(true)}>
          <span>Browse rooms</span>
          <span className="rooms-btn-plus">+ New</span>
        </button>

        <div className="side-scroll">
          <div className="nav-label-row">
            <span className="nav-label">Private messages</span>
            <button className="mini-plus" onClick={() => setShowNewDm(true)} title="New private message" aria-label="New private message">
              +
            </button>
          </div>
          <nav className="buffers">
            {dmList.length === 0 && <p className="buffers-empty">No private messages yet.</p>}
            {dmList.map((t) => {
              const key = dmKey(t.with);
              return (
                <button
                  key={key}
                  className={`buffer dm ${active === key ? 'active' : ''}`}
                  onClick={() => chat.setActive(key)}
                  title={t.last || undefined}
                >
                  <Avatar name={t.with} src={avatarFor(t.with)} size={22} />
                  <span className="buffer-name">{t.with}</span>
                  {t.unread > 0 && <span className="badge">{t.unread}</span>}
                </button>
              );
            })}
          </nav>

          <div className="nav-label-row">
            <span className="nav-label">
              Friends{state.friends.length > 0 ? ` · ${state.friends.filter((f) => f.online).length} online` : ''}
            </span>
            <button className="mini-plus" onClick={() => setShowAddFriend(true)} title="Add a friend" aria-label="Add a friend">
              +
            </button>
          </div>
          {state.requests.incoming.length > 0 && (
            <div className="friend-requests">
              {state.requests.incoming.map((n) => (
                <div className="friend-req" key={n}>
                  <span>
                    <b>{n}</b> wants to be friends
                  </span>
                  <span className="friend-req-btns">
                    <button className="mini" onClick={() => chat.friendRespond(n, true)}>Accept</button>
                    <button className="mini" onClick={() => chat.friendRespond(n, false)}>Decline</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <nav className="buffers">
            {state.friends.length === 0 && state.requests.incoming.length === 0 && (
              <p className="buffers-empty">No friends yet. Add someone with +.</p>
            )}
            {state.friends.map((f) => (
              <button key={f.name} className="buffer friend" onClick={() => chat.openDm(f.name)} title="Send a message">
                <span className={`presence ${f.online ? 'on' : ''}`} aria-label={f.online ? 'online' : 'offline'} />
                <Avatar name={f.name} src={avatarFor(f.name)} size={22} />
                <span className={`buffer-name ${f.online ? '' : 'offline'}`}>{f.name}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <main className="main">
        {room ? (
          <>
            <header className="chan-head">
              <button className="head-btn narrow-only" aria-label="Menu" title="Menu: your rooms, messages and friends" onClick={() => setDrawer((d) => (d === 'menu' ? null : 'menu'))}>☰</button>
              <div className="chan-title">
                <span className="chan-name">{roomLabel(room.name)}</span>
                <span className="chan-meta">{room.members.length} online</span>
                {room.topic && (
                  <span className="chan-topic" title={`Topic set by ${room.topic.by}`}>
                    {room.topic.text}
                  </span>
                )}
              </div>
              <div className="chan-actions">
                <button className="head-btn narrow-only" aria-label="Members" title="Who is here" onClick={() => setDrawer((d) => (d === 'members' ? null : 'members'))}>👥</button>
                {!POPOUT && (
                  <button className="head-btn" title="Open this chat in its own small window" aria-label="Pop out chat" onClick={openPopout}>⧉</button>
                )}
                <button
                  className={`head-btn ${searching ? 'active' : ''}`}
                  title="Search this room"
                  aria-label="Search this room"
                  onClick={() => {
                    if (searching) chat.clearSearch(room.name);
                    setSearching((s) => !s);
                  }}
                >
                  🔍
                </button>
                {myRank >= 2 && (
                  <button
                    className="head-btn"
                    title="Room settings"
                    aria-label="Room settings"
                    onClick={() => {
                      chat.openRoomAdmin(room.name);
                      setShowSettings(true);
                    }}
                  >
                    ⚙
                  </button>
                )}
                <button className="leave" onClick={() => chat.leave(room.name)}>Leave</button>
              </div>
            </header>
            <MediaPanel
              key={room.name}
              roomMedia={room.media}
              autoplay={autoplay}
              onPlayRoom={(ref) => chat.playYouTube(room.name, ref)}
              onControlRoom={(op, pos) => chat.mediaControl(room.name, op, pos, room.media?.ref)}
            />
            {searching && (
              <SearchPanel
                room={room.name}
                result={room.search}
                onSearch={(q) => chat.search(room.name, q)}
                onClose={() => {
                  chat.clearSearch(room.name);
                  setSearching(false);
                }}
              />
            )}
            <div className="content">
              <Conversation
                key={room.name}
                events={room.events}
                more={room.more}
                loadingMore={room.loadingMore}
                onLoadEarlier={() => chat.loadEarlier(room.name)}
                typing={room.typing}
                me={state.nick}
                avatarFor={avatarFor}
                placeholder={`Message ${roomLabel(room.name)}`}
                commandRank={myRank}
                onSend={(text, extra) => chat.say(room.name, text, extra)}
                onTyping={() => chat.typing(room.name)}
                tools={<SoundPicker onPlay={(id) => chat.playSound(room.name, id)} />}
                canModerate={myRank >= 2}
                onEdit={(id, text) => chat.editMessage(room.name, id, text)}
                onDelete={(id) => chat.deleteMessage(room.name, id)}
                onProfile={openMember}
                bots={room.bots}
                onClear={() => chat.clearRoom(room.name)}
                rich={{
                  onReact: (id, emoji) => chat.react(room.name, id, emoji),
                  onReport: (id) => {
                    const msg = room.events.find((e) => e.id === id);
                    if (msg) setReporting({ room: room.name, msg });
                  },
                  onUpload: async (file) => {
                    if (!token) throw new Error('Not logged in.');
                    return (await uploadImage(token, file)).name;
                  },
                }}
              />
              <aside className={`right-rail ${drawer === 'members' ? 'open' : ''}`}>
                <MembersPanel
                  members={room.members}
                  roles={room.roles}
                  away={room.away}
                  avatarFor={avatarFor}
                  onPick={openMember}
                  onMenu={openMemberMenu}
                  bots={room.bots}
                  onBot={setBotCard}
                />
              </aside>
            </div>
          </>
        ) : dm ? (
          <>
            <header className="chan-head">
              <button className="head-btn narrow-only" aria-label="Menu" title="Menu: your rooms, messages and friends" onClick={() => setDrawer((d) => (d === 'menu' ? null : 'menu'))}>☰</button>
              <div className="chan-title">
                <button className="dm-head" onClick={() => openMember(dm.with)} title="View profile">
                  <Avatar name={dm.with} src={avatarFor(dm.with)} size={34} />
                  <span className="chan-name">{dm.with}</span>
                </button>
                <span className="chan-meta">private chat</span>
              </div>
              {!POPOUT && (
                <div className="chan-actions">
                  <button className="head-btn" title="Open this chat in its own small window" aria-label="Pop out chat" onClick={openPopout}>⧉</button>
                </div>
              )}
            </header>
            <div className="content">
              <Conversation
                key={active ?? ''}
                events={dm.events}
                more={dm.more}
                loadingMore={dm.loadingMore}
                onLoadEarlier={() => chat.loadEarlier(active!)}
                typing={{ [dm.with]: dm.typingUntil }}
                me={state.nick}
                avatarFor={avatarFor}
                placeholder={`Message ${dm.with}`}
                commandRank={null}
                onSend={(text) => chat.sendDm(dm.with, text)}
                onTyping={() => chat.typing(active!)}
                canModerate={false}
                onEdit={() => undefined}
                onDelete={() => undefined}
                onProfile={openMember}
              />
            </div>
          </>
        ) : (
          <>
            <header className="chan-head">
              <button className="head-btn narrow-only" aria-label="Menu" title="Menu: your rooms, messages and friends" onClick={() => setDrawer((d) => (d === 'menu' ? null : 'menu'))}>☰</button>
              <div className="chan-title">
                <span className="chan-name">Welcome</span>
              </div>
            </header>
            <div className="empty-state">
              <p>You are not in a room right now.</p>
              <button onClick={() => setShowRooms(true)}>Browse rooms</button>
            </div>
          </>
        )}
        <RoomTabs
          order={state.order}
          rooms={state.rooms}
          active={active}
          onPick={chat.setActive}
          onBrowse={() => setShowRooms(true)}
        />
      </main>

      {modal && (
        <ProfileModal
          account={modal.account}
          profile={modal.profile}
          editable={modal.editable}
          onClose={() => setModal(null)}
          onSave={modal.editable ? onSaveProfile : undefined}
          onUploadAvatar={modal.editable ? onUploadAvatar : undefined}
          onMessage={
            modal.editable
              ? undefined
              : () => {
                  chat.openDm(modal.account);
                  setModal(null);
                }
          }
          canMessage={modal.allowPm}
          friend={
            modal.editable
              ? undefined
              : {
                  status: friendStatus(modal.account),
                  onAdd: () => chat.friendRequest(modal.account),
                  onRemove: () => chat.friendRemove(modal.account),
                  onAccept: () => chat.friendRespond(modal.account, true),
                }
          }
          modTools={modal.editable ? undefined : modToolsFor(modal.account)}
        />
      )}
      {showRooms && (
        <RoomsModal
          rooms={state.roomList}
          joined={state.order}
          onRefresh={chat.listRooms}
          onJoin={chat.join}
          onOpen={chat.setActive}
          onClose={() => setShowRooms(false)}
        />
      )}
      {showNewDm && <NewMessageModal me={state.nick} onStart={chat.openDm} onClose={() => setShowNewDm(false)} />}
      {showAddFriend && (
        <NewMessageModal
          me={state.nick}
          title="Add a friend"
          blurb="Type the name of the member you want to add. They get a request to accept."
          cta="Send request"
          needsPm={false}
          onStart={chat.friendRequest}
          onClose={() => setShowAddFriend(false)}
        />
      )}
      {showSettings && room && (
        <RoomSettingsModal
          room={room.name}
          info={state.roomAdmin && state.roomAdmin.room === room.name ? state.roomAdmin : null}
          topic={room.topic?.text ?? ''}
          canManageMods={myRank >= 3}
          onCommand={(cmd) => {
            chat.say(room.name, cmd);
            window.setTimeout(() => chat.openRoomAdmin(room.name), 400);
          }}
          onClose={() => {
            setShowSettings(false);
            chat.closeRoomAdmin();
          }}
        />
      )}
      {reporting && (
        <ReportModal
          message={reporting.msg}
          onSend={(reason) => chat.report(reporting.room, reporting.msg.id, reason)}
          onClose={() => setReporting(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && <ConfirmModal {...confirm} />}
      {botCard && <BotModal bot={botCard} onClose={() => setBotCard(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {showPassword && token && <PasswordModal token={token} onClose={() => setShowPassword(false)} />}
      {showDelete && token && (
        <DeleteAccountModal
          token={token}
          isAdmin={role === 'admin'}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setToken(null);
            window.location.assign('/');
          }}
        />
      )}
      {showPrefs && token && (
        <PreferencesModal
          token={token}
          onClose={() => setShowPrefs(false)}
          onSaved={(p) => setAutoplay(p.autoplay)}
        />
      )}
    </div>
  );
}

function MembersPanel({
  members,
  roles,
  away,
  avatarFor,
  onPick,
  onMenu,
  bots,
  onBot,
}: {
  members: string[];
  roles: Record<string, RoomRole>;
  away: string[];
  avatarFor: (name: string) => string | undefined;
  onPick: (nick: string) => void;
  /** Right-click (or the keyboard menu key) on a member. */
  onMenu: (nick: string, x: number, y: number) => void;
  bots: BotInfo[];
  onBot: (bot: BotInfo) => void;
}) {
  // Staff first, then everyone else, each group alphabetical.
  const sorted = useMemo(
    () => [...members].sort((a, b) => roleRank(roles[b]) - roleRank(roles[a]) || a.localeCompare(b)),
    [members, roles],
  );
  const awaySet = new Set(away);
  return (
    <div className="members-panel">
      <div className="rail-head">Members · {members.length}</div>
      <ul className="member-list">
        {sorted.map((m) => {
          const r = roles[m];
          return (
            <li
              key={m}
              className={`member-item ${awaySet.has(m) ? 'away' : ''}`}
              title={r ? `${ROLE_NAME[r]}${awaySet.has(m) ? ', away' : ''}` : awaySet.has(m) ? 'Away' : 'View profile'}
              onClick={() => onPick(m)}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(m, e.clientX, e.clientY);
              }}
            >
              <Avatar name={m} src={avatarFor(m)} size={26} />
              <span className="member-name">{m}</span>
              {r && <span className="role-icon" aria-label={ROLE_NAME[r]}>{ROLE_ICON[r]}</span>}
            </li>
          );
        })}
      </ul>
      {bots.length > 0 && (
        <>
          <div className="rail-head bots-head">Bots · {bots.length}</div>
          <ul className="member-list">
            {bots.map((b) => (
              <li
                key={b.name}
                className="member-item bot"
                title={b.description || b.name}
                onClick={() => onBot(b)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onBot(b);
                }}
              >
                <Avatar name={b.name} size={26} emoji={b.emoji} />
                <span className="member-name">{b.name}</span>
                <span className="bot-tag">BOT</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div className="connect">
      <div className="connect-brand" style={{ gap: 14 }}>
        <LogoMark size={72} />
        <p className="tagline">Reconnecting…</p>
      </div>
    </div>
  );
}
