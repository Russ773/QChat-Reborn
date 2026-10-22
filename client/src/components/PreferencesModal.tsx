import { useEffect, useState } from 'react';
import { VISIBILITY_FIELDS, defaultPrefs, fieldVisible, type ProfilePrefs } from '@qchat/shared';
import { me, savePreferences } from '../api.js';

interface Props {
  token: string;
  onClose: () => void;
  onSaved?: (prefs: ProfilePrefs) => void;
}

export function PreferencesModal({ token, onClose, onSaved }: Props) {
  const [prefs, setPrefs] = useState<ProfilePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    me(token)
      .then((r) => setPrefs(r.prefs ?? defaultPrefs()))
      .catch(() => setPrefs(defaultPrefs()));
  }, [token]);

  const toggleField = (key: string) =>
    setPrefs((p) => (p ? { ...p, visible: { ...p.visible, [key]: !fieldVisible(p, key) } } : p));
  const setFlag = (k: 'allowPm' | 'autoplay', v: boolean) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!prefs) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await savePreferences(token, prefs);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal prefs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Preferences">
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Preferences</h2>

        {!prefs ? (
          <p className="pm-empty">Loading…</p>
        ) : (
          <>
            <div className="pref-group">
              <div className="pref-legend">Show on my profile</div>
              <div className="pref-toggles">
                {VISIBILITY_FIELDS.map((f) => (
                  <label key={f.key as string} className="toggle">
                    <input
                      type="checkbox"
                      checked={fieldVisible(prefs, f.key as string)}
                      onChange={() => toggleField(f.key as string)}
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
              <p className="pref-note">Unticked fields stay private. Your name and avatar always show.</p>
            </div>

            <div className="pref-group">
              <div className="pref-legend">Privacy &amp; media</div>
              <label className="toggle">
                <input type="checkbox" checked={prefs.allowPm} onChange={(e) => setFlag('allowPm', e.target.checked)} />
                <span>Allow private messages</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={prefs.autoplay} onChange={(e) => setFlag('autoplay', e.target.checked)} />
                <span>Autoplay media shared in rooms</span>
              </label>
              <p className="pref-note">
                With autoplay off you just see what someone played and can start it yourself. Private
                messaging and media sync are on the way; these settings are ready for them.
              </p>
            </div>

            {error && <p className="pm-error">{error}</p>}
            <div className="pm-actions">
              <button className="secondary" onClick={onClose}>Cancel</button>
              <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save preferences'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
