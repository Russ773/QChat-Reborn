import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem =
  | { kind?: 'item'; label: string; onClick: () => void; danger?: boolean; icon?: string }
  | { kind: 'heading'; label: string }
  | { kind: 'divider' };

interface Props {
  /** Where to open it (screen coordinates of the click). */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A small pop-up menu at the pointer. Closes on a click elsewhere, Escape, scrolling or resizing. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep it inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={pos}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.kind === 'divider') return <div className="ctx-divider" key={i} role="separator" />;
        if (it.kind === 'heading') return <div className="ctx-heading" key={i}>{it.label}</div>;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            {it.icon && <span className="ctx-icon" aria-hidden="true">{it.icon}</span>}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
