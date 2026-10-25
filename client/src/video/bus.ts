import type { ServerMsg } from '@qchat/shared';

/**
 * Video set-up messages are events, not state, so they do not go through the chat reducer. The chat connection
 * passes them here, and whichever room's call is active picks up the ones for it.
 */
const listeners = new Set<(m: ServerMsg) => void>();

export function onSignal(fn: (m: ServerMsg) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitSignal(m: ServerMsg): void {
  for (const l of listeners) l(m);
}
