import { SKINS, THEMES, type ThemeChoice } from '@qchat/shared';

const KEY_THEME = 'qchat_theme';
const KEY_SKIN = 'qchat_skin';

const resolve = (t: ThemeChoice): 'dark' | 'light' =>
  t === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;

let watching: (() => void) | null = null;

/** Put a theme and skin on the page, and remember them for next time (the sign in page needs them too). */
export function applyLook(theme: ThemeChoice, skin: string): void {
  const t = THEMES.some((x) => x.id === theme) ? theme : 'dark';
  const s = SKINS.some((x) => x.id === skin) ? skin : 'default';
  const root = document.documentElement;
  root.dataset.theme = resolve(t);
  root.dataset.skin = s;
  try {
    localStorage.setItem(KEY_THEME, t);
    localStorage.setItem(KEY_SKIN, s);
  } catch {
    /* a private window: it simply will not be remembered */
  }
  // "Match my device" follows it as it changes (dusk, a switch in the system settings).
  watching?.();
  watching = null;
  if (t === 'auto' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => (root.dataset.theme = mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', on);
    watching = () => mq.removeEventListener('change', on);
  }
}

/** Is the page showing the light theme right now? */
export const isLight = (): boolean => document.documentElement.dataset.theme === 'light';
