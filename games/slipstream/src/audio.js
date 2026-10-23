// Tiny WebAudio synth — no assets. An engine drone that follows the speed, plus blips. M toggles mute.
import { params } from './params.js';

let ctx = null;
let master = null;
let engine = null;
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
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.4) {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(master);
  src.start();
}

export const sfx = {
  get muted() {
    return muted;
  },
  toggleMute() {
    muted = !muted;
    if (muted) sfx.engine(0, false);
    else ensure();
    return muted;
  },
  /** engine drone: speed in m/s, on = racing */
  engine(speed, on) {
    const c = on ? ensure() : ctx;
    if (!c) return;
    if (!engine && on && c.state === 'running') {
      const osc = c.createOscillator();
      const osc2 = c.createOscillator();
      const filter = c.createBiquadFilter();
      const g = c.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      g.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(g).connect(master);
      osc.start();
      osc2.start();
      engine = { osc, osc2, filter, g };
    }
    if (!engine) return;
    const t = c.currentTime;
    const f = 55 + speed * 2.6;
    engine.osc.frequency.setTargetAtTime(f, t, 0.05);
    engine.osc2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    engine.filter.frequency.setTargetAtTime(400 + speed * 22, t, 0.08);
    engine.g.gain.setTargetAtTime(on && !muted ? 0.16 : 0, t, 0.08);
  },
  beep: () => tone(520, 0.16, { type: 'square', vol: 0.25 }),
  go: () => tone(1040, 0.4, { type: 'square', vol: 0.3 }),
  boost: () => tone(300, 0.35, { type: 'sawtooth', vol: 0.18, slide: 600 }),
  hit: () => noise(0.12, 0.35),
  wreck: () => {
    noise(0.6, 0.6);
    tone(140, 0.4, { type: 'triangle', vol: 0.3, slide: -90 });
  },
  lap: () => [660, 880].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.3, delay: i * 0.08 })),
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.3, delay: i * 0.1 })),
  overtake: () => tone(880, 0.1, { type: 'triangle', vol: 0.2 }),
};
