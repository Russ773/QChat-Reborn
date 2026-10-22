import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Profile, RoomRole } from '@qchat/shared';
import { dmKey, isDmKey } from './types.js';
import {
  getProfile,
  getToken,
  logout,
  me,
  saveProfile,
  setToken,
  uploadAvatar,
  type AuthResult,
  type Role,
} from './api.js';
import { AdminPage } from './admin/AdminPage.js';
import { Avatar } from './components/Avatar.js';
import { Conversation } from './components/Conversation.js';
import { Gate } from './components/Gate.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { MediaPanel } from './components/MediaPanel.js';
import { NewMessageModal } from './components/NewMessageModal.js';
import { PreferencesModal } from './components/PreferencesModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { RoomsModal } from './components/RoomsModal.js';
import { SoundPicker } from './components/SoundPicker.js';
import { playSound as playSoundFx } from './media/sounds.js';
import { useAvatars } from './useAvatars.js';
import { useChat } from './useChat.js';

interface ModalTarget {
  account: string;
  profile: Profile | null;
  editable: boolean;
  allowPm: boolean;
}

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
  const [showRooms, setShowRooms] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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

  // Surface server messages (bad room name, you were removed...) as a short toast.
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

  // A soft sound for a mention or a new private message.
  useEffect(() => {
    const a = state.alert;
    if (a && autoplay) playSoundFx(a.kind === 'dm' ? 'ding' : 'pop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.alert?.id]);

  // Unread private messages and mentions show in the browser tab.
  const unreadDms = state.threads.reduce((n, t) => n + t.unread, 0);
  const unreadMentions = Object.values(state.rooms).reduce((n, r) => n + r.mentions, 0);
  const attention = unreadDms + unreadMentions;
  useEffect(() => {
    document.title = attention > 0 ? `(${attention}) QChat Reborn` : 'QChat Reborn';
  }, [attention]);

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

      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>

        <div className="profile-chip editable" onClick={openOwnProfile} title="View and edit your profile">
          <Avatar name={state.nick} src={myProfile?.avatar} size={34} />
          <div className="profile-meta">
            <span className="profile-nick">{myProfile?.displayName || state.nick}</span>
            <span className="profile-status">
              <span className={`dot ${status}`} />
              {role === 'admin' ? 'Admin' : 'Member'}
            </span>
          </div>
          <span className="chip-edit">✎</span>
        </div>
        <div className="chip-links">
          <button className="auth-link" onClick={() => setShowPrefs(true)}>Preferences</button>
          {role === 'admin' && (
            <button className="auth-link admin-link" onClick={() => go('admin')}>Admin</button>
          )}
          <button className="auth-link" onClick={doLogout}>Log out</button>
        </div>

        <button className="rooms-btn" onClick={() => setShowRooms(true)}>
          <span>Browse rooms</span>
          <span className="rooms-btn-plus">+ New</span>
        </button>

        <div className="nav-label">My rooms</div>
        <nav className="buffers">
          {state.order.length === 0 && <p className="buffers-empty">You are not in any rooms yet.</p>}
          {state.order.map((name) => {
            const r = state.rooms[name];
            return (
              <button
                key={name}
                className={`buffer ${active === name ? 'active' : ''}`}
                onClick={() => chat.setActive(name)}
              >
                <span className="buffer-name">{roomLabel(name)}</span>
                {r && r.mentions > 0 ? (
                  <span className="badge mention" title="You were mentioned">@{r.mentions}</span>
                ) : (
                  r && r.unread > 0 && <span className="badge">{r.unread}</span>
                )}
              </button>
            );
          })}
        </nav>

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
      </aside>

      <main className="main">
        {room ? (
          <>
            <header className="chan-head">
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
                <button className="leave" onClick={() => chat.leave(room.name)}>Leave</button>
              </div>
            </header>
            <MediaPanel
              key={room.name}
              roomMedia={room.media}
              autoplay={autoplay}
              onPlayRoom={(ref) => chat.playYouTube(room.name, ref)}
              onControlRoom={(op, pos) => chat.mediaControl(room.name, op, pos)}
            />
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
                onSend={(text) => chat.say(room.name, text)}
                onTyping={() => chat.typing(room.name)}
                tools={<SoundPicker onPlay={(id) => chat.playSound(room.name, id)} />}
                canModerate={myRank >= 2}
                onEdit={(id, text) => chat.editMessage(room.name, id, text)}
                onDelete={(id) => chat.deleteMessage(room.name, id)}
                onProfile={openMember}
                onClear={() => chat.clearRoom(room.name)}
              />
              <aside className="right-rail">
                <MembersPanel
                  members={room.members}
                  roles={room.roles}
                  away={room.away}
                  avatarFor={avatarFor}
                  onPick={openMember}
                />
              </aside>
            </div>
          </>
        ) : dm ? (
          <>
            <header className="chan-head">
              <div className="chan-title">
                <button className="dm-head" onClick={() => openMember(dm.with)} title="View profile">
                  <Avatar name={dm.with} src={avatarFor(dm.with)} size={34} />
                  <span className="chan-name">{dm.with}</span>
                </button>
                <span className="chan-meta">private chat</span>
              </div>
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
      {toast && <div className="toast" role="status">{toast}</div>}
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
}: {
  members: string[];
  roles: Record<string, RoomRole>;
  away: string[];
  avatarFor: (name: string) => string | undefined;
  onPick: (nick: string) => void;
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
            >
              <Avatar name={m} src={avatarFor(m)} size={26} />
              <span className="member-name">{m}</span>
              {r && <span className="role-icon" aria-label={ROLE_NAME[r]}>{ROLE_ICON[r]}</span>}
            </li>
          );
        })}
      </ul>
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
