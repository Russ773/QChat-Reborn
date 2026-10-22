/**
 * Bundled soundboard. Every sound is synthesised in the browser with the Web
 * Audio API, so there are no audio files to ship, host or upload. A later phase
 * can add user-uploaded sounds alongside these.
 */

export interface SoundDef {
  id: string;
  label: string;
  emoji: string;
  play: (ctx: AudioContext) => void;
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.22): void {
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(g).connect(c.destination);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function sweep(c: AudioContext, f1: number, f2: number, start: number, dur: number, type: OscillatorType = 'sawtooth', gain = 0.2): void {
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
  o.connect(g).connect(c.destination);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, start: number, dur: number, gain = 0.2, filterFreq = 1500): void {
  const t = c.currentTime + start;
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  src.connect(f).connect(g).connect(c.destination);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.start(t);
  src.stop(t + dur);
}

export const SOUNDS: SoundDef[] = [
  { id: 'ding', label: 'Ding', emoji: '🔔', play: (c) => { tone(c, 880, 0, 0.5, 'sine', 0.25); tone(c, 1320, 0, 0.5, 'sine', 0.12); } },
  { id: 'pop', label: 'Pop', emoji: '🫧', play: (c) => { tone(c, 600, 0, 0.12, 'sine', 0.3); } },
  { id: 'coin', label: 'Coin', emoji: '🪙', play: (c) => { tone(c, 988, 0, 0.08, 'square', 0.16); tone(c, 1319, 0.08, 0.3, 'square', 0.16); } },
  { id: 'zap', label: 'Zap', emoji: '⚡', play: (c) => { sweep(c, 1200, 120, 0, 0.25, 'sawtooth', 0.2); } },
  { id: 'tada', label: 'Tada', emoji: '🎉', play: (c) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, f, i * 0.09, 0.4, 'triangle', 0.2)); } },
  { id: 'boing', label: 'Boing', emoji: '🤸', play: (c) => { sweep(c, 180, 600, 0, 0.1, 'sine', 0.25); sweep(c, 600, 160, 0.1, 0.25, 'sine', 0.22); } },
  { id: 'uhoh', label: 'Uh-oh', emoji: '😬', play: (c) => { tone(c, 440, 0, 0.2, 'triangle', 0.22); tone(c, 330, 0.2, 0.35, 'triangle', 0.22); } },
  { id: 'drum', label: 'Drum', emoji: '🥁', play: (c) => { sweep(c, 160, 50, 0, 0.18, 'sine', 0.35); noise(c, 0, 0.05, 0.15, 2500); } },
  { id: 'laser', label: 'Laser', emoji: '🔫', play: (c) => { sweep(c, 1400, 200, 0, 0.3, 'square', 0.14); } },
  { id: 'applause', label: 'Applause', emoji: '👏', play: (c) => { for (let i = 0; i < 9; i++) noise(c, i * 0.04, 0.07, 0.1, 3500); } },
];

const BY_ID = new Map(SOUNDS.map((s) => [s.id, s]));

export function playSound(id: string): void {
  const def = BY_ID.get(id);
  if (!def) return;
  const c = audio();
  if (!c) return;
  try {
    def.play(c);
  } catch {
    /* ignore */
  }
}

export function soundLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}
