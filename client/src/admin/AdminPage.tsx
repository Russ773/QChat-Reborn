import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminBot, AdminReport, AdminRoom, AdminStats, AdminUser, AuditEntry, SiteSettings } from '@qchat/shared';
import { Avatar } from '../components/Avatar.js';
import { LogoMark, Wordmark } from '../components/Logo.js';
import { adminApi } from './adminApi.js';

type Tab = 'dashboard' | 'members' | 'rooms' | 'bots' | 'reports' | 'announce' | 'settings' | 'audit';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'members', label: 'Members', icon: '👥' },
  { id: 'rooms', label: 'Rooms', icon: '💬' },
  { id: 'bots', label: 'Bots', icon: '🤖' },
  { id: 'reports', label: 'Reports', icon: '🚩' },
  { id: 'announce', label: 'Announcements', icon: '📢' },
  { id: 'settings', label: 'Site settings', icon: '⚙️' },
  { id: 'audit', label: 'Audit log', icon: '🧾' },
];

const roomLabel = (name: string) => name.replace(/^#/, '');
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const ACTION_LABEL: Record<string, string> = {
  suspend: 'Suspended a member',
  unsuspend: 'Unsuspended a member',
  'make-admin': 'Made someone an admin',
  'remove-admin': 'Removed admin rights',
  'reset-password': 'Reset a password',
  'delete-member': 'Deleted a member',
  disconnect: 'Disconnected a member',
  'force-logout': 'Logged a member out',
  settings: 'Changed site settings',
  announce: 'Sent an announcement',
  'close-room': 'Closed a room',
  'stop-video': 'Stopped a video',
  'kick-from-room': 'Removed someone from a room',
  'resolve-report': 'Dealt with a report',
  'create-bot': 'Created a bot',
  'edit-bot': 'Edited a bot',
  'delete-bot': 'Deleted a bot',
  'bot-say': 'Made a bot speak',
  'create-room': 'Created a server room',
  'delete-room': 'Deleted a server room',
  'set-topic': 'Changed a room topic',
  'make-server-room': 'Made a room server owned',
};

/** Load data once, and again whenever reload() is called. */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    fn()
      .then((d) => {
        if (!dead) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!dead) setError(e.message);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

// --- Confirm / input dialog ---------------------------------------------------

interface DialogSpec {
  title: string;
  message?: string;
  input?: { label: string; type?: string; placeholder?: string; optional?: boolean };
  confirmLabel: string;
  danger?: boolean;
  run: (value: string) => Promise<void>;
}

function ActionDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (spec.input && !spec.input.optional && !value.trim()) {
      setError(`${spec.input.label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await spec.run(value.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label={spec.title}>
        <h2 className="modal-title">{spec.title}</h2>
        {spec.message && <p className="dialog-msg">{spec.message}</p>}
        {spec.input && (
          <label className="dialog-field">
            {spec.input.label}
            <input
              autoFocus
              type={spec.input.type ?? 'text'}
              value={value}
              placeholder={spec.input.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={spec.danger ? 'danger' : ''} disabled={busy}>
            {busy ? 'Working…' : spec.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Shared props for the tabs --------------------------------------------------

interface TabProps {
  token: string;
  me: string;
  notify: (msg: string) => void;
  ask: (spec: DialogSpec) => void;
}

// --- Dashboard --------------------------------------------------------------------

function Dashboard({ token }: TabProps) {
  const stats = useLoad<AdminStats>(() => adminApi.stats(token), [token]);
  const audit = useLoad<AuditEntry[]>(() => adminApi.audit(token), [token]);

  // Keep the live numbers fresh.
  useEffect(() => {
    const iv = window.setInterval(stats.reload, 10000);
    return () => window.clearInterval(iv);
  }, [stats.reload]);

  const s = stats.data;
  const cards: { label: string; value: number | string; sub?: string; tone: string }[] = s
    ? [
        { label: 'Members', value: s.members, sub: `${s.admins} admin${s.admins === 1 ? '' : 's'}`, tone: 'blue' },
        { label: 'Online now', value: s.online, sub: 'connected to chat', tone: 'green' },
        { label: 'New this week', value: s.newThisWeek, sub: 'sign ups', tone: 'gold' },
        { label: 'Rooms', value: s.rooms, sub: 'open right now', tone: 'pink' },
        { label: 'Videos playing', value: s.videos, sub: 'across all rooms', tone: 'purple' },
        { label: 'Suspended', value: s.suspended, sub: 'members', tone: 'red' },
        {
          label: 'Open reports',
          value: s.openReports,
          sub: 'waiting for review',
          tone: s.openReports > 0 ? 'red' : 'green',
        },
      ]
    : [];

  return (
    <>
      <PageHead title="Dashboard" sub="A live look at how QChat is doing." />
      {stats.error && <p className="pm-error">{stats.error}</p>}
      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className={`stat-card tone-${c.tone}`}>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
            {c.sub && <div className="stat-sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">Recent admin activity</div>
        {!audit.data && <p className="muted">Loading…</p>}
        {audit.data && audit.data.length === 0 && <p className="muted">Nothing yet. Actions you take here will show up in this list.</p>}
        {audit.data?.slice(0, 8).map((e) => (
          <div className="activity-row" key={e.id}>
            <span className="activity-what">
              <b>{e.admin}</b> {ACTION_LABEL[e.action] ?? e.action}
              {e.target ? <span className="activity-target"> · {roomLabel(e.target)}</span> : null}
            </span>
            <span className="activity-when">{ago(e.ts)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// --- Members -----------------------------------------------------------------------

function Members({ token, me, notify, ask }: TabProps) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const users = useLoad<AdminUser[]>(() => adminApi.users(token, debounced), [token, debounced]);

  const done = (msg: string) => async () => {
    notify(msg);
    users.reload();
  };

  const act = (u: AdminUser) => ({
    role: () =>
      ask({
        title: u.role === 'admin' ? `Remove admin rights from ${u.account}?` : `Make ${u.account} an admin?`,
        message:
          u.role === 'admin'
            ? 'They will lose access to this admin area straight away.'
            : 'Admins can manage members, rooms and settings. Only do this for people you trust fully.',
        confirmLabel: u.role === 'admin' ? 'Remove admin' : 'Make admin',
        danger: u.role !== 'admin',
        run: async () => {
          await adminApi.setRole(token, u.account, u.role === 'admin' ? 'user' : 'admin');
          await done(`${u.account} is now ${u.role === 'admin' ? 'a normal member' : 'an admin'}.`)();
        },
      }),
    suspend: () =>
      u.suspended
        ? ask({
            title: `Unsuspend ${u.account}?`,
            message: 'They will be able to log in and chat again.',
            confirmLabel: 'Unsuspend',
            run: async () => {
              await adminApi.suspend(token, u.account, false);
              await done(`${u.account} was unsuspended.`)();
            },
          })
        : ask({
            title: `Suspend ${u.account}?`,
            message: 'They are disconnected now and cannot log in until you unsuspend them.',
            input: { label: 'Reason (they will see this)', placeholder: 'e.g. spamming the lobby', optional: true },
            confirmLabel: 'Suspend',
            danger: true,
            run: async (reason) => {
              await adminApi.suspend(token, u.account, true, reason);
              await done(`${u.account} was suspended.`)();
            },
          }),
    password: () =>
      ask({
        title: `Reset password for ${u.account}`,
        message: 'They will be logged out everywhere and must use the new password. Tell them what it is.',
        input: { label: 'New password (8 or more characters)', type: 'text', placeholder: 'new password' },
        confirmLabel: 'Reset password',
        run: async (pw) => {
          await adminApi.resetPassword(token, u.account, pw);
          await done(`Password reset for ${u.account}.`)();
        },
      }),
    logout: () =>
      ask({
        title: `Log ${u.account} out everywhere?`,
        message: 'They are disconnected and will have to log in again.',
        confirmLabel: 'Log out',
        run: async () => {
          await adminApi.forceLogout(token, u.account);
          await done(`${u.account} was logged out.`)();
        },
      }),
    remove: () =>
      ask({
        title: `Delete ${u.account}?`,
        message: 'This permanently deletes the account, profile and avatar. It cannot be undone.',
        confirmLabel: 'Delete account',
        danger: true,
        run: async () => {
          await adminApi.deleteUser(token, u.account);
          await done(`${u.account} was deleted.`)();
        },
      }),
  });

  return (
    <>
      <PageHead title="Members" sub="Everyone with an account. Search by username or email." />
      <input
        className="admin-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search members…"
        autoFocus
      />
      {users.error && <p className="pm-error">{users.error}</p>}
      <div className="panel flush">
        {!users.data && <p className="muted pad">Loading…</p>}
        {users.data && users.data.length === 0 && <p className="muted pad">No members match that search.</p>}
        {users.data?.map((u) => {
          const self = u.account.toLowerCase() === me.toLowerCase();
          const a = act(u);
          return (
            <div className="member-row" key={u.account}>
              <div className="mr-who">
                <Avatar name={u.account} src={u.avatar} size={40} />
                <div className="mr-names">
                  <span className="mr-name">
                    {u.displayName || u.account}
                    {self && <span className="pill you">you</span>}
                    {u.role === 'admin' && <span className="pill admin">admin</span>}
                    {u.suspended && <span className="pill bad">suspended</span>}
                  </span>
                  <span className="mr-sub">
                    @{u.account}
                    {u.email ? ` · ${u.email}` : ''}
                  </span>
                  {u.suspended && u.suspendedReason && <span className="mr-reason">Reason: {u.suspendedReason}</span>}
                </div>
              </div>
              <div className="mr-meta">
                <span className={`mr-online ${u.online ? 'on' : ''}`}>{u.online ? 'Online' : `Seen ${ago(u.lastLogin)}`}</span>
                <span className="mr-joined">Joined {fmtDate(u.createdAt)}</span>
              </div>
              <div className="mr-actions">
                {self ? (
                  <button className="mini" onClick={a.password}>Reset password</button>
                ) : (
                  <>
                    <button className="mini" onClick={a.role}>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
                    {u.role !== 'admin' && (
                      <button className="mini" onClick={a.suspend}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                    )}
                    <button className="mini" onClick={a.password}>Reset password</button>
                    {u.online && <button className="mini" onClick={a.logout}>Log out</button>}
                    {u.role !== 'admin' && <button className="mini danger" onClick={a.remove}>Delete</button>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// --- Rooms -------------------------------------------------------------------------

function ServerRoomEditor({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createRoom(token, name, topic);
      onCreated(name);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={save} role="dialog" aria-label="New server room">
        <h2 className="modal-title">New server room</h2>
        <p className="dialog-msg">
          A server room is kept for good and has no owner, so only administrators run it. It never expires.
        </p>
        <label className="dialog-field">
          Name
          <input autoFocus value={name} maxLength={31} onChange={(e) => setName(e.target.value)} placeholder="e.g. music" />
        </label>
        <label className="dialog-field">
          Topic <span className="optional">(optional)</span>
          <input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder="What is this room about?" />
        </label>
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create room'}</button>
        </div>
      </form>
    </div>
  );
}

function Rooms({ token, me, notify, ask }: TabProps) {
  const rooms = useLoad<AdminRoom[]>(() => adminApi.rooms(token), [token]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const iv = window.setInterval(rooms.reload, 5000);
    return () => window.clearInterval(iv);
  }, [rooms.reload]);

  const sorted = useMemo(
    () => [...(rooms.data ?? [])].sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name)),
    [rooms.data],
  );

  return (
    <>
      <PageHead title="Rooms" sub="Every room that exists right now. Updates live." />
      <div className="seg-actions">
        <button onClick={() => setCreating(true)}>+ New server room</button>
      </div>
      {creating && (
        <ServerRoomEditor
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            notify(`${roomLabel(name)} was created.`);
            rooms.reload();
          }}
        />
      )}
      {rooms.error && <p className="pm-error">{rooms.error}</p>}
      {!rooms.data && <p className="muted">Loading…</p>}
      <div className="room-cards">
        {sorted.map((r) => (
          <div className="panel room-card" key={r.name}>
            <div className="rc-head">
              <div className="rc-name">
                {roomLabel(r.name)}
                <span className={`pill ${r.permanent ? '' : 'user'}`}>
                  {r.builtin ? 'built in' : r.permanent ? 'server room' : 'user room'}
                </span>
              </div>
              <div className="rc-count">
                {r.members.length} here · {r.lines} saved messages
                {r.owner ? ` · owner ${r.owner}` : ''}
              </div>
              {r.topic && <div className="rc-topic">{r.topic}</div>}
            </div>

            {r.members.length === 0 ? (
              <p className="muted small">Nobody is in this room.</p>
            ) : (
              <div className="chips">
                {r.members.map((m) => (
                  <span className="chip" key={m}>
                    {m}
                    {m.toLowerCase() !== me.toLowerCase() && (
                      <button
                        className="chip-x"
                        title={`Remove ${m} from this room`}
                        onClick={() =>
                          ask({
                            title: `Remove ${m} from ${roomLabel(r.name)}?`,
                            message: 'They are taken out of the room but can rejoin.',
                            confirmLabel: 'Remove',
                            danger: true,
                            run: async () => {
                              await adminApi.kick(token, r.name, m);
                              notify(`${m} was removed from ${roomLabel(r.name)}.`);
                              rooms.reload();
                            },
                          })
                        }
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {r.media && (
              <div className="rc-media">
                <span>▶ Video playing · started by {r.media.by}{r.media.paused ? ' · paused' : ''}</span>
                <button
                  className="mini"
                  onClick={async () => {
                    try {
                      await adminApi.stopMedia(token, r.name);
                      notify('Video stopped.');
                      rooms.reload();
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Stop video
                </button>
              </div>
            )}

            <div className="rc-actions">
              <button
                className="mini"
                onClick={() =>
                  ask({
                    title: `Topic for ${roomLabel(r.name)}`,
                    message: 'Everyone in the room sees the new topic straight away. Leave it empty to clear the topic.',
                    input: { label: 'Topic', placeholder: r.topic ?? 'What is this room about?', optional: true },
                    confirmLabel: 'Set topic',
                    run: async (value) => {
                      await adminApi.setRoomTopic(token, r.name, value);
                      notify('Topic updated.');
                      rooms.reload();
                    },
                  })
                }
              >
                Set topic
              </button>
              {!r.permanent && (
                <button
                  className="mini"
                  onClick={() =>
                    ask({
                      title: `Make ${roomLabel(r.name)} a server room?`,
                      message: 'It is kept for good (it never expires) and has no owner, so only administrators run it.',
                      confirmLabel: 'Make server room',
                      run: async () => {
                        await adminApi.makeServerRoom(token, r.name);
                        notify(`${roomLabel(r.name)} is now a server room.`);
                        rooms.reload();
                      },
                    })
                  }
                >
                  Make server room
                </button>
              )}
              {r.permanent && !r.builtin && (
                <button
                  className="mini danger"
                  onClick={() =>
                    ask({
                      title: `Delete ${roomLabel(r.name)}?`,
                      message: 'Everyone is removed and the room is deleted for good, with all of its saved messages.',
                      confirmLabel: 'Delete room',
                      danger: true,
                      run: async () => {
                        await adminApi.deleteRoom(token, r.name);
                        notify(`${roomLabel(r.name)} was deleted.`);
                        rooms.reload();
                      },
                    })
                  }
                >
                  Delete room
                </button>
              )}
              <button
                className="mini danger"
                onClick={() =>
                  ask({
                    title: `Close ${roomLabel(r.name)}?`,
                    message: r.permanent
                      ? 'Everyone is removed and all of its saved messages are deleted. The room itself stays.'
                      : 'Everyone is removed and the room is deleted along with its saved messages.',
                    confirmLabel: 'Close room',
                    danger: true,
                    run: async () => {
                      await adminApi.closeRoom(token, r.name);
                      notify(`${roomLabel(r.name)} was closed.`);
                      rooms.reload();
                    },
                  })
                }
              >
                Close room
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// --- Announcements --------------------------------------------------------------------

function Announce({ token, notify }: TabProps) {
  const [text, setText] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rooms = useLoad<AdminRoom[]>(() => adminApi.rooms(token), [token]);
  const audit = useLoad<AuditEntry[]>(() => adminApi.audit(token), [token]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write an announcement first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi.announce(token, text.trim(), room || undefined);
      notify(`Sent to ${r.reached} ${r.reached === 1 ? 'person' : 'people'}.`);
      setText('');
      audit.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const past = audit.data?.filter((e) => e.action === 'announce').slice(0, 10) ?? [];

  return (
    <>
      <PageHead title="Announcements" sub="Send a message to everyone, or just one room. It appears as a banner and in the chat." />
      <form className="panel" onSubmit={send}>
        <label className="dialog-field">
          Message
          <textarea
            rows={4}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. We are restarting the server at 10pm tonight."
          />
        </label>
        <div className="form-row">
          <label className="dialog-field grow">
            Send to
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">Everyone online</option>
              {(rooms.data ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  Just {roomLabel(r.name)} ({r.members.length} here)
                </option>
              ))}
            </select>
          </label>
          <span className="char-count">{text.length}/500</span>
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send announcement'}
          </button>
        </div>
        {error && <p className="pm-error">{error}</p>}
      </form>

      <div className="panel">
        <div className="panel-title">Recently sent</div>
        {past.length === 0 && <p className="muted">Nothing sent yet.</p>}
        {past.map((e) => (
          <div className="activity-row" key={e.id}>
            <span className="activity-what">
              <b>{e.admin}</b> to {e.target === 'everyone' ? 'everyone' : roomLabel(e.target ?? '')}: {e.detail}
            </span>
            <span className="activity-when">{ago(e.ts)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// --- Site settings ----------------------------------------------------------------------

function Settings({ token, notify, ask }: TabProps) {
  const loaded = useLoad<SiteSettings>(() => adminApi.settings(token), [token]);
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);

  const dirty = !!form && !!loaded.data && JSON.stringify(form) !== JSON.stringify(loaded.data);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.saveSettings(token, form);
      notify('Settings saved.');
      loaded.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    if (form?.maintenance && !loaded.data?.maintenance) {
      ask({
        title: 'Turn on maintenance mode?',
        message: 'Everyone who is not an admin is disconnected now and cannot log in until you turn it off.',
        confirmLabel: 'Turn on maintenance',
        danger: true,
        run: save,
      });
    } else {
      void save();
    }
  };

  if (!form) return <p className="muted">{loaded.error ?? 'Loading…'}</p>;

  return (
    <>
      <PageHead title="Site settings" sub="Changes take effect straight away." />
      <div className="panel">
        <Switch
          label="Sign ups are open"
          help="When off, nobody new can create an account. People who already have one are not affected."
          checked={form.registrationOpen}
          onChange={(v) => setForm({ ...form, registrationOpen: v })}
        />
        <Switch
          label="Maintenance mode"
          help="Only admins can log in or stay connected. Everyone else sees a maintenance message."
          checked={form.maintenance}
          danger
          onChange={(v) => setForm({ ...form, maintenance: v })}
        />
        <Switch
          label="QBot welcomes new members"
          help="QBot says hello the first time someone joins a room, and points them to !help."
          checked={form.qbotWelcome}
          onChange={(v) => setForm({ ...form, qbotWelcome: v })}
        />
        <Switch
          label="QBot answers commands"
          help="Members can type !help to see everything QBot does: dice, jokes, 8 ball, polls, reminders, the time, room topic and more."
          checked={form.qbotCommands}
          onChange={(v) => setForm({ ...form, qbotCommands: v })}
        />
        <label className="dialog-field">
          Welcome message
          <textarea
            rows={3}
            maxLength={300}
            value={form.welcomeMessage}
            onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
            placeholder="Shown to everyone as they join a room. Leave empty for none."
          />
        </label>
        <label className="dialog-field">
          Blocked words and phrases
          <textarea
            rows={4}
            maxLength={2000}
            value={form.blockedWords}
            onChange={(e) => setForm({ ...form, blockedWords: e.target.value })}
            placeholder={'One per line. A message containing one is not sent. Whole words only, and look-alikes such as h3llo are caught. Admins are exempt.'}
          />
        </label>
        <label className="dialog-field">
          New members cannot post links for (minutes)
          <input
            type="number"
            min={0}
            max={1440}
            value={form.newMemberLinkMinutes}
            onChange={(e) => setForm({ ...form, newMemberLinkMinutes: Math.max(0, Math.min(1440, Math.round(Number(e.target.value) || 0))) })}
          />
          <span className="field-help">Counted from when the account was made. 0 turns the rule off. Stops spam from brand new accounts.</span>
        </label>
        <label className="dialog-field">
          Contact email
          <input
            type="email"
            maxLength={120}
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            placeholder="Shown on the Terms and Privacy pages. Leave empty for none."
          />
        </label>
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button className="secondary" disabled={!dirty} onClick={() => setForm(loaded.data)}>
            Undo changes
          </button>
          <button disabled={!dirty || busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </>
  );
}

function Switch({
  label,
  help,
  checked,
  onChange,
  danger,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        <span className="switch-help">{help}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`switch ${danger ? 'danger' : ''}`} aria-hidden="true" />
    </label>
  );
}

// --- Bots -------------------------------------------------------------------------------------

const EMOJI_CHOICES = ['🤖', '🛰️', '🎲', '🎵', '📣', '🧠', '🦊', '🐙', '⭐', '🔔'];

function BotEditor({
  token,
  bot,
  onClose,
  onSaved,
}: {
  token: string;
  bot: AdminBot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const rooms = useLoad<AdminRoom[]>(() => adminApi.rooms(token), [token]);
  const [name, setName] = useState(bot?.name ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [emoji, setEmoji] = useState(bot?.emoji ?? '🤖');
  const [enabled, setEnabled] = useState(bot?.enabled ?? true);
  const [allRooms, setAllRooms] = useState(bot?.allRooms ?? true);
  const [picked, setPicked] = useState<string[]>(bot?.rooms ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builtin = bot?.builtin ?? false;

  const toggle = (r: string) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = { description, emoji, enabled, allRooms, rooms: picked };
      if (bot) await adminApi.updateBot(token, bot.name, form);
      else await adminApi.createBot(token, { ...form, name });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog bot-editor" onClick={(e) => e.stopPropagation()} onSubmit={save} role="dialog" aria-label="Bot">
        <h2 className="modal-title">{bot ? `Edit ${bot.name}` : 'New bot'}</h2>
        {!bot && (
          <label className="dialog-field">
            Name
            <input autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. QuizBot" />
          </label>
        )}
        <label className="dialog-field">
          Description <span className="optional">(what it is for)</span>
          <input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="dialog-field">
          Picture
          <div className="emoji-choices">
            {EMOJI_CHOICES.map((em) => (
              <button type="button" key={em} className={`emoji-choice ${emoji === em ? 'on' : ''}`} onClick={() => setEmoji(em)}>
                {em}
              </button>
            ))}
          </div>
        </div>
        {builtin ? (
          <p className="muted small">QBot is built in. It is always on and always in every room.</p>
        ) : (
          <>
            <label className="check-row">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Switched on
            </label>
            <label className="check-row">
              <input type="checkbox" checked={allRooms} onChange={(e) => setAllRooms(e.target.checked)} /> In every room
            </label>
            {!allRooms && (
              <div className="room-pick">
                {!rooms.data && <p className="muted small">Loading rooms…</p>}
                {rooms.data?.map((r) => (
                  <label className="check-row" key={r.name}>
                    <input type="checkbox" checked={picked.includes(r.name)} onChange={() => toggle(r.name)} /> {roomLabel(r.name)}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : bot ? 'Save' : 'Create bot'}</button>
        </div>
      </form>
    </div>
  );
}

function BotSpeak({ token, bot, notify, onClose }: { token: string; bot: AdminBot; notify: (m: string) => void; onClose: () => void }) {
  const rooms = useLoad<AdminRoom[]>(() => adminApi.rooms(token), [token]);
  const [room, setRoom] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const choices = (rooms.data ?? []).filter((r) => bot.allRooms || bot.rooms.includes(r.name));
  const current = room || choices[0]?.name || '';

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await adminApi.botSay(token, bot.name, current, text);
      notify(`${bot.name} spoke in ${roomLabel(current)}.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={send} role="dialog" aria-label="Speak as a bot">
        <h2 className="modal-title">Speak as {bot.name}</h2>
        <label className="dialog-field">
          Room
          <select value={current} onChange={(e) => setRoom(e.target.value)}>
            {choices.map((r) => (
              <option key={r.name} value={r.name}>{roomLabel(r.name)}</option>
            ))}
          </select>
        </label>
        <label className="dialog-field">
          Message
          <input autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!text.trim() || !current}>Send</button>
        </div>
      </form>
    </div>
  );
}

function Bots({ token, notify, ask }: TabProps) {
  const bots = useLoad<AdminBot[]>(() => adminApi.bots(token), [token]);
  const [editing, setEditing] = useState<AdminBot | 'new' | null>(null);
  const [speaking, setSpeaking] = useState<AdminBot | null>(null);

  const toggle = (b: AdminBot) =>
    adminApi
      .updateBot(token, b.name, { enabled: !b.enabled })
      .then(() => {
        notify(`${b.name} switched ${b.enabled ? 'off' : 'on'}.`);
        bots.reload();
      })
      .catch((e: Error) => notify(e.message));

  const remove = (b: AdminBot) =>
    ask({
      title: `Delete ${b.name}?`,
      message: 'It leaves every room. What it said earlier stays in the chat history.',
      confirmLabel: 'Delete bot',
      danger: true,
      run: async () => {
        await adminApi.deleteBot(token, b.name);
        notify(`${b.name} was deleted.`);
        bots.reload();
      },
    });

  const where = (b: AdminBot) =>
    b.allRooms ? 'Every room' : b.rooms.length ? b.rooms.map(roomLabel).join(', ') : 'No rooms yet';

  return (
    <>
      <PageHead title="Bots" sub="Bots live in rooms and are not counted as members. QBot is in every room." />
      <div className="seg-actions">
        <button onClick={() => setEditing('new')}>+ New bot</button>
      </div>
      {bots.error && <p className="pm-error">{bots.error}</p>}
      {!bots.data && <p className="muted">Loading…</p>}
      {bots.data?.map((b) => (
        <div className={`panel bot-card ${b.enabled ? '' : 'off'}`} key={b.name}>
          <div className="bot-card-main">
            <span className="avatar bot" style={{ width: 44, height: 44, fontSize: 24 }}>{b.emoji}</span>
            <div className="bot-card-text">
              <div className="bot-card-name">
                <b>{b.name}</b> <span className="bot-tag">BOT</span>
                {b.builtin && <span className="pill">Built in</span>}
                {!b.enabled && <span className="pill off">Off</span>}
              </div>
              <div className="muted small">{b.description || 'No description.'}</div>
              <div className="muted small">In: {where(b)}</div>
            </div>
          </div>
          <div className="report-actions">
            <button className="mini" onClick={() => setSpeaking(b)} disabled={!b.enabled}>Speak</button>
            <button className="mini" onClick={() => setEditing(b)}>Edit</button>
            {!b.builtin && <button className="mini" onClick={() => toggle(b)}>{b.enabled ? 'Switch off' : 'Switch on'}</button>}
            {!b.builtin && <button className="mini danger" onClick={() => remove(b)}>Delete</button>}
          </div>
        </div>
      ))}
      {editing && (
        <BotEditor
          token={token}
          bot={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            notify('Bot saved.');
            bots.reload();
          }}
        />
      )}
      {speaking && <BotSpeak token={token} bot={speaking} notify={notify} onClose={() => setSpeaking(null)} />}
    </>
  );
}

