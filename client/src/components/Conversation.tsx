import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COMMANDS, type BotInfo } from '@qchat/shared';
import type { ChatEvent } from '../types.js';
import { SHORTCODES, suggestEmoji } from '../emojiShortcodes.js';
import { EmojiPicker } from './EmojiPicker.js';
import { Message } from './Message.js';

export interface SendExtra {
  replyTo?: string;
  image?: string;
}

interface Props {
  events: ChatEvent[];
  more: boolean;
  loadingMore: boolean;
  onLoadEarlier: () => void;
  /** Who is typing, with when each indicator expires. */
  typing: Record<string, number>;
  me: string;
  /** Profile photo for a name, if they have one (loaded on demand). */
  avatarFor: (name: string) => string | undefined;
  placeholder: string;
  /** Rooms support slash commands; private chats only /me. */
  commandRank: number | null;
  onSend: (text: string, extra?: SendExtra) => void;
  onTyping: () => void;
  /** Extra buttons before the emoji picker (the soundboard in rooms). */
  tools?: ReactNode;
  /** May the viewer delete other people's messages here? */
  canModerate: boolean;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onProfile: (name: string) => void;
  /** The pinned messages and rules, shown above the conversation. */
  notes?: ReactNode;
  /** The bots in this room, to show their pictures on what they said. */
  bots?: BotInfo[];
  /** Add a link from the chat to the room's queue. */
  onEnqueue?: (url: string) => void;
  /** Names that @ can complete (the people in the room, and its bots). */
  mentionable?: string[];
  onClear?: () => void;
  /** Room-only extras: replies, reactions, reports and pictures. */
  rich?: {
    onReact: (id: string, emoji: string) => void;
    onReport: (id: string) => void;
    /** Moderators: pin or unpin a message. */
    onPin?: (id: string, pin: boolean) => void;
    pinnedIds?: string[];
    /** Upload a picture and return its stored name. */
    onUpload: (file: File) => Promise<string>;
  };
}

const GROUP_GAP = 5 * 60 * 1000;
const MAX_IMAGE = 3 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

const snippet = (e: ChatEvent) => (e.text || (e.image ? 'a picture' : '')).slice(0, 80);

