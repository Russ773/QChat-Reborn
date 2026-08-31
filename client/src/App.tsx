import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatEvent } from './types.js';
import { postAnnouncement } from './api.js';
import { Avatar } from './components/Avatar.js';
import { EmojiPicker } from './components/EmojiPicker.js';
import { LogoMark, Wordmark } from './components/Logo.js';
import { Message } from './components/Message.js';
import { ChannelBrowser } from './components/ChannelBrowser.js';
import { MediaPanel } from './components/MediaPanel.js';
import { MiniProfile } from './components/MiniProfile.js';
import { ProfileEditor } from './components/ProfileEditor.js';
import type { LoginCreds } from './irc/client.js';
import { useIrc } from './useIrc.js';
import { useProfiles, type Profiles } from './useProfiles.js';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'connecting…',
  registered: 'online',
  closed: 'offline',
  error: 'connection error',
  idle: 'idle',
};

interface ProfileTarget {
  nick: string;
  x: number;
  y: number;
}

export default function App() {
  const irc = useIrc();
  const { state, status } = irc;
  const profiles = useProfiles();
  const [showMembers, setShowMembers] = useState(true);
  const [showWatch, setShowWatch] = useState(true);
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const [editing, setEditing] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [dismissedAnn, setDismissedAnn] = useState<string | null>(null);

  const openBrowser = () => {
    setBrowsing(true);
    irc.listChannels();
  };

  // Load our own profile once logged in.
  useEffect(() => {
    if (state.token && state.account) profiles.load([state.account]);
  }, [state.token, state.account, profiles]);

  const openProfile = (nick: string, x: number, y: number) => {
    setTarget({ nick, x, y });
    irc.whois(nick);
    profiles.load([nick]);
  };
  const mention = (nick: string) =>
    setDraft((d) => (d.trim() ? `${d.replace(/\s*$/, '')} ${nick} ` : `${nick}: `));

  if (status === 'idle') {
    return <Connect onConnect={irc.connect} />;
  }

  const active = state.active;
  const channel = active && active !== irc.serverBuffer ? state.channels[active] : null;
  const disconnected = status === 'closed' || status === 'error';
  const showRail = !!channel && (showMembers || showWatch);
  const myProfile = state.account ? profiles.get(state.account) : null;
  const isAdmin = state.roles.includes('admin');
  const ann = state.latestAnnouncement;

  return (
    <div className="app">
      {disconnected && (
        <div className="disconnect-banner" role="alert">
          <span>
            ⚠ You’ve been disconnected from the server
            {status === 'error' ? ' (connection error)' : ''}.
          </span>
          <button onClick={irc.reconnect}>Reconnect</button>
        </div>
      )}
      {ann && ann.id !== dismissedAnn && (
        <div className="announce-bar" role="status">
          <span>
            📢 <b>{ann.by}:</b> {ann.text}
          </span>
          <button onClick={() => setDismissedAnn(ann.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>

        <div
          className={`profile-chip ${state.token ? 'editable' : ''}`}
          onClick={state.token ? () => setEditing(true) : undefined}
          title={state.token ? 'Edit your profile' : undefined}
        >
          <Avatar name={state.nick} src={myProfile?.avatar} size={34} />
          <div className="profile-meta">
            <span className="profile-nick">{myProfile?.displayName || state.nick}</span>
            <span className="profile-status">
              <span className={`dot ${status}`} />
              {state.account ? `✓ ${state.account}` : (STATUS_LABEL[status] ?? status)}
            </span>
          </div>
          {state.token ? (
            <span className="chip-edit" aria-hidden="true">
              ✎ Edit
            </span>
          ) : (
            <span className="chip-guest" title="Log in with a registered account to create a profile">
              guest
            </span>
          )}
        </div>
        {!state.token && (
          <p className="profile-hint">
            You’re browsing as a guest. Reconnect and choose “Log in with a registered account” to
            create a profile.
          </p>
        )}

        <JoinBox onJoin={irc.join} />

        <button className="browse-btn" onClick={openBrowser}>
          🧭 Browse all channels
        </button>

        <div className="nav-label">Channels</div>
        <nav className="buffers">
          {state.buffers.filter((b) => b !== irc.serverBuffer).length === 0 && (
            <p className="buffers-empty">Join a channel above to start chatting.</p>
          )}
          {state.buffers
            .filter((b) => b !== irc.serverBuffer)
            .map((buf) => {
              const ch = state.channels[buf];
              const label = (ch?.name ?? buf).replace(/^#/, '');
              return (
                <button
                  key={buf}
                  className={`buffer ${active === buf ? 'active' : ''}`}
                  onClick={() => irc.setActive(buf)}
                >
                  <span className="buffer-hash">#</span>
                  <span className="buffer-name">{label}</span>
                  {ch && ch.unread > 0 && <span className="badge">{ch.unread}</span>}
                </button>
              );
            })}
        </nav>

        <div className="sidebar-footer">
          {isAdmin && (
            <button className="admin-announce-btn" onClick={() => setAnnouncing(true)}>
              📢 Post announcement
            </button>
          )}
          <button
            className={`console-btn ${active === irc.serverBuffer ? 'active' : ''}`}
            onClick={() => irc.setActive(irc.serverBuffer)}
            title="Raw server messages and system log"
          >
            <span className="console-icon">›_</span> Server console
          </button>
        </div>
      </aside>

      <main className="main">
        {channel ? (
          <>
            <header className="chan-head">
              <div className="chan-title">
                <span className="chan-hash">#</span>
                <span className="chan-name">{channel.name.replace(/^#/, '')}</span>
                <span className="chan-meta">{channel.members.length} online</span>
              </div>
              <div className="chan-actions">
                <button
                  className={`toggle-btn ${showMembers ? 'active' : ''}`}
                  onClick={() => setShowMembers((v) => !v)}
                  title="Toggle members"
                >
                  👥 {channel.members.length}
                </button>
                <button
                  className={`toggle-btn ${showWatch ? 'active' : ''}`}
                  onClick={() => setShowWatch((v) => !v)}
                  title="Toggle watch party"
                >
                  📺
                </button>
                <button className="leave" onClick={() => irc.part(channel.name)}>
                  Leave
                </button>
              </div>
            </header>

            <div className={`content ${showRail ? '' : 'no-rail'}`}>
              <ChannelChat
                events={channel.events}
                draft={draft}
                setDraft={setDraft}
                onSend={(text) => irc.say(channel.name, text)}
                onEnqueue={(url) => irc.sendMedia(channel.name, { t: 'enqueue', url })}
              />
              {showRail && (
                <aside className="right-rail">
                  {showMembers && (
                    <MembersPanel
                      members={channel.members}
                      profiles={profiles}
                      onUserContext={openProfile}
                    />
                  )}
                  {showWatch && (
                    <MediaPanel channel={channel.name} media={channel.media} onSend={irc.sendMedia} />
                  )}
                </aside>
              )}
            </div>
          </>
        ) : (
          <>
            <header className="chan-head">
              <div className="chan-title">
                <span className="chan-name">Server console</span>
                <span className="chan-meta">raw server messages and system log</span>
              </div>
            </header>
            <ServerView events={state.serverLog} />
          </>
        )}
      </main>

      {target && (
        <MiniProfile
          nick={target.nick}
          info={state.whois[target.nick.toLowerCase()]}
          profile={profiles.get(target.nick)}
          x={target.x}
          y={target.y}
          onClose={() => setTarget(null)}
          onMention={mention}
        />
      )}
      {editing && state.token && state.account && (
        <ProfileEditor
          token={state.token}
          account={state.account}
          profile={myProfile}
          onClose={() => setEditing(false)}
          onSaved={(p) => profiles.set(p)}
        />
      )}
      {announcing && state.token && (
        <AdminAnnounce token={state.token} onClose={() => setAnnouncing(false)} />
      )}
      {browsing && (
        <ChannelBrowser
          items={state.channelList.items}
          loading={state.channelList.loading}
          joined={new Set(state.buffers.filter((b) => b !== irc.serverBuffer))}
          onJoin={irc.join}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

function MembersPanel({
  members,
  profiles,
  onUserContext,
}: {
  members: string[];
  profiles: Profiles;
  onUserContext: (nick: string, x: number, y: number) => void;
}) {
  const sorted = useMemo(() => [...members].sort((a, b) => a.localeCompare(b)), [members]);
  useEffect(() => {
    profiles.load(members);
  }, [members, profiles]);

  return (
    <div className="members-panel">
      <div className="rail-head">Members · {members.length}</div>
      <ul className="member-list">
        {sorted.map((m) => {
          const p = profiles.get(m);
          return (
            <li
              key={m}
              className="member-item"
              title="Click or right-click for profile"
              onClick={(e) => onUserContext(m, e.clientX, e.clientY)}
              onContextMenu={(e) => {
                e.preventDefault();
                onUserContext(m, e.clientX, e.clientY);
              }}
            >
              <Avatar name={m} src={p?.avatar} size={26} />
              <span className="member-name">{p?.displayName || m}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AdminAnnounce({ token, onClose }: { token: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await postAnnouncement(token, trimmed);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Post announcement">
        <h2>Post announcement</h2>
        <p className="pe-hint">Broadcasts live into every open chat.</p>
        <textarea
          value={text}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder="Announcement…"
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="pe-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} onClick={send}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Connect({ onConnect }: { onConnect: (nick: string, creds?: LoginCreds) => void }) {
  const [nick, setNick] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = nick.trim() || account.trim();
    if (!n) return;
    const creds =
      showLogin && account.trim() && password ? { account: account.trim(), password } : undefined;
    onConnect(n, creds);
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
        <p className="tagline">Media webchat, reborn.</p>
        <input
          autoFocus
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder={showLogin ? 'Nickname (defaults to account)' : 'Choose a nickname'}
          maxLength={32}
        />
        {showLogin && (
          <>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="NickServ account"
              autoComplete="username"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
            />
          </>
        )}
        <button type="submit">{showLogin ? 'Log in & connect' : 'Connect'}</button>
        <button type="button" className="link-btn" onClick={() => setShowLogin((v) => !v)}>
          {showLogin ? 'Connect as guest instead' : 'Log in with a registered account'}
        </button>
      </form>
    </div>
  );
}

function JoinBox({ onJoin }: { onJoin: (channel: string) => void }) {
  const [name, setName] = useState('lobby');
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
        onFocus={(e) => e.target.select()}
        placeholder="join a #channel"
      />
      <button type="submit">Join</button>
    </form>
  );
}

function ChannelChat({
  events,
  draft,
  setDraft,
  onSend,
  onEnqueue,
}: {
  events: ChatEvent[];
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  onSend: (text: string) => void;
  onEnqueue: (url: string) => void;
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
        {events.map((ev) => (
          <Message key={ev.id} event={ev} onEnqueue={onEnqueue} />
        ))}
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
          placeholder="Message…  (paste a link to share media)"
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
