// Tiny WebAudio synth: flaps, points, bonks, medals. No assets. M toggles mute; autoplay is always muted.
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

function tone(freq, dur, { type = 'square', vol = 0.4, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
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

export const sfx = {
  toggleMute() {
    muted = !muted;
    if (!muted) ensure();
    return muted;
  },
  flap: () => {
    noise(0.08, { vol: 0.35, freq: 2400, slide: -1600 });
    tone(520, 0.07, { type: 'triangle', vol: 0.12, slide: 260 });
  },
  point: () => {
    tone(988, 0.07, { type: 'square', vol: 0.12 });
    tone(1319, 0.12, { type: 'square', vol: 0.12, delay: 0.07 });
  },
  hit: () => {
    noise(0.22, { vol: 0.9, freq: 900, slide: -700 });
    tone(140, 0.2, { type: 'sawtooth', vol: 0.3, slide: -80 });
  },
  fall: () => tone(700, 0.45, { type: 'triangle', vol: 0.12, slide: -520, delay: 0.12 }),
  medal: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.28, delay: i * 0.08 })),
  biome: () => [523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'sine', vol: 0.25, delay: i * 0.1 })),
  swoosh: () => noise(0.25, { vol: 0.4, freq: 600, slide: 2400 }),
};
