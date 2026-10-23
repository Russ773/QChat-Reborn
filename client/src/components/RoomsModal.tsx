import { useEffect, useMemo, useState } from 'react';
import { MAX_ROOM_NAME, MAX_TOPIC, normalizeRoom, validRoom, type RoomInfo } from '@qchat/shared';

interface Props {
  rooms: RoomInfo[];
  /** Rooms the user is already in. */
  joined: string[];
  onRefresh: () => void;
  onJoin: (room: string, topic?: string) => void;
  onOpen: (room: string) => void;
  onClose: () => void;
}

export function RoomsModal({ rooms, joined, onRefresh, onJoin, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Keep the list fresh while the popup is open, and close on Escape.
  useEffect(() => {
    onRefresh();
    const iv = window.setInterval(onRefresh, 4000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinedSet = useMemo(() => new Set(joined), [joined]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    const rows = q ? rooms.filter((r) => r.name.includes(q)) : rooms;
    return [...rows].sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
  }, [rooms, query]);

  const go = (r: RoomInfo) => {
    if (joinedSet.has(r.name)) onOpen(r.name);
    else onJoin(r.name);
    onClose();
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const room = normalizeRoom(newName);
    if (!room) {
      setError('Give your room a name.');
      return;
    }
    if (!validRoom(room)) {
      setError(`Use letters, numbers, - and _ only (up to ${MAX_ROOM_NAME} characters).`);
      return;
    }
    if (joinedSet.has(room)) onOpen(room);
    else onJoin(room, newTopic.trim() || undefined); // joins it if it exists, creates it (with this topic) if not
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rooms-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rooms">
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Rooms</h2>
        <p className="rooms-sub">Pick a room to jump into, or make your own.</p>

        <input
          className="rooms-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rooms…"
          autoFocus
        />

        <div className="rooms-list">
          {shown.length === 0 && (
            <p className="rooms-empty">{rooms.length === 0 ? 'Loading rooms…' : 'No rooms match that search.'}</p>
          )}
          {shown.map((r) => {
            const isJoined = joinedSet.has(r.name);
            return (
              <div className="room-row" key={r.name}>
                <div className="room-main">
                  <span className="room-name">{r.name.replace(/^#/, '')}</span>
                  <span className="room-tags">
                    <span className="room-count">{r.members} here</span>
                    {r.media && <span className="room-tag playing">▶ playing</span>}
                    {isJoined && <span className="room-tag joined">joined</span>}
                    {!r.permanent && <span className="room-tag">{r.owner ? `by ${r.owner}` : 'user room'}</span>}
                  </span>
                  {r.topic && <span className="room-topic">{r.topic}</span>}
                </div>
                <button className={isJoined ? 'secondary' : ''} onClick={() => go(r)}>
                  {isJoined ? 'Open' : 'Join'}
                </button>
              </div>
            );
          })}
        </div>

        <form className="rooms-create" onSubmit={create}>
          <div className="rooms-create-title">Create your own room</div>
          <div className="rooms-create-row">
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError(null);
              }}
              placeholder="room-name"
              maxLength={MAX_ROOM_NAME + 1}
            />
            <button type="submit">Create</button>
          </div>
          <input
            className="rooms-topic-input"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Topic (optional), e.g. Football chat"
            maxLength={MAX_TOPIC}
          />
          {error && <p className="pm-error">{error}</p>}
          <p className="rooms-hint">
            You own the rooms you create and can make moderators. They stay until you delete them (type
            /deleteroom) or nobody uses them for 30 days.
          </p>
        </form>
      </div>
    </div>
  );
}
