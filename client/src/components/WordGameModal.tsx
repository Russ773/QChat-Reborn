import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD,
  CENTER,
  LETTER_VALUES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  evaluatePlay,
  premiumAt,
  type Placement,
  type WordGameSummary,
  type WordGameView,
} from '@qchat/shared';

interface Props {
  room: string;
  me: string;
  games: WordGameSummary[];
  /** The game being looked at: null for the list. */
  openId: string | null;
  view: WordGameView | null | undefined;
  onOpen: (id: string | null) => void;
  onCreate: (maxPlayers: number) => void;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onStart: (id: string) => void;
  onPlay: (id: string, tiles: Placement[]) => void;
  onPass: (id: string) => void;
  onExchange: (id: string, letters: string[]) => void;
  onResign: (id: string) => void;
  onClose: () => void;
}

const label = (room: string) => room.replace(/^#/, '');
const PREM_TEXT: Record<string, string> = { TW: 'Triple word', DW: 'Double word', TL: 'Triple letter', DL: 'Double letter' };

/** QWords: the games in a room, and the board when you open one. */
export function WordGameModal(p: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop" onClick={p.onClose}>
      <div className="modal wg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Word game">
        <button className="modal-x" onClick={p.onClose} aria-label="Close">✕</button>
        {p.openId && p.view ? <Board {...p} view={p.view} /> : p.openId ? <p className="muted">Loading the game…</p> : <Lobby {...p} />}
      </div>
    </div>
  );
}

// --- The list of games ------------------------------------------------------------------------

