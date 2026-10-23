// The rules of Ashvale: one floor at a time, stepped at a fixed rate. Pure (no THREE, no DOM): the game, the
// bot and the Node tests all run this. Everything the view and the telemetry care about goes out through
// `hooks`, called at the moment it happens (so telemetry breadcrumbs are in the order things happened).
import { FLOORS, tileCenter } from './floors.js';
import { buildGrid, T, get, walkable, tileOf, tileAt, roomAt, heightAt, moveCircle, resolve, lineOfSight, walkLine, distanceField, downhill, solidForLedgeWalker } from './grid.js';
import { HERO, FOES, levelForXp, floorScale, DROPS, DEATHS_PER_FLOOR } from './rules.js';
import { makeItem, compare, gearTotals, STARTER_WEAPON, SLOTS } from './gear.js';

const HOOKS = [
  'hit', // (enemy, amount, kind: 'swing'|'nova'|'burn', crit)
  'heroHurt', // (amount, cause)
  'evade', // (cause): something hit the hero mid-roll
  'kill', // (enemy)
  'xp', // (amount, enemy)
  'levelUp', // (level)
  'loot', // (item): picked up (gold, potion) or stepped onto (gear)
  'equip', // (item, old, verdict)
  'salvage', // (item, gold, verdict)
  'potionFull', // (item): stepped on a potion with a full belt
  'potion', // (healed)
  'skill', // (name): 'dodge' | 'nova'
  'swing', // (angle, hits)
  'nova', // ()
  'roomWake', // (room)
  'roomClear', // (room)
  'stairsOpen', // ()
  'boss', // (result: 'start' | 'win' | 'died')
  'bossPhase', // (phase: 'summon' | 'enrage', boss)
  'death', // (cause, { x, y, z })
  'floorComplete', // ()
  'drop', // (item)
  'shoot', // (projectile)
  'split', // (slime)
  'strike', // (enemy, kind)
  'windup', // (enemy, kind)
];

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function turnToward(a, b, step) {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

function weighted(rng, table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = rng.next() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r < 0) return v;
  }
  return table[table.length - 1][0];
}

function newHero() {
  return {
    x: 0,
    z: 0,
    y: 0,
    r: HERO.radius,
    face: Math.PI,
    aim: Math.PI,
    vx: 0,
    vz: 0,
    hp: HERO.hp,
    maxHp: HERO.hp,
    mana: HERO.mana,
    maxMana: HERO.mana,
    level: 1,
    xp: 0,
    potions: HERO.potionsStart,
    gold: 0,
    gear: { weapon: { ...STARTER_WEAPON }, armor: null, ring: null },
    damage: 0,
    armor: 0,
    crit: 0,
    swingCd: 0,
    swingT: 0,
    swingA: 0,
    dodgeT: 0,
    dodgeCd: 0,
    dodgeX: 0,
    dodgeZ: 1,
    iframes: 0,
    novaCd: 0,
    novaT: 0,
    potionCd: 0,
    hurtT: 0,
    levelT: 0,
    lastCause: null,
  };
}

