// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// Plays through the same input a human produces: movement keys (8 directions), an aim point on the floor
// (where the mouse would be), and the buttons (swing held, roll, nova, potion). Every fixed step it reads the
// sim: it walks toward the nearest enemy (archers first, the better it is) or the nearest loot, keeps its aim
// on the target, swings in range, rolls out of arrows and telegraphed attacks it notices in time, novas groups
// and drinks under 35% health. Skill sets how fast it reacts, how many threats it notices at all, how steady
// its aim is and how well it picks targets. Low skill stands in archer fire; high skill clears every floor.
// Deterministic per seed.
import { createRng } from './rng.js';
import { tileCenter } from './floors.js';
import { tileOf, walkLine, distanceField, downhill, get, walkable } from './grid.js';
import { HERO } from './rules.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createAutoplay({ skill, seed }) {
  const rng = createRng(seed);
  const s1 = 1 - skill;
  const P = {
    think: 0.07 + s1 * 0.22, // s between decisions
    reaction: 0.1 + Math.pow(s1, 1.2) * 0.75, // s before it reacts to a new threat
    notice: 0.12 + skill * 0.84, // chance it reacts to a given threat at all
    aimNoise: 0.03 + Math.pow(s1, 1.5) * 0.9, // rad of aim wobble
    potionAt: skill >= 0.5 ? 0.35 : 0.18 + skill * 0.3, // fraction of health
    potionDelay: 0.05 + s1 * 0.9,
    novaGroup: skill > 0.65 ? 2 : 3,
    archerFirst: skill * skill * 12, // metres of preference for archers
    hesitate: s1 * 0.35, // chance to stand still a beat when it gets to a target
    backoff: skill > 0.55, // steps out of a wind-up it can't roll
  };

  const input = { mx: 0, mz: 0, aimX: 0, aimZ: 0, attack: false, dodge: false, nova: false, potion: false, quit: false };
  const threats = new Map(); // key → { seen, react }
  const tried = new Set(); // loot it has stepped on
  const fields = new Map(); // goal tile → distance field
  let fieldsFor = null;
  const bot = {
    skill,
    seed,
    input,
    target: null,
    goal: null,
    think: 0,
    noiseA: 0,
    lowT: -1,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    escapeT: 0,
    escapeA: 0,
    holdT: 0,
    lootGoal: null,
    lootSince: 0,
    menuT: 0,
    menuWait: 0.6 + rng.range(0, 0.8),
    time: 0,
    stats: { dodges: 0, novas: 0, potions: 0 },
  };

  function fieldTo(sim, c, r) {
    if (fieldsFor !== sim.grid) {
      fields.clear();
      fieldsFor = sim.grid;
    }
    const key = r * sim.grid.cols + c;
    let f = fields.get(key);
    if (!f) {
      f = distanceField(sim.grid, c, r);
      if (fields.size > 64) fields.clear();
      fields.set(key, f);
    }
    return f;
  }

  /** A direction to walk from the hero toward (gx, gz): straight if clear, else along the grid. */
  function steer(sim, gx, gz) {
    const hr = sim.hero;
    const g = sim.grid;
    if (walkLine(g, hr.x, hr.z, gx, gz, hr.r * 0.9)) return { x: gx - hr.x, z: gz - hr.z };
    let gc = tileOf(gx);
    let gr = tileOf(gz);
    if (!walkable(get(g, gc, gr))) {
      // goal inside a pillar or wall edge: aim for a walkable neighbour
      outer: for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (walkable(get(g, gc + dc, gr + dr))) {
        gc += dc;
        gr += dr;
        break outer;
      }
    }
    const field = fieldTo(sim, gc, gr);
    let c = tileOf(hr.x);
    let r = tileOf(hr.z);
    let best = null;
    for (let i = 0; i < 6; i++) {
      const n = downhill(g, field, c, r);
      if (!n) break;
      [c, r] = n;
      const p = tileCenter(c, r);
      if (walkLine(g, hr.x, hr.z, p.x, p.z, hr.r * 0.9)) best = p;
      else if (best) break;
    }
    if (!best) {
      const n = downhill(g, field, tileOf(hr.x), tileOf(hr.z));
      if (!n) return { x: gx - hr.x, z: gz - hr.z };
      best = tileCenter(n[0], n[1]);
    }
    return { x: best.x - hr.x, z: best.z - hr.z };
  }

  function clearDir(sim, dx, dz, dist) {
    const hr = sim.hero;
    return walkLine(sim.grid, hr.x, hr.z, hr.x + dx * dist, hr.z + dz * dist, hr.r * 0.9);
  }

  /** Pick a roll direction near (dx, dz) that isn't into a wall. */
  function rollDir(sim, dx, dz) {
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      if (clearDir(sim, rx, rz, 3.6)) return { x: rx, z: rz };
    }
    return { x: dx, z: dz };
  }

  // The most urgent threat it has noticed (and had time to react to), with where to go to get out of it.
  function dangers(sim) {
    const hr = sim.hero;
    let worst = null;
    const consider = (key, urgency, ex, ez) => {
      let t = threats.get(key);
      if (!t) {
        t = { seen: bot.time, react: rng.chance(P.notice) };
        threats.set(key, t);
      }
      if (!t.react || bot.time - t.seen < P.reaction) return;
      if (!worst || urgency < worst.urgency) worst = { urgency, x: ex, z: ez, shot: key[0] === 'p' };
    };
    for (const p of sim.projectiles) {
      const rx = hr.x - p.x;
      const rz = hr.z - p.z;
      const v2 = p.vx * p.vx + p.vz * p.vz;
      const tStar = (rx * p.vx + rz * p.vz) / v2;
      if (tStar < 0 || tStar > 0.9) continue;
      const cx = p.x + p.vx * tStar - hr.x;
      const cz = p.z + p.vz * tStar - hr.z;
      if (Math.hypot(cx, cz) > hr.r + p.r + 0.35) continue;
      // sideways, away from the line it's on
      const sp = Math.sqrt(v2);
      let px = -p.vz / sp;
      let pz = p.vx / sp;
      if (px * -cx + pz * -cz < 0) {
        px = -px;
        pz = -pz;
      }
      consider(`p${p.id}`, tStar, px, pz);
    }
    for (const e of sim.enemies) {
      const tl = e.tele;
      if (!tl || e.dead) continue;
      const dx = hr.x - e.x;
      const dz = hr.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const key = `t${tl.id}`;
      if (tl.kind === 'arc') {
        const off = Math.abs(wrap(Math.atan2(dx, dz) - e.face));
        if (d > tl.range + hr.r + 0.6 || off > tl.arc / 2 + 0.4) continue;
        consider(key, tl.t, dx / d, dz / d);
      } else if (tl.kind === 'circle') {
        const cx = hr.x - tl.x;
        const cz = hr.z - tl.z;
        const cd = Math.hypot(cx, cz);
        if (cd > tl.r + hr.r + 0.3) continue;
        consider(key, tl.t, cd > 0.1 ? cx / cd : 1, cd > 0.1 ? cz / cd : 0);
      } else if (tl.kind === 'line') {
        // a slime about to lunge along its facing: get off the line
        const fx = Math.sin(e.face);
        const fz = Math.cos(e.face);
        const along = dx * fx + dz * fz;
        const side = dx * -fz + dz * fx;
        if (along < -0.5 || along > tl.len + 0.6 || Math.abs(side) > e.r + hr.r + 0.3) continue;
        const s = side >= 0 ? 1 : -1;
        consider(key, tl.t + 0.05, -fz * s, fx * s);
      } else if (tl.kind === 'fan') {
        if (d > 9) continue;
        consider(key, tl.t + 0.25, -dz / d, dx / d);
      }
    }
    return worst;
  }

  function pickTarget(sim) {
    const hr = sim.hero;
    let best = null;
    let bestScore = Infinity;
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - hr.x, e.z - hr.z);
      let score = d;
      if (!e.awake) score += 30;
      if (e.kind === 'archer' && e.awake) score -= P.archerFirst;
      if (e.kind === 'ash_lord') score += 2 * skill; // adds first, a little
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  function nearestLoot(sim, maxD) {
    const hr = sim.hero;
    let best = null;
    let bd = maxD;
    for (const it of sim.loot) {
      if (tried.has(it.id)) continue;
      if (it.kind === 'potion' && hr.potions >= HERO.potionsMax) continue;
      const d = Math.hypot(it.x - hr.x, it.z - hr.z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  bot.onFloor = () => {
    bot.target = null;
    bot.goal = null;
    bot.think = 0;
    bot.lowT = -1;
    threats.clear();
  };

  bot.tick = (dt) => {
    bot.time += dt;
  };

  /** One fixed step of play: returns the input to use. */
  bot.step = (sim, dt) => {
    const hr = sim.hero;
    input.attack = false;
    input.dodge = false;
    input.nova = false;
    input.potion = false;
    input.quit = false;

    // remember loot it has already walked onto (equipped, salvaged, or — a legendary — still lying there)
    for (const it of sim.loot) if (it.inside) tried.add(it.id);

    // ── think
    bot.think -= dt;
    if (bot.think <= 0) {
      bot.think = P.think * rng.range(0.7, 1.3);
      const t = pickTarget(sim);
      if (t !== bot.target && !(bot.target && !bot.target.dead && rng.chance(s1 * 0.4))) {
        bot.target = t;
        bot.noiseA += rng.gauss() * P.aimNoise;
        if (t && rng.chance(P.hesitate)) bot.holdT = rng.range(0.2, 0.7);
      }
      const near = bot.target ? Math.hypot(bot.target.x - hr.x, bot.target.z - hr.z) : Infinity;
      const loot = nearestLoot(sim, bot.target && bot.target.awake ? 4 : sim.stairsOpen ? 24 : 14);
      bot.goal = loot && (!bot.target || !bot.target.awake || near > 6) ? { x: loot.x, z: loot.z, loot } : null;
      // loot it can't get to in a few seconds isn't worth it
      if (bot.goal?.loot && bot.goal.loot === bot.lootGoal) {
        if (bot.time - bot.lootSince > 5) tried.add(bot.goal.loot.id);
      } else {
        bot.lootGoal = bot.goal?.loot || null;
        bot.lootSince = bot.time;
      }
      if (!bot.goal && !bot.target && sim.stairsOpen) {
        const s = tileCenter(sim.floor.stairs[0], sim.floor.stairs[1]);
        bot.goal = { x: s.x, z: s.z };
      }
      // give up? only below 0.5, on its last life on a floor, hurt and out of potions
      if (skill < 0.5 && sim.deathsOnFloor >= 2 && hr.hp < hr.maxHp * 0.4 && (hr.potions === 0 || skill < 0.4) && rng.chance((0.5 - skill) * 0.6)) {
        input.quit = true;
        return input;
      }
    }
    if (bot.target?.dead) bot.target = null;

    // ── potion (a beat late, worse at low skill)
    if (hr.hp < hr.maxHp * P.potionAt && hr.potions > 0) {
      if (bot.lowT < 0) bot.lowT = bot.time;
      if (bot.time - bot.lowT >= P.potionDelay) {
        input.potion = true;
        bot.stats.potions++;
        bot.lowT = -1;
      }
    } else bot.lowT = -1;

    // ── aim: keep the mouse on the target, with a wobble that wanders
    bot.noiseA += -bot.noiseA * 3 * dt + rng.gauss() * P.aimNoise * Math.sqrt(6 * dt);
    let mx = 0;
    let mz = 0;
    const tg = bot.target;
    let aimA = hr.aim;
    let dist = Infinity;
    if (tg) {
      const dx = tg.x - hr.x;
      const dz = tg.z - hr.z;
      dist = Math.hypot(dx, dz);
      aimA = Math.atan2(dx, dz) + bot.noiseA;
    }

    // ── threats first
    const danger = dangers(sim);
    let fleeing = false;
    if (danger) {
      if (hr.dodgeCd <= 0 && hr.dodgeT <= 0 && danger.urgency < 0.42) {
        const d = rollDir(sim, danger.x, danger.z);
        mx = d.x;
        mz = d.z;
        input.dodge = true;
        bot.stats.dodges++;
        fleeing = true;
      } else if (!danger.shot && (P.backoff || danger.urgency < 0.25)) {
        mx = danger.x;
        mz = danger.z;
        fleeing = true;
      }
    }

    // ── move
    if (!fleeing) {
      bot.holdT -= dt;
      if (bot.goal) {
        const s = steer(sim, bot.goal.x, bot.goal.z);
        mx = s.x;
        mz = s.z;
        if (!tg || dist > 5) aimA = Math.atan2(mx, mz);
      } else if (tg) {
        const want = tg.r + (tg.kind === 'ash_lord' ? 1.2 : 1.1);
        if (bot.holdT > 0 && dist < 6) {
          mx = mz = 0;
        } else if (dist > want + 0.3) {
          const s = steer(sim, tg.x, tg.z);
          mx = s.x;
          mz = s.z;
        } else if (dist < tg.r + 0.7) {
          mx = hr.x - tg.x;
          mz = hr.z - tg.z;
        }
      }
    }

    // ── attack: swing when the target is in reach and the aim is close enough
    if (tg && !input.dodge) {
      const off = Math.abs(wrap(Math.atan2(tg.x - hr.x, tg.z - hr.z) - aimA));
      if (dist - tg.r < HERO.swing.range - 0.15 && off < HERO.swing.arc / 2) input.attack = true;
    }

    // ── nova on groups (and on the boss)
    if (hr.mana >= HERO.nova.cost && hr.novaCd <= 0) {
      let close = 0;
      let boss = false;
      for (const e of sim.enemies) {
        if (e.dead || !e.awake) continue;
        const d = Math.hypot(e.x - hr.x, e.z - hr.z) - e.r;
        if (d < HERO.nova.radius - 0.6) {
          close++;
          if (e.kind === 'ash_lord') boss = true;
        }
      }
      if (close >= P.novaGroup || (boss && rng.chance(0.05 + skill * 0.2)) || (close >= 1 && rng.chance(s1 * 0.02))) {
        input.nova = true;
        bot.stats.novas++;
      }
    }

    // ── unstick
    bot.stuckT += dt;
    if (bot.stuckT > 0.8) {
      const moved = Math.hypot(hr.x - bot.lastX, hr.z - bot.lastZ);
      if (moved < 0.25 && Math.hypot(mx, mz) > 0.3 && !input.attack) {
        bot.escapeA = rng.range(-Math.PI, Math.PI);
        bot.escapeT = 0.4;
      }
      bot.stuckT = 0;
      bot.lastX = hr.x;
      bot.lastZ = hr.z;
    }
    if (bot.escapeT > 0) {
      bot.escapeT -= dt;
      mx = Math.sin(bot.escapeA);
      mz = Math.cos(bot.escapeA);
    }

    // movement keys: 8 directions, like W A S D
    if (Math.hypot(mx, mz) > 0.15) {
      const a = Math.round(Math.atan2(mx, mz) / (Math.PI / 4)) * (Math.PI / 4);
      input.mx = Math.round(Math.sin(a));
      input.mz = Math.round(Math.cos(a));
    } else {
      input.mx = 0;
      input.mz = 0;
    }
    // the mouse: a point on the floor along the aim, at the target's distance
    const ad = Math.min(Math.max(dist, 2), 12);
    input.aimX = hr.x + Math.sin(aimA) * ad;
    input.aimZ = hr.z + Math.cos(aimA) * ad;
    return input;
  };

  /** Menu screens: returns true when the bot "clicks to play". */
  bot.menu = (state, dt) => {
    bot.menuT += dt;
    if (bot.menuT < bot.menuWait) return false;
    bot.menuT = 0;
    return state === 'title';
  };

  return bot;
}