// --- Reports -----------------------------------------------------------------------------------

function Reports({ token, notify, ask }: TabProps) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const reports = useLoad<AdminReport[]>(() => adminApi.reports(token, filter), [token, filter]);

  const suspendAuthor = (r: AdminReport) =>
    ask({
      title: `Suspend ${r.author}?`,
      message: 'They are disconnected now and cannot log in until you unsuspend them in Members. The report stays open until you close it.',
      input: { label: 'Reason (they will see this)', placeholder: 'e.g. spamming the lobby', optional: true },
      confirmLabel: 'Suspend',
      danger: true,
      run: async (reason) => {
        await adminApi.suspend(token, r.author, true, reason);
        notify(`${r.author} was suspended.`);
      },
    });

  const resolve = (r: AdminReport, action: 'delete' | 'dismiss' | 'handled') => {
    const go = async () => {
      await adminApi.resolveReport(token, r.id, action);
      notify(action === 'delete' ? 'Message deleted and report closed.' : 'Report closed.');
      reports.reload();
    };
    if (action === 'delete') {
      ask({
        title: 'Delete this message?',
        message: `It will be removed from ${roomLabel(r.room)} for everyone, and every report about it is closed.`,
        confirmLabel: 'Delete message',
        danger: true,
        run: go,
      });
    } else {
      go().catch((e: Error) => notify(e.message));
    }
  };

  return (
    <>
      <PageHead title="Reports" sub="Messages members have flagged for review." />
      <div className="seg">
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Open</button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
      </div>
      {reports.error && <p className="pm-error">{reports.error}</p>}
      {!reports.data && <p className="muted">Loading…</p>}
      {reports.data?.length === 0 && (
        <div className="panel">
          <p className="muted">{filter === 'open' ? 'No open reports. All clear.' : 'Nobody has reported anything yet.'}</p>
        </div>
      )}
      {reports.data?.map((r) => (
        <div className={`panel report-card ${r.status}`} key={r.id}>
          <div className="report-meta">
            <span>
              <b>{r.author}</b> in <b>{roomLabel(r.room)}</b>
            </span>
            <span className="report-when">{fmtTime(r.ts)}</span>
          </div>
          <blockquote className="report-quote">
            {r.text || <i>(no text)</i>}
            {r.image && (
              <a href={r.image} target="_blank" rel="noreferrer noopener">
                <img className="report-image" src={r.image} alt="Reported picture" loading="lazy" />
              </a>
            )}
          </blockquote>
          <div className="report-reason">
            Reported by <b>{r.reporter}</b>
            {r.reason ? <>: {r.reason}</> : ' (no reason given)'}
          </div>
          {r.status === 'open' ? (
            <div className="report-actions">
              <button className="mini danger" onClick={() => resolve(r, 'delete')}>Delete message</button>
              <button className="mini danger" onClick={() => suspendAuthor(r)}>Suspend author</button>
              <button className="mini" onClick={() => resolve(r, 'handled')}>Mark handled</button>
              <button className="mini" onClick={() => resolve(r, 'dismiss')}>Dismiss</button>
            </div>
          ) : (
            <div className="report-done">
              Closed ({r.resolution}) by {r.resolvedBy}
              {r.resolvedAt ? `, ${fmtTime(r.resolvedAt)}` : ''}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// --- Audit log ------------------------------------------------------------------------------

function Audit({ token }: TabProps) {
  const audit = useLoad<AuditEntry[]>(() => adminApi.audit(token), [token]);
  return (
    <>
      <PageHead title="Audit log" sub="Every action an admin has taken, newest first." />
      {audit.error && <p className="pm-error">{audit.error}</p>}
      <div className="panel flush">
        {!audit.data && <p className="muted pad">Loading…</p>}
        {audit.data?.length === 0 && <p className="muted pad">No admin actions yet.</p>}
        {audit.data?.map((e) => (
          <div className="audit-row" key={e.id}>
            <span className="audit-when">{fmtTime(e.ts)}</span>
            <span className="audit-admin">{e.admin}</span>
            <span className="audit-what">
              {ACTION_LABEL[e.action] ?? e.action}
              {e.target ? <b> {roomLabel(e.target)}</b> : null}
              {e.detail ? <span className="audit-detail"> · {e.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      <p>{sub}</p>
    </header>
  );
}

// --- The page ---------------------------------------------------------------------------------

export function AdminPage({ token, me, onBack }: { token: string; me: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  const props: TabProps = { token, me, notify, ask: setDialog };

  return (
    <div className="admin-page">
      <aside className="admin-nav">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>
        <div className="admin-badge">Admin area</div>
        <nav className="admin-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`admin-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <span className="at-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <button className="secondary back-btn" onClick={onBack}>
          Back to chat
        </button>
      </aside>

      <main className="admin-main">
        {tab === 'dashboard' && <Dashboard {...props} />}
        {tab === 'members' && <Members {...props} />}
        {tab === 'rooms' && <Rooms {...props} />}
        {tab === 'bots' && <Bots {...props} />}
        {tab === 'reports' && <Reports {...props} />}
        {tab === 'announce' && <Announce {...props} />}
        {tab === 'settings' && <Settings {...props} />}
        {tab === 'audit' && <Audit {...props} />}
      </main>

      {dialog && <ActionDialog spec={dialog} onClose={() => setDialog(null)} />}
      {toast && <div className="toast ok" role="status">{toast}</div>}
    </div>
  );
}
