import { useMemo, useState } from 'react';
import type { ChannelListItem } from '../types.js';

interface Props {
  items: ChannelListItem[];
  loading: boolean;
  joined: Set<string>;
  onJoin: (channel: string) => void;
  onClose: () => void;
}

export function ChannelBrowser({ items, loading, joined, onJoin, onClose }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? items.filter(
          (c) => c.name.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q),
        )
      : items;
    return [...rows].sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
  }, [items, query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal channel-browser"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Browse channels"
      >
        <h2>Channels</h2>
        <p className="pe-hint">Pick a room to jump into.</p>
        <input
          className="cb-search"
          value={query}
          autoFocus
          placeholder="Search channels…"
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="cb-list">
          {loading && filtered.length === 0 && <p className="cb-empty">Loading channels…</p>}
          {!loading && filtered.length === 0 && <p className="cb-empty">No channels found.</p>}
          {filtered.map((c) => {
            const isJoined = joined.has(c.name.toLowerCase());
            return (
              <div key={c.name} className="cb-row">
                <div className="cb-main">
                  <div className="cb-name">
                    <span className="cb-hash">#</span>
                    {c.name.replace(/^#/, '')}
                    <span className="cb-users">{c.users}</span>
                  </div>
                  {c.topic && <div className="cb-topic">{c.topic}</div>}
                </div>
                <button
                  className="cb-join"
                  disabled={isJoined}
                  onClick={() => {
                    onJoin(c.name);
                    onClose();
                  }}
                >
                  {isJoined ? 'Joined' : 'Join'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
