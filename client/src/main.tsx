import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { LegalPage, legalKind } from './legal/LegalPage.js';
import { MailPage, mailPageKind } from './legal/MailPages.js';
import { installDialogFocus } from './a11y.js';
import './styles.css';

installDialogFocus();

// The terms and privacy notice are public pages: no sign in, and no chat connection.
const legal = legalKind();
const mailPage = mailPageKind();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{legal ? <LegalPage kind={legal} /> : mailPage ? <MailPage kind={mailPage} /> : <App />}</StrictMode>,
);
