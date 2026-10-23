// Weapons: hitscan pistol, 8-pellet shotgun and a rocket launcher with splash damage (which also hurts
// the player). Firing, rockets in flight and explosions live here; kills go back through ctx.killEnemy.
import * as THREE from 'three';
import { rayWorld, rayCylinder, pointSolid } from './collide.js';
import { PLAYER, viewDir } from './player.js';

export const WEAPONS = {
  pistol: { slot: 1, name: 'Pistol', cd: 0.25, dmg: 25, ammo: null },
  shotgun: { slot: 2, name: 'Shotgun', cd: 0.9, dmg: 12, pellets: 8, spread: 0.07, ammo: 'shells' },
  launcher: { slot: 3, name: 'Launcher', cd: 1.1, dmg: 100, radius: 3.5, speed: 24, ammo: 'rockets' },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'launcher'];
export const AMMO_START = { shells: 24, rockets: 8 };
export const AMMO_MAX = { shells: 40, rockets: 12 };
const SELF_DAMAGE = 1;
const RANGE = 90;

/**
 * ctx = { game, scene, fx, vm, sfx, hud, rng, gd, killEnemy(index, weapon), damagePlayer(dmg, cause) }
 */
export function createWeapons(ctx) {
  const { game, scene, fx, vm, sfx, hud, rng, gd } = ctx;
  const dir = { x: 0, y: 0, z: 0 };

  function eye() {
    const p = game.player;
    return { x: p.x, y: p.y + PLAYER.EYE, z: p.z };
  }

  /** World position of the gun's muzzle (right of and below the eye), for tracers and rockets. */
  function muzzle(forward = 0.75) {
    const p = game.player;
    const e = eye();
    viewDir(p.yaw, p.pitch, dir);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    return { x: e.x + dir.x * forward + rx * 0.2, y: e.y + dir.y * forward - 0.17, z: e.z + dir.z * forward + rz * 0.2 };
  }

  /** The aim direction, nudged by up to `spread` radians (gaussian-ish). */
  function aim(spread = 0) {
    const p = game.player;
    const d = viewDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
    if (!spread) return d;
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    // up = right x forward
    const ux = -rz * d.y;
    const uy = rz * d.x - rx * d.z;
    const uz = rx * d.y;
    const a = rng.gauss() * spread * 0.6;
    const b = rng.gauss() * spread * 0.6;
    d.x += rx * a + ux * b;
    d.y += uy * b;
    d.z += rz * a + uz * b;
    const l = Math.hypot(d.x, d.y, d.z);
    d.x /= l;
    d.y /= l;
    d.z /= l;
    return d;
  }

  /** Nearest enemy along a ray (stopped by walls/cover/floor). Returns { index, t }; index -1 = no enemy. */
  function trace(o, d, range = RANGE) {
    const wall = rayWorld(o, d, range, game.boxes);
    let best = wall;
    let index = -1;
    for (let i = 0; i < game.enemies.length; i++) {
      const e = game.enemies[i];
      const t = rayCylinder(o, d, e.x, e.z, e.def.radius, 0, e.def.height);
      if (t < best) {
        best = t;
        index = i;
      }
    }
    return { index, t: best };
  }

  function at(o, d, t) {
    return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  }

  function onHit(e, point, weapon) {
    e.hitT = 0.12;
    fx.sparks(point.x, point.y, point.z, e.type === 'swarmer' ? 0xc070ff : e.type === 'gunner' ? 0xffa040 : 0xff5050, 6, 3.5, 0.35);
  }

  // ── pistol: one hitscan bullet
  function firePistol() {
    const w = WEAPONS.pistol;
    gd.track('shot', { weapon: 'pistol' });
    const o = eye();
    const d = aim(0.006);
    const hit = trace(o, d);
    const end = at(o, d, hit.t);
    fx.tracer(muzzle(), end);
    if (hit.index < 0) {
      fx.sparks(end.x, end.y, end.z, 0xfff0b0, 4, 2.5, 0.25);
      return;
    }
    const e = game.enemies[hit.index];
    e.hp -= w.dmg;
    onHit(e, end, 'pistol');
    game.stats.hits++;
    gd.track('hit', { weapon: 'pistol', enemy: e.type });
    hud.hitmark(false);
    sfx.hit();
    if (e.hp <= 0) ctx.killEnemy(hit.index, 'pistol');
  }

  // ── shotgun: 8 pellets
  function fireShotgun() {
    const w = WEAPONS.shotgun;
    game.ammo.shells--;
    gd.track('shot', { weapon: 'shotgun' });
    const o = eye();
    const from = muzzle(0.9);
    // first, work out which enemy each pellet hits (an index into game.enemies, -1 = none)
    const targets = [];
    const points = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = aim(w.spread);
      const hit = trace(o, d, 60);
      const end = at(o, d, hit.t);
      fx.tracer(from, end, 0xffd890, 0.016);
      if (hit.index < 0) fx.sparks(end.x, end.y, end.z, 0xfff0b0, 2, 2, 0.2);
      targets.push(hit.index);
      points.push(end);
    }
    // then apply the damage, pellet by pellet
    let first = null;
    for (let i = 0; i < targets.length; i++) {
      const idx = targets[i];
      if (idx < 0) continue;
      // GLITCHLESS-DEMO: shotgun stale index — the pellet targets are indices into game.enemies worked
      // out before any damage, but a pellet that kills splices the array (killEnemy). Every later pellet
      // aimed at that slot or after it now points one enemy further on, and past the end of the array
      // enemies[idx] is undefined: "Cannot read properties of undefined (reading 'hp')". The throw skips
      // the rest of this blast, including its `hit` event, so the shotgun's hit rate reads low.
      const e = game.enemies[idx];
      e.hp -= w.dmg;
      onHit(e, points[i], 'shotgun');
      if (!first) first = e.type;
      if (e.hp <= 0) ctx.killEnemy(idx, 'shotgun');
    }
    if (first) {
      game.stats.hits++;
      gd.track('hit', { weapon: 'shotgun', enemy: first });
      hud.hitmark(false);
      sfx.hit();
    }
  }

  // ── launcher: a rocket in flight; damage happens when it explodes
  const rockets = [];
  const rocketPool = [];
  const rocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10);
  rocketGeo.rotateX(Math.PI / 2);
  const rocketMat = new THREE.MeshStandardMaterial({ color: 0x3c4434, roughness: 0.5, metalness: 0.5 });
  const tailGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xffc060 });

  function fireLauncher() {
    const w = WEAPONS.launcher;
    game.ammo.rockets--;
    gd.track('shot', { weapon: 'launcher' });
    const o = eye();
    const d = aim(0);
    // fly from the muzzle toward whatever the crosshair is on
    const hit = trace(o, d);
    const target = at(o, d, Math.max(2, hit.t));
    const from = muzzle(0.8);
    let vx = target.x - from.x;
    let vy = target.y - from.y;
    let vz = target.z - from.z;
    const l = Math.hypot(vx, vy, vz) || 1;
    vx /= l;
    vy /= l;
    vz /= l;
    let mesh = rocketPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(rocketGeo, rocketMat);
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.position.z = 0.26;
      mesh.add(tail);
      mesh.name = 'rocket';
    }
    mesh.position.set(from.x, from.y, from.z);
    mesh.lookAt(from.x + vx, from.y + vy, from.z + vz);
    mesh.rotateY(Math.PI);
    scene.add(mesh);
    rockets.push({ x: from.x, y: from.y, z: from.z, vx: vx * w.speed, vy: vy * w.speed, vz: vz * w.speed, life: 4, trail: 0, mesh });
  }

  function explode(r) {
    const w = WEAPONS.launcher;
    const R = w.radius;
    fx.explosion(r.x, r.y, r.z, R);
    sfx.boom();
    ctx.shake(0.5);
    // everyone in the blast, nearest first
    const victims = [];
    for (const e of game.enemies) {
      const hd = Math.max(0, Math.hypot(e.x - r.x, e.z - r.z) - e.def.radius);
      const vd = r.y < 0 ? -r.y : r.y > e.def.height ? r.y - e.def.height : 0;
      const d = Math.hypot(hd, vd);
      if (d < R) victims.push({ e, d });
    }
    victims.sort((a, b) => a.d - b.d);
    for (const { e, d } of victims) {
      e.hp -= w.dmg * (1 - d / R);
      e.hitT = 0.15;
    }
    if (victims.length) {
      game.stats.hits++;
      gd.track('hit', { weapon: 'launcher', enemy: victims[0].e.type });
      hud.hitmark(false);
    }
    // remove the dead back to front so the indices stay valid
    for (let i = game.enemies.length - 1; i >= 0; i--) if (game.enemies[i].hp <= 0) ctx.killEnemy(i, 'launcher');
    // splash hurts the shooter too
    const p = game.player;
    const hd = Math.max(0, Math.hypot(p.x - r.x, p.z - r.z) - PLAYER.RADIUS);
    const vd = r.y < p.y ? p.y - r.y : r.y > p.y + PLAYER.HEIGHT ? r.y - p.y - PLAYER.HEIGHT : 0;
    const d = Math.hypot(hd, vd);
    if (d < R && game.state === 'playing') ctx.damagePlayer(Math.round(w.dmg * (1 - d / R) * SELF_DAMAGE), 'own_rocket');
  }

  function removeRocket(i) {
    const r = rockets[i];
    scene.remove(r.mesh);
    rocketPool.push(r.mesh);
    rockets.splice(i, 1);
  }

  function stepRockets(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      const px = r.x;
      const py = r.y;
      const pz = r.z;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.life -= dt;
      let boom = false;
      for (const e of game.enemies) {
        if (r.y < 0 || r.y > e.def.height + 0.1) continue;
        if (Math.hypot(e.x - r.x, e.z - r.z) < e.def.radius + 0.12) {
          boom = true;
          break;
        }
      }
      if (!boom && pointSolid(r, game.boxes)) {
        // back up to the surface so the blast isn't inside the wall
        r.x = px;
        r.y = Math.max(0.05, py);
        r.z = pz;
        boom = true;
      }
      if (boom) {
        explode(r);
        removeRocket(i);
      } else if (r.life <= 0 || Math.abs(r.x) > 70 || Math.abs(r.z) > 70) {
        removeRocket(i);
      } else {
        r.mesh.position.set(r.x, r.y, r.z);
        r.trail -= dt;
        if (r.trail <= 0) {
          r.trail = 0.015;
          fx.sparks(r.x, r.y, r.z, 0xffa040, 2, 0.8, 0.25, 0);
        }
      }
    }
  }

  function clearRockets() {
    for (let i = rockets.length - 1; i >= 0; i--) removeRocket(i);
  }

  /** Pull the trigger with the current weapon (cooldowns and ammo are checked here). */
  function fire() {
    const name = game.weapon;
    const w = WEAPONS[name];
    if (game.cooldown > 0 || game.switchT > 0) return false;
    if (w.ammo && game.ammo[w.ammo] <= 0) {
      game.cooldown = 0.3;
      sfx.empty();
      hud.toast(`Out of ${w.ammo}`, 'amber', 900);
      return false;
    }
    game.cooldown = w.cd;
    game.stats.shots++;
    vm.fire(name === 'pistol' ? 0.6 : name === 'shotgun' ? 1.2 : 1.4);
    const m = muzzle(0.9);
    fx.muzzle(m.x, m.y, m.z, name === 'pistol' ? 0.6 : 1);
    sfx.shot(name);
    if (name === 'pistol') firePistol();
    else if (name === 'shotgun') fireShotgun();
    else fireLauncher();
    return true;
  }

  return { fire, stepRockets, clearRockets, rockets, trace, eye };
}
