// The tower defense simulation: waves, enemies walking the path, towers, projectiles, gold and the
// gate. Pure (no THREE, no DOM) and fixed-step, so the game, the bot and a Node balance script all
// run the same code. Everything that happens is pushed to `sim.events` for the game to drain:
// visuals, sounds and telemetry hang off those events.
import { PATH_LENGTH, pointAt, isBuildable, inGrid, key, tileX, tileZ, zoneFor } from './map.js';
import {
  TOWERS,
  ENEMIES,
  WAVES,
  WAVE_COUNT,
  START_GOLD,
  START_LIVES,
  FIRST_BUILD_S,
  INTERMISSION_S,
  EARLY_GOLD_PER_S,
  clearBonus,
  sellValue,
  upgradeCost,
  towerStats,
} from './rules.js';
import { createRng } from './rng.js';

export const STEP = 1 / 60;
const ARROW_SPEED = 13; // tiles per second
const BALL_FLIGHT = 0.5; // seconds
const TARGETABLE_FROM = 0.4; // enemies still in the cave can't be shot

// Starting later than wave 1 (?level=N) comes with the gold a player would have earned by then.
const LATE_START_GOLD = 110;

export function createSim({ seed = 1, firstWave = 1 } = {}) {
  const rng = createRng((seed ^ 0x51ed) >>> 0);
  const p = {};

  const s = {
    phase: 'build', // build | wave | won | lost
    wave: Math.min(Math.max(1, firstWave), WAVE_COUNT), // the wave being fought, or the next one during build
    gold: START_GOLD + (Math.min(Math.max(1, firstWave), WAVE_COUNT) - 1) * LATE_START_GOLD,
    lives: START_LIVES,
    t: 0,
    buildLeft: FIRST_BUILD_S,
    waveT: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    queue: [], // pending spawns for the current wave
    events: [],
    nextId: 1,
    occupied: new Map(),
    stats: { kills: 0, leaks: 0, spent: 0, built: 0, leaksThisWave: 0 },
  };

  const emit = (e) => s.events.push(e);

  // ── waves ──────────────────────────────────────────────────────────────────────────────────

  function startWave(n = s.wave) {
    s.wave = n;
    s.phase = 'wave';
    s.waveT = 0;
    s.stats.leaksThisWave = 0;
    s.queue = [];
    for (const g of WAVES[n - 1]) addGroup(g, 0);
    emit({ type: 'wave_start', wave: n });
  }

  function addGroup(g, base) {
    for (let i = 0; i < g.count; i++) {
      s.queue.push({
        at: base + g.at + i * g.every,
        type: g.type,
        d: g.pack ? -rng.range(0, g.spread) : 0,
        lane: g.pack ? rng.range(-0.3, 0.3) : rng.range(-0.12, 0.12),
      });
    }
    s.queue.sort((a, b) => a.at - b.at);
  }

  function spawn({ type, d = 0, lane = 0 }) {
    const def = ENEMIES[type];
    const e = {
      id: s.nextId++,
      type,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed * rng.range(0.96, 1.04),
      d,
      lane,
      slowT: 0,
      slowMult: 1,
      alive: true,
      x: 0,
      z: 0,
      dx: 1,
      dz: 0,
    };
    place(e);
    s.enemies.push(e);
    emit({ type: 'spawn', enemy: e });
    return e;
  }

  function place(e) {
    pointAt(e.d, p);
    // the lane offset is perpendicular to the walking direction
    e.x = p.x - p.dz * e.lane;
    e.z = p.z + p.dx * e.lane;
    e.dx = p.dx;
    e.dz = p.dz;
  }

  function finishWave() {
    const bonus = clearBonus(s.wave);
    s.gold += bonus;
    const done = { type: 'wave_clear', wave: s.wave, durationS: Math.round(s.waveT * 100) / 100, gold: s.gold, bonus, leaks: s.stats.leaksThisWave };
    emit(done);
    s.projectiles.length = 0;
    if (s.wave >= WAVE_COUNT) {
      s.phase = 'won';
      emit({ type: 'won', wave: s.wave });
      return;
    }
    s.wave++;
    s.phase = 'build';
    s.buildLeft = INTERMISSION_S;
  }

  // ── combat ─────────────────────────────────────────────────────────────────────────────────

  function damage(e, amount, tower) {
    if (!e.alive) return;
    const mult = tower.type === 'arrow' ? ENEMIES[e.type].arrowMult ?? 1 : 1;
    e.hp -= amount * mult;
    if (e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
      s.gold += ENEMIES[e.type].gold;
      s.stats.kills++;
      tower.kills++;
      emit({ type: 'kill', enemy: e, tower: tower.type });
    } else emit({ type: 'hit', enemy: e });
  }

  function inRange(t, range) {
    let best = null;
    for (const e of s.enemies) {
      if (!e.alive || e.d < TARGETABLE_FROM) continue;
      if (Math.hypot(e.x - t.x, e.z - t.z) > range) continue;
      if (!best || e.d > best.d) best = e; // "first": the one closest to the gate
    }
    return best;
  }

  function fire(t) {
    const st = towerStats(t.type, t.tier);
    if (t.type === 'frost') {
      let hits = 0;
      for (const e of s.enemies) {
        if (!e.alive || e.d < TARGETABLE_FROM || Math.hypot(e.x - t.x, e.z - t.z) > st.range) continue;
        hits++;
        e.slowMult = Math.min(e.slowMult, st.slow);
        e.slowT = Math.max(e.slowT, st.slowFor);
        damage(e, st.dmg, t);
      }
      if (!hits) return false;
      emit({ type: 'pulse', tower: t, range: st.range });
      return true;
    }
    const target = inRange(t, st.range);
    if (!target) return false;
    t.aim = Math.atan2(target.x - t.x, target.z - t.z);
    if (t.type === 'arrow') {
      const pr = { id: s.nextId++, kind: 'arrow', x: t.x, y: 1.0, z: t.z, target, tx: target.x, tz: target.z, dmg: st.dmg, tower: t, t: 0 };
      s.projectiles.push(pr);
      emit({ type: 'fire', tower: t, projectile: pr });
    } else {
      // lead the target: where it will be when the ball lands
      const lead = { ...target };
      lead.d = target.d + target.speed * (target.slowT > 0 ? target.slowMult : 1) * BALL_FLIGHT;
      place(lead);
      const pr = { id: s.nextId++, kind: 'ball', x: t.x, y: 0.9, z: t.z, sx: t.x, sz: t.z, tx: lead.x, tz: lead.z, dmg: st.dmg, splash: st.splash, tower: t, t: 0 };
      s.projectiles.push(pr);
      emit({ type: 'fire', tower: t, projectile: pr });
    }
    return true;
  }

  function stepProjectiles(dt) {
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const pr = s.projectiles[i];
      pr.t += dt;
      let done = false;
      if (pr.kind === 'arrow') {
        if (pr.target.alive) {
          pr.tx = pr.target.x;
          pr.tz = pr.target.z;
        }
        const dx = pr.tx - pr.x;
        const dz = pr.tz - pr.z;
        const dist = Math.hypot(dx, dz);
        const stepLen = ARROW_SPEED * dt;
        if (dist <= stepLen + 0.05) {
          if (pr.target.alive) damage(pr.target, pr.dmg, pr.tower);
          done = true;
        } else {
          pr.x += (dx / dist) * stepLen;
          pr.z += (dz / dist) * stepLen;
          pr.y += (0.35 - pr.y) * Math.min(1, dt * 6);
          pr.dx = dx / dist;
          pr.dz = dz / dist;
        }
      } else {
        const k = Math.min(1, pr.t / BALL_FLIGHT);
        pr.x = pr.sx + (pr.tx - pr.sx) * k;
        pr.z = pr.sz + (pr.tz - pr.sz) * k;
        pr.y = 0.9 * (1 - k) + 0.15 + Math.sin(k * Math.PI) * 1.3;
        if (k >= 1) {
          for (const e of s.enemies) {
            if (e.alive && e.d >= TARGETABLE_FROM && Math.hypot(e.x - pr.tx, e.z - pr.tz) <= pr.splash) damage(e, pr.dmg, pr.tower);
          }
          emit({ type: 'explode', x: pr.tx, z: pr.tz, radius: pr.splash });
          done = true;
        }
      }
      if (done) {
        s.projectiles.splice(i, 1);
        emit({ type: 'projectile_end', projectile: pr });
      }
    }
  }

  // ── the fixed step ─────────────────────────────────────────────────────────────────────────

  s.step = (dt = STEP) => {
    if (s.phase === 'won' || s.phase === 'lost') return;
    s.t += dt;
    if (s.phase === 'build') {
      s.buildLeft -= dt;
      if (s.buildLeft <= 0) startWave();
      return;
    }

    s.waveT += dt;
    while (s.queue.length && s.queue[0].at <= s.waveT) spawn(s.queue.shift());

    for (const e of s.enemies) {
      if (!e.alive) continue;
      const slowed = e.slowT > 0;
      e.d += e.speed * (slowed ? e.slowMult : 1) * dt;
      if (slowed) {
        e.slowT -= dt;
        if (e.slowT <= 0) e.slowMult = 1;
      }
      place(e);
      if (e.d >= PATH_LENGTH) {
        e.alive = false;
        e.leaked = true;
        const cost = ENEMIES[e.type].lives;
        s.lives = Math.max(0, s.lives - cost);
        s.stats.leaks++;
        s.stats.leaksThisWave++;
        emit({ type: 'leak', enemy: e, cost });
        if (s.lives <= 0) {
          s.phase = 'lost';
          s.enemies = s.enemies.filter((x) => x.alive);
          emit({ type: 'gate_fallen', wave: s.wave, cause: e.type });
          return;
        }
      }
    }

    for (const t of s.towers) {
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      if (fire(t)) t.cooldown = towerStats(t.type, t.tier).rate;
      else t.cooldown = 0.05; // nothing in range: look again shortly
    }
    stepProjectiles(dt);

    // dead and leaked enemies leave the list (the game already got their events)
    if (s.enemies.some((e) => !e.alive)) s.enemies = s.enemies.filter((e) => e.alive);

    if (!s.queue.length && !s.enemies.length) finishWave();
  };

  // ── player actions (mouse, keyboard, bot and agent tools all come through here) ──────────

  const fail = (error) => ({ ok: false, error });
  const over = () => s.phase === 'won' || s.phase === 'lost';

  s.canBuild = (col, row) => isBuildable(col, row) && !s.occupied.has(key(col, row));

  s.build = (type, col, row) => {
    const def = TOWERS[type];
    if (!def) return fail(`unknown tower type ${type}`);
    if (over()) return fail(`the run is over (${s.phase})`);
    if (!inGrid(col, row)) return fail('outside the map');
    if (!s.canBuild(col, row)) return fail('tile is not free grass');
    if (s.gold < def.cost) return fail(`not enough gold (${s.gold}/${def.cost})`);
    s.gold -= def.cost;
    s.stats.spent += def.cost;
    s.stats.built++;
    const t = {
      id: s.nextId++,
      type,
      tier: 1,
      col,
      row,
      x: tileX(col),
      z: tileZ(row),
      cooldown: 0.3,
      invested: def.cost,
      kills: 0,
      aim: 0,
      zone: zoneFor(col, row, def.tiers[0].range),
    };
    s.towers.push(t);
    s.occupied.set(key(col, row), t);
    emit({ type: 'built', tower: t, cost: def.cost });
    return { ok: true, tower: t };
  };

  s.upgrade = (id) => {
    const t = s.towers.find((t) => t.id === id);
    if (!t) return fail('no such tower');
    if (over()) return fail(`the run is over (${s.phase})`);
    const cost = upgradeCost(t);
    if (cost === null) return fail('already tier 3');
    if (s.gold < cost) return fail(`not enough gold (${s.gold}/${cost})`);
    s.gold -= cost;
    s.stats.spent += cost;
    t.tier++;
    t.invested += cost;
    emit({ type: 'upgraded', tower: t, cost });
    return { ok: true, tower: t };
  };

  s.sell = (id) => {
    const t = s.towers.find((t) => t.id === id);
    if (!t) return fail('no such tower');
    if (over()) return fail(`the run is over (${s.phase})`);
    const refund = sellValue(t);
    s.gold += refund;
    s.towers = s.towers.filter((x) => x !== t);
    s.occupied.delete(key(t.col, t.row));
    emit({ type: 'sold', tower: t, refund });
    return { ok: true, refund };
  };

  /** Call the next wave now (build phase only): pays EARLY_GOLD_PER_S for every second skipped. */
  s.callWave = () => {
    if (s.phase !== 'build') return fail(`no wave to call (${s.phase})`);
    const bonus = Math.max(0, Math.round(s.buildLeft * EARLY_GOLD_PER_S));
    s.gold += bonus;
    startWave();
    emit({ type: 'early_call', wave: s.wave, bonus });
    return { ok: true, wave: s.wave, bonus };
  };

  // ── agent / debug hooks ────────────────────────────────────────────────────────────────────

  /** Jump straight to wave n: clears the field and starts it (towers and gold stay). */
  s.jumpToWave = (n) => {
    s.enemies.forEach((e) => {
      e.alive = false;
      emit({ type: 'despawn', enemy: e });
    });
    s.enemies = [];
    s.projectiles.length = 0;
    if (s.phase === 'lost' || s.phase === 'won') s.lives = Math.max(s.lives, 1);
    startWave(n);
  };

  /** Spawn `count` enemies through the real spawn path, poured out of the cave like the swarm. */
  s.spawnPack = (type, count) => {
    if (s.phase !== 'wave') startWave();
    for (let i = 0; i < count; i++) spawn({ type, d: -rng.range(0, 2.5), lane: rng.range(-0.3, 0.3) });
    return s.enemies.length;
  };

  s.addGold = (n) => {
    s.gold += n;
    return s.gold;
  };

  return s;
}
