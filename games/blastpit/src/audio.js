// Tiny WebAudio synth: shots, booms, hits, pickups. No assets. M toggles mute; autoplay is always muted.
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
      master.gain.value = 0.2;
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

function noise(dur, { vol = 0.5, freq = 1200, q = 0.8, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
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
  get muted() {
    return muted;
  },
  toggleMute() {
    muted = !muted;
    if (!muted) ensure();
    return muted;
  },
  shot(weapon) {
    if (weapon === 'pistol') {
      noise(0.09, { vol: 0.5, freq: 3200, slide: -2600 });
      tone(420, 0.07, { type: 'square', vol: 0.12, slide: -260 });
    } else if (weapon === 'shotgun') {
      noise(0.28, { vol: 0.9, freq: 1800, slide: -1500 });
      tone(110, 0.18, { type: 'sawtooth', vol: 0.25, slide: -60 });
      noise(0.05, { vol: 0.3, freq: 2500, delay: 0.32 }); // pump
    } else {
      noise(0.4, { vol: 0.45, freq: 900, slide: 1400 });
      tone(160, 0.3, { type: 'sawtooth', vol: 0.15, slide: 120 });
    }
  },
  boom() {
    noise(0.7, { vol: 1, freq: 700, slide: -600, q: 0.5 });
    tone(70, 0.5, { type: 'sine', vol: 0.6, slide: -40 });
  },
  hit: () => tone(1500, 0.04, { type: 'square', vol: 0.08 }),
  kill: () => {
    tone(900, 0.06, { type: 'square', vol: 0.12 });
    tone(1350, 0.08, { type: 'square', vol: 0.1, delay: 0.05 });
  },
  hurt: () => tone(150, 0.15, { type: 'sawtooth', vol: 0.3, slide: -70 }),
  pickup: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.08, { type: 'triangle', vol: 0.25, delay: i * 0.05 })),
  empty: () => tone(1800, 0.03, { type: 'square', vol: 0.06 }),
  switch: () => noise(0.06, { vol: 0.25, freq: 3000 }),
  spawn: () => tone(220, 0.5, { type: 'sawtooth', vol: 0.08, slide: 440 }),
  swarm: () => [196, 233, 277, 311].forEach((f, i) => tone(f, 0.22, { type: 'sawtooth', vol: 0.14, delay: i * 0.12 })),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.3, delay: i * 0.08 })),
  death: () => {
    tone(300, 0.6, { type: 'sawtooth', vol: 0.3, slide: -250 });
    noise(0.5, { vol: 0.4, freq: 600, slide: -500 });
  },
};
