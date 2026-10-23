import { useEffect, useRef, useState } from 'react';
import { REACTION_EMOJI } from '@qchat/shared';
import type { ChatEvent } from '../types.js';
import { classify, linkify } from '../media/urls.js';
import { colorForNick } from '../colors.js';
import { Avatar } from './Avatar.js';

interface Props {
  event: ChatEvent;
  /** Your name, to highlight the reactions you made. */
  me: string;
  /** True when this message continues a run from the same author (hide header). */
  grouped?: boolean;
  /** Invoked when a user clicks "add to queue" on a detected media link. */
  onEnqueue?: (url: string) => void;
  /** Present when the viewer may edit it (their own message). */
  onEdit?: (text: string) => void;
  /** Present when the viewer may delete it (their own, or they moderate the room). */
  onDelete?: () => void;
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  /** Present when the viewer may report it (not their own). */
  onReport?: () => void;
  /** Open the author's profile. */
  onProfile?: (name: string) => void;
  /** The author's profile photo, if they have one. */
  avatar?: string;
  /** The bot's picture, when a bot said it. */
  botEmoji?: string;
}

export function Message({ event, me, grouped, onEnqueue, onEdit, onDelete, onReply, onReact, onReport, onProfile, avatar, botEmoji }: Props) {
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
        <Tools onDelete={onDelete} onReport={onReport} />
      </div>
    );
  }

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text !== event.text && (text || event.image)) onEdit?.(text);
    setEditing(false);
  };

  const reactions = Object.entries(event.reactions ?? {}).filter(([, who]) => who.length > 0);

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
            <Avatar name={event.from ?? '?'} src={avatar} size={22} emoji={event.bot ? botEmoji ?? '🤖' : undefined} />
          </button>
          <button
            type="button"
            className="nick"
            style={{ color: colorForNick(event.from ?? '') }}
            onClick={() => event.from && onProfile?.(event.from)}
          >
            {event.from}
          </button>
          {event.bot && <span className="bot-tag">BOT</span>}
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
          <div className={`text ${event.image ? 'has-image' : ''}`} title={time}>
            {event.replyTo && (
              <div className={`reply-quote ${event.replyTo.deleted ? 'gone' : ''}`}>
                <b>{event.replyTo.from || 'Someone'}</b>
                <span>{event.replyTo.deleted ? 'Original message deleted' : event.replyTo.text}</span>
              </div>
            )}
            {event.image && (
              <a href={event.image} target="_blank" rel="noreferrer noopener" className="msg-image-link">
                <img className="msg-image" src={event.image} alt="Shared picture" loading="lazy" />
              </a>
            )}
            {event.text && <div className="msg-text">{renderText(event.text, onEnqueue)}</div>}
            {event.edited && <span className="edited" title="This message was edited">(edited)</span>}
          </div>
          <Tools
            onReply={onReply}
            onReact={onReact}
            onEdit={
              onEdit
                ? () => {
                    setDraft(event.text);
                    setEditing(true);
                  }
                : undefined
            }
            onDelete={onDelete}
            onReport={onReport}
          />
        </div>
      )}
      {reactions.length > 0 && (
        <div className="rx-row">
          {reactions.map(([emoji, who]) => {
            const mine = who.some((n) => n.toLowerCase() === me.toLowerCase());
            return (
              <button
                key={emoji}
                type="button"
                className={`rx ${mine ? 'mine' : ''}`}
                title={who.join(', ')}
                disabled={!onReact}
                onClick={() => onReact?.(emoji)}
              >
                <span>{emoji}</span>
                <span className="rx-n">{who.length}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Hover buttons beside a message. */
function Tools({
  onReply,
  onReact,
  onEdit,
  onDelete,
  onReport,
}: {
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  if (!onReply && !onReact && !onEdit && !onDelete && !onReport) return null;
  return (
    <span className="msg-tools">
      {onReact && (
        <span className="rx-wrap">
          <button type="button" title="React" aria-label="Add a reaction" onClick={() => setPicking((p) => !p)}>
            ☺
          </button>
          {picking && (
            <span className="rx-picker" onMouseLeave={() => setPicking(false)}>
              {REACTION_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(e);
                    setPicking(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
      {onReply && (
        <button type="button" title="Reply" aria-label="Reply to message" onClick={onReply}>
          ↩
        </button>
      )}
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
      {onReport && (
        <button type="button" title="Report to the admins" aria-label="Report message" onClick={onReport}>
          ⚑
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