export function Conversation(p: Props) {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  // Where the caret should sit once a suggestion or an emoji has been put into the text.
  const wantCaret = useRef<number | null>(null);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [replyTo, setReplyTo] = useState<ChatEvent | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const stick = useRef(true);
  const last = useRef({ firstId: '', height: 0, count: 0 });
  const lastTypingSent = useRef(0);
  const [ticks, tick] = useState(0);

  // Who is typing right now (entries expire on their own).
  const typers = Object.entries(p.typing)
    .filter(([name, until]) => until > Date.now() && name.toLowerCase() !== p.me.toLowerCase())
    .map(([name]) => name);

  // Re-check every second while anyone is typing so the indicator goes away.
  useEffect(() => {
    if (Object.keys(p.typing).length === 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), 1000);
    return () => window.clearTimeout(t);
  }, [p.typing, ticks]);

  // Stay at the bottom for new messages, but hold your place when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const prev = last.current;
    const firstId = p.events[0]?.id ?? '';
    const prepended = prev.firstId !== '' && firstId !== prev.firstId && p.events.some((e) => e.id === prev.firstId);
    if (prepended) {
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (stick.current || p.events.at(-1)?.self) {
      el.scrollTop = el.scrollHeight;
    }
    last.current = { firstId, height: el.scrollHeight, count: p.events.length };
  }, [p.events]);

  useLayoutEffect(() => {
    if (wantCaret.current !== null) {
      input.current?.setSelectionRange(wantCaret.current, wantCaret.current);
      wantCaret.current = null;
    }
  }, [draft]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const hints = useMemo(() => {
    if (p.commandRank === null || !draft.startsWith('/') || /\s/.test(draft)) return [];
    const typed = draft.toLowerCase();
    return COMMANDS.filter((c) => {
      if (c.level === 'owner' && p.commandRank! < 3) return false;
      if (c.level === 'mod' && p.commandRank! < 2) return false;
      return c.usage.split(' ')[0].startsWith(typed);
    }).slice(0, 6);
  }, [draft, p.commandRank]);

  /** What the typing so far could become: a name after @, or an emoji after :. */
  const suggestions = useMemo(() => {
    if (draft.startsWith('/')) return [];
    const before = draft.slice(0, caret);
    const at = /(^|\s)@([A-Za-z0-9_-]{0,23})$/.exec(before);
    if (at && p.mentionable) {
      const q = at[2].toLowerCase();
      const names = p.mentionable.filter((n) => n.toLowerCase() !== p.me.toLowerCase());
      const starts = names.filter((n) => n.toLowerCase().startsWith(q));
      const has = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
      const from = at.index + at[1].length;
      return [...starts, ...has].slice(0, 7).map((n) => ({ key: '@' + n, label: n, hint: '', from, insert: `@${n} ` }));
    }
    const em = /(^|\s):([a-z0-9_+-]{2,})$/i.exec(before);
    if (em) {
      const from = em.index + em[1].length;
      return suggestEmoji(em[2]).map((s) => ({ key: ':' + s.name, label: s.emoji, hint: `:${s.name}:`, from, insert: s.emoji }));
    }
    return [];
  }, [draft, caret, p.mentionable, p.me]);
  const showSuggest = suggestions.length > 0 && dismissed !== draft.slice(0, caret);
  useEffect(() => setPick(0), [suggestions.length, draft.slice(0, caret)]);

  const accept = (s: { from: number; insert: string }) => {
    const next = draft.slice(0, s.from) + s.insert + draft.slice(caret);
    const pos = s.from + s.insert.length;
    setDraft(next);
    setCaret(pos);
    wantCaret.current = pos;
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(suggestions[Math.min(pick, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(draft.slice(0, caret));
        return;
      }
    }
    if (e.key === 'Escape') setReplyTo(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (p.commandRank !== null && text.toLowerCase() === '/clear') return p.onClear?.();
    // Commands are never replies.
    const isCommand = text.startsWith('/') && !text.startsWith('//');
    p.onSend(text, replyTo && !isCommand ? { replyTo: replyTo.id } : undefined);
    setReplyTo(null);
  };

  const onChange = (value: string, at: number) => {
    // A finished :name: turns into the emoji straight away.
    const done = /(^|\s):([a-z0-9_+-]{2,}):$/i.exec(value.slice(0, at));
    const emoji = done ? SHORTCODES[done[2].toLowerCase()] : undefined;
    if (done && emoji) {
      const from = done.index + done[1].length;
      value = value.slice(0, from) + emoji + value.slice(at);
      at = from + emoji.length;
      wantCaret.current = at;
    }
    setCaret(at);
    setDraft(value);
    const now = Date.now();
    if (value && !value.startsWith('/') && now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      p.onTyping();
    }
  };

  /** Upload a picture and post it (with whatever is typed as its caption). */
  const attach = async (file: File | undefined | null) => {
    if (!file || !p.rich) return;
    setUploadError(null);
    if (!IMAGE_TYPES.includes(file.type)) return setUploadError('Only PNG, JPG, GIF and WebP pictures can be shared.');
    if (file.size > MAX_IMAGE) return setUploadError('That picture is too big. The limit is 3 MB.');
    setUploading(true);
    try {
      const name = await p.rich.onUpload(file);
      p.onSend(draft.trim(), { image: name, ...(replyTo ? { replyTo: replyTo.id } : {}) });
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file && p.rich) {
      e.preventDefault();
      void attach(file);
    }
  };

  return (
    <div
      className={`chat ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (p.rich && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!p.rich) return;
        e.preventDefault();
        void attach(e.dataTransfer.files[0]);
      }}
    >
      {dragging && <div className="drop-hint">Drop a picture to share it</div>}
      {p.notes}
      <div className="messages" ref={scroller} onScroll={onScroll} role="log" aria-label="Messages" aria-relevant="additions">
        {p.more && (
          <button className="load-earlier" onClick={p.onLoadEarlier} disabled={p.loadingMore}>
            {p.loadingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {p.events.map((ev, i) => {
          const prev = p.events[i - 1];
          const grouped =
            ev.kind === 'message' && prev?.kind === 'message' && prev.from === ev.from && ev.ts - prev.ts < GROUP_GAP;
          const editable = ev.self && ev.kind === 'message';
          const deletable = (ev.kind === 'message' || ev.kind === 'action') && (ev.self || p.canModerate);
          const social = !!p.rich && (ev.kind === 'message' || ev.kind === 'action');
          return (
            <Message
              key={ev.id}
              event={ev}
              me={p.me}
              grouped={grouped}
              avatar={ev.from ? p.avatarFor(ev.from) : undefined}
              botEmoji={ev.bot ? p.bots?.find((b) => b.name === ev.from)?.emoji : undefined}
              onProfile={p.onProfile}
              onEnqueue={p.onEnqueue}
              onEdit={editable ? (text) => p.onEdit(ev.id, text) : undefined}
              onDelete={deletable ? () => p.onDelete(ev.id) : undefined}
              onReply={
                social
                  ? () => {
                      setReplyTo(ev);
                      input.current?.focus();
                    }
                  : undefined
              }
              onReact={social ? (emoji) => p.rich!.onReact(ev.id, emoji) : undefined}
              onReport={social && !ev.self ? () => p.rich!.onReport(ev.id) : undefined}
              onPin={social && ev.kind === 'message' && p.rich?.onPin ? () => p.rich!.onPin!(ev.id, !p.rich!.pinnedIds?.includes(ev.id)) : undefined}
              pinned={!!p.rich?.pinnedIds?.includes(ev.id)}
            />
          );
        })}
      </div>

      <div className="typing-line" aria-live="polite">
        {uploading ? 'Uploading picture…' : typingLabel(typers)}
      </div>

      {uploadError && (
        <div className="upload-error" role="alert">
          {uploadError}
          <button type="button" onClick={() => setUploadError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {replyTo && (
        <div className="reply-bar">
          <span>
            Replying to <b>{replyTo.from}</b>: {snippet(replyTo)}
          </span>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
        </div>
      )}

      {showSuggest && (
        <div className="cmd-hints" role="listbox" aria-label="Suggestions">
          {suggestions.map((s, i) => (
            <button
              type="button"
              key={s.key}
              role="option"
              aria-selected={i === pick}
              className={`cmd-hint ${i === pick ? 'picked' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => accept(s)}
            >
              <b>{s.label}</b>
              {s.hint && <span>{s.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {hints.length > 0 && (
        <div className="cmd-hints" role="listbox">
          {hints.map((c) => (
            <button
              type="button"
              key={c.usage}
              className="cmd-hint"
              onClick={() => {
                setDraft(`${c.usage.split(' ')[0]} `);
                input.current?.focus();
              }}
            >
              <b>{c.usage}</b>
              <span>{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        {p.tools}
        {p.rich && (
          <>
            <button
              type="button"
              className="attach-btn"
              title="Share a picture"
              aria-label="Share a picture"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              📎
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              hidden
              onChange={(e) => void attach(e.target.files?.[0])}
            />
          </>
        )}
        <EmojiPicker
          onPick={(emoji) => {
            setDraft((d) => d + emoji);
            input.current?.focus();
          }}
        />
        <input
          ref={input}
          value={draft}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          aria-label={p.placeholder}
          aria-autocomplete="list"
          onPaste={onPaste}
          onKeyDown={onKey}
          placeholder={p.placeholder}
          maxLength={2000}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
