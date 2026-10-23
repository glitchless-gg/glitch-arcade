// Tiny WebAudio synth: chimes that climb with the cascade, pops, booms. No assets. M toggles mute;
// autoplay is always muted.
import { params } from './params.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = params.mute || params.autoplay;

function ensure() {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

window.addEventListener('keydown', () => ensure(), { passive: true });
window.addEventListener('pointerdown', () => ensure(), { passive: true });

function tone(freq, dur, { type = 'sine', vol = 0.4, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.5, freq = 1200, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq, t0);
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319];

export const sfx = {
  toggleMute() {
    muted = !muted;
    if (!muted) ensure();
    return muted;
  },
  select: () => tone(880, 0.06, { type: 'triangle', vol: 0.18 }),
  swap: () => noise(0.08, { vol: 0.2, freq: 2400, slide: -1600 }),
  invalid: () => tone(220, 0.14, { type: 'square', vol: 0.12, slide: -60 }),
  match(cascade, size) {
    const f = SCALE[Math.min(SCALE.length - 1, cascade + (size >= 4 ? 1 : 0))];
    tone(f, 0.16, { type: 'triangle', vol: 0.3 });
    tone(f * 1.5, 0.12, { type: 'sine', vol: 0.12, delay: 0.03 });
  },
  special: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.2, delay: i * 0.04 })),
  blast() {
    noise(0.45, { vol: 0.7, freq: 900, slide: -700 });
    tone(90, 0.35, { type: 'sine', vol: 0.4, slide: -40 });
  },
  stone: () => noise(0.12, { vol: 0.35, freq: 700, slide: -400 }),
  crown: () => [659, 880, 1319].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.28, delay: i * 0.07 })),
  hammer() {
    noise(0.2, { vol: 0.8, freq: 500, slide: -300 });
    tone(140, 0.2, { type: 'square', vol: 0.15, slide: -60 });
  },
  shuffle: () => [523, 659, 523, 784].forEach((f, i) => tone(f, 0.08, { type: 'triangle', vol: 0.16, delay: i * 0.05 })),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.3, delay: i * 0.09 })),
  fail: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', vol: 0.12, delay: i * 0.12 })),
  star: (i) => tone(1047 * (1 + i * 0.25), 0.18, { type: 'triangle', vol: 0.3 }),
};
