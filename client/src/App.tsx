import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '@qchat/shared';
import type { ChatEvent } from './types.js';
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
import { EmojiPicker } from './components/EmojiPicker.js';
import { Gate } from './components/Gate.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { MediaPanel } from './components/MediaPanel.js';
import { Message } from './components/Message.js';
import { PreferencesModal } from './components/PreferencesModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { RoomsModal } from './components/RoomsModal.js';
import { SoundPicker } from './components/SoundPicker.js';
import { playSound as playSoundFx } from './media/sounds.js';
import { useChat } from './useChat.js';

interface ModalTarget {
  account: string;
  profile: Profile | null;
  editable: boolean;
}

const isAdminPath = () => window.location.pathname.replace(/\/+$/, '') === '/admin';
const roomLabel = (name: string) => name.replace(/^#/, '');

export default function App() {
  const chat = useChat();
  const { state, status } = chat;
  const [token, setTok] = useState<string | null>(getToken());
  const [role, setRole] = useState<Role | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'admin'>(() => (isAdminPath() ? 'admin' : 'chat'));
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const [draft, setDraft] = useState('');

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
    if (state.account) setModal({ account: state.account, profile: myProfile, editable: true });
  };
  const openMember = (nick: string) => {
    const editable = !!state.account && state.account.toLowerCase() === nick.toLowerCase();
    getProfile(nick)
      .then((p) => setModal({ account: nick, profile: p, editable }))
      .catch(() => setModal({ account: nick, profile: null, editable }));
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
    setModal((m) =>
      m ? { ...m, profile: { ...(m.profile ?? { account: m.account }), avatar: url } } : m,
    );
    return url;
  };

  if (booting) return <Splash />;
  if (status === 'idle' || state.nick === '') {
    const serverNotice = lastLog?.kind === 'notice' ? lastLog.text : null;
    return <Gate onAuthed={onAuthed} notice={gateNotice ?? serverNotice} />;
  }
  if (view === 'admin' && role === 'admin' && token) {
    return <AdminPage token={token} me={state.nick} onBack={() => go('chat')} />;
  }

  const active = state.active;
  const room = active ? state.rooms[active] : null;
  const disconnected = status === 'closed' || status === 'error';
  const ann = state.announcement;

  return (
    <div className="app">
      {disconnected && (
        <div className="disconnect-banner" role="alert">
          <span>⚠ Lost connection to the server.</span>
          <button onClick={() => chat.connect(state.account ?? state.nick, token)}>Reconnect</button>
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
                {r && r.unread > 0 && <span className="badge">{r.unread}</span>}
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
              <RoomChat
                events={room.events}
                draft={draft}
                setDraft={setDraft}
                onSend={(text) => chat.say(room.name, text)}
                onPlaySound={(id) => chat.playSound(room.name, id)}
              />
              <aside className="right-rail">
                <MembersPanel members={room.members} onPick={openMember} />
              </aside>
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

function MembersPanel({ members, onPick }: { members: string[]; onPick: (nick: string) => void }) {
  const sorted = useMemo(() => [...members].sort((a, b) => a.localeCompare(b)), [members]);
  return (
    <div className="members-panel">
      <div className="rail-head">Members · {members.length}</div>
      <ul className="member-list">
        {sorted.map((m) => (
          <li key={m} className="member-item" title="View profile" onClick={() => onPick(m)}>
            <Avatar name={m} size={26} />
            <span className="member-name">{m}</span>
          </li>
        ))}
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

function RoomChat({
  events,
  draft,
  setDraft,
  onSend,
  onPlaySound,
}: {
  events: ChatEvent[];
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  onSend: (text: string) => void;
  onPlaySound: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="chat">
      <div className="messages" ref={scrollerRef}>
        {events.map((ev, i) => {
          const prev = events[i - 1];
          const grouped =
            ev.kind === 'message' &&
            prev?.kind === 'message' &&
            prev.from === ev.from &&
            ev.ts - prev.ts < 5 * 60 * 1000;
          return <Message key={ev.id} event={ev} grouped={grouped} />;
        })}
      </div>
      <form className="composer" onSubmit={submit}>
        <SoundPicker onPlay={onPlaySound} />
        <EmojiPicker
          onPick={(emoji) => {
            setDraft((d) => d + emoji);
            inputRef.current?.focus();
          }}
        />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room…"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
