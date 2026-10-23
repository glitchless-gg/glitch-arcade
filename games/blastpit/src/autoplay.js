// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// Produces the same input the keyboard and mouse do ({ move, strafe, yawDelta, pitchDelta, fire, weapon })
// every fixed step. It aims at the nearest enemy it can see, turning at a skill-scaled rate with a wandering
// aim error, and fires once the crosshair is close enough. Shotgun up close, launcher into clusters,
// pistol otherwise. It strafes, backs away from melee and goes for health when low. Lower skill = slower
// reactions, worse aim, slower weapon choices and rockets fired far too close. Deterministic per seed.
import { createRng } from './rng.js';
import { lineOfSight, rayBox, ARENA_HALF } from './collide.js';
import { PLAYER, yawTo, wrapAngle, viewDir } from './player.js';

export function createAutoplay({ skill, seed }) {
  const rng = createRng(seed);
  const s1 = 1 - skill;
  const reaction = 0.08 + s1 * 0.6; // s before firing at a newly acquired target
  const turnRate = 3.2 + skill * 9; // rad/s
  const settle = 0.04 + s1 * 0.16; // aim time constant (s)
  const noiseSigma = 0.004 + s1 * 0.09; // wandering aim error (rad)
  const flickError = 0.02 + s1 * 0.22; // extra error when switching targets (rad)
  const thinkEvery = 0.1 + s1 * 0.35; // s between decisions (weapon, target, plan)
  const minRocketDist = 6.2 - s1 * 5; // closest a cluster may be before it fires a rocket
  const backoff = 1.6 + skill * 3.4; // distance it keeps from melee enemies
  const healthAt = 22 + skill * 24; // goes for health under this
  const strafeAmp = 0.1 + skill * 0.9;
  const fovHalf = 0.95 + skill * 1.5; // rad either side of where it looks

  const input = { move: 0, strafe: 0, yawDelta: 0, pitchDelta: 0, fire: false, jump: false, weapon: null, restart: false, quit: false };
  const bot = {
    skill,
    seed,
    input,
    target: null,
    onTarget: 0,
    think: 0,
    nYaw: 0,
    nPitch: 0,
    strafeDir: 1,
    strafeT: 1,
    goal: null,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    escapeT: 0,
    escapeX: 0,
    escapeZ: 0,
    menuT: 0,
    menuWait: 0.5 + rng.range(0, 0.7),
    restarted: false,
    careful: true,
    planted: false,
    wantWeapon: 'pistol',
    stats: { thinks: 0, rocketsClose: 0 },
  };

  function eyeOf(p) {
    return { x: p.x, y: p.y + PLAYER.EYE, z: p.z };
  }

  function aimPoint(e, weapon, p) {
    // rockets go at the feet (splash), bullets at the chest
    const y = weapon === 'launcher' ? 0.35 : e.def.height * 0.55;
    let x = e.x;
    let z = e.z;
    if (weapon === 'launcher') {
      const t = Math.hypot(e.x - p.x, e.z - p.z) / 24;
      x += e.vx * t * skill;
      z += e.vz * t * skill;
    }
    return { x, y, z };
  }

  function visibleEnemies(game) {
    const p = game.player;
    const eye = eyeOf(p);
    const out = [];
    for (const e of game.enemies) {
      if (e.spawnT < 0.3) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      // only what is in front of us (wider for better players), plus anything close enough to hear
      const off = Math.abs(wrapAngle(yawTo(p.x, p.z, e.x, e.z) - p.yaw));
      const sees = (off < fovHalf || d < 2.5) && lineOfSight(eye, { x: e.x, y: e.def.height * 0.6, z: e.z }, game.boxes);
      out.push({ e, d, sees });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  function chooseWeapon(game, seen, target) {
    const near = seen.find((s) => s.sees);
    const { shells, rockets } = game.ammo;
    if (!near) return game.weapon;
    let rocketOk = false;
    if (target && rockets > 0) {
      const td = Math.hypot(target.x - game.player.x, target.z - game.player.z);
      let cluster = 0;
      for (const s of seen) if (Math.hypot(s.e.x - target.x, s.e.z - target.z) < 3.5) cluster++;
      rocketOk = cluster >= 3 && td >= minRocketDist && td <= 15;
    }
    // beginners love a rocket into a crowd, even a close one
    if (rocketOk && rng.chance(s1 * 0.8)) return 'launcher';
    if (near.d < 6 && shells > 0) {
      // a nervous low-skill bot sometimes reaches for the rocket launcher instead (more so when hurt)
      const panic = s1 * (game.player.hp < 50 ? 0.6 : 0.3);
      if (rockets > 0 && near.d > 1.4 && rng.chance(panic)) {
        bot.stats.rocketsClose++;
        return 'launcher';
      }
      return 'shotgun';
    }
    return rocketOk ? 'launcher' : 'pistol';
  }

  function pickGoal(game) {
    const p = game.player;
    const items = game.pickups || [];
    const nearest = (kind, maxD) => {
      let best = null;
      let bd = maxD;
      for (const it of items) {
        if (it.kind !== kind || !it.up) continue;
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      return best;
    };
    if (p.hp < healthAt) return nearest('health', 40);
    if (game.ammo.shells < 6) return nearest('shells', 16);
    if (game.ammo.rockets < 2 && game.roundIndex === 2) return nearest('rockets', 12);
    return null;
  }

  function probeBlocked(game, x, z, dx, dz, dist) {
    const o = { x, y: 0.5, z };
    const d = { x: dx, y: 0, z: dz };
    for (const b of game.boxes) {
      if (b.kind === 'wall') continue;
      const t = rayBox(o, d, b, dist);
      if (t < dist) return true;
    }
    return Math.abs(x + dx * dist) > ARENA_HALF - 0.8 || Math.abs(z + dz * dist) > ARENA_HALF - 0.8;
  }

  /** Steer a world direction around cover; returns a unit vector. */
  function avoid(game, p, dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return { x: 0, z: 0 };
    dx /= l;
    dz /= l;
    if (!probeBlocked(game, p.x, p.z, dx, dz, 1.4)) return { x: dx, z: dz };
    for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      if (!probeBlocked(game, p.x, p.z, rx, rz, 1.4)) return { x: rx, z: rz };
    }
    return { x: -dx, z: -dz };
  }

  bot.onRoundStart = () => {
    bot.target = null;
    bot.onTarget = 0;
    bot.goal = null;
    bot.think = 0;
    bot.escapeT = 0;
  };

  bot.onDeath = () => {
    bot.target = null;
  };

  bot.tick = () => {};

  /** called once per fixed step while playing; returns the input to use */
  bot.step = (game, dt) => {
    const p = game.player;
    input.fire = false;
    input.weapon = null;
    input.jump = false;
    input.restart = false;
    input.quit = false;

    // ── decide (every think period)
    bot.think -= dt;
    if (bot.think <= 0) {
      bot.think = thinkEvery * rng.range(0.7, 1.3);
      bot.stats.thinks++;
      const seen = visibleEnemies(game);
      bot.seen = seen;
      const vis = seen.filter((s) => s.sees);
      // target: the nearest visible enemy; low skill keeps its old target a while
      let next = vis[0]?.e || null;
      if (bot.target && game.enemies.includes(bot.target) && vis.some((s) => s.e === bot.target) && rng.chance(s1 * 0.6)) next = bot.target;
      if (next !== bot.target) {
        bot.target = next;
        bot.onTarget = 0;
        bot.nYaw += rng.gauss() * flickError;
        bot.nPitch += rng.gauss() * flickError * 0.4;
      }
      bot.wantWeapon = chooseWeapon(game, seen, bot.target);
      bot.goal = pickGoal(game);
      // beginners stop moving while they shoot
      bot.planted = !!bot.target && rng.chance(s1 * 0.4);

      // give up? (low skill only, rare)
      if (skill < 0.6 && !bot.restarted && p.hp < 25 && game.roundTime > 8 && game.enemies.length > 3 && rng.chance((0.6 - skill) * 0.12)) {
        bot.restarted = true;
        input.restart = true;
        return input;
      }
      bot.careful = rng.chance(skill);
      if (skill < 0.5 && game.tries <= 1 && p.hp < 35 && rng.chance((0.5 - skill) * 0.2)) {
        input.quit = true;
        return input;
      }
    }
    if (bot.target && !game.enemies.includes(bot.target)) {
      bot.target = null;
      bot.think = Math.min(bot.think, reaction * 0.5);
    }
    if (bot.wantWeapon !== game.weapon) {
      const w = bot.wantWeapon;
      if ((w === 'shotgun' && game.ammo.shells > 0) || (w === 'launcher' && game.ammo.rockets > 0) || w === 'pistol') input.weapon = w;
      else bot.wantWeapon = 'pistol';
    }

    // ── aim
    bot.nYaw += -bot.nYaw * 2.5 * dt + rng.gauss() * noiseSigma * Math.sqrt(5 * dt);
    bot.nPitch += -bot.nPitch * 2.5 * dt + rng.gauss() * noiseSigma * 0.5 * Math.sqrt(5 * dt);
    const eye = eyeOf(p);
    let aimErr = Infinity;
    let tolerance = 0;
    let tgt = null;
    let dist = Infinity;
    if (bot.target) {
      const e = bot.target;
      tgt = aimPoint(e, game.weapon, p);
      dist = Math.hypot(tgt.x - eye.x, tgt.z - eye.z);
      const wantYaw = yawTo(eye.x, eye.z, tgt.x, tgt.z);
      const wantPitch = Math.atan2(tgt.y - eye.y, dist);
      const ey = wrapAngle(wantYaw + bot.nYaw - p.yaw);
      const ep = wantPitch + bot.nPitch - p.pitch;
      const k = Math.min(1, dt / settle);
      const lim = turnRate * dt;
      input.yawDelta = Math.max(-lim, Math.min(lim, ey * k));
      input.pitchDelta = Math.max(-lim, Math.min(lim, ep * k));
      // how far off the crosshair is from the real target (after this step's turn)
      const d = viewDir(p.yaw + input.yawDelta, p.pitch + input.pitchDelta);
      const tx = tgt.x - eye.x;
      const ty = tgt.y - eye.y;
      const tz = tgt.z - eye.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      aimErr = Math.acos(Math.max(-1, Math.min(1, (d.x * tx + d.y * ty + d.z * tz) / tl)));
      tolerance = Math.atan2(e.def.radius * 0.9, tl) * (1 + s1 * 3.5) + (game.weapon === 'shotgun' ? 0.05 : 0) + (game.weapon === 'launcher' ? 0.03 : 0);
      bot.onTarget += dt;
    } else {
      // nobody in sight: look toward the nearest enemy (or the middle) and level the view
      const near = game.enemies[0] ? game.enemies.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b)) : null;
      const lx = near ? near.x : 0;
      const lz = near ? near.z : 0;
      const ey = wrapAngle(yawTo(p.x, p.z, lx, lz) - p.yaw);
      const lim = turnRate * 0.6 * dt;
      input.yawDelta = Math.max(-lim, Math.min(lim, ey * Math.min(1, dt / (settle * 2))));
      input.pitchDelta = -p.pitch * Math.min(1, dt * 4);
    }

    // ── fire
    const w = game.weapon;
    const sees = bot.target && bot.seen?.find((s) => s.e === bot.target)?.sees;
    if (bot.target && sees && bot.onTarget >= reaction && game.switchT <= 0 && game.cooldown <= 0) {
      let ok = aimErr < tolerance || (aimErr < tolerance * 2.2 && rng.chance(s1 * 0.015));
      // a careful bot won't fire a rocket into its own face
      if (w === 'launcher' && dist < 4 && bot.careful) {
        ok = false;
        bot.wantWeapon = game.ammo.shells > 0 ? 'shotgun' : 'pistol';
      }
      input.fire = ok;
    }

    // ── move
    let wx = 0;
    let wz = 0;
    const melee = (bot.seen || []).filter((s) => s.e.type !== 'gunner' && (s.sees || s.d < 3) && s.d < backoff + 1.5 && game.enemies.includes(s.e));
    if (bot.goal && bot.goal.up) {
      wx = bot.goal.x - p.x;
      wz = bot.goal.z - p.z;
      const l = Math.hypot(wx, wz) || 1;
      wx /= l;
      wz /= l;
      // still back away from anything about to hit us
      for (const m of melee) {
        if (m.d > 1.8) continue;
        wx += (p.x - m.e.x) / m.d;
        wz += (p.z - m.e.z) / m.d;
      }
    } else if (bot.planted) {
      wx = 0;
      wz = 0;
    } else if (melee.length) {
      // back off from melee enemies, weighted by how close they are
      for (const m of melee) {
        const k = (backoff + 1.5 - m.d) / (backoff + 1.5);
        wx += ((p.x - m.e.x) / Math.max(0.3, m.d)) * k;
        wz += ((p.z - m.e.z) / Math.max(0.3, m.d)) * k;
      }
    } else if (bot.target) {
      const d = Math.hypot(bot.target.x - p.x, bot.target.z - p.z);
      const want = bot.target.type === 'gunner' ? 8 : 9;
      const sign = d > want + 2 ? 1 : d < want - 2 ? -1 : 0;
      wx = ((bot.target.x - p.x) / d) * sign * 0.7;
      wz = ((bot.target.z - p.z) / d) * sign * 0.7;
    } else if (game.enemies.length) {
      // hunt: walk toward the nearest enemy until we can see it
      const near = (bot.seen || [])[0]?.e || game.enemies[0];
      wx = near.x - p.x;
      wz = near.z - p.z;
    } else {
      wx = -p.x * 0.3;
      wz = -p.z * 0.3;
    }
    // strafe across the line to the target (dodges orbs, looks human)
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeDir = -bot.strafeDir;
      bot.strafeT = rng.range(0.5, 1.6);
    }
    if (bot.target && !bot.planted) {
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      wx += -fz * bot.strafeDir * strafeAmp;
      wz += fx * bot.strafeDir * strafeAmp;
    }
    // keep off the outer walls (corners are where swarms win)
    const edge = ARENA_HALF - 3.5;
    if (Math.abs(p.x) > edge) wx -= Math.sign(p.x) * (Math.abs(p.x) - edge) * 0.8;
    if (Math.abs(p.z) > edge) wz -= Math.sign(p.z) * (Math.abs(p.z) - edge) * 0.8;

    // unstick
    bot.stuckT += dt;
    if (bot.stuckT > 0.9) {
      const moved = Math.hypot(p.x - bot.lastX, p.z - bot.lastZ);
      if (moved < 0.3 && Math.hypot(wx, wz) > 0.3) {
        const a = rng.range(0, Math.PI * 2);
        bot.escapeX = Math.cos(a);
        bot.escapeZ = Math.sin(a);
        bot.escapeT = 0.6;
      }
      bot.stuckT = 0;
      bot.lastX = p.x;
      bot.lastZ = p.z;
    }
    if (bot.escapeT > 0) {
      bot.escapeT -= dt;
      wx = bot.escapeX;
      wz = bot.escapeZ;
    }

    const dir = avoid(game, p, wx, wz);
    const speed = Math.min(1, Math.hypot(wx, wz));
    // world direction → move/strafe in the player's frame
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    input.move = (dir.x * fx + dir.z * fz) * speed;
    input.strafe = (dir.x * rx + dir.z * rz) * speed;
    return input;
  };

  /** menu screens: returns true when the bot "clicks to play" */
  bot.menu = (state, dt) => {
    bot.menuT += dt;
    if (bot.menuT < bot.menuWait) return false;
    bot.menuT = 0;
    return state === 'title';
  };

  return bot;
}
