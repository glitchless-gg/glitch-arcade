// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// It plays through the same input a person has: one flap button. Every fixed step it looks at the bird
// and the next gap, predicts where the bird will be a moment from now, and decides to flap when that is
// below its target height (the centre of the next gap, as it judges it). The flap lands after a
// reaction delay plus timing noise, both larger at low skill; low skill also misjudges gap centres more,
// looks less far ahead (so the squeeze at pipe 12 comes as a surprise), and has more slips (a double
// tap, a moment of hesitation). Between runs it sits on the game-over card for a bit, like a person,
// retries, and after a while (or a number of runs, more at low skill) it quits. Deterministic per seed.
import { PHYS } from './physics.js';
import { PIPE_W, SPACING, CEILING_Y, pipeAt, pipesPassed } from './course.js';
import { createRng } from './rng.js';

const R = PHYS.RADIUS;
const G = PHYS.GRAVITY;
const RISE = (PHYS.FLAP_VY * PHYS.FLAP_VY) / (2 * G); // height a flap gains (~1.29)
const ARC = RISE / 2; // a flap's arc spans ±ARC around its middle: flap when the bird is ARC under the target

export function createAutoplay({ skill, seed }) {
  const rng = createRng(seed);
  const unskill = 1 - skill;

  const reaction = 0.04 + 0.1 * unskill; // s from deciding to the flap landing
  const sigma = 0.013 + 0.03 * Math.pow(unskill, 1.5); // timing noise (1σ, s)
  const biasSigma = 0.05 + 0.2 * unskill * unskill; // how far off it judges a gap's centre (1σ, units)
  const lookahead = 0.8 + 2.5 * skill * skill; // units before the next pipe at which it starts heading for its gap
  const compensate = 0.55 + 0.45 * skill; // how much of its own delay it allows for
  const cooldown = 0.085 + 0.05 * unskill; // fastest it can tap again
  const slipRate = 0.035 + 0.08 * unskill * unskill; // slips per second at the start of a run; attention fades as a run goes on
  const quitAt = 60 + 60 * rng.next(); // s of session before it calls it a day
  const maxRuns = 4 + Math.round(9 * unskill) + rng.int(0, 2);

  const bot = {
    skill,
    seed,
    halted: false,
    elapsed: 0,
    runs: 0,
    quitAt,
    maxRuns,
    // per run
    clock: 0,
    pendingAt: -1,
    lastFlap: -1,
    doubleTap: false,
    frozenUntil: 0,
    bias: new Map(),
    // menus
    menuT: 0.9 + 0.8 * rng.next(),
    menuPlan: null,
    lastDeath: null,
    stats: { flaps: 0, slips: 0 },

    /** real time, every frame */
    tick(dt) {
      bot.elapsed += dt;
    },

    onRunStart() {
      bot.runs++;
      bot.clock = 0;
      bot.pendingAt = -1;
      bot.lastFlap = 0;
      bot.doubleTap = false;
      bot.frozenUntil = 0;
      bot.bias.clear();
      bot.menuPlan = null;
    },

    onDeath(info) {
      bot.lastDeath = info;
      bot.menuPlan = null;
    },

    /** one fixed step while playing: true = flap */
    step(game, dt) {
      bot.clock += dt;
      const t = bot.clock;
      const b = game.bird;
      if (bot.pendingAt >= 0 && t >= bot.pendingAt) {
        bot.pendingAt = -1;
        bot.lastFlap = t;
        bot.stats.flaps++;
        if (bot.doubleTap) {
          // a slip: the finger taps twice
          bot.doubleTap = false;
          bot.pendingAt = t + 0.07 + 0.08 * rng.next();
        }
        return true;
      }
      if (bot.pendingAt >= 0 || t < bot.frozenUntil) return false;

      const fatigue = (1 + t / 12) * (bot.elapsed > quitAt ? 3 : 1); // long runs, and past its bedtime
      if (rng.next() < slipRate * fatigue * dt) {
        bot.stats.slips++;
        if (rng.next() < 0.5) bot.doubleTap = true;
        else bot.frozenUntil = t + 0.15 + 0.3 * rng.next(); // hesitates
      }

      const target = targetHeight(b);
      const h = dt + reaction * compensate; // where the bird will be when the flap lands, as far as it allows for
      const vy = Math.max(-PHYS.MAX_FALL, b.vy - G * h);
      const yp = b.y + ((b.vy + vy) / 2) * h;
      const peak = b.y + RISE;
      if (yp < target - ARC && t - bot.lastFlap >= cooldown && peak + R < CEILING_Y - 0.05) {
        const delay = Math.max(0, reaction + sigma * rng.gauss());
        bot.pendingAt = t + delay;
        if (delay < dt) {
          bot.pendingAt = -1;
          bot.lastFlap = t;
          bot.stats.flaps++;
          return true;
        }
      }
      return false;
    },

    /**
     * Menus, every frame: returns 'press' (start / retry) or 'quit' when it acts, else null.
     * state: 'title' | 'gameover'; ready: the card takes input now.
     */
    menu(state, dt, ready = true) {
      if (state === 'title') {
        bot.menuT -= dt;
        return bot.menuT <= 0 ? 'press' : null;
      }
      if (state !== 'gameover' || !ready) return null;
      if (!bot.menuPlan) bot.menuPlan = planMenu();
      bot.menuPlan.t -= dt;
      return bot.menuPlan.t <= 0 ? bot.menuPlan.action : null;
    },
  };

  function planMenu() {
    if (bot.elapsed >= quitAt || bot.runs >= maxRuns) return { action: 'quit', t: 0.9 + 0.9 * rng.next() };
    let t = 0.7 + 1.1 * rng.next() + 1.6 * unskill * rng.next();
    const squeezed = bot.lastDeath?.score === 11;
    if (squeezed && rng.next() < 0.5) t = 0.35 + 0.5 * rng.next(); // "again!": straight back in
    else if (rng.next() < 0.1) t = 5 + 9 * rng.next(); // a longer look at the card
    return { action: 'press', t };
  }

  /** where it wants the bird: the centre of the next gap as it judges it, heading early for the one after */
  function targetHeight(b) {
    const n = pipesPassed(b.x - R) + 1; // the first pipe the bird hasn't cleared
    const p = pipeAt(n);
    const q = pipeAt(n + 1);
    const yp = p.y + biasFor(p.n);
    const yq = q.y + biasFor(q.n);
    const inside = b.x + R > p.x - PIPE_W / 2;
    const toNext = q.x - PIPE_W / 2 - (b.x + R); // distance before the bird reaches the next pipe
    let target = yp;
    if (toNext < lookahead) {
      const k = Math.min(1, Math.max(0, 1 - toNext / Math.min(lookahead, SPACING)));
      target = yp + (yq - yp) * k;
    }
    if (inside) {
      // stay inside this gap while going through it (the flap's arc has to fit)
      const lo = p.y - p.gap / 2 + R + ARC + 0.06;
      const hi = p.y + p.gap / 2 - R - ARC - 0.06;
      target = Math.min(Math.max(target, Math.min(lo, hi)), Math.max(lo, hi));
    }
    return target;
  }

  function biasFor(n) {
    let v = bot.bias.get(n);
    if (v === undefined) {
      v = biasSigma * rng.gauss();
      bot.bias.set(n, v);
    }
    return v;
  }

  return bot;
}
