import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatEvent } from './types.js';
import { Avatar } from './components/Avatar.js';
import { EmojiPicker } from './components/EmojiPicker.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { Message } from './components/Message.js';
import { useChat } from './useChat.js';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'connecting…',
  online: 'online',
  closed: 'offline',
  error: 'connection error',
  idle: 'idle',
};

export default function App() {
  const chat = useChat();
  const { state, status } = chat;
  const [draft, setDraft] = useState('');
  const [nick, setNick] = useState('');

  const mention = (who: string) =>
    setDraft((d) => (d.trim() ? `${d.replace(/\s*$/, '')} ${who} ` : `${who}: `));

  if (status === 'idle' || state.nick === '') {
    return <Connect onConnect={(n) => { setNick(n); chat.connect(n); }} />;
  }

  const active = state.active;
  const room = active ? state.rooms[active] : null;
  const disconnected = status === 'closed' || status === 'error';
  const joinable = state.available.filter((r) => !state.order.includes(r));

  return (
    <div className="app">
      {disconnected && (
        <div className="disconnect-banner" role="alert">
          <span>⚠ Lost connection to the server.</span>
          <button onClick={() => chat.connect(nick || state.nick)}>Reconnect</button>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>

        <div className="profile-chip">
          <Avatar name={state.nick} size={34} />
          <div className="profile-meta">
            <span className="profile-nick">{state.nick}</span>
            <span className="profile-status">
              <span className={`dot ${status}`} />
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
        </div>

        <JoinBox onJoin={chat.join} />

        {joinable.length > 0 && (
          <>
            <div className="nav-label">Rooms</div>
            <div className="buffers">
              {joinable.map((r) => (
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
                <button className="leave" onClick={() => chat.leave(room.name)}>
                  Leave
                </button>
              </div>
            </header>

            <div className="content">
              <RoomChat
                events={room.events}
                myNick={state.nick}
                draft={draft}
                setDraft={setDraft}
                onSend={(text) => chat.say(room.name, text)}
              />
              <aside className="right-rail">
                <MembersPanel members={room.members} onPick={mention} />
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
          <li key={m} className="member-item" title="Click to mention" onClick={() => onPick(m)}>
            <Avatar name={m} size={26} />
            <span className="member-name">{m}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Connect({ onConnect }: { onConnect: (nick: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = value.trim();
    if (n) onConnect(n);
  };
  return (
    <div className="connect">
      <form onSubmit={submit}>
        <div className="connect-brand">
          <LogoMark size={72} />
          <h1>
            <Wordmark />
          </h1>
        </div>
        <p className="tagline">Media Webchat, Reborn.</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Choose a nickname"
          maxLength={24}
        />
        <button type="submit">Jump in</button>
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
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="join or make a #room"
      />
      <button type="submit">Join</button>
    </form>
  );
}

function RoomChat({
  events,
  myNick,
  draft,
  setDraft,
  onSend,
}: {
  events: ChatEvent[];
  myNick: string;
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
          placeholder={`Message #${myNick ? '' : ''}…`}
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
