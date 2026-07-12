import { useEffect, useRef, useState } from 'react';

/** A compact, curated set of common emoji — no external dependency needed. */
const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😎', '😉',
  '🙂', '😅', '😇', '🤔', '😐', '😴', '😭', '😤',
  '😱', '🥳', '😢', '😜', '🤨', '🙄', '😬', '🤗',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '👋',
  '❤️', '🔥', '✨', '⭐', '🎉', '🎶', '💯', '👀',
  '🤯', '🥶', '🤩', '🫡', '🫠', '💀', '🎬', '📺',
  '🍕', '☕', '🍺', '🎮', '⚽', '🚀', '🌈', '✅',
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="emoji-picker" ref={rootRef}>
      <button
        type="button"
        className="emoji-toggle"
        title="Emoji"
        aria-label="Insert emoji"
        onClick={() => setOpen((o) => !o)}
      >
        😊
      </button>
      {open && (
        <div className="emoji-pop" role="menu">
          {EMOJIS.map((emoji, i) => (
            <button
              type="button"
              key={`${emoji}-${i}`}
              className="emoji-item"
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
