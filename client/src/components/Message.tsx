import { useEffect, useRef, useState } from 'react';
import type { ChatEvent } from '../types.js';
import { classify, linkify } from '../media/urls.js';
import { colorForNick } from '../colors.js';
import { Avatar } from './Avatar.js';

interface Props {
  event: ChatEvent;
  /** True when this message continues a run from the same author (hide header). */
  grouped?: boolean;
  /** Invoked when a user clicks "add to queue" on a detected media link. */
  onEnqueue?: (url: string) => void;
  /** Present when the viewer may edit it (their own message). */
  onEdit?: (text: string) => void;
  /** Present when the viewer may delete it (their own, or they moderate the room). */
  onDelete?: () => void;
  /** Open the author's profile. */
  onProfile?: (name: string) => void;
  /** The author's profile photo, if they have one. */
  avatar?: string;
}

export function Message({ event, grouped, onEnqueue, onEdit, onDelete, onProfile, avatar }: Props) {
  const time = new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.text);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (event.kind === 'announcement') {
    return (
      <div className="msg announcement">
        <span className="ts">{time}</span>
        <span className="announce-text">{renderText(event.text, onEnqueue)}</span>
      </div>
    );
  }
  if (event.kind === 'system' || event.kind === 'notice') {
    return (
      <div className={`msg meta ${event.kind}`}>
        <span className="ts">{time}</span>
        <span className="meta-text">{event.text}</span>
      </div>
    );
  }
  if (event.kind === 'join' || event.kind === 'part' || event.kind === 'quit' || event.kind === 'nick') {
    return (
      <div className={`msg event ${event.kind}`}>
        <span className="ts">{time}</span>
        <span className="event-text">{event.text}</span>
      </div>
    );
  }
  if (event.kind === 'action') {
    return (
      <div className={`msg action ${event.mention ? 'mention' : ''}`}>
        <span className="ts">{time}</span>
        <span className="action-text" style={{ color: colorForNick(event.from ?? '') }}>
          * {event.from} {renderText(event.text, onEnqueue)}
        </span>
        <Tools onDelete={onDelete} />
      </div>
    );
  }

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text && text !== event.text) onEdit?.(text);
    setEditing(false);
  };

  return (
    <div className={`msg chat ${event.self ? 'self' : ''} ${grouped ? 'grouped' : ''} ${event.mention ? 'mention' : ''}`}>
      {!grouped && (
        <div className="msg-head">
          <button
            type="button"
            className="head-avatar"
            aria-label={`Open ${event.from}'s profile`}
            onClick={() => event.from && onProfile?.(event.from)}
          >
            <Avatar name={event.from ?? '?'} src={avatar} size={22} />
          </button>
          <button
            type="button"
            className="nick"
            style={{ color: colorForNick(event.from ?? '') }}
            onClick={() => event.from && onProfile?.(event.from)}
          >
            {event.from}
          </button>
          <span className="ts">{time}</span>
        </div>
      )}
      {editing ? (
        <form className="edit-form" onSubmit={submitEdit}>
          <input
            ref={inputRef}
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          />
          <span className="edit-hint">Enter to save · Esc to cancel</span>
        </form>
      ) : (
        <div className="bubble-row">
          <div className="text" title={time}>
            {renderText(event.text, onEnqueue)}
            {event.edited && <span className="edited" title="This message was edited">(edited)</span>}
          </div>
          <Tools
            onEdit={
              onEdit
                ? () => {
                    setDraft(event.text);
                    setEditing(true);
                  }
                : undefined
            }
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

/** Hover buttons beside a message. */
function Tools({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  if (!onEdit && !onDelete) return null;
  return (
    <span className="msg-tools">
      {onEdit && (
        <button type="button" title="Edit" aria-label="Edit message" onClick={onEdit}>
          ✎
        </button>
      )}
      {onDelete && (
        <button type="button" title="Delete" aria-label="Delete message" onClick={onDelete}>
          🗑
        </button>
      )}
    </span>
  );
}

function renderText(text: string, onEnqueue?: (url: string) => void) {
  return linkify(text).map((seg, i) => {
    if (seg.type === 'text') return <span key={i}>{seg.value}</span>;
    const media = classify(seg.value);
    return (
      <span key={i} className="url-seg">
        <a href={seg.value} target="_blank" rel="noreferrer noopener">
          {seg.value}
        </a>
        {media.kind !== 'unknown' && onEnqueue && (
          <button className="enqueue-btn" title="Add to watch party" onClick={() => onEnqueue(seg.value)}>
            ＋ queue
          </button>
        )}
      </span>
    );
  });
}
