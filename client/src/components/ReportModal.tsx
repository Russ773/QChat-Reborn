import { useState } from 'react';
import type { ChatEvent } from '../types.js';

interface Props {
  message: ChatEvent;
  onSend: (reason: string) => void;
  onClose: () => void;
}

/** Report a message to the admins, with an optional reason. */
export function ReportModal({ message, onSend, onClose }: Props) {
  const [reason, setReason] = useState('');
  const preview = (message.text || (message.image ? 'a picture' : '')).slice(0, 140);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSend(reason.trim());
          onClose();
        }}
        role="dialog"
        aria-label="Report message"
      >
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Report this message?</h2>
        <p className="dialog-msg">
          An admin will review it. <b>{message.from}</b> will not be told it was you.
        </p>
        <blockquote className="report-preview">{preview}</blockquote>
        <label className="dialog-field">
          What is wrong with it? <span className="optional">(optional)</span>
          <textarea
            autoFocus
            rows={3}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. harassment, spam, something unsafe"
          />
        </label>
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="danger">Send report</button>
        </div>
      </form>
    </div>
  );
}
