// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// Follows the designed route room by room. Each room gets a small program: walk to an x (pits,
// blocks, lava and moving platforms are handled by a look-ahead planner that simulates "jump in k
// steps" with the real physics, like the Zoomies bot), drop down the shaft, climb it with double
// jumps, ride the lift, do the Spike Gallery dash + double jump, fight the Warden. Every timed action
// gets human-ish noise that grows as skill drops; low skill also hesitates, panics and reacts late.
// The sword is a reflex: swing at bats and crawlers in reach. Deterministic per seed.
import { PHYS } from './physics.js';
import { stepPlay } from './sim.js';
import { ROOM_BY_ID } from './rooms.js';
import { createRng } from './rng.js';

const STEP = PHYS.STEP;
const MAX_SIM = 230;

// the Spike Gallery line (found headless): air-dash at x 74.85, double jump 0.2475 s after the dash
const GALLERY = { dashX: 74.85, jumpAfter: 0.2475 };

// Long Shaft ledges, bottom to top: where to take off and where to land
const SHAFT_HOPS = [
  { y: -15, dir: 1, takeoff: 57.5, target: 64.5, to: -10.5 },
  { y: -10.5, dir: -1, takeoff: 62.5, target: 55.5, to: -6 },
  { y: -6, dir: 1, takeoff: 57.5, target: 64.5, to: -1.25 },
  { y: -1.25, dir: -1, takeoff: 62.5, target: 60, to: 3.5 },
  { y: 0, dir: 1, takeoff: 57.5, target: 60, to: 3.5 },
  { y: 3.5, dir: 1, takeoff: 60.6, target: 64.5, to: 8 },
];

