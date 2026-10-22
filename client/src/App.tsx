import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '@qchat/shared';
import type { ChatEvent } from './types.js';
import {
  getProfile,
  getToken,
  login,
  logout,
  me,
  register,
  saveProfile,
  setToken,
  uploadAvatar,
  type AuthResult,
} from './api.js';
import { Avatar } from './components/Avatar.js';
import { EmojiPicker } from './components/EmojiPicker.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { Message } from './components/Message.js';
import { PreferencesModal } from './components/PreferencesModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { useChat } from './useChat.js';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'connecting…',
  online: 'online',
  closed: 'offline',
  error: 'connection error',
  idle: 'idle',
};

interface ModalTarget {
  account: string;
  profile: Profile | null;
  editable: boolean;
}

export default function App() {
  const chat = useChat();
  const { state, status } = chat;
  const [token, setTok] = useState<string | null>(getToken());
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [draft, setDraft] = useState('');

  // Resume a stored session on first load.
  useEffect(() => {
    const t = getToken();
    if (!t) return;
    let cancelled = false;
    me(t)
      .then((res) => {
        if (cancelled) return;
        setMyProfile(res.profile);
        chat.connect(res.account, t);
        setBooting(false);
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setTok(null);
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGuest = (nick: string) => chat.connect(nick);
  const onAuthed = (res: AuthResult) => {
    setToken(res.token);
    setTok(res.token);
    setMyProfile(res.profile);
    chat.connect(res.account, res.token);
  };
  const doLogout = () => {
    if (token) logout(token);
    setToken(null);
    window.location.reload();
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
    return <Connect onGuest={onGuest} onAuthed={onAuthed} />;
  }

  const active = state.active;
  const room = active ? state.rooms[active] : null;
  const disconnected = status === 'closed' || status === 'error';

  return (
    <div className="app">
      {disconnected && (
        <div className="disconnect-banner" role="alert">
          <span>⚠ Lost connection to the server.</span>
          <button onClick={() => chat.connect(state.account ?? state.nick, token)}>Reconnect</button>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>

        <div
          className={`profile-chip ${state.account ? 'editable' : ''}`}
          onClick={state.account ? openOwnProfile : undefined}
          title={state.account ? 'View and edit your profile' : undefined}
        >
          <Avatar name={state.nick} src={myProfile?.avatar} size={34} />
          <div className="profile-meta">
            <span className="profile-nick">{myProfile?.displayName || state.nick}</span>
            <span className="profile-status">
              <span className={`dot ${status}`} />
              {state.account ? `✓ ${state.account}` : 'guest'}
            </span>
          </div>
          {state.account && <span className="chip-edit">✎</span>}
        </div>
        <div className="chip-links">
          {state.account && (
            <button className="auth-link" onClick={() => setShowPrefs(true)}>Preferences</button>
          )}
          <button className="auth-link" onClick={state.account ? doLogout : () => window.location.reload()}>
            {state.account ? 'Log out' : 'Log in or sign up'}
          </button>
        </div>

        <JoinBox onJoin={chat.join} />

        {state.available.filter((r) => !state.order.includes(r)).length > 0 && (
          <>
            <div className="nav-label">Rooms</div>
            <div className="buffers">
              {state.available
                .filter((r) => !state.order.includes(r))
                .map((r) => (
                  <button key={r} className="buffer" onClick={() => chat.join(r)}>
                    <span className="buffer-hash">#</span>
                    <span className="buffer-name">{r.replace(/^#/, '')}</span>
                    <span className="chip-guest">join</span>
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="nav-label">Joined</div>
        <nav className="buffers">
          {state.order.length === 0 && <p className="buffers-empty">Join a room above to start chatting.</p>}
          {state.order.map((name) => {
            const r = state.rooms[name];
            return (
              <button
                key={name}
                className={`buffer ${active === name ? 'active' : ''}`}
                onClick={() => chat.setActive(name)}
              >
                <span className="buffer-hash">#</span>
                <span className="buffer-name">{name.replace(/^#/, '')}</span>
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
                <span className="chan-hash">#</span>
                <span className="chan-name">{room.name.replace(/^#/, '')}</span>
                <span className="chan-meta">{room.members.length} online</span>
              </div>
              <div className="chan-actions">
                <button className="leave" onClick={() => chat.leave(room.name)}>Leave</button>
              </div>
            </header>
            <div className="content">
              <RoomChat
                events={room.events}
                draft={draft}
                setDraft={setDraft}
                onSend={(text) => chat.say(room.name, text)}
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
                <span className="chan-meta">pick a room on the left</span>
              </div>
            </header>
            <ServerView events={state.serverLog} />
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
      {showPrefs && token && <PreferencesModal token={token} onClose={() => setShowPrefs(false)} />}
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

function Connect({
  onGuest,
  onAuthed,
}: {
  onGuest: (nick: string) => void;
  onAuthed: (res: AuthResult) => void;
}) {
  const [mode, setMode] = useState<'guest' | 'login' | 'signup'>('guest');
  const [nick, setNick] = useState('');
  const [account, setAccount] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'guest') {
      const n = nick.trim();
      if (n) onGuest(n);
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await login(account.trim(), password)
          : await register(account.trim(), email.trim(), password);
      onAuthed(res);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const cta = mode === 'guest' ? 'Jump in' : mode === 'login' ? 'Log in' : 'Create account';

  return (
    <div className="connect">
      <div className="connect-bubbles" aria-hidden="true">
        <span className="cb cb1">🎵</span>
        <span className="cb cb2">💬</span>
        <span className="cb cb3">🎬</span>
        <span className="cb cb4">😄</span>
        <span className="cb cb5">✨</span>
      </div>
      <form onSubmit={submit}>
        <div className="connect-brand">
          <LogoMark size={64} />
          <h1><Wordmark /></h1>
        </div>
        <p className="tagline">Media Webchat, Reborn.</p>

        {mode === 'guest' ? (
          <input autoFocus value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Choose a nickname" maxLength={24} />
        ) : (
          <>
            <input autoFocus value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Username" autoComplete="username" />
            {mode === 'signup' && (
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" autoComplete="email" />
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </>
        )}

        {error && <p className="pm-error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : cta}</button>

        <div className="connect-switch">
          {mode === 'guest' ? (
            <>
              <button type="button" className="link-btn" onClick={() => setMode('login')}>Log in</button>
              <span>·</span>
              <button type="button" className="link-btn" onClick={() => setMode('signup')}>Create an account</button>
            </>
          ) : (
            <>
              <button type="button" className="link-btn" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
                {mode === 'login' ? 'Create an account' : 'Have an account? Log in'}
              </button>
              <span>·</span>
              <button type="button" className="link-btn" onClick={() => setMode('guest')}>Continue as guest</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function JoinBox({ onJoin }: { onJoin: (room: string) => void }) {
  const [name, setName] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onJoin(trimmed);
      setName('');
    }
  };
  return (
    <form className="joinbox" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="join or make a #room" />
      <button type="submit">Join</button>
    </form>
  );
}

function RoomChat({
  events,
  draft,
  setDraft,
  onSend,
}: {
  events: ChatEvent[];
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  onSend: (text: string) => void;
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

function ServerView({ events }: { events: ChatEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  return (
    <div className="server-view" ref={scrollerRef}>
      {events.map((ev) => (
        <Message key={ev.id} event={ev} />
      ))}
    </div>
  );
}
