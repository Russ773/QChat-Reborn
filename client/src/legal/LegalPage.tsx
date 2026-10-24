import { useEffect, useState } from 'react';
import { siteStatus } from '../api.js';
import { LogoMark, Wordmark } from '../components/Logo.js';
import { PRIVACY, TERMS, UPDATED, type Section } from './text.js';

export type LegalKind = 'terms' | 'privacy';

/** Which legal page the address asks for, if any. */
export function legalKind(): LegalKind | null {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '/terms' ? 'terms' : p === '/privacy' ? 'privacy' : null;
}

/** The Terms of Use and Privacy Notice. Public: no sign in needed. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const [contact, setContact] = useState('');
  useEffect(() => {
    document.title = `${kind === 'terms' ? 'Terms of Use' : 'Privacy Notice'} | QChat Reborn`;
    siteStatus().then((s) => setContact(s.contactEmail ?? '')).catch(() => undefined);
  }, [kind]);

  const sections: Section[] = kind === 'terms' ? TERMS : PRIVACY;

  return (
    <div className="legal">
      <header className="legal-head">
        <a className="legal-brand" href="/" aria-label="Back to QChat">
          <LogoMark size={34} />
          <Wordmark />
        </a>
        <nav className="legal-nav" aria-label="Legal pages">
          <a className={kind === 'terms' ? 'on' : ''} href="/terms">Terms of Use</a>
          <a className={kind === 'privacy' ? 'on' : ''} href="/privacy">Privacy Notice</a>
          <a href="/">Back to chat</a>
        </nav>
      </header>

      <main className="legal-body">
        <h1>{kind === 'terms' ? 'Terms of Use' : 'Privacy Notice'}</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>
        {sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.body.map((b, i) =>
              typeof b === 'string' ? (
                <p key={i}>{b}</p>
              ) : (
                <ul key={i}>
                  {b.map((li) => (
                    <li key={li}>{li}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
        <section>
          <h2>Contact</h2>
          {contact ? (
            <p>
              You can email the administrators at <a href={`mailto:${contact}`}>{contact}</a>.
            </p>
          ) : (
            <p>
              Use the flag button on a message to report it, or send a private message to an administrator in
              QChat.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
