import { useEffect, useRef, useState } from 'react';
import type { SearchState } from '../types.js';
import { colorForNick } from '../colors.js';

interface Props {
  room: string;
  result: SearchState | null;
  onSearch: (q: string) => void;
  onClose: () => void;
}

/** Search the saved messages of the room you are in. */
export function SearchPanel({ room, result, onSearch, onClose }: Props) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => input.current?.focus(), [room]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length >= 2) onSearch(q.trim());
  };

  return (
    <div className="search-panel">
      <form className="search-form" onSubmit={submit}>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search this room's messages…"
          maxLength={100}
        />
        <button type="submit" disabled={q.trim().length < 2}>Search</button>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close search">✕</button>
      </form>

      {result && (
        <div className="search-results">
          {result.events.length === 0 && <p className="muted pad">Nothing found for "{result.q}".</p>}
          {result.events.length > 0 && (
            <p className="search-count">
              {result.events.length} result{result.events.length === 1 ? '' : 's'} for "{result.q}", newest first
            </p>
          )}
          {result.events.map((e) => (
            <div className="sr-row" key={e.id}>
              <div className="sr-head">
                <b style={{ color: colorForNick(e.from ?? '') }}>{e.from}</b>
                <span className="sr-time">
                  {new Date(e.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="sr-text">{highlight(e.text, result.q)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wrap the matching part of a result in <mark>. */
function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
