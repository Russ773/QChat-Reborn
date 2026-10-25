/**
 * Keyboard and screen reader help that applies to every pop-up window (dialog) in the app, so each one does not
 * need to remember to do it: it is marked as a modal dialog, focus moves into it, Tab stays inside it, and focus
 * goes back to where it was when it closes.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (el: HTMLElement): boolean => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

export function installDialogFocus(): void {
  const stack: { backdrop: HTMLElement; previous: HTMLElement | null }[] = [];

  const open = (backdrop: HTMLElement) => {
    if (stack.some((s) => s.backdrop === backdrop)) return;
    const dialog = backdrop.querySelector<HTMLElement>('[role="dialog"], .modal');
    if (!dialog) return;
    // A <form> cannot be a dialog, so for those the dialog is the backdrop that wraps it.
    const host = dialog.tagName === 'FORM' ? backdrop : dialog;
    const label = dialog.getAttribute('aria-label') ?? dialog.querySelector('h2')?.textContent ?? '';
    if (host !== dialog) {
      dialog.removeAttribute('role');
      dialog.removeAttribute('aria-label');
    }
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    if (label && !host.hasAttribute('aria-label')) host.setAttribute('aria-label', label);
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    stack.push({ backdrop, previous: document.activeElement instanceof HTMLElement ? document.activeElement : null });
    // Give the dialog a moment to finish rendering, then move in (unless it already put focus somewhere, e.g. autofocus).
    window.setTimeout(() => {
      if (dialog.contains(document.activeElement)) return;
      (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    }, 0);
  };

  const close = (backdrop: HTMLElement) => {
    const i = stack.findIndex((s) => s.backdrop === backdrop);
    if (i < 0) return;
    const [{ previous }] = stack.splice(i, 1);
    if (previous && document.contains(previous)) previous.focus();
  };

  const scan = () => {
    const live = new Set(document.querySelectorAll<HTMLElement>('.modal-backdrop'));
    live.forEach(open);
    for (const s of [...stack]) if (!live.has(s.backdrop)) close(s.backdrop);
  };

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });

  // Escape closes the pop-up that is on top. A dialog that already handles Escape itself is left alone.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || stack.length === 0) return;
    const top = stack[stack.length - 1].backdrop;
    window.setTimeout(() => {
      if (!document.contains(top)) return; // it closed itself
      (top.querySelector<HTMLElement>('.modal-x') ?? top).click();
    }, 0);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || stack.length === 0) return;
    const dialog = stack[stack.length - 1].backdrop.querySelector<HTMLElement>('[role="dialog"], .modal');
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
    if (items.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  });
}
