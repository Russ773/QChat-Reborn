/** Desktop notifications for mentions and private messages while the tab is in the background. */

const KEY = 'qchat_notify';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** True when the member has switched them on AND the browser has allowed them. */
export function notificationsEnabled(): boolean {
  try {
    return notificationsSupported() && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** The member's own on/off choice (it may still be blocked in the browser). */
export function notificationsWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export async function enableNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  try {
    localStorage.setItem(KEY, result === 'granted' ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  return result === 'granted' ? 'granted' : 'denied';
}

export function disableNotifications(): void {
  try {
    localStorage.setItem(KEY, '0');
  } catch {
    /* storage unavailable */
  }
}

export function showDesktopNotification(title: string, body: string): void {
  if (!notificationsEnabled() || !document.hidden) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 140), tag: 'qchat' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
