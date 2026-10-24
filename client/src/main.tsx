import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { LegalPage, legalKind } from './legal/LegalPage.js';
import './styles.css';

// The terms and privacy notice are public pages: no sign in, and no chat connection.
const legal = legalKind();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{legal ? <LegalPage kind={legal} /> : <App />}</StrictMode>,
);
