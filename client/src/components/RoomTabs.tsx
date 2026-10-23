import type { RoomState } from '../types.js';

interface Props {
  /** The rooms you are in, in the order you joined them. */
  order: string[];
  rooms: Record<string, RoomState>;
  active: string | null;
  onPick: (room: string) => void;
  onBrowse: () => void;
}

const label = (name: string) => name.replace(/^#/, '');

/** The rooms you are in, as a horizontal strip along the bottom of the chat. */
export function RoomTabs({ order, rooms, active, onPick, onBrowse }: Props) {
  return (
    <nav className="room-tabs" aria-label="Your rooms">
      <span className="room-tabs-label">Your rooms</span>
      <div className="room-tabs-scroll">
        {order.length === 0 && <span className="room-tabs-empty">You are not in any rooms yet.</span>}
        {order.map((name) => {
          const r = rooms[name];
          return (
            <button
              key={name}
              type="button"
              className={`room-tab ${active === name ? 'active' : ''}`}
              onClick={() => onPick(name)}
              title={r ? `${r.members.length} online` : undefined}
            >
              <span className="room-tab-name">{label(name)}</span>
              {r && r.mentions > 0 ? (
                <span className="badge mention" title="You were mentioned">@{r.mentions}</span>
              ) : (
                r && r.unread > 0 && <span className="badge">{r.unread}</span>
              )}
            </button>
          );
        })}
      </div>
      <button type="button" className="room-tab add" onClick={onBrowse} title="Browse and create rooms" aria-label="Browse rooms">
        +
      </button>
    </nav>
  );
}
