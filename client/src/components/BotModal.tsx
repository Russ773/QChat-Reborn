import { useEffect } from 'react';
import type { BotInfo } from '@qchat/shared';
import { Avatar } from './Avatar.js';

interface Props {
  bot: BotInfo;
  onClose: () => void;
}

/** A short "about" card for a bot. */
export function BotModal({ bot, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal profile-modal bot-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`About ${bot.name}`}>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="pm-hero">
          <Avatar name={bot.name} size={96} emoji={bot.emoji} className="pm-avatar" />
          <h2 className="pm-name">
            {bot.name} <span className="bot-tag">BOT</span>
          </h2>
          <div className="pm-sub">{bot.builtin ? 'Built-in bot' : 'Bot'}</div>
        </div>
        <div className="pm-view">
          <p className="pm-empty">{bot.description || 'This bot has no description yet.'}</p>
          <p className="muted small bot-note">
            Bots are not members, so they do not count as online and cannot be messaged yet.
          </p>
        </div>
      </div>
    </div>
  );
}