function Lobby(p: Props) {
  const [size, setSize] = useState(2);
  const mine = (g: WordGameSummary) => g.players.some((x) => x.name.toLowerCase() === p.me.toLowerCase());
  return (
    <>
      <h2 className="modal-title">Word game in {label(p.room)}</h2>
      <p className="dialog-msg">
        QWords is a word game for two to four players. Take turns making words on the board, using the tiles on your rack. You can play
        slowly: a game carries on for days, and you are told when it is your turn.
      </p>
      <form
        className="wg-new"
        onSubmit={(e) => {
          e.preventDefault();
          p.onCreate(size);
        }}
      >
        <label>
          New game for
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
              <option key={n} value={n}>{n} players</option>
            ))}
          </select>
        </label>
        <button type="submit">Start a game</button>
      </form>

      {p.games.length === 0 && <p className="muted">No games here yet. Start one and ask someone to join!</p>}
      <ul className="wg-list">
        {p.games.map((g) => (
          <li key={g.id} className={`wg-row ${g.status}`}>
            <div className="wg-row-main">
              <b>{g.players.map((x) => x.name).join(', ')}</b>
              <span className="muted small">
                {g.status === 'waiting' && `waiting for players (${g.players.length} of ${g.maxPlayers}), started by ${g.creator}`}
                {g.status === 'playing' && `playing: ${g.players.map((x) => `${x.name} ${x.score}`).join(', ')}. ${g.turn}'s turn`}
                {g.status === 'finished' && `finished: ${g.players.map((x) => `${x.name} ${x.score}`).join(', ')}`}
              </span>
            </div>
            <div className="wg-row-actions">
              {g.status === 'waiting' && !mine(g) && g.players.length < g.maxPlayers && <button className="mini" onClick={() => p.onJoin(g.id)}>Join</button>}
              {g.status === 'waiting' && mine(g) && (
                <>
                  {g.creator.toLowerCase() === p.me.toLowerCase() && g.players.length >= MIN_PLAYERS && <button className="mini" onClick={() => p.onStart(g.id)}>Start</button>}
                  <button className="mini" onClick={() => p.onOpen(g.id)}>Open</button>
                  <button className="mini" onClick={() => p.onLeave(g.id)}>Leave</button>
                </>
              )}
              {g.status !== 'waiting' && <button className="mini" onClick={() => p.onOpen(g.id)}>{mine(g) && g.status === 'playing' ? 'Play' : 'Watch'}</button>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- The board ------------------------------------------------------------------------------------

interface Pending extends Placement {
  /** Which tile of the rack it came from. */
  idx: number;
}

function Board(p: Props & { view: WordGameView }) {
  const g = p.view;
  const meIdx = g.players.findIndex((x) => x.name.toLowerCase() === p.me.toLowerCase());
  const playing = meIdx >= 0 && !g.players[meIdx].out;
  const myTurn = g.status === 'playing' && playing && g.turn === meIdx;

  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>([]); // the rack, as you have arranged it
  const [blankAt, setBlankAt] = useState<{ r: number; c: number; idx: number } | null>(null);
  const [swap, setSwap] = useState<Set<number> | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [focus, setFocus] = useState<[number, number]>([CENTER, CENTER]);
  const cells = useRef<Record<string, HTMLButtonElement | null>>({});

  // A new rack (after a move) starts fresh.
  const rackKey = g.rack.join('');
  useEffect(() => {
    setPending([]);
    setSelected(null);
    setSwap(null);
    setBlankAt(null);
    setOrder(g.rack.map((_, i) => i));
  }, [rackKey, g.id, g.moves.length]);

  const used = new Set(pending.map((x) => x.idx));
  const rackOrder = order.length === g.rack.length ? order : g.rack.map((_, i) => i);

  const pendingAt = (r: number, c: number) => pending.find((x) => x.r === r && x.c === c);

  const place = (r: number, c: number, idx: number, letter: string, blank: boolean) => {
    setPending((list) => [...list.filter((x) => x.idx !== idx && !(x.r === r && x.c === c)), { r, c, letter, ...(blank ? { blank: true } : {}), idx }]);
    setSelected(null);
  };

  const putSelected = (r: number, c: number) => {
    if (!myTurn || g.board[r][c] || selected === null || used.has(selected)) return;
    const tile = g.rack[selected];
    if (tile === '?') setBlankAt({ r, c, idx: selected });
    else place(r, c, selected, tile, false);
  };

  const onCell = (r: number, c: number) => {
    const here = pendingAt(r, c);
    if (here) return setPending((list) => list.filter((x) => x !== here));
    putSelected(r, c);
  };

  const moveFocus = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(BOARD - 1, r));
    const nc = Math.max(0, Math.min(BOARD - 1, c));
    setFocus([nr, nc]);
    cells.current[`${nr},${nc}`]?.focus();
  };

  const onCellKey = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(r - 1, c); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(r + 1, c); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(r, c - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(r, c + 1); }
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      const here = pendingAt(r, c);
      if (here) { e.preventDefault(); setPending((list) => list.filter((x) => x !== here)); }
    } else if (e.key === 'Enter' && pending.length > 0 && !preview.error) {
      e.preventDefault();
      submit();
    } else if (/^[a-zA-Z]$/.test(e.key) && myTurn && !g.board[r][c] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing a letter puts that tile on the square: your own tile, or a blank standing in for it.
      e.preventDefault();
      const L = e.key.toUpperCase();
      const free = g.rack.map((t, i) => ({ t, i })).filter((x) => !used.has(x.i));
      const real = free.find((x) => x.t === L);
      const blank = free.find((x) => x.t === '?');
      const tile = real ?? blank;
      if (tile) place(r, c, tile.i, L, !real);
    }
  };

  // What the move would score, worked out in the browser with the same rules the server uses.
  const preview = useMemo(() => {
    if (pending.length === 0) return { words: [] as { word: string; score: number }[], total: 0, error: '' };
    const r = evaluatePlay(g.board, pending);
    return r.ok ? { words: r.words, total: r.total, error: '' } : { words: [], total: 0, error: r.error };
  }, [pending, g.board]);

  const submit = () => {
    if (!myTurn || pending.length === 0 || preview.error) return;
    p.onPlay(g.id, pending.map(({ r, c, letter, blank }) => ({ r, c, letter, ...(blank ? { blank: true } : {}) })));
  };

  const shuffle = () => {
    setOrder((o) => {
      const a = (o.length ? o : g.rack.map((_, i) => i)).slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  };

  const last = new Set(g.lastPlay.map(([r, c]) => `${r},${c}`));

  return (
    <div className="wg-game">
      <div className="wg-top">
        <button className="mini" onClick={() => p.onOpen(null)}>‹ All games</button>
        <h2 className="modal-title wg-title">Word game</h2>
      </div>

      <div className="wg-layout">
        <div className="wg-board-wrap">
          <div className="wg-board" role="grid" aria-label="Word game board">
            {Array.from({ length: BOARD }, (_, r) => (
              <div role="row" className="wg-row-cells" key={r}>
                {Array.from({ length: BOARD }, (_, c) => {
                  const cell = g.board[r][c];
                  const pend = pendingAt(r, c);
                  const prem = premiumAt(r, c);
                  const letter = cell?.letter ?? pend?.letter;
                  const isBlank = cell?.blank ?? pend?.blank;
                  const name = letter
                    ? `${letter}${isBlank ? ' (blank)' : ''}, row ${r + 1}, column ${c + 1}${pend ? ', your tile, press delete to take it back' : ''}`
                    : `Empty, row ${r + 1}, column ${c + 1}${prem ? `, ${PREM_TEXT[prem]}` : ''}${r === CENTER && c === CENTER ? ', the star' : ''}`;
                  return (
                    <button
                      key={c}
                      ref={(el) => { cells.current[`${r},${c}`] = el; }}
                      type="button"
                      role="gridcell"
                      aria-label={name}
                      tabIndex={focus[0] === r && focus[1] === c ? 0 : -1}
                      className={`wg-cell ${prem ?? ''} ${cell ? 'placed' : ''} ${pend ? 'pending' : ''} ${last.has(`${r},${c}`) ? 'last' : ''} ${isBlank ? 'blank' : ''}`}
                      onFocus={() => setFocus([r, c])}
                      onClick={() => onCell(r, c)}
                      onKeyDown={(e) => onCellKey(e, r, c)}
                    >
                      {letter ? (
                        <>
                          <span className="wg-letter">{letter}</span>
                          {!isBlank && <span className="wg-val">{LETTER_VALUES[letter]}</span>}
                        </>
                      ) : (
                        <span className="wg-prem" aria-hidden="true">{r === CENTER && c === CENTER ? '★' : prem ?? ''}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="wg-side">
          <ul className="wg-players" aria-label="Players">
            {g.players.map((x, i) => (
              <li key={x.name} className={`${g.status === 'playing' && g.turn === i ? 'turn' : ''} ${x.out ? 'out' : ''}`}>
                <span>{x.name}{x.out ? ' (resigned)' : ''}{g.status === 'playing' && g.turn === i ? ' 🎲' : ''}</span>
                <b>{x.score}</b>
              </li>
            ))}
          </ul>
          <p className="muted small" aria-live="polite">
            {g.status === 'waiting' && 'Waiting for players.'}
            {g.status === 'playing' && (myTurn ? 'Your turn!' : `${g.players[g.turn]?.name}'s turn.`)}
            {g.status === 'finished' && `Game over (${g.endedBy}). ${g.winner ? `${g.winner} won.` : ''}`}
            {' '}{g.bag} tile{g.bag === 1 ? '' : 's'} in the bag.
          </p>

          {g.status === 'waiting' && (
            <div className="wg-actions">
              {g.creator.toLowerCase() === p.me.toLowerCase() && g.players.length >= MIN_PLAYERS && <button onClick={() => p.onStart(g.id)}>Start the game</button>}
              {playing && <button className="secondary" onClick={() => { p.onLeave(g.id); p.onOpen(null); }}>Leave</button>}
            </div>
          )}

          {playing && g.status === 'playing' && (
            <>
              <div className="wg-rack" role="group" aria-label="Your tiles">
                {rackOrder.map((idx) => {
                  const t = g.rack[idx];
                  const isUsed = used.has(idx);
                  const swapping = swap?.has(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isUsed}
                      className={`wg-tile ${selected === idx ? 'selected' : ''} ${swapping ? 'swapping' : ''} ${isUsed ? 'used' : ''}`}
                      aria-pressed={selected === idx || !!swapping}
                      aria-label={t === '?' ? 'Blank tile' : `${t}, worth ${LETTER_VALUES[t]}`}
                      onClick={() => {
                        if (swap) setSwap((s) => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
                        else setSelected((s) => (s === idx ? null : idx));
                      }}
                    >
                      <span className="wg-letter">{t === '?' ? '' : t}</span>
                      {t !== '?' && <span className="wg-val">{LETTER_VALUES[t]}</span>}
                    </button>
                  );
                })}
              </div>

              {blankAt && (
                <div className="wg-blank" role="group" aria-label="Choose a letter for the blank tile">
                  <span>Blank tile as:</span>
                  {[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((L) => (
                    <button key={L} type="button" className="mini" onClick={() => { place(blankAt.r, blankAt.c, blankAt.idx, L, true); setBlankAt(null); }}>{L}</button>
                  ))}
                  <button type="button" className="mini" onClick={() => setBlankAt(null)}>Cancel</button>
                </div>
              )}

              <div className="wg-preview" aria-live="polite">
                {pending.length === 0 && myTurn && !swap && <span className="muted small">Pick a tile, then a square. Or click a square and type a letter.</span>}
                {pending.length > 0 && preview.error && <span className="wg-bad">{preview.error}</span>}
                {pending.length > 0 && !preview.error && (
                  <span>{preview.words.map((w) => `${w.word} ${w.score}`).join(', ')}. <b>Total {preview.total}</b></span>
                )}
                {swap && <span>Choose the tiles to swap, then press Swap.</span>}
              </div>

              <div className="wg-actions">
                {!swap ? (
                  <>
                    <button disabled={!myTurn || pending.length === 0 || !!preview.error} onClick={submit}>Play</button>
                    <button className="secondary" disabled={pending.length === 0} onClick={() => setPending([])}>Take back</button>
                    <button className="secondary" onClick={shuffle}>Shuffle</button>
                    <button className="secondary" disabled={!myTurn} onClick={() => p.onPass(g.id)}>Pass</button>
                    <button className="secondary" disabled={!myTurn || g.bag < 7} title={g.bag < 7 ? 'There are fewer than 7 tiles left in the bag' : ''} onClick={() => { setPending([]); setSwap(new Set()); }}>Swap</button>
                  </>
                ) : (
                  <>
                    <button disabled={swap.size === 0} onClick={() => p.onExchange(g.id, [...swap].map((i) => g.rack[i]))}>Swap {swap.size || ''}</button>
                    <button className="secondary" onClick={() => setSwap(null)}>Cancel</button>
                  </>
                )}
                {!confirmResign ? (
                  <button className="secondary danger-text" onClick={() => setConfirmResign(true)}>Resign</button>
                ) : (
                  <>
                    <button className="danger" onClick={() => { p.onResign(g.id); setConfirmResign(false); }}>Really resign</button>
                    <button className="secondary" onClick={() => setConfirmResign(false)}>No</button>
                  </>
                )}
              </div>
            </>
          )}

          <div className="wg-moves">
            <div className="rs-title">Moves</div>
            {g.moves.length === 0 && <p className="muted small">No moves yet.</p>}
            <ol reversed>
              {[...g.moves].reverse().slice(0, 12).map((m, i) => (
                <li key={`${m.at}-${i}`}>
                  <b>{m.by}</b>{' '}
                  {m.kind === 'play' && `played ${m.words?.map((w) => w.word).join(', ')} for ${m.score}${m.bingo ? ' (all seven tiles, +50!)' : ''}`}
                  {m.kind === 'pass' && 'passed'}
                  {m.kind === 'exchange' && `swapped ${m.swapped} tile${m.swapped === 1 ? '' : 's'}`}
                  {m.kind === 'resign' && 'resigned'}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
