import { useEffect, useState } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Ask for a short reason; it is passed to onConfirm. */
  askReason?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}

/** "Are you sure?" for actions that are hard to undo. */
export function ConfirmModal({ title, message, confirmLabel, danger, askReason, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onConfirm(reason.trim());
          } finally {
            onClose();
          }
        }}
        role="dialog"
        aria-label={title}
      >
        <h2 className="modal-title">{title}</h2>
        <p className="dialog-msg">{message}</p>
        {askReason && (
          <label className="dialog-field">
            Reason <span className="optional">(optional)</span>
            <input autoFocus value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={danger ? 'danger' : ''} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