export function createAutoplay({ skill, seed, onQuit }) {
  const rng = createRng(seed);
  const unskill = 1 - skill;
  const sigma = 0.003 + 0.08 * Math.pow(unskill, 1.5); // timing noise (1σ, seconds)
  const GALLERY_NERVES = 1.8; // timing noise is this much worse in the Spike Gallery
  const pPanic = unskill * unskill; // Spike Gallery: jumps far too early
  const pHesitate = 0.05 + 0.3 * unskill;
  const reaction = 0.07 + 0.28 * unskill; // seconds to notice an enemy / an opening
  const pMiss = 0.75 * unskill; // doesn't notice an enemy for a while
  const bossSigma = 0.02 + 0.4 * Math.pow(unskill, 1.5); // dodge timing noise
  const pGreedy = 0.55 * unskill; // keeps swinging after the Warden's opening closes

  const input = { left: false, right: false, jump: false, dash: false, attack: false };
  const bot = {
    skill,
    seed,
    input,
    halted: false,
    reason: null,
    clock: 0,
    elapsed: 0,
    program: null,
    pc: 0,
    stepState: null,
    needProgram: true,
    // planner state (walk steps)
    plan: null,
    hes: 0,
    holding: false,
    sinceJump: 0,
    backups: 0,
    backingUp: false,
    lastThreatKey: null,
    skip: new Set(),
    // reflexes
    seeT: 0,
    seeReact: reaction,
    lastAttack: false,
    // boss
    dodge: null,
    openSeen: -1,
    greedUntil: 0,
    // bookkeeping
    galleryDeaths: 0,
    bossDeaths: 0,
    rageIn: -1,
    rageAt: null,
    menuT: 0,
    menuWait: 0.8,
    near: new Map(),
    stats: { plans: 0, sims: 0, programs: 0 },
  };

  // ── local physics copies for what-if sims ---------------------------------------------------
  function buildNear(play) {
    bot.near.clear();
    for (const id of Object.keys(ROOM_BY_ID)) {
      const b = ROOM_BY_ID[id].bounds;
      const inside = (x0, x1, y0, y1) => x1 > b.x0 - 2 && x0 < b.x1 + 2 && y1 > b.y0 - 2 && y0 < b.y1 + 2;
      bot.near.set(id, {
        solids: play.solids.filter((s) => s.axis || inside(s.x, s.x + s.w, s.y - s.h, s.y)),
        hazards: play.hazards.filter((h) => inside(h.x0, h.x1, h.y0, h.y1)),
      });
    }
  }

  function localPlay(game) {
    const p = game.play;
    const near = bot.near.get(game.room.id);
    const movers = p.movers.map((m) => ({ ...m }));
    const map = new Map(p.movers.map((m, i) => [m, movers[i]]));
    return {
      body: { ...p.body, ground: map.get(p.body.ground) || p.body.ground },
      movers,
      solids: near.solids.map((s) => map.get(s) || s),
      hazards: near.hazards,
      t: p.t,
      abilities: { ...p.abilities },
    };
  }

  /**
   * Simulate: run in `dir`, press jump `delay` steps from now (Infinity = never), hold it until the
   * apex, optionally dash `dashAt` steps after the jump and air-jump `airAt` steps after it.
   * `ok(b, startGround)` says when the landing counts; it must then survive a beat.
   */
  function trial(game, { dir, delay, dashAt = -1, airAt = -1, ok, maxSteps = MAX_SIM }) {
    bot.stats.sims++;
    const s = localPlay(game);
    const b = s.body;
    b.jumpWasDown = false;
    b.dashWasDown = false;
    const startGround = b.ground;
    let since = -1;
    let holdOn = false;
    let okAt = -1;
    for (let i = 0; i < maxSteps; i++) {
      const inp = { left: dir < 0, right: dir > 0, jump: false, dash: false };
      if (i === delay) {
        since = 0;
        holdOn = true;
      }
      if (since >= 0) {
        let jump = false;
        if (holdOn) {
          jump = since < 3 || b.vy > 0;
          if (!jump) holdOn = false;
        }
        if (airAt >= 0 && since === airAt - 1) {
          jump = false;
          holdOn = false;
        }
        if (airAt >= 0 && since >= airAt && (since < airAt + 3 || b.vy > 0)) jump = true;
        inp.jump = jump;
        inp.dash = since === dashAt;
        since++;
      }
      const ev = stepPlay(s, inp, STEP);
      if (ev.hazard) return false;
      if (okAt >= 0) {
        if (i - okAt >= 18) return true;
        continue;
      }
      if (!b.grounded || (delay !== Infinity && i < delay)) continue;
      if (ok(b, startGround)) okAt = i;
    }
    return false;
  }

  // ── threats on the way (walk steps) ----------------------------------------------------------
  function supportEdge(play, dir) {
    const b = play.body;
    const g = b.ground;
    if (!g) return null;
    if (g.axis) return dir > 0 ? g.x + g.w : g.x;
    let edge = dir > 0 ? g.x + g.w : g.x;
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of play.solids) {
        if (s === g || s.axis || s.oneWay) continue;
        if (Math.abs(s.y - g.y) > 0.05) continue;
        if (dir > 0 && s.x <= edge + 0.05 && s.x + s.w > edge + 0.05) {
          edge = s.x + s.w;
          grew = true;
        } else if (dir < 0 && s.x + s.w >= edge - 0.05 && s.x < edge - 0.05) {
          edge = s.x;
          grew = true;
        }
      }
    }
    return edge;
  }

  function findThreat(game, dir, goal) {
    const play = game.play;
    const b = play.body;
    const look = Math.max(4, Math.abs(b.vx) * 0.85 + 1.5);
    let best = null;
    const ahead = (x) => (x - b.x) * dir;
    const consider = (t) => {
      if ((t.x - goal) * dir > 0) return; // nothing past the goal matters
      if (!best || ahead(t.x) < ahead(best.x)) best = t;
    };
    const edge = supportEdge(play, dir);
    if (edge !== null && ahead(edge) < look) consider({ kind: 'edge', x: edge, key: `edge:${edge.toFixed(1)}` });
    for (const s of play.solids) {
      if (s === b.ground || s.oneWay || s.axis) continue;
      const near = dir > 0 ? s.x : s.x + s.w;
      const d = (near - b.x) * dir;
      if (d < PHYS.HALF_W - 0.05 || d > look) continue;
      if (s.y <= b.y + 0.05) continue;
      if (s.y - s.h >= b.y + PHYS.HEIGHT) continue;
      consider({ kind: 'wall', x: near, key: `wall:${near.toFixed(1)}` });
    }
    for (const h of play.hazards) {
      if (h.y1 < b.y - 0.2 || h.y0 > b.y + 0.4) continue; // only hazards at foot level
      const near = dir > 0 ? h.x0 : h.x1;
      const far = dir > 0 ? h.x1 : h.x0;
      const d = (near - b.x) * dir;
      if (d < -0.2 || d > look) continue;
      consider({ kind: 'hazard', x: near, far, key: `hz:${near.toFixed(1)}` });
    }
    return best;
  }

  function passed(threat, dir, fromY) {
    return (b, startGround) => {
      if (b.y < fromY - 3) return false; // never "solve" a gap by dropping into the room below
      if (threat.kind === 'edge') return b.ground !== startGround && (b.x - threat.x) * dir > PHYS.HALF_W;
      if (threat.kind === 'hazard') return (b.x - threat.far) * dir > PHYS.HALF_W + 0.05;
      return (b.x - threat.x) * dir > 0.35;
    };
  }

  function makePlan(game, threat, dir) {
    bot.stats.plans++;
    const b = game.play.body;
    const ok = passed(threat, dir, b.y);
    if (threat.kind === 'edge' && trial(game, { dir, delay: Infinity, ok })) return { type: 'walk', untilX: threat.x + dir * 0.6, key: threat.key, dir };
    const speed = Math.max(2.5, Math.abs(b.vx));
    const K = Math.min(140, Math.ceil(Math.abs(threat.x + dir * 1.3 - b.x) / speed / STEP) + 16);
    const variants = [{ dashAt: -1 }];
    if (game.abilities.dash) variants.push({ dashAt: 34 });
    for (const v of variants) {
      let lo = -1;
      let hi = -1;
      for (let k = 0; k <= K; k += 2) {
        if (trial(game, { dir, delay: k, dashAt: v.dashAt, ok })) {
          if (lo < 0) lo = k;
          hi = k;
        } else if (lo >= 0) break;
      }
      if (lo < 0) continue;
      // aim at the middle of the early part of the window (late "jumps" just bump into the obstacle first)
      let k = Math.round(lo + Math.min(hi - lo, 24) / 2 + rng.gauss() * (sigma / STEP));
      if (rng.chance(pPanic * 0.25)) k = rng.int(0, Math.max(0, lo - 1)); // nervous early jump
      return { type: 'jump', k: Math.max(0, k), dashAt: v.dashAt, key: threat.key, threat, dir, moverRef: b.ground?.axis ? b.ground.id : null };
    }
    return null;
  }

  function press() {
    input.jump = true;
    bot.holding = true;
    bot.sinceJump = 0;
  }

  // ── step executors -------------------------------------------------------------------------
  function brakeTo(b, x) {
    const dx = x - b.x;
    const stopDist = (b.vx * b.vx) / (2 * PHYS.DECEL_GROUND) + 0.05;
    if (Math.abs(dx) > Math.max(0.2, stopDist)) {
      input.right = dx > 0;
      input.left = dx < 0;
    }
  }

  /** walk to x (direction dir); pits, blocks, hazards and movers on the way go through the planner */
  function execWalk(st, game) {
    const play = game.play;
    const b = play.body;
    const dir = st.dir;
    input.right = dir > 0;
    input.left = dir < 0;

    // finish an in-progress jump (hold to the apex), dash when planned
    if (bot.holding) {
      bot.sinceJump++;
      if (bot.plan?.dashAt >= 0 && bot.sinceJump === bot.plan.dashAt) input.dash = true;
      if (bot.sinceJump < 3 || b.vy > 0) {
        input.jump = true;
        return;
      }
      bot.holding = false;
    } else if (bot.plan?.dashAt >= 0 && bot.plan.type === 'air') {
      bot.sinceJump++;
      if (bot.sinceJump === bot.plan.dashAt) input.dash = true;
      if (b.grounded && bot.sinceJump > 4) bot.plan = null;
    }

    if ((b.x - st.to) * dir >= 0 && b.grounded) {
      bot.plan = null;
      return 'done';
    }
    if (st.stop && Math.abs(b.x - st.to) < 0.6 && b.grounded) {
      input.left = input.right = false;
      brakeTo(b, st.to);
      if (Math.abs(b.x - st.to) < 0.3 && Math.abs(b.vx) < 0.6) return 'done';
      return;
    }

    if (bot.hes > 0) {
      bot.hes--;
      input.right = input.left = false;
      if (bot.backingUp) {
        input.right = dir < 0;
        input.left = dir > 0;
      } else if (b.grounded && b.vx * dir > 0) {
        const edge = supportEdge(play, dir);
        if (edge !== null && (edge - b.x) * dir < (b.vx * b.vx) / (2 * PHYS.DECEL_GROUND) + 0.4) {
          input.right = dir < 0;
          input.left = dir > 0;
        }
      }
      if (bot.hes === 0) {
        bot.plan = null;
        bot.backingUp = false;
      }
      return;
    }

    const plan = bot.plan;
    if (plan && plan.type !== 'air') {
      if (plan.type === 'walk') {
        if ((b.x - plan.untilX) * dir > 0) bot.plan = null;
        else return;
      } else if (plan.type === 'jump') {
        if (plan.moverRef !== (b.ground?.axis ? b.ground.id : null) && b.grounded) {
          bot.plan = null; // the floor under us changed — rethink
          return;
        }
        if (plan.k <= 0) {
          bot.plan = plan.dashAt >= 0 ? { type: 'air', dashAt: plan.dashAt } : null;
          press();
          return;
        }
        plan.k--;
        return;
      } else if (plan.type === 'wait') {
        plan.t += STEP;
        input.right = input.left = false;
        const room = (plan.x - b.x) * dir;
        if (room > 0.9) {
          input.right = dir > 0;
          input.left = dir < 0;
        } else if (b.vx * dir > 0.5 && room < 0.6) {
          input.right = dir < 0;
          input.left = dir > 0;
        }
        if (--plan.retry <= 0) {
          plan.retry = 6;
          for (let k = 0; k <= 6; k += 2) {
            if (trial(game, { dir, delay: k, dashAt: plan.dashAt ?? -1, ok: passed(plan.threat, dir, b.y) })) {
              const delay = Math.round(reaction / STEP / 3 + rng.gauss() * (sigma / STEP) * 0.7);
              bot.plan = { type: 'jump', k: Math.max(0, k + delay), dashAt: plan.dashAt ?? -1, key: plan.key, dir, moverRef: b.ground?.axis ? b.ground.id : null };
              return;
            }
          }
          if (plan.t > plan.patience && rng.chance(unskill * 0.5)) {
            bot.plan = null; // got bored waiting for the platform — just go for it
            press();
            return;
          }
        }
        return;
      }
    }

    if (!b.grounded) return;

    const threat = findThreat(game, dir, st.to);
    if (!threat) {
      bot.backups = 0;
      return;
    }
    if (threat.key !== bot.lastThreatKey) {
      bot.lastThreatKey = threat.key;
      bot.backups = 0;
      if (Math.abs(threat.x - b.x) > 2.5 && rng.chance(pHesitate)) {
        bot.hes = Math.round(rng.range(0.15, 0.35 + unskill * 0.6) / STEP);
        input.right = input.left = false;
        return;
      }
    }
    const p = makePlan(game, threat, dir);
    if (p) {
      bot.plan = p;
      if (p.type === 'jump' && p.k <= 0) {
        bot.plan = p.dashAt >= 0 ? { type: 'air', dashAt: p.dashAt } : null;
        press();
      }
      return;
    }
    const moverNear = play.movers.some((m) => !m.oneWay && Math.abs(m.x + m.w / 2 - threat.x) < 9 && Math.abs(m.y - b.y) < 3);
    if (moverNear || bot.backups >= 2) {
      bot.plan = { type: 'wait', x: threat.x, threat, key: threat.key, t: 0, retry: 0, patience: rng.range(0.8, 3.5) * (0.3 + skill), dashAt: game.abilities.dash && !moverNear ? 34 : -1 };
      return;
    }
    // not enough run-up: back off and try again
    bot.backups++;
    bot.backingUp = true;
    bot.hes = Math.round(rng.range(0.3, 0.6) / STEP);
    input.right = dir < 0;
    input.left = dir > 0;
  }

  /** walk off the ledge, then steer to x while falling; done on landing near the bottom */
  function execDrop(st, game) {
    const b = game.play.body;
    const s = bot.stepState;
    if (!s.off) {
      input.right = true;
      if (!b.grounded && b.x > 58.4) s.off = true;
      return;
    }
    const dx = st.x - b.x;
    input.right = dx > 0.25;
    input.left = dx < -0.25;
    if (b.grounded) {
      if (b.y < st.bottom + 0.5) return 'done';
      // landed on a ledge on the way down: walk off it toward the middle
      input.right = dx > 0;
      input.left = dx < 0;
    }
  }

  /** one double-jump hop between Long Shaft ledges */
  function execHop(st, game) {
    const b = game.play.body;
    const s = bot.stepState;
    const h = st.hop;
    if (!s.phase) {
      s.phase = 'approach';
      s.takeoff = h.takeoff + rng.gauss() * sigma * PHYS.RUN * 0.6;
      s.air = Math.round((0.33 + rng.gauss() * sigma * 0.6) / STEP);
    }
    if (s.phase === 'approach') {
      if (!b.grounded) return;
      // a short run-up: back off to 1.6 units behind the take-off point first
      if (s.back === undefined) s.back = (b.x - s.takeoff) * h.dir > -1.3;
      if (s.back) {
        const to = s.takeoff - h.dir * 1.6;
        input.right = to > b.x;
        input.left = to < b.x;
        if (Math.abs(b.x - to) < 0.25) s.back = false;
        return;
      }
      input.right = h.dir > 0;
      input.left = h.dir < 0;
      if ((b.x - s.takeoff) * h.dir >= 0) {
        s.phase = 'air';
        s.t = 0;
        input.jump = true;
      }
      return;
    }
    // airborne: hold to the apex, air-jump, steer to the next ledge
    s.t++;
    if (s.t < 3 || (b.vy > 0 && s.t < s.air - 1)) input.jump = true;
    if (s.t >= s.air && (s.t < s.air + 3 || b.vy > 0)) input.jump = true; // the air jump, held to its apex
    const dx = h.target - b.x;
    input.right = dx > 0.5;
    input.left = dx < -0.5;
    if (b.grounded && s.t > 6) {
      if (Math.abs(b.y - h.to) < 0.2) return 'done';
      return 'fail';
    }
  }

  /** the lift up to the Collapsed Bridge: stand under it, jump through when it's low, ride, step off */
  function execLift(st, game) {
    const b = game.play.body;
    const lift = game.play.movers.find((m) => m.id === 'lift');
    const s = bot.stepState;
    if (!s.phase) s.phase = b.ground === lift ? 'ride' : 'wait';
    if (s.phase === 'wait') {
      brakeTo(b, 7.0);
      if (!b.grounded) return;
      if (b.ground === lift) {
        s.phase = 'ride';
        return;
      }
      const low = lift.y < -27.0 && lift.dy <= 0.002;
      if (low && Math.abs(b.x - 7) < 0.6) {
        s.goIn = s.goIn ?? Math.max(0, Math.round((reaction * 0.6 + Math.abs(rng.gauss()) * sigma) / STEP));
        if (s.goIn-- <= 0) {
          s.phase = 'jump';
          s.t = 0;
          input.jump = true;
        }
      } else s.goIn = undefined;
      return;
    }
    if (s.phase === 'jump') {
      s.t++;
      input.jump = s.t < 3 || b.vy > 0;
      if (b.grounded && s.t > 4) {
        s.phase = b.ground === lift ? 'ride' : 'wait';
        s.goIn = undefined;
      }
      return;
    }
    if (s.phase === 'ride') {
      if (b.ground !== lift && b.grounded) {
        s.phase = b.y < -20 ? 'wait' : 'off';
        return;
      }
      if (lift.y >= -15.05) s.phase = 'off';
      return;
    }
    input.right = true;
    if (b.grounded && b.x > 9.8 && b.y > -15.2) return 'done';
  }

  /** GLITCHLESS-DEMO (the bot's side of the difficulty spike): air-dash then double jump, with noise */
  function execGallery(st, game) {
    const b = game.play.body;
    const s = bot.stepState;
    if (!s.phase) {
      s.phase = 'run';
      // nerves: a ~50 ms window over spikes, after a long walk back from the last statue, makes anyone tense up
      const nervous = sigma * GALLERY_NERVES;
      s.dashX = GALLERY.dashX + rng.gauss() * nervous * PHYS.RUN;
      const panic = rng.chance(pPanic);
      s.jumpAfter = Math.round((panic ? GALLERY.jumpAfter - rng.range(0.03, 0.08) : GALLERY.jumpAfter + rng.gauss() * nervous) / STEP);
      // a slow, nervous approach at low skill: a short stop before the run-up
      s.wait = rng.chance(pHesitate) && b.x < 71 ? Math.round(rng.range(0.2, 0.5 + unskill) / STEP) : 0;
    }
    if (s.wait > 0) {
      s.wait--;
      brakeTo(b, Math.min(b.x, 70));
      return;
    }
    input.right = true;
    if (s.phase === 'run') {
      if (b.x >= s.dashX) {
        if (b.x < 71.5 || Math.abs(b.vx) < PHYS.RUN * 0.9) return; // need a run-up
        input.dash = true;
        s.phase = 'dash';
        s.t = 0;
      }
      return;
    }
    s.t++;
    if (s.t >= s.jumpAfter && s.t < s.jumpAfter + 3) input.jump = true;
    else if (s.t >= s.jumpAfter + 3 && b.vy > 0) input.jump = true;
    if (b.grounded && s.t > 8) return b.x > 80 ? 'done' : 'fail';
  }

  /** the Warden fight */
  function execFight(st, game) {
    const b = game.play.body;
    const w = game.warden;
    const a = ROOM_BY_ID.warden_hall.boss.arena;
    if (w.state === 'dormant') {
      input.right = true;
      return;
    }
    if (w.state === 'dying' || w.state === 'dead') return;
    const dx = w.x - b.x;
    const dist = Math.abs(dx);
    const away = dx > 0 ? -1 : 1;
    const t = bot.clock;

    // a planned dodge (set up when the wind-up started)
    const d = bot.dodge;
    if (d) {
      if (d.kind === 'slam' && t < d.impact) {
        // back off to a safe distance from the impact, then wait for the wave
        const roomBehind = away > 0 ? a.x1 - 0.8 - b.x : b.x - (a.x0 + 0.8);
        if (dist < 3.6 && roomBehind > 0.5) {
          input.right = away > 0;
          input.left = away < 0;
        }
      }
      if (!d.jumped) {
        const jumpAt = dodgeTime(d, game);
        if (t >= jumpAt) {
          d.jumped = true;
          d.jumpT = 0;
          input.jump = true;
        }
        return;
      }
      d.jumpT++;
      if (d.jumpT < 3 || (b.vy > 0 && (d.air < 0 || d.jumpT < d.air - 1))) input.jump = true;
      if (d.air >= 0 && d.jumpT >= d.air && (d.jumpT < d.air + 3 || b.vy > 0)) input.jump = true;
      if (b.grounded && d.jumpT > 6) bot.dodge = null;
      return;
    }

    // the opening: fists in the floor / stunned against the wall
    if (w.open || t < bot.greedUntil) {
      if (bot.openSeen < 0) {
        bot.openSeen = t;
        bot.openReact = reaction + Math.abs(rng.gauss()) * reaction * 0.5;
      }
      if (t - bot.openSeen < bot.openReact && w.open) {
        holdDistance(b, w, a, 3.8);
        return;
      }
      if (!w.open && bot.greedUntil === 0 && rng.chance(pGreedy)) bot.greedUntil = t + rng.range(0.15, 0.45);
      if (dist > 2.25) {
        input.right = dx > 0;
        input.left = dx < 0;
      } else if (Math.sign(dx) !== b.facing) {
        input.right = dx > 0;
        input.left = dx < 0;
      }
      if (dist < 2.9 && Math.sign(dx) === b.facing) {
        input.attack = !bot.lastAttack;
      }
      return;
    }
    if (bot.openSeen >= 0) {
      bot.openSeen = -1;
      bot.greedUntil = 0;
    }
    holdDistance(b, w, a, 3.9);
  }

  function holdDistance(b, w, a, want) {
    const dx = w.x - b.x;
    const dist = Math.abs(dx);
    const away = dx > 0 ? -1 : 1;
    const target = w.x + away * want;
    const clampT = Math.min(a.x1 - 0.8, Math.max(a.x0 + 0.8, target));
    if (Math.abs(clampT - b.x) > 0.5) {
      input.right = clampT > b.x;
      input.left = clampT < b.x;
    }
    if (dist < 1.8 && b.grounded) input.jump = !bot.lastJump; // too close: hop away
  }

  /** when to press jump for a planned dodge, given where everyone is now */
  function dodgeTime(d, game) {
    const b = game.play.body;
    const w = game.warden;
    const dist = Math.abs(w.x - b.x);
    if (d.kind === 'slam') {
      // the wave starts 1.4 out at impact and travels at d.speed; be at the top of the jump when it arrives
      const arrive = d.impact + Math.max(0, dist - 1.4 - 0.86) / d.speed;
      return Math.max(d.earliest, arrive - 0.29 + d.offset); // airborne [0.08, 0.66] s after the jump; the wave takes ~0.16 s to pass
    }
    // charge: it starts when the wind-up ends (or now, if it's already coming); be above it while it passes
    const start = w.state === 'charge' ? bot.clock : d.impact;
    const contact = start + Math.max(0, dist - 1.56) / d.speed;
    const exit = contact + 3.12 / d.speed;
    const ideal = (exit - 0.96 + contact - 0.32) / 2; // double jump: above 3 units from 0.32 to 0.96 s after the jump
    return Math.max(d.earliest, ideal + d.offset);
  }

  // ── programs per room --------------------------------------------------------------------------
  const walk = (to, dir, extra = {}) => ({ kind: 'walk', to, dir, ...extra });

  function programFor(game) {
    const id = game.room.id;
    const ab = game.abilities;
    const p = ab.doubleJump ? 2 : ab.dash ? 1 : 0;
    const b = game.play.body;
    switch (id) {
      case 'gate':
        return [walk(25.2, 1)];
      case 'ossuary':
        return [walk(53.2, 1)];
      case 'long_shaft':
        if (b.y < -25) return [walk(50.8, -1)]; // at the bottom: on to the Foundry
        if (p < 2) return [walk(57.4, 1), { kind: 'drop', x: 60, bottom: -30 }, walk(50.8, -1)];
        return climbProgram(b);
      case 'furnace':
        return [walk(28.8, -1)];
      case 'gear_hall':
        if (p === 0) return [walk(2.8, -1)];
        return [b.x > 7 ? walk(7, -1, { stop: true }) : walk(7, 1, { stop: true }), { kind: 'lift' }];
      case 'dash_shrine':
        return p === 0 ? [walk(-10.5, -1), walk(5.2, 1)] : [walk(5.2, 1)];
      case 'collapsed_bridge':
        return b.x < 9 ? [{ kind: 'lift' }, walk(31.2, 1)] : [walk(31.2, 1)];
      case 'boot_shrine':
        return [walk(53.2, 1)];
      case 'spike_gallery':
        return b.x < 79 ? [{ kind: 'gallery' }, walk(95.2, 1)] : [walk(95.2, 1)];
      case 'warden_hall':
        return [walk(97.4, 1), { kind: 'fight' }];
      default:
        return [];
    }
  }

  function climbProgram(b) {
    if (b.y > 7.5 && b.x > 62) return [walk(69.4, 1)];
    const i = SHAFT_HOPS.findIndex((h) => Math.abs(h.y - b.y) < 0.3);
    if (i < 0) return [walk(50.8, -1)]; // fell to the bottom: the long way round
    const hops = [];
    let cur = SHAFT_HOPS[i];
    while (cur) {
      hops.push({ kind: 'hop', hop: cur });
      const to = cur.to;
      cur = to === 8 ? null : SHAFT_HOPS.find((h) => h.y === to);
    }
    return [...hops, walk(69.4, 1)];
  }

  function resetPlanner() {
    bot.plan = null;
    bot.holding = false;
    bot.hes = 0;
    bot.backups = 0;
    bot.backingUp = false;
    bot.lastThreatKey = null;
    bot.skip.clear();
  }

  function setProgram(game) {
    bot.program = programFor(game);
    bot.pc = 0;
    bot.stepState = {};
    bot.needProgram = false;
    bot.stats.programs++;
    resetPlanner();
  }

  // ── reflex: swing at enemies in reach --------------------------------------------------------
  function reflex(game) {
    const b = game.play.body;
    let target = null;
    let best = Infinity;
    for (const e of game.room.enemies) {
      if (!e || !e.alive) continue;
      const hb = e.hitbox();
      const cx = (hb.x0 + hb.x1) / 2;
      const cy = (hb.y0 + hb.y1) / 2;
      const dx = cx - b.x;
      const dy = cy - (b.y + 0.7);
      if (Math.abs(dy) > 1.9 || Math.abs(dx) > 2.8) continue;
      const d = Math.hypot(dx, dy);
      if (d < best) {
        best = d;
        target = { e, hb, dx };
      }
    }
    if (!target) {
      bot.seeT = 0;
      return;
    }
    if (bot.seeT === 0) bot.seeReact = reaction + (rng.chance(pMiss) ? rng.range(0.4, 1.0) : 0);
    bot.seeT += STEP;
    if (bot.seeT < bot.seeReact) return;
    const facing = b.facing;
    const front = Math.sign(target.dx) === facing || Math.abs(target.dx) < 0.25;
    if (!front && Math.abs(target.dx) < 2.0 && b.grounded && !bot.holding && !bot.plan) {
      input.right = target.dx > 0;
      input.left = target.dx < 0;
    }
    const x0 = facing > 0 ? b.x + 0.05 : b.x - 2.15;
    const box = { x0, x1: x0 + 2.1, y0: b.y - 0.3, y1: b.y + 1.7 };
    if (front && box.x0 < target.hb.x1 && box.x1 > target.hb.x0 && box.y0 < target.hb.y1 && box.y1 > target.hb.y0) input.attack = !bot.lastAttack;
  }

  // ── the game calls these ------------------------------------------------------------------------
  bot.step = (game) => {
    input.left = input.right = input.jump = input.dash = input.attack = false;
    if (bot.halted || bot.rageIn > 0) return input; // about to rage quit: hands off the keyboard
    bot.clock += STEP;
    if (bot.needProgram || !bot.program) setProgram(game);
    const st = bot.program[bot.pc];
    let r;
    if (st) {
      if (st.kind === 'walk') r = execWalk(st, game);
      else if (st.kind === 'drop') r = execDrop(st, game);
      else if (st.kind === 'hop') r = execHop(st, game);
      else if (st.kind === 'lift') r = execLift(st, game);
      else if (st.kind === 'gallery') r = execGallery(st, game);
      else if (st.kind === 'fight') r = execFight(st, game);
    }
    if (r === 'done') {
      bot.pc++;
      bot.stepState = {};
      resetPlanner();
    } else if (r === 'fail') bot.needProgram = true;
    if (st?.kind !== 'fight') reflex(game);
    bot.lastAttack = input.attack;
    bot.lastJump = input.jump;
    return input;
  };

  bot.onRunStart = () => {
    bot.needProgram = true;
    bot.dodge = null;
  };
  bot.onRoom = () => {
    bot.needProgram = true;
  };
  bot.onRespawn = () => {
    bot.needProgram = true;
    bot.dodge = null;
    bot.openSeen = -1;
    bot.greedUntil = 0;
  };
  bot.onSave = () => {};
  bot.onHurt = () => {
    // knocked back: whatever we were doing is off
    resetPlanner();
    bot.stepState = bot.program?.[bot.pc]?.kind === 'fight' ? bot.stepState : {};
  };
  bot.onDeath = (cause, x, y, roomId) => {
    resetPlanner();
    bot.dodge = null;
    if (roomId === 'spike_gallery') {
      bot.galleryDeaths++;
      // GLITCHLESS-DEMO: the rage quit — low skill gives up after 4 deaths in the Spike Gallery
      if (skill < 0.5 && bot.galleryDeaths >= 4 && bot.rageIn < 0) {
        bot.rageIn = rng.range(4.2, 6.0); // stares at the screen, then closes the tab
        bot.rageAt = 'spike_gallery';
      }
    } else if (cause === 'warden') {
      bot.bossDeaths++;
      // ...and flattened three times by the Warden, it gives up there too
      if (skill < 0.5 && bot.bossDeaths >= 3 && bot.rageIn < 0) {
        bot.rageIn = rng.range(2.5, 4.5);
        bot.rageAt = 'warden_hall';
      }
    }
  };
  bot.onTelegraph = (attack, game) => {
    const w = game.warden;
    const k = w.tune;
    const panic = rng.chance(0.25 * unskill * unskill);
    bot.dodge = {
      kind: attack,
      impact: bot.clock + w.t,
      speed: attack === 'slam' ? k.wave : k.charge,
      earliest: bot.clock + reaction * 0.8,
      offset: panic ? -rng.range(0.2, 0.4) : rng.gauss() * bossSigma,
      air: attack === 'charge' ? Math.round(0.3 / STEP + rng.gauss() * (bossSigma / STEP) * 0.3) : -1,
      jumped: false,
    };
  };

  /** every fixed step in any state (rage-quit timer, patience) */
  bot.tick = (dt) => {
    if (bot.halted) return;
    bot.elapsed += dt;
    if (bot.rageIn > 0 && (bot.rageIn -= dt) <= 0) bot.quit('ragequit');
    else if (bot.elapsed > 148) bot.quit('timeout');
  };

  bot.quit = (reason) => {
    if (bot.halted) return;
    bot.halted = true;
    bot.reason = reason;
    onQuit?.(reason, { deaths: bot.galleryDeaths, bossDeaths: bot.bossDeaths, where: bot.rageAt });
  };

  /** menu screens: returns true when the bot "presses Space" */
  bot.menu = (state, dt) => {
    if (bot.halted) return false;
    bot.menuT += dt;
    if (bot.menuT < bot.menuWait) return false;
    bot.menuT = 0;
    if (state === 'win') {
      bot.quit('finished');
      return false;
    }
    bot.menuWait = rng.range(0.5, 1.0);
    return true;
  };
  bot.resetMenu = (wait) => {
    bot.menuT = 0;
    bot.menuWait = wait ?? rng.range(1.2, 2.4);
  };

  bot.prepare = (play) => buildNear(play);
  return bot;
}
