import { useEffect, useRef, useState } from 'react';
import { SKINS, THEMES, VISIBILITY_FIELDS, defaultPrefs, fieldVisible, type ProfilePrefs, type ThemeChoice } from '@qchat/shared';
import { applyLook } from '../theme.js';
import { me, savePreferences, setEmail, siteStatus } from '../api.js';
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notificationsSupported,
  notificationsWanted,
} from '../notify.js';

interface Props {
  token: string;
  onClose: () => void;
  onSaved?: (prefs: ProfilePrefs) => void;
}

export function PreferencesModal({ token, onClose: closeModal, onSaved }: Props) {
  const [prefs, setPrefs] = useState<ProfilePrefs | null>(null);
  // The look is tried out as you pick it. Cancelling puts back the one you came in with.
  const startLook = useRef<{ theme: ThemeChoice; skin: string } | null>(null);
  const saved = useRef(false);
  const onClose = () => {
    if (!saved.current && startLook.current) applyLook(startLook.current.theme, startLook.current.skin);
    closeModal();
  };
  const setLook = (theme: ThemeChoice, skin: string) => {
    setPrefs((p) => (p ? { ...p, theme, skin } : p));
    applyLook(theme, skin);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(notificationsWanted() && notificationsEnabled());
  const [desktopNote, setDesktopNote] = useState<string | null>(null);
  const [mail, setMail] = useState<{ email: string | null; verified: boolean; enabled: boolean } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailNote, setEmailNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  // This one is about this browser, so it applies straight away rather than on Save.
  const toggleDesktop = async (on: boolean) => {
    setDesktopNote(null);
    if (!on) {
      disableNotifications();
      setDesktop(false);
      return;
    }
    const r = await enableNotifications();
    setDesktop(r === 'granted');
    if (r === 'unsupported') setDesktopNote('This browser does not support desktop notifications.');
    else if (r === 'denied') setDesktopNote('Your browser blocked notifications. Allow them for this site in the browser settings, then try again.');
  };

  useEffect(() => {
    me(token)
      .then((r) => {
        const p = r.prefs ?? defaultPrefs();
        startLook.current = { theme: p.theme, skin: p.skin };
        setPrefs(p);
        void siteStatus().then((s) => setMail({ email: r.email, verified: r.emailVerified, enabled: !!s.mailEnabled })).catch(() => setMail({ email: r.email, verified: r.emailVerified, enabled: false }));
      })
      .catch(() => setPrefs(defaultPrefs()));
  }, [token]);

  const changeEmail = async (remove: boolean) => {
    setEmailNote(null);
    if (!emailPw) return setEmailNote({ text: 'Enter your password to confirm.', bad: true });
    if (!remove && !newEmail.trim()) return setEmailNote({ text: 'Enter the email address.', bad: true });
    setEmailBusy(true);
    try {
      const r = await setEmail(token, remove ? '' : newEmail.trim(), emailPw);
      setEmailPw('');
      if (r.removed) {
        setMail((m) => (m ? { ...m, email: null, verified: false } : m));
        setEmailNote({ text: 'Your email address was removed.' });
      } else {
        setNewEmail('');
        setEmailNote({ text: `We sent a link to ${r.pending}. Open it to confirm the address.` });
      }
    } catch (e) {
      setEmailNote({ text: (e as Error).message, bad: true });
    } finally {
      setEmailBusy(false);
    }
  };

  const toggleField = (key: string) =>
    setPrefs((p) => (p ? { ...p, visible: { ...p.visible, [key]: !fieldVisible(p, key) } } : p));
  const setFlag = (k: 'allowPm' | 'autoplay', v: boolean) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!prefs) return;
    setBusy(true);
    setError(null);
    try {
      const result = await savePreferences(token, prefs);
      saved.current = true;
      onSaved?.(result);
      closeModal();
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
                    <span>{f.label}{f.key === 'birthday' ? ' (QBot will wish you a happy birthday in the lobby)' : ''}</span>
                  </label>
                ))}
              </div>
              <p className="pref-note">Unticked fields stay private. Your name and avatar always show.</p>
            </div>

            {mail && (
              <div className="pref-group">
                <div className="pref-legend">Email</div>
                {mail.email ? (
                  <p className="pref-note">
                    {mail.email} {mail.verified ? '(confirmed: you can use it to reset your password)' : '(not confirmed yet: open the link we sent)'}
                  </p>
                ) : (
                  <p className="pref-note">No email address. Add one so you can reset your password if you forget it.</p>
                )}
                {mail.enabled ? (
                  <div className="email-form">
                    <input type="email" placeholder="New email address" aria-label="New email address" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
                    <input type="password" placeholder="Your password" aria-label="Your password, to confirm" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} autoComplete="current-password" />
                    <div className="pm-actions">
                      <button type="button" disabled={emailBusy} onClick={() => void changeEmail(false)}>{mail.email ? 'Change email' : 'Add email'}</button>
                      {mail.email && <button type="button" className="secondary" disabled={emailBusy} onClick={() => void changeEmail(true)}>Remove</button>}
                    </div>
                  </div>
                ) : (
                  <p className="pref-note">This site cannot send email yet, so addresses cannot be confirmed.</p>
                )}
                {emailNote && <p className={emailNote.bad ? 'pm-error' : 'pref-note'} role={emailNote.bad ? 'alert' : 'status'}>{emailNote.text}</p>}
              </div>
            )}

            <div className="pref-group">
              <div className="pref-legend">Look</div>
              <div className="look-row" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={prefs.theme === t.id}
                    className={`look-opt ${prefs.theme === t.id ? 'on' : ''}`}
                    onClick={() => setLook(t.id, prefs.skin)}
                  >
                    {t.id === 'dark' ? '🌙' : t.id === 'light' ? '☀️' : '🖥️'} {t.label}
                  </button>
                ))}
              </div>
              <div className="look-row" role="radiogroup" aria-label="Colours">
                {SKINS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={prefs.skin === s.id}
                    className={`look-opt skin ${prefs.skin === s.id ? 'on' : ''}`}
                    onClick={() => setLook(prefs.theme, s.id)}
                  >
                    <span className="swatch" style={{ background: `linear-gradient(135deg, ${s.swatch[0]}, ${s.swatch[1]})` }} aria-hidden="true" />
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="pref-note">Changes show straight away and are remembered on every device you sign in on.</p>
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
                With autoplay off you just see what someone played and can start it yourself.
              </p>
            </div>

            {notificationsSupported() && (
              <div className="pref-group">
                <div className="pref-legend">Notifications</div>
                <label className="toggle">
                  <input type="checkbox" checked={desktop} onChange={(e) => void toggleDesktop(e.target.checked)} />
                  <span>Desktop notifications</span>
                </label>
                <p className="pref-note">
                  Get a pop-up when someone mentions you or sends you a private message while QChat is in the
                  background. This applies to this browser only.
                </p>
                {desktopNote && <p className="pm-error">{desktopNote}</p>}
              </div>
            )}

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
