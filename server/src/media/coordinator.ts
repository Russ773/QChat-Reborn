import { randomUUID } from 'node:crypto';
import {
  effectivePosition,
  type MediaClientEvent,
  type MediaItem,
  type MediaKind,
  type MediaState,
} from '@qchat/shared';

/** Detect the provider/kind for a shared URL and extract a provider id. */
export function classifyUrl(url: string): { kind: MediaKind; providerId?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unknown' };
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.searchParams.get('v');
    if (id) return { kind: 'youtube', providerId: id };
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    if (id) return { kind: 'youtube', providerId: id };
  }

  const path = parsed.pathname.toLowerCase();
  if (/\.(mp3|ogg|oga|wav|m4a|flac|aac)$/.test(path)) return { kind: 'audio' };
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return { kind: 'video' };

  return { kind: 'unknown' };
}

/**
 * Holds and mutates the authoritative watch-party state for every channel.
 * The server owns broadcasting; this class only decides what the new state is.
 */
export class MediaCoordinator {
  private states = new Map<string, MediaState>();

  /** Current snapshot for a channel, or undefined if none has been created. */
  getState(channelKey: string): MediaState | undefined {
    return this.states.get(channelKey);
  }

  /** Drop a channel's state once it becomes empty. */
  dispose(channelKey: string): void {
    this.states.delete(channelKey);
  }

  private ensure(channelKey: string, channelName: string): MediaState {
    let state = this.states.get(channelKey);
    if (!state) {
      state = {
        channel: channelName,
        queue: [],
        currentIndex: -1,
        playing: false,
        position: 0,
        atServerMs: Date.now(),
      };
      this.states.set(channelKey, state);
    }
    return state;
  }

  /**
   * Apply a client intent. Returns the updated state to broadcast, or null if
   * the event was a no-op (e.g. seeking with nothing playing).
   */
  handle(
    channelKey: string,
    channelName: string,
    event: MediaClientEvent,
    addedBy: string,
  ): MediaState | null {
    const state = this.ensure(channelKey, channelName);
    const now = Date.now();

    switch (event.t) {
      case 'enqueue': {
        const { kind, providerId } = classifyUrl(event.url);
        const item: MediaItem = {
          id: randomUUID(),
          url: event.url,
          kind,
          providerId,
          title: event.url,
          addedBy,
        };
        state.queue.push(item);
        // If nothing is playing, start this item immediately.
        if (state.currentIndex === -1) {
          state.currentIndex = state.queue.length - 1;
          state.position = 0;
          state.playing = true;
          state.atServerMs = now;
        }
        return state;
      }

      case 'play': {
        if (state.currentIndex === -1) return null;
        if (!state.playing) {
          state.playing = true;
          state.atServerMs = now;
        }
        return state;
      }

      case 'pause': {
        if (state.currentIndex === -1) return null;
        if (state.playing) {
          state.position = effectivePosition(state, now);
          state.playing = false;
          state.atServerMs = now;
        }
        return state;
      }

      case 'seek': {
        if (state.currentIndex === -1) return null;
        state.position = Math.max(0, event.position);
        state.atServerMs = now;
        return state;
      }

      case 'skip': {
        if (state.queue.length === 0) return null;
        const target =
          event.index !== undefined ? event.index : state.currentIndex + 1;
        if (target < 0 || target >= state.queue.length) {
          // Skipped past the end: go idle.
          state.currentIndex = -1;
          state.playing = false;
          state.position = 0;
        } else {
          state.currentIndex = target;
          state.position = 0;
          state.playing = true;
        }
        state.atServerMs = now;
        return state;
      }

      case 'remove': {
        const idx = state.queue.findIndex((i) => i.id === event.id);
        if (idx === -1) return null;
        state.queue.splice(idx, 1);
        if (idx < state.currentIndex) {
          state.currentIndex--;
        } else if (idx === state.currentIndex) {
          // Removed the currently-playing item: restart at same index.
          if (state.currentIndex >= state.queue.length) state.currentIndex = -1;
          state.position = 0;
          state.playing = state.currentIndex !== -1;
        }
        state.atServerMs = now;
        return state;
      }
    }
  }
}
