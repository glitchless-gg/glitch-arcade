// Tiny WebAudio synth: every sound is made from oscillators and noise, no files. Muted with ?mute=1 and in autoplay.
import { params } from './params.js';

let ctx = null;
let master = null;
let muted = params.mute || params.autoplay;
let noiseBuf = null;

function ac() {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      muted = true;
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ f = 440, f2 = null, t = 0.15, type = 'sine', vol = 0.4, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const at = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), at + t);
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + t);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + t + 0.02);
}

function noise({ t = 0.15, vol = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, sweep = null }) {
  const c = ac();
  if (!c) return;
  const at = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, at + t);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + t);
  s.connect(f).connect(g).connect(master);
  s.start(at);
  s.stop(at + t + 0.02);
}

export const sfx = {
  toggleMute() {
    muted = !muted;
    return muted;
  },
  swing: () => noise({ t: 0.14, vol: 0.22, freq: 2400, sweep: 700, q: 0.8 }),
  hit: (crit) => {
    noise({ t: 0.08, vol: 0.35, freq: 900, q: 1.2 });
    tone({ f: crit ? 520 : 180, f2: crit ? 260 : 90, t: 0.1, type: 'square', vol: 0.12 });
  },
  kill: () => {
    noise({ t: 0.22, vol: 0.3, freq: 500, q: 0.7, sweep: 200 });
    tone({ f: 140, f2: 50, t: 0.25, type: 'triangle', vol: 0.25 });
  },
  hurt: () => tone({ f: 220, f2: 110, t: 0.18, type: 'sawtooth', vol: 0.18 }),
  dodge: () => noise({ t: 0.2, vol: 0.18, freq: 600, sweep: 2000, q: 0.6 }),
  nova: () => {
    noise({ t: 0.6, vol: 0.4, freq: 300, sweep: 3000, q: 0.5, type: 'lowpass' });
    tone({ f: 90, f2: 40, t: 0.5, type: 'sine', vol: 0.4 });
  },
  potion: () => {
    tone({ f: 300, f2: 600, t: 0.18, type: 'sine', vol: 0.25 });
    tone({ f: 450, f2: 900, t: 0.2, type: 'sine', vol: 0.2, delay: 0.1 });
  },
  levelUp: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: 0.35, type: 'triangle', vol: 0.22, delay: i * 0.09 })),
  coin: () => tone({ f: 1320, f2: 1760, t: 0.09, type: 'square', vol: 0.08 }),
  drop: (rarity) => {
    const base = { common: 600, magic: 760, rare: 900, legendary: 520 }[rarity] || 600;
    tone({ f: base, f2: base * 1.5, t: 0.25, type: 'sine', vol: 0.15 });
    if (rarity === 'legendary') [0, 0.12, 0.24].forEach((d, i) => tone({ f: base * (1 + i * 0.5), t: 0.6, type: 'triangle', vol: 0.18, delay: d }));
  },
  equip: () => {
    noise({ t: 0.1, vol: 0.2, freq: 3000, q: 2 });
    tone({ f: 880, t: 0.12, type: 'triangle', vol: 0.15, delay: 0.05 });
  },
  arrow: () => noise({ t: 0.09, vol: 0.12, freq: 3200, sweep: 1200, q: 3 }),
  windup: () => tone({ f: 160, f2: 240, t: 0.25, type: 'sawtooth', vol: 0.06 }),
  slam: () => {
    noise({ t: 0.5, vol: 0.5, freq: 200, q: 0.5, type: 'lowpass' });
    tone({ f: 70, f2: 30, t: 0.5, type: 'sine', vol: 0.5 });
  },
  roar: () => {
    tone({ f: 110, f2: 60, t: 1.1, type: 'sawtooth', vol: 0.18 });
    noise({ t: 1.0, vol: 0.25, freq: 400, q: 0.6 });
  },
  stairs: () => [392, 523, 659].forEach((f, i) => tone({ f, t: 0.5, type: 'sine', vol: 0.18, delay: i * 0.15 })),
  death: () => {
    tone({ f: 200, f2: 50, t: 1.1, type: 'triangle', vol: 0.3 });
    noise({ t: 0.8, vol: 0.2, freq: 300, q: 0.5, type: 'lowpass' });
  },
  click: () => tone({ f: 660, t: 0.06, type: 'square', vol: 0.08 }),
};