export function createSim({ rng, hooks = {} }) {
  const h = {};
  for (const k of HOOKS) h[k] = hooks[k] || (() => {});
  let ids = 1;

  const sim = {
    floorIndex: 0,
    floor: null,
    grid: null,
    state: 'idle', // idle | playing | dead | complete
    hero: newHero(),
    enemies: [],
    projectiles: [],
    loot: [],
    rooms: [],
    time: 0,
    floorTime: 0,
    kills: 0, // this attempt at the floor
    deathsOnFloor: 0,
    stairsOpen: false,
    boss: null,
    bossStarted: false,
    heroField: null,
    heroFieldTile: -1,
    totals: { kills: 0, deaths: 0, time: 0, gold: 0, hits: 0, swings: 0, legendaries: 0 },
  };

  // ───────────────────────────────────────────── run / floor flow

  sim.newRun = () => {
    sim.hero = newHero();
    sim.totals = { kills: 0, deaths: 0, time: 0, gold: 0, hits: 0, swings: 0, legendaries: 0 };
    refreshStats();
  };

  sim.loadFloor = (index) => {
    sim.floorIndex = index;
    sim.floor = FLOORS[index];
    sim.grid = buildGrid(sim.floor);
    sim.deathsOnFloor = 0;
    sim.resetFloor();
  };

  /** Start (or restart) the current floor: every enemy alive, hero at the start, no loot. */
  sim.resetFloor = () => {
    const f = sim.floor;
    sim.rooms = f.rooms.map((def, idx) => ({ id: def.id, idx, def, awake: false, cleared: def.enemies.length === 0, swings: 0, boss: !!def.boss }));
    sim.enemies = [];
    sim.projectiles = [];
    sim.loot = [];
    sim.boss = null;
    sim.bossStarted = false;
    sim.stairsOpen = false;
    sim.kills = 0;
    sim.floorTime = 0;
    f.rooms.forEach((def, idx) => {
      for (const [kind, c, r] of def.enemies) {
        const p = tileCenter(c, r);
        const e = spawnEnemy(kind, p.x, p.z, idx);
        if (kind === 'ash_lord') sim.boss = e;
      }
    });
    const hr = sim.hero;
    const s = tileCenter(f.start[0], f.start[1]);
    Object.assign(hr, { x: s.x, z: s.z, y: 0, vx: 0, vz: 0, face: Math.PI, aim: Math.PI, swingCd: 0, swingT: 0, dodgeT: 0, dodgeCd: 0, iframes: 0, novaCd: 0, novaT: 0, potionCd: 0, hurtT: 0, lastCause: null });
    refreshStats();
    hr.hp = hr.maxHp;
    hr.mana = hr.maxMana;
    hr.potions = Math.max(1, hr.potions);
    sim.heroFieldTile = -1;
    sim.onStairs = false;
    sim.state = 'playing';
  };

  function refreshStats() {
    const hr = sim.hero;
    const t = gearTotals(hr.gear);
    hr.maxHp = HERO.hp + HERO.levelHp * (hr.level - 1);
    hr.maxMana = HERO.mana + HERO.levelMana * (hr.level - 1) + t.mana;
    hr.damage = HERO.damage + HERO.damagePerLevel * (hr.level - 1) + t.damage;
    hr.armor = t.armor;
    hr.crit = HERO.crit + t.crit;
    hr.hp = Math.min(hr.hp, hr.maxHp);
    hr.mana = Math.min(hr.mana, hr.maxMana);
  }
  sim.refreshStats = refreshStats;

  // ───────────────────────────────────────────── enemies

  function spawnEnemy(kind, x, z, roomIdx, { small = false, awake = false } = {}) {
    const base = kind === 'slime' && small ? FOES.slime_small : FOES[kind];
    const sc = kind === 'ash_lord' ? { hp: 1, damage: 1, xp: 1 } : floorScale(sim.floorIndex);
    const room = sim.rooms[roomIdx];
    const def = kind === 'archer' ? { ...base, ...(room?.def.archer || {}) } : base;
    const e = {
      id: ids++,
      kind,
      small: kind === 'slime' && small,
      def,
      x,
      z,
      y: 0,
      r: base.radius,
      hp: Math.round(def.hp * sc.hp),
      maxHp: Math.round(def.hp * sc.hp),
      dmgScale: sc.damage,
      xp: Math.round(base.xp * sc.xp),
      room: roomIdx,
      awake,
      wakeT: awake ? 0.25 : 0,
      state: 'idle',
      t: 0,
      cd: rng.range(0.2, 0.9),
      face: rng.range(-Math.PI, Math.PI),
      flash: 0,
      burn: null,
      dead: false,
      tele: null,
      hop: rng.range(0, 6),
      vx: 0,
      vz: 0,
      lx: 0,
      lz: 0,
      hitDone: false,
      // boss
      attack: null,
      slamCd: 2.5,
      boltCd: 1.5,
      summoned: 0,
      enraged: false,
    };
    e.ledge = tileAt(sim.grid, x, z) === T.LEDGE && kind === 'archer';
    e.y = heightAt(sim.grid, x, z);
    sim.enemies.push(e);
    return e;
  }

  function wakeRoom(idx) {
    const room = sim.rooms[idx];
    if (!room || room.awake) return;
    room.awake = true;
    for (const e of sim.enemies) {
      if (e.room !== idx || e.awake) continue;
      e.awake = true;
      e.wakeT = rng.range(0.1, 0.45);
    }
    h.roomWake(room);
    if (room.boss && sim.boss && !sim.boss.dead) {
      sim.bossStarted = true;
      sim.boss.state = 'roar';
      sim.boss.t = 1.4;
      sim.boss.wakeT = 0;
      h.boss('start');
    }
  }

  const dmgOf = (e, base) => Math.round(base * e.dmgScale);

  function damageEnemy(e, amount, kind, crit = false, kx = 0, kz = 0) {
    if (e.dead) return;
    e.hp -= amount;
    if (kind !== 'burn') e.flash = 0.12; // the view's hit flash
    sim.totals.hits++;
    if (!e.awake) wakeRoom(e.room);
    if ((kx || kz) && e.kind !== 'ash_lord') moveCircle(sim.grid, e, kx * 0.3, kz * 0.3, e.r, e.ledge ? solidForLedgeWalker : undefined);
    h.hit(e, amount, kind, crit);
    if (e.kind === 'ash_lord') bossThresholds(e);
    if (e.hp <= 0) killEnemy(e);
  }
  sim.damageEnemy = damageEnemy;

  function killEnemy(e) {
    e.dead = true;
    e.hp = 0;
    e.tele = null;
    sim.kills++;
    sim.totals.kills++;
    h.kill(e);
    gainXp(e.xp, e);
    if (e.kind === 'slime' && !e.small) {
      // splits once: two small slimes, already angry
      const a = rng.range(0, Math.PI);
      for (const s of [-1, 1]) {
        const c = spawnEnemy('slime', e.x + Math.cos(a) * 0.55 * s, e.z + Math.sin(a) * 0.55 * s, e.room, { small: true, awake: true });
        resolve(sim.grid, c, c.r);
        onFloor(c);
      }
      h.split(e);
    }
    if (e.kind === 'ash_lord') {
      sim.projectiles = sim.projectiles.filter((p) => p.kind !== 'bolt');
      h.boss('win');
      // the Ash Lord always drops a legendary, and a little of everything else
      dropAt(e.x, e.z, makeItem(rng, { slot: rng.pick(SLOTS), rarity: 'legendary', ilvl: sim.floorIndex }), 0.2);
      for (let i = 0; i < 3; i++) dropAt(e.x, e.z, { kind: 'gold', amount: rng.int(20, 40) }, 1.6);
      dropAt(e.x, e.z, { kind: 'potion' }, 1.6);
    } else rollDrops(e);
  }

  function gainXp(n, src) {
    const hr = sim.hero;
    hr.xp += n;
    h.xp(n, src);
    const target = levelForXp(hr.xp);
    while (hr.level < target) {
      hr.level++;
      refreshStats();
      hr.hp = hr.maxHp;
      hr.mana = hr.maxMana;
      hr.levelT = 1.2;
      h.levelUp(hr.level);
    }
  }

  function rollDrops(e) {
    const fi = sim.floorIndex;
    if (e.small) {
      if (rng.chance(DROPS.smallGold)) dropAt(e.x, e.z, { kind: 'gold', amount: rng.int(1, 3) * (1 + fi) });
      return;
    }
    if (rng.chance(DROPS.gold)) dropAt(e.x, e.z, { kind: 'gold', amount: rng.int(3, 8) * (1 + fi) });
    if (rng.chance(DROPS.potion)) dropAt(e.x, e.z, { kind: 'potion' });
    if (rng.chance(DROPS.gear)) dropAt(e.x, e.z, makeItem(rng, { slot: weighted(rng, DROPS.slot), rarity: weighted(rng, DROPS.rarity), ilvl: fi }));
  }

  /** Anything pushed into a wall goes to the centre of the nearest open tile. */
  function onFloor(o) {
    if (walkable(tileAt(sim.grid, o.x, o.z))) return;
    const c0 = tileOf(o.x);
    const r0 = tileOf(o.z);
    for (let k = 1; k < 6; k++) {
      let best = null;
      let bd = Infinity;
      for (let r = r0 - k; r <= r0 + k; r++) {
        for (let c = c0 - k; c <= c0 + k; c++) {
          if (!walkable(get(sim.grid, c, r))) continue;
          const p = tileCenter(c, r);
          const d = Math.hypot(p.x - o.x, p.z - o.z);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
      }
      if (best) {
        o.x = best.x;
        o.z = best.z;
        return;
      }
    }
  }

  function dropAt(x, z, item, spread = 1.1) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = spread * rng.range(0.4, 1);
    const it = { id: ids++, kind: item.kind || 'gear', ...item, x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, y: 0, inside: false, t: 0 };
    resolve(sim.grid, it, 0.35);
    onFloor(it);
    it.y = heightAt(sim.grid, it.x, it.z);
    if (it.rarity === 'legendary') sim.totals.legendaries++;
    sim.loot.push(it);
    h.drop(it);
    return it;
  }
  sim.dropAt = dropAt;
  sim.makeItem = (slot, rarity) => makeItem(rng, { slot, rarity, ilvl: sim.floorIndex });

  // ───────────────────────────────────────────── the hero

  function hurtHero(dmg, cause) {
    const hr = sim.hero;
    if (sim.state !== 'playing') return false;
    if (hr.iframes > 0) {
      h.evade(cause);
      return false;
    }
    const taken = Math.max(1, Math.round(dmg * (1 - hr.armor / 100)));
    hr.hp -= taken;
    hr.hurtT = 0.25;
    hr.lastCause = cause;
    h.heroHurt(taken, cause);
    if (hr.hp <= 0) {
      hr.hp = 0;
      die(cause);
    }
    return true;
  }

  function die(cause) {
    const hr = sim.hero;
    sim.state = 'dead';
    sim.deathsOnFloor++;
    sim.totals.deaths++;
    if (sim.bossStarted && sim.boss && !sim.boss.dead) h.boss('died');
    h.death(cause, { x: hr.x, y: hr.y, z: hr.z });
  }

  sim.outOfLives = () => sim.deathsOnFloor >= DEATHS_PER_FLOOR;

  function stepHero(input, dt) {
    const hr = sim.hero;
    hr.swingCd -= dt;
    hr.swingT -= dt;
    hr.dodgeCd -= dt;
    hr.novaCd -= dt;
    hr.novaT -= dt;
    hr.potionCd -= dt;
    hr.iframes -= dt;
    hr.hurtT -= dt;
    hr.levelT -= dt;

    const ax = input.aimX - hr.x;
    const az = input.aimZ - hr.z;
    if (Math.hypot(ax, az) > 0.05) hr.aim = Math.atan2(ax, az);

    let mx = input.mx || 0;
    let mz = input.mz || 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }

    if (input.dodge && hr.dodgeCd <= 0 && hr.dodgeT <= 0) {
      let dx = mx;
      let dz = mz;
      if (Math.hypot(dx, dz) < 0.1) {
        dx = Math.sin(hr.aim);
        dz = Math.cos(hr.aim);
      }
      const l = Math.hypot(dx, dz);
      hr.dodgeX = dx / l;
      hr.dodgeZ = dz / l;
      hr.dodgeT = HERO.dodge.time;
      hr.iframes = HERO.dodge.iframes;
      hr.dodgeCd = HERO.dodge.cooldown;
      hr.swingT = 0;
      h.skill('dodge');
    }

    let vx;
    let vz;
    if (hr.dodgeT > 0) {
      hr.dodgeT -= dt;
      vx = hr.dodgeX * HERO.dodge.speed;
      vz = hr.dodgeZ * HERO.dodge.speed;
      hr.face = Math.atan2(vx, vz);
    } else {
      const speed = HERO.speed * (hr.swingT > 0 ? HERO.swing.slow : 1);
      vx = mx * speed;
      vz = mz * speed;
    }
    hr.vx = vx;
    hr.vz = vz;
    moveCircle(sim.grid, hr, vx * dt, vz * dt, hr.r);
    hr.y += (heightAt(sim.grid, hr.x, hr.z) - hr.y) * Math.min(1, dt * 14);

    if (input.attack && hr.swingCd <= 0 && hr.dodgeT <= 0) swing(hr.aim);
    if (input.nova && hr.novaCd <= 0 && hr.mana >= HERO.nova.cost && hr.dodgeT <= 0) nova();
    if (input.potion && hr.potions > 0 && hr.potionCd <= 0 && hr.hp < hr.maxHp) drinkPotion();

    if (hr.dodgeT <= 0) {
      if (hr.swingT > 0) hr.face = hr.swingA;
      else if (Math.hypot(vx, vz) > 0.5) hr.face = turnToward(hr.face, Math.atan2(vx, vz), 14 * dt);
      else hr.face = turnToward(hr.face, hr.aim, 10 * dt);
    }
    hr.mana = Math.min(hr.maxMana, hr.mana + HERO.manaRegen * dt);
  }

  function swing(a) {
    const hr = sim.hero;
    const S = HERO.swing;
    hr.swingCd = S.cooldown;
    hr.swingT = S.anim;
    hr.swingA = a;
    hr.face = a;
    sim.totals.swings++;
    for (const room of sim.rooms) if (room.awake && !room.cleared) room.swings++;
    let hits = 0;
    for (const e of sim.enemies.slice()) {
      if (e.dead) continue;
      const dx = e.x - hr.x;
      const dz = e.z - hr.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      if (d - e.r > S.range) continue;
      const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - a));
      if (off > S.arc / 2 && d > e.r + hr.r + 0.3) continue; // point blank always connects
      const crit = rng.chance(hr.crit);
      const dmg = Math.round(hr.damage * rng.range(0.88, 1.12) * (crit ? HERO.critMult : 1));
      hits++;
      damageEnemy(e, dmg, 'swing', crit, dx / d, dz / d);
    }
    h.swing(a, hits);
  }

  function nova() {
    const hr = sim.hero;
    const N = HERO.nova;
    hr.mana -= N.cost;
    hr.novaCd = N.cooldown;
    hr.novaT = 0.5;
    h.skill('nova');
    h.nova();
    const dmg = Math.round(N.damage * (1 + 0.08 * (hr.level - 1)));
    const burn = N.burnDamage + Math.floor(hr.level / 2);
    for (const e of sim.enemies.slice()) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - hr.x, e.z - hr.z);
      if (d - e.r > N.radius) continue;
      e.burn = { left: N.burnTicks, t: N.burnEvery, dmg: burn };
      damageEnemy(e, dmg, 'nova', false, (e.x - hr.x) / (d || 1), (e.z - hr.z) / (d || 1));
    }
  }

  function drinkPotion() {
    const hr = sim.hero;
    const healed = Math.min(hr.maxHp - hr.hp, Math.round(hr.maxHp * HERO.potionHeal));
    hr.hp += healed;
    hr.potions--;
    hr.potionCd = HERO.potionCooldown;
    h.potion(healed);
  }

  // ───────────────────────────────────────────── enemy brains

  function solidFor(e) {
    return e.ledge ? solidForLedgeWalker : undefined;
  }

  function updateHeroField() {
    const hr = sim.hero;
    const tile = tileOf(hr.z) * sim.grid.cols + tileOf(hr.x);
    if (tile === sim.heroFieldTile) return;
    sim.heroFieldTile = tile;
    sim.heroField = distanceField(sim.grid, tileOf(hr.x), tileOf(hr.z));
  }

  function moveToward(e, tx, tz, speed, dt) {
    let dx = tx - e.x;
    let dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const solid = solidFor(e);
    if (!e.ledge && !(d < 8 && walkLine(sim.grid, e.x, e.z, tx, tz, e.r * 0.85))) {
      const step = downhill(sim.grid, sim.heroField, tileOf(e.x), tileOf(e.z));
      if (step) {
        const c = tileCenter(step[0], step[1]);
        dx = c.x - e.x;
        dz = c.z - e.z;
      }
    }
    const l = Math.hypot(dx, dz) || 1;
    e.vx = (dx / l) * speed;
    e.vz = (dz / l) * speed;
    moveCircle(sim.grid, e, e.vx * dt, e.vz * dt, e.r, solid);
    e.face = turnToward(e.face, Math.atan2(dx, dz), 8 * dt);
  }

  function stepSkeleton(e, dt, dx, dz, d) {
    const hr = sim.hero;
    const D = e.def;
    e.cd -= dt;
    if (e.state === 'idle' || e.state === 'chase') {
      e.state = 'chase';
      if (d < D.range + hr.r && e.cd <= 0) {
        e.state = 'windup';
        e.t = D.windup;
        e.face = Math.atan2(dx, dz);
        e.tele = { id: ids++, kind: 'arc', range: D.range + 0.3, arc: D.arc, t: D.windup, total: D.windup };
        h.windup(e, 'swing');
      } else if (d > D.range * 0.75) moveToward(e, hr.x, hr.z, D.speed, dt);
      else e.face = turnToward(e.face, Math.atan2(dx, dz), 6 * dt);
    } else if (e.state === 'windup') {
      e.t -= dt;
      e.face = turnToward(e.face, Math.atan2(dx, dz), 2.2 * dt);
      e.tele.t = e.t;
      if (e.t <= 0) {
        const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.face));
        if (d < D.range + hr.r + 0.25 && off < D.arc / 2 + 0.2) hurtHero(dmgOf(e, D.damage), 'skeleton');
        h.strike(e, 'swing');
        e.state = 'recover';
        e.t = D.recover;
        e.tele = null;
        e.cd = 0.4 + rng.range(0, 0.5);
      }
    } else if (e.state === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.state = 'chase';
    }
  }

  function stepSlime(e, dt, dx, dz, d) {
    const hr = sim.hero;
    const D = e.def;
    e.cd -= dt;
    if (e.state === 'idle' || e.state === 'chase') {
      e.state = 'chase';
      e.hop += dt * 6.5;
      const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(e.hop));
      if (d < D.lunge + 0.6 && e.cd <= 0 && lineOfSight(sim.grid, e.x, e.z, hr.x, hr.z)) {
        e.state = 'windup';
        e.t = D.windup;
        e.lx = dx / (d || 1);
        e.lz = dz / (d || 1);
        e.face = Math.atan2(dx, dz);
        const reach = Math.min(D.lunge, d + 0.6);
        e.tele = { id: ids++, kind: 'line', len: reach + e.r, width: e.r * 2, t: D.windup, total: D.windup };
        h.windup(e, 'lunge');
      } else moveToward(e, hr.x, hr.z, D.speed * pulse * 1.25, dt);
    } else if (e.state === 'windup') {
      e.t -= dt;
      e.tele.t = e.t;
      if (e.t <= 0) {
        e.state = 'lunge';
        e.t = D.lungeTime;
        e.hitDone = false;
        e.tele = null;
        h.strike(e, 'lunge');
      }
    } else if (e.state === 'lunge') {
      const sp = D.lunge / D.lungeTime;
      moveCircle(sim.grid, e, e.lx * sp * dt, e.lz * sp * dt, e.r);
      if (!e.hitDone && Math.hypot(hr.x - e.x, hr.z - e.z) < e.r + hr.r + 0.12) {
        e.hitDone = true;
        hurtHero(dmgOf(e, D.damage), 'slime');
      }
      e.t -= dt;
      if (e.t <= 0) {
        e.state = 'recover';
        e.t = D.recover;
        e.cd = 0.5 + rng.range(0, 0.5);
      }
    } else if (e.state === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.state = 'chase';
    }
  }

  function stepArcher(e, dt, dx, dz, d) {
    const hr = sim.hero;
    const D = e.def;
    e.cd -= dt;
    const los = d < D.range + 2 && lineOfSight(sim.grid, e.x, e.z, hr.x, hr.z);
    if (e.state === 'idle' || e.state === 'move') {
      e.state = 'move';
      if (e.ledge) {
        // on a ledge: walk along it, away from the hero when it gets close
        const away = d < D.keepMin ? -Math.sign(dx || 1) : d > D.keepMax ? Math.sign(dx) : 0;
        if (away) moveToward(e, e.x + away * 2, e.z, D.speed * 0.85, dt);
      } else if (d < D.keepMin) moveToward(e, e.x - (dx / d) * 3, e.z - (dz / d) * 3, D.speed * 0.9, dt);
      else if (d > D.keepMax || !los) moveToward(e, hr.x, hr.z, D.speed, dt);
      e.face = turnToward(e.face, Math.atan2(dx, dz), 6 * dt);
      if (los && d < D.range && e.cd <= 0) {
        e.state = 'draw';
        e.t = D.draw;
        e.tele = { id: ids++, kind: 'aim', len: Math.min(d, D.range), t: D.draw, total: D.draw };
        h.windup(e, 'draw');
      }
    } else if (e.state === 'draw') {
      e.t -= dt;
      e.face = turnToward(e.face, Math.atan2(dx, dz), 10 * dt);
      e.tele.t = e.t;
      e.tele.len = Math.min(d, D.range);
      if (e.t <= 0) {
        // lead the target a little (more on the gallery ledges)
        const flight = d / D.arrowSpeed;
        const tx = hr.x + hr.vx * flight * D.lead;
        const tz = hr.z + hr.vz * flight * D.lead;
        const a = Math.atan2(tx - e.x, tz - e.z) + rng.gauss() * 0.03;
        shoot({ kind: 'arrow', x: e.x + Math.sin(a) * 0.6, z: e.z + Math.cos(a) * 0.6, y: e.y + 1.1, a, speed: D.arrowSpeed, dmg: dmgOf(e, D.damage), cause: 'archer', life: (D.range + 3) / D.arrowSpeed, from: e.id });
        h.strike(e, 'shot');
        e.state = 'move';
        e.tele = null;
        e.cd = D.reload * rng.range(0.85, 1.15);
      }
    }
  }

  function shoot({ kind, x, z, y, a, speed, dmg, cause, life, from }) {
    const p = { id: ids++, kind, x, z, y, a, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, dmg, cause, life, r: kind === 'bolt' ? 0.32 : 0.16, from };
    sim.projectiles.push(p);
    h.shoot(p);
  }

  function bossThresholds(e) {
    const D = e.def;
    const frac = e.hp / e.maxHp;
    while (e.summoned < D.summonAt.length && frac < D.summonAt[e.summoned] && e.hp > 0) {
      e.summoned++;
      // the Ash Lord calls in its guard: two skeletons and a slime from the pillars
      const room = sim.rooms[e.room];
      const [c0, r0, w, hgt] = room.def.rect;
      const spots = [
        [c0 + 3, r0 + 1],
        [c0 + w - 4, r0 + 1],
        [c0 + 3, r0 + hgt - 2],
        [c0 + w - 4, r0 + hgt - 2],
      ];
      const pick = spots.sort((a, b) => {
        const pa = tileCenter(a[0], a[1]);
        const pb = tileCenter(b[0], b[1]);
        return Math.hypot(pb.x - sim.hero.x, pb.z - sim.hero.z) - Math.hypot(pa.x - sim.hero.x, pa.z - sim.hero.z);
      });
      ['skeleton', 'skeleton', 'slime'].forEach((kind, i) => {
        const p = tileCenter(pick[i][0], pick[i][1]);
        spawnEnemy(kind, p.x, p.z, e.room, { awake: true });
      });
      h.bossPhase('summon', e);
    }
    if (!e.enraged && frac < D.enrageAt && e.hp > 0) {
      e.enraged = true;
      h.bossPhase('enrage', e);
    }
  }

  function stepBoss(e, dt, dx, dz, d) {
    const hr = sim.hero;
    const D = e.def;
    const fast = e.enraged ? 1.3 : 1;
    e.cd -= dt;
    e.slamCd -= dt * fast;
    e.boltCd -= dt * fast;
    if (e.state === 'roar') {
      e.t -= dt;
      e.face = turnToward(e.face, Math.atan2(dx, dz), 3 * dt);
      if (e.t <= 0) e.state = 'chase';
      return;
    }
    if (e.state === 'idle') e.state = 'chase';
    if (e.state === 'chase') {
      const A = D;
      if (d < A.cleave.range + hr.r - 0.2 && e.cd <= 0) {
        startBoss(e, 'cleave', A.cleave.windup / fast);
        e.face = Math.atan2(dx, dz);
        e.tele = { id: ids++, kind: 'arc', range: A.cleave.range + 0.3, arc: A.cleave.arc, t: e.t, total: e.t };
      } else if (e.slamCd <= 0 && d < A.slam.maxRange && d > 2.5) {
        startBoss(e, 'slam', A.slam.windup / fast);
        e.tx = hr.x;
        e.tz = hr.z;
        e.tele = { id: ids++, kind: 'circle', x: hr.x, z: hr.z, r: A.slam.radius, t: e.t, total: e.t };
        e.slamCd = A.slam.cooldown;
      } else if (e.boltCd <= 0 && d > 4.5) {
        startBoss(e, 'bolts', A.bolts.windup / fast);
        e.tele = { id: ids++, kind: 'fan', len: 7, arc: A.bolts.spread * (A.bolts.count - 1), t: e.t, total: e.t };
        e.boltCd = A.bolts.cooldown;
      } else moveToward(e, hr.x, hr.z, D.speed * fast, dt);
      if (e.state === 'chase') e.face = turnToward(e.face, Math.atan2(dx, dz), 4 * dt);
    } else if (e.state === 'windup') {
      e.t -= dt;
      e.tele.t = e.t;
      if (e.attack === 'cleave' || e.attack === 'bolts') e.face = turnToward(e.face, Math.atan2(dx, dz), 1.6 * dt);
      if (e.t <= 0) {
        e.tele = null;
        let rec = 0.8;
        if (e.attack === 'cleave') {
          const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.face));
          if (d < D.cleave.range + hr.r + 0.2 && off < D.cleave.arc / 2 + 0.15) hurtHero(D.cleave.damage, 'ash_lord');
          rec = D.cleave.recover;
          e.cd = 0.6;
        } else if (e.attack === 'slam') {
          if (Math.hypot(hr.x - e.tx, hr.z - e.tz) < D.slam.radius + hr.r * 0.5) hurtHero(D.slam.damage, 'ash_lord');
          rec = D.slam.recover;
        } else if (e.attack === 'bolts') {
          const B = D.bolts;
          for (let i = 0; i < B.count; i++) {
            const a = e.face + (i - (B.count - 1) / 2) * B.spread;
            shoot({ kind: 'bolt', x: e.x + Math.sin(a) * 1.4, z: e.z + Math.cos(a) * 1.4, y: 1.4, a, speed: B.speed, dmg: B.damage, cause: 'ash_lord', life: 3.2, from: e.id });
          }
          rec = B.recover;
        }
        h.strike(e, e.attack);
        e.state = 'recover';
        e.t = rec / fast;
      }
    } else if (e.state === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.state = 'chase';
    }
  }

  function startBoss(e, attack, t) {
    e.state = 'windup';
    e.attack = attack;
    e.t = t;
    h.windup(e, attack);
  }

  function stepEnemies(dt) {
    const hr = sim.hero;
    updateHeroField();
    for (const e of sim.enemies) {
      if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt);
      if (e.burn) {
        e.burn.t -= dt;
        if (e.burn.t <= 0) {
          e.burn.t += HERO.nova.burnEvery;
          e.burn.left--;
          const dmg = e.burn.dmg;
          if (e.burn.left <= 0) e.burn = null;
          damageEnemy(e, dmg, 'burn');
          if (e.dead) continue;
        }
      }
      const dx = hr.x - e.x;
      const dz = hr.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      if (!e.awake) {
        if (d < e.def.aggro && lineOfSight(sim.grid, e.x, e.z, hr.x, hr.z)) wakeRoom(e.room);
        continue;
      }
      if (e.wakeT > 0) {
        e.wakeT -= dt;
        e.face = turnToward(e.face, Math.atan2(dx, dz), 5 * dt);
        continue;
      }
      if (e.kind === 'skeleton') stepSkeleton(e, dt, dx, dz, d);
      else if (e.kind === 'slime') stepSlime(e, dt, dx, dz, d);
      else if (e.kind === 'archer') stepArcher(e, dt, dx, dz, d);
      else if (e.kind === 'ash_lord') stepBoss(e, dt, dx, dz, d);
      e.y += (heightAt(sim.grid, e.x, e.z) - e.y) * Math.min(1, dt * 12);
      if (sim.state !== 'playing') return;
    }
    // keep bodies apart, and out of the hero
    const list = sim.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = a.r + b.r;
        const dd = dx * dx + dz * dz;
        if (dd >= min * min || dd < 1e-8) continue;
        const d = Math.sqrt(dd);
        const push = (min - d) / 2;
        const wa = a.kind === 'ash_lord' ? 0 : b.kind === 'ash_lord' ? 2 : 1;
        const wb = 2 - wa;
        moveCircle(sim.grid, a, (-dx / d) * push * wa, (-dz / d) * push * wa, a.r, solidFor(a));
        moveCircle(sim.grid, b, (dx / d) * push * wb, (dz / d) * push * wb, b.r, solidFor(b));
      }
      const hx = a.x - hr.x;
      const hz = a.z - hr.z;
      const hd = Math.hypot(hx, hz);
      const hmin = a.r + hr.r;
      if (hd < hmin && hd > 1e-4) {
        if (a.kind === 'ash_lord') moveCircle(sim.grid, hr, (-hx / hd) * (hmin - hd), (-hz / hd) * (hmin - hd), hr.r);
        else moveCircle(sim.grid, a, (hx / hd) * (hmin - hd), (hz / hd) * (hmin - hd), a.r, solidFor(a));
      }
    }
  }

  function stepProjectiles(dt) {
    const hr = sim.hero;
    const keep = [];
    for (const p of sim.projectiles) {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      const v = tileAt(sim.grid, p.x, p.z);
      if (p.life <= 0 || v === T.WALL || v === T.VOID || v === T.PILLAR) {
        p.dead = true;
        continue;
      }
      if (sim.state === 'playing' && Math.hypot(p.x - hr.x, p.z - hr.z) < hr.r + p.r) {
        if (hr.iframes > 0) {
          if (!p.evaded) {
            p.evaded = true;
            h.evade(p.cause);
          }
        } else {
          hurtHero(p.dmg, p.cause);
          p.dead = true;
          continue;
        }
      }
      keep.push(p);
    }
    sim.projectiles = keep;
  }

  function checkRooms() {
    let alive = null;
    for (const room of sim.rooms) {
      if (room.cleared) continue;
      alive ??= countAlive();
      if ((alive.get(room.idx) || 0) > 0) continue;
      room.cleared = true;
      h.roomClear(room);
    }
    if (!sim.stairsOpen && sim.rooms.every((r) => r.cleared)) {
      sim.stairsOpen = true;
      h.stairsOpen();
    }
  }

  function countAlive() {
    const m = new Map();
    for (const e of sim.enemies) if (!e.dead) m.set(e.room, (m.get(e.room) || 0) + 1);
    return m;
  }

  // Walking onto loot. Last thing in a step: gear goes through compare(), which can throw (see gear.js).
  function touchLoot() {
    const hr = sim.hero;
    for (const it of sim.loot.slice()) {
      const inside = Math.hypot(it.x - hr.x, it.z - hr.z) < 0.95;
      if (!inside) {
        it.inside = false;
        continue;
      }
      if (it.inside) continue; // only when stepping onto it
      it.inside = true;
      pickUp(it);
    }
  }

  function removeLoot(it) {
    const i = sim.loot.indexOf(it);
    if (i >= 0) sim.loot.splice(i, 1);
    it.gone = true;
  }

  function pickUp(it) {
    const hr = sim.hero;
    if (it.kind === 'gold') {
      hr.gold += it.amount;
      sim.totals.gold += it.amount;
      removeLoot(it);
      h.loot(it);
      return;
    }
    if (it.kind === 'potion') {
      if (hr.potions >= HERO.potionsMax) {
        h.potionFull(it);
        return;
      }
      hr.potions++;
      removeLoot(it);
      h.loot(it);
      return;
    }
    h.loot(it); // the loot event goes out first…
    // GLITCHLESS-DEMO: the legendary crash. …then compare() throws for a legendary (see gear.js): the item stays on
    // the floor, is never equipped, and the rest of this frame is skipped. The game loop carries on.
    const verdict = compare(it, hr.gear[it.slot]);
    removeLoot(it);
    if (verdict.better) {
      const old = hr.gear[it.slot];
      hr.gear[it.slot] = it;
      refreshStats();
      h.equip(it, old, verdict);
    } else {
      const gold = 2 + 3 * it.ilvl + (it.rarity === 'rare' ? 6 : it.rarity === 'magic' ? 3 : 0);
      hr.gold += gold;
      sim.totals.gold += gold;
      h.salvage(it, gold, verdict);
    }
  }

  // ───────────────────────────────────────────── one fixed step

  sim.step = (input, dt) => {
    if (sim.state !== 'playing') return;
    sim.time += dt;
    sim.floorTime += dt;
    sim.totals.time += dt;
    stepHero(input, dt);
    // walking into a room wakes everything in it
    const ri = roomAt(sim.grid, sim.hero.x, sim.hero.z);
    if (ri >= 0 && !sim.rooms[ri].awake && !sim.rooms[ri].cleared) wakeRoom(ri);
    stepEnemies(dt);
    if (sim.state !== 'playing') return;
    stepProjectiles(dt);
    if (sim.state !== 'playing') return;
    sim.enemies = sim.enemies.filter((e) => !e.dead);
    checkRooms();
    // the stairs take you down when you step onto them once they're open (standing on them as they open doesn't count)
    const onStairs = tileAt(sim.grid, sim.hero.x, sim.hero.z) === T.STAIRS;
    const entered = onStairs && !sim.onStairs;
    sim.onStairs = onStairs;
    if (sim.stairsOpen && entered) {
      sim.state = 'complete';
      h.floorComplete();
      return;
    }
    for (const it of sim.loot) it.t += dt;
    touchLoot();
  };

  /** Agent tool helper: wake a room as if the hero had walked in. */
  sim.wakeRoom = wakeRoom;
  sim.roomIndexAt = (x, z) => roomAt(sim.grid, x, z);

  refreshStats();
  return sim;
}
