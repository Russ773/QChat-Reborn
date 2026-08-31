import type { ChatEvent } from '../types.js';
import { classify, linkify } from '../media/urls.js';
import { colorForNick } from '../colors.js';

interface Props {
  event: ChatEvent;
  /** True when this message continues a run from the same author (hide header). */
  grouped?: boolean;
  /** Invoked when a user clicks "add to queue" on a detected media link. */
  onEnqueue?: (url: string) => void;
}

export function Message({ event, grouped, onEnqueue }: Props) {
  const time = new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
  if (
    event.kind === 'join' ||
    event.kind === 'part' ||
    event.kind === 'quit' ||
    event.kind === 'nick'
  ) {
    return (
      <div className={`msg event ${event.kind}`}>
        <span className="ts">{time}</span>
        <span className="event-text">— {event.text}</span>
      </div>
    );
  }
  if (event.kind === 'action') {
    return (
      <div className="msg action">
        <span className="ts">{time}</span>
        <span className="action-text" style={{ color: colorForNick(event.from ?? '') }}>
          * {event.from} {renderText(event.text, onEnqueue)}
        </span>
      </div>
    );
  }

  return (
    <div className={`msg chat ${event.self ? 'self' : ''} ${grouped ? 'grouped' : ''}`}>
      {!grouped && (
        <div className="msg-head">
          <span className="nick" style={{ color: colorForNick(event.from ?? '') }}>
            {event.from}
          </span>
          <span className="ts">{time}</span>
        </div>
      )}
      <div className="text" title={time}>
        {renderText(event.text, onEnqueue)}
      </div>
    </div>
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
