// Tiny WebAudio synth, no assets. M toggles mute. Autoplay is always muted.
import { params } from './params.js';

let ctx = null;
let master = null;
let muted = params.mute || params.autoplay;

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

function noise(dur, { vol = 0.4, delay = 0, lowpass = 900 } = {}) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
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
  jump: () => tone(300, 0.14, { type: 'square', vol: 0.14, slide: 260 }),
  airJump: () => tone(520, 0.16, { type: 'triangle', vol: 0.22, slide: 420 }),
  land: () => tone(120, 0.08, { type: 'triangle', vol: 0.22, slide: -50 }),
  dash: () => noise(0.16, { vol: 0.35, lowpass: 2400 }),
  swing: () => noise(0.09, { vol: 0.25, lowpass: 4200 }),
  hit: () => tone(180, 0.1, { type: 'square', vol: 0.22, slide: -90 }),
  kill: () => {
    tone(660, 0.08, { type: 'square', vol: 0.15 });
    tone(330, 0.16, { type: 'triangle', vol: 0.2, delay: 0.05, slide: -200 });
  },
  hurt: () => tone(220, 0.22, { type: 'sawtooth', vol: 0.18, slide: -140 }),
  death: () => {
    tone(330, 0.25, { type: 'square', vol: 0.18, slide: -220 });
    tone(110, 0.5, { type: 'triangle', vol: 0.3, delay: 0.15, slide: -60 });
  },
  save: () => [523, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.22, delay: i * 0.09 })),
  relic: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.26, delay: i * 0.08 })),
  telegraph: () => tone(90, 0.4, { type: 'sawtooth', vol: 0.14, slide: 60 }),
  slam: () => {
    noise(0.45, { vol: 0.7, lowpass: 380 });
    tone(55, 0.4, { type: 'sine', vol: 0.5, slide: -20 });
  },
  gate: () => noise(0.6, { vol: 0.4, lowpass: 600 }),
  victory: () => [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.28, delay: i * 0.12 })),
};
