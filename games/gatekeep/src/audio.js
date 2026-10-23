// Tiny WebAudio blip synth, no assets. M toggles mute; autoplay is always muted.
import { params } from './params.js';

let ctx = null;
let master = null;
let muted = params.mute || params.autoplay;
let lastShot = 0;

function ensure() {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.2;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

window.addEventListener('keydown', () => ensure(), { passive: true });
window.addEventListener('pointerdown', () => ensure(), { passive: true });

function tone(freq, dur, { type = 'square', vol = 0.5, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// shots are frequent: at most one blip every 60 ms
function throttled(fn) {
  return () => {
    const now = performance.now();
    if (now - lastShot < 60) return;
    lastShot = now;
    fn();
  };
}

export const sfx = {
  get muted() {
    return muted;
  },
  toggleMute() {
    muted = !muted;
    if (!muted) ensure();
    return muted;
  },
  build: () => [392, 523].forEach((f, i) => tone(f, 0.1, { type: 'triangle', vol: 0.3, delay: i * 0.06 })),
  upgrade: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.3, delay: i * 0.06 })),
  sell: () => [659, 440].forEach((f, i) => tone(f, 0.1, { type: 'triangle', vol: 0.25, delay: i * 0.06 })),
  nope: () => tone(160, 0.12, { type: 'square', vol: 0.15, slide: -40 }),
  arrow: throttled(() => tone(1200, 0.04, { type: 'triangle', vol: 0.06, slide: -500 })),
  cannon: () => tone(110, 0.18, { type: 'square', vol: 0.12, slide: -60 }),
  frost: () => tone(1600, 0.2, { type: 'sine', vol: 0.06, slide: 600 }),
  leak: () => tone(180, 0.25, { type: 'sawtooth', vol: 0.15, slide: -100 }),
  wave: () => [262, 330, 392].forEach((f, i) => tone(f, 0.16, { type: 'square', vol: 0.12, delay: i * 0.09 })),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.25, delay: i * 0.08 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.3, delay: i * 0.16 })),
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.3, delay: i * 0.1 })),
};
