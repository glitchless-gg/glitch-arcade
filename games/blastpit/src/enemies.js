// Enemies: grunt (red, chases and punches), gunner (orange, keeps its distance and lobs glowing orbs) and
// swarmer (small purple, fast, comes in numbers). Simple steering around cover, melee and orb attacks.
import * as THREE from 'three';
import { resolveCircle, lineOfSight, pointSolid } from './collide.js';
import { PLAYER } from './player.js';

export const ENEMY_TYPES = {
  grunt: { hp: 60, speed: 4.4, radius: 0.42, height: 1.8, reach: 1.5, dmg: 10, cd: 0.8 },
  gunner: { hp: 80, speed: 3.0, radius: 0.46, height: 1.95, keepMin: 10, keepMax: 14, orbDmg: 12, orbSpeed: 11, fireCd: 1.6, windup: 0.4 },
  swarmer: { hp: 20, speed: 6.2, radius: 0.3, height: 0.8, reach: 0.95, dmg: 6, cd: 0.6 },
};

const ORB_RADIUS = 0.2;
const ORB_LIFE = 4;

let nextId = 1;

export function createEnemies(scene, rng) {
  // shared geometry + materials
  const geo = {
    gruntBody: new THREE.CapsuleGeometry(0.42, 0.9, 6, 14),
    gunnerBody: new THREE.CapsuleGeometry(0.46, 1.0, 6, 14),
    swarmerBody: new THREE.CapsuleGeometry(0.29, 0.16, 6, 12),
    visor: new THREE.BoxGeometry(0.52, 0.13, 0.2),
    pad: new THREE.BoxGeometry(0.3, 0.2, 0.42),
    cannon: new THREE.CylinderGeometry(0.11, 0.13, 0.75, 12),
    cannonTip: new THREE.SphereGeometry(0.12, 12, 8),
    eye: new THREE.SphereGeometry(0.065, 8, 6),
    spike: new THREE.ConeGeometry(0.07, 0.24, 6),
    orb: new THREE.SphereGeometry(ORB_RADIUS, 16, 10),
    orbHalo: new THREE.SphereGeometry(ORB_RADIUS * 1.9, 16, 10),
  };
  const mat = {
    grunt: new THREE.MeshStandardMaterial({ color: 0xe8344a, roughness: 0.42, metalness: 0.15, emissive: 0x6a0a1c }),
    gunner: new THREE.MeshStandardMaterial({ color: 0xff8a26, roughness: 0.42, metalness: 0.15, emissive: 0x6a2a00 }),
    swarmer: new THREE.MeshStandardMaterial({ color: 0x9a4dff, roughness: 0.35, metalness: 0.2, emissive: 0x3c1078 }),
    armor: new THREE.MeshStandardMaterial({ color: 0x3a3f4e, roughness: 0.5, metalness: 0.35 }),
    gruntVisor: new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
    gunnerVisor: new THREE.MeshBasicMaterial({ color: 0x2de2e6 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xf6d8ff }),
    orb: new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    orbHalo: new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  function base(type, x, z) {
    const def = ENEMY_TYPES[type];
    return {
      id: nextId++,
      type,
      def,
      x,
      z,
      vx: 0,
      vz: 0,
      hp: def.hp,
      attackCd: 0.3,
      fireCd: rng.range(0.8, 1.6),
      windup: 0,
      strafeDir: rng.chance(0.5) ? 1 : -1,
      strafeT: rng.range(1.2, 2.6),
      detourX: 0,
      detourZ: 0,
      detourT: 0,
      stuckT: 0,
      lastX: x,
      lastZ: z,
      spawnT: 0,
      hitT: 0,
      lunge: 0,
      walk: rng.range(0, 6),
      jitter: rng.range(0, 6),
      mesh: null,
    };
  }

  function addPart(group, geometry, material, x, y, z, cast = false) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = cast;
    group.add(m);
    return m;
  }

  function spawnGrunt(x, z) {
    const e = base('grunt', x, z);
    const g = new THREE.Group();
    g.name = 'grunt';
    e.body = addPart(g, geo.gruntBody, mat.grunt, 0, 0.9, 0, true);
    addPart(g, geo.visor, mat.gruntVisor, 0, 1.42, 0.33);
    addPart(g, geo.pad, mat.armor, -0.44, 1.18, 0, true);
    addPart(g, geo.pad, mat.armor, 0.44, 1.18, 0, true);
    e.mesh = g;
    return e;
  }

  function spawnGunner(x, z) {
    const e = base('gunner', x, z);
    const g = new THREE.Group();
    g.name = 'gunner';
    e.body = addPart(g, geo.gunnerBody, mat.gunner, 0, 0.98, 0, true);
    addPart(g, geo.visor, mat.gunnerVisor, 0, 1.55, 0.36);
    const cannon = addPart(g, geo.cannon, mat.armor, 0.5, 1.15, 0.2, true);
    cannon.rotation.x = Math.PI / 2;
    e.tip = addPart(g, geo.cannonTip, mat.orb, 0.5, 1.15, 0.6);
    e.tip.scale.setScalar(0.4);
    e.mesh = g;
    return e;
  }

  function spawnSwarmer(x, z) {
    const e = base('swarmer', x, z);
    const g = new THREE.Group();
    g.name = 'swarmer';
    // its own material so each one can flash and tint on its own
    // GLITCHLESS-DEMO: swarm spawn stutter (1/2): one material per swarmer instead of the shared one
    e.material = mat.swarmer.clone();
    e.body = addPart(g, geo.swarmerBody, e.material, 0, 0.45, 0, true);
    addPart(g, geo.eye, mat.eye, -0.11, 0.55, 0.24);
    addPart(g, geo.eye, mat.eye, 0.11, 0.55, 0.24);
    for (const [sx, sz] of [
      [0, -0.05],
      [-0.14, -0.1],
      [0.14, -0.1],
    ]) {
      const s = addPart(g, geo.spike, e.material, sx, 0.84, sz);
      s.rotation.x = -0.35;
    }
    // GLITCHLESS-DEMO: swarm spawn stutter (2/2): real lights for the glowing eyes and a purple underglow.
    // Every swarmer adds three PointLights to the scene, so 30 at once takes the light count from 8 to 98:
    // three.js recompiles every material's shader for the new count (and again each time dead ones are
    // cleared away), and every lit pixel now loops over 95 point lights for the rest of the round.
    e.lights = [
      [-0.11, 0.58, 0.3, 0.9, 4],
      [0.11, 0.58, 0.3, 0.9, 4],
      [0, 0.12, 0, 1.6, 3.2],
    ].map(([x, y, z, intensity, distance]) => {
      const l = new THREE.PointLight(0xc04bff, intensity, distance, 1.6);
      l.position.set(x, y, z);
      l.userData.base = intensity;
      g.add(l);
      return l;
    });
    e.mesh = g;
    return e;
  }

  const SPAWNERS = { grunt: spawnGrunt, gunner: spawnGunner, swarmer: spawnSwarmer };

  /** Create an enemy of a type at (x, z) and add it to the scene. */
  function spawn(type, x, z) {
    const e = SPAWNERS[type](x, z);
    e.mesh.position.set(x, 0, z);
    e.mesh.scale.setScalar(0.01);
    scene.add(e.mesh);
    return e;
  }

  /** Remove an enemy's mesh for good (after its death animation). */
  function dispose(e) {
    scene.remove(e.mesh);
    if (e.material) e.material.dispose();
  }

  // ── AI ---------------------------------------------------------------------------------------

  function blockedAt(x, z, r, boxes) {
    for (const b of boxes) {
      if (b.kind === 'wall' && Math.abs(x) < 19.2 && Math.abs(z) < 19.2) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return Math.abs(x) > 19.4 || Math.abs(z) > 19.4;
  }

  /** Steer toward (tx, tz) at `speed` (negative = away), going around cover. */
  function steer(e, tx, tz, speed, dt, boxes, sideways = 0) {
    let dx = tx - e.x;
    let dz = tz - e.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    if (speed < 0) {
      dx = -dx;
      dz = -dz;
      speed = -speed;
    }
    if (sideways) {
      // strafe: mostly perpendicular, a little toward the goal direction
      const px = -dz * sideways;
      const pz = dx * sideways;
      dx = px * 0.9 + dx * 0.1;
      dz = pz * 0.9 + dz * 0.1;
    }
    if (e.detourT > 0) {
      e.detourT -= dt;
      dx = e.detourX;
      dz = e.detourZ;
    } else {
      const r = e.def.radius + 0.05;
      if (blockedAt(e.x + dx * 1.3, e.z + dz * 1.3, r, boxes)) {
        // go around: pick the side that is open, prefer the one that keeps us closest to the goal
        const sides = [
          [-dz, dx],
          [dz, -dx],
        ];
        sides.sort((a, b) => Math.hypot(tx - (e.x + a[0]), tz - (e.z + a[1])) - Math.hypot(tx - (e.x + b[0]), tz - (e.z + b[1])));
        const open = sides.find(([sx, sz]) => !blockedAt(e.x + sx * 1.3, e.z + sz * 1.3, r, boxes)) || sides[0];
        e.detourX = open[0] * 0.8 + dx * 0.2;
        e.detourZ = open[1] * 0.8 + dz * 0.2;
        e.detourT = 0.45;
        dx = e.detourX;
        dz = e.detourZ;
      }
    }
    const k = Math.min(1, dt * 9);
    e.vx += (dx * speed - e.vx) * k;
    e.vz += (dz * speed - e.vz) * k;
  }

  function stopMoving(e, dt) {
    const k = Math.min(1, dt * 10);
    e.vx -= e.vx * k;
    e.vz -= e.vz * k;
  }

  /**
   * One fixed step for one enemy. ctx = { player, boxes, dt, eye, damagePlayer(dmg, cause), fireOrb(e, target) }
   */
  function step(e, ctx) {
    const { player, boxes, dt } = ctx;
    const def = e.def;
    if (e.spawnT < 0.3) {
      e.spawnT += dt;
      return; // still materializing
    }
    if (e.hitT > 0) e.hitT -= dt;
    if (e.lunge > 0) e.lunge = Math.max(0, e.lunge - dt * 4);
    e.attackCd -= dt;
    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const dist = Math.hypot(dx, dz);

    if (e.type === 'gunner') {
      const from = { x: e.x, y: 1.4, z: e.z };
      const sees = lineOfSight(from, ctx.eye, boxes);
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeDir = -e.strafeDir;
        e.strafeT = rng.range(1.4, 3.0);
      }
      if (!sees || dist > def.keepMax) steer(e, player.x, player.z, def.speed, dt, boxes);
      else if (dist < def.keepMin) steer(e, player.x, player.z, -def.speed, dt, boxes);
      else steer(e, player.x, player.z, def.speed * 0.6, dt, boxes, e.strafeDir);
      // fire: wind up (the cannon glows), then lob an orb at where the player is now
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          e.fireCd = def.fireCd + rng.range(-0.3, 0.4);
          if (sees) {
            // lead the target a little: aim where the player will be when the orb gets there
            const t = (dist / def.orbSpeed) * 0.6;
            ctx.fireOrb(e, { x: ctx.eye.x + player.vx * t, y: ctx.eye.y, z: ctx.eye.z + player.vz * t });
          }
        }
      } else {
        e.fireCd -= dt;
        if (e.fireCd <= 0 && sees && dist < 26) e.windup = def.windup;
      }
    } else {
      // melee: chase, stop at arm's length, hit on a cooldown
      const reach = def.reach;
      const heightOk = player.y < 1.2;
      if (dist > reach * 0.8) {
        let tx = player.x;
        let tz = player.z;
        if (e.type === 'swarmer' && dist > 2.5) {
          // zig-zag a little so a swarm doesn't arrive as a single line
          e.jitter += dt * 3.1;
          const s = Math.sin(e.jitter) * 0.6;
          tx += -dz / dist * s * Math.min(dist, 4);
          tz += dx / dist * s * Math.min(dist, 4);
        }
        // grunts charge the last few metres
        const charge = e.type === 'grunt' && dist < 4 ? 1.45 : 1;
        steer(e, tx, tz, def.speed * charge, dt, boxes);
      } else stopMoving(e, dt);
      if (dist < reach && heightOk && e.attackCd <= 0) {
        e.attackCd = def.cd;
        e.lunge = 1;
        ctx.damagePlayer(def.dmg, e.type);
      } else if (dist >= reach && e.attackCd < 0.2) e.attackCd = 0.2; // a beat before the first hit
    }

    e.x += e.vx * dt;
    e.z += e.vz * dt;
    resolveCircle(e, def.radius, 0, boxes);

    // unstick: if we barely moved for a while, take a random sidestep
    e.stuckT += dt;
    if (e.stuckT > 0.8) {
      const moved = Math.hypot(e.x - e.lastX, e.z - e.lastZ);
      if (moved < 0.35 && Math.hypot(e.vx, e.vz) > 0.5 && dist > 2) {
        const a = rng.range(0, Math.PI * 2);
        e.detourX = Math.cos(a);
        e.detourZ = Math.sin(a);
        e.detourT = 0.6;
      }
      e.stuckT = 0;
      e.lastX = e.x;
      e.lastZ = e.z;
    }
  }

  /** Keep enemies from overlapping each other and the player (pushes both). */
  function separate(enemies, player) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        const r = a.def.radius + b.def.radius;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (r - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
      if (player.y < a.def.height) {
        const r = a.def.radius + PLAYER.RADIUS;
        const dx = player.x - a.x;
        const dz = player.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          a.x -= (dx / d) * push * 0.6;
          a.z -= (dz / d) * push * 0.6;
          player.x += (dx / d) * push * 0.4;
          player.z += (dz / d) * push * 0.4;
        }
      }
    }
  }

  /** Visuals: face the player, walk bob, materialize, hit flash, lunge, wind-up glow. */
  function animate(e, dt, clock, player) {
    const m = e.mesh;
    m.position.set(e.x, 0, e.z);
    const face = Math.atan2(player.x - e.x, player.z - e.z);
    let dr = face - m.rotation.y;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    m.rotation.y += dr * Math.min(1, dt * 10);
    const speed = Math.hypot(e.vx, e.vz);
    e.walk += dt * speed * (e.type === 'swarmer' ? 4.5 : 2.6);
    const s = Math.min(1, e.spawnT / 0.3);
    const squash = e.hitT > 0 ? 1 + e.hitT * 1.4 : 1;
    m.scale.set(s * squash, s / squash, s * squash);
    m.position.y = Math.abs(Math.sin(e.walk)) * (e.type === 'swarmer' ? 0.12 : 0.06);
    m.rotation.x = Math.min(0.25, speed * 0.03) + e.lunge * 0.35;
    if (e.tip) {
      const w = e.windup > 0 ? 1 - e.windup / e.def.windup : 0;
      e.tip.scale.setScalar(0.4 + w * 1.1 + (w > 0 ? Math.sin(clock * 40) * 0.08 : 0));
    }
    if (e.material) e.material.emissive.setHex(e.hitT > 0 ? 0xffffff : 0x3c1078);
    if (e.lights) for (const l of e.lights) l.intensity = l.userData.base * (0.85 + Math.sin(clock * 9 + e.id) * 0.15);
  }

  /** Death animation: tip over and slump onto the floor; the body stays (dimming) until it is cleared away. */
  function animateDeath(e, dt) {
    e.deadT = (e.deadT || 0) + dt;
    const k = Math.min(1, e.deadT / 0.4);
    e.mesh.rotation.x = -k * 1.35;
    e.mesh.position.y = -k * (e.type === 'swarmer' ? 0.15 : 0.35);
    e.mesh.scale.set(1 + k * 0.15, 1 - k * 0.45, 1 + k * 0.15);
    if (e.lights) for (const l of e.lights) l.intensity = l.userData.base * Math.max(0.15, 1 - e.deadT * 0.6);
    return e.deadT;
  }

  // ── orbs (the gunner's slow projectiles) ------------------------------------------------------

  const orbs = [];
  const orbPool = [];

  function fireOrb(e, target) {
    const tipWorld = new THREE.Vector3();
    e.tip.getWorldPosition(tipWorld);
    const dx = target.x - tipWorld.x;
    const dy = target.y - 0.25 - tipWorld.y;
    const dz = target.z - tipWorld.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const spread = 0.04;
    const v = e.def.orbSpeed;
    let mesh = orbPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(geo.orb, mat.orb);
      mesh.add(new THREE.Mesh(geo.orbHalo, mat.orbHalo));
      mesh.name = 'orb';
    }
    mesh.position.copy(tipWorld);
    scene.add(mesh);
    orbs.push({
      x: tipWorld.x,
      y: tipWorld.y,
      z: tipWorld.z,
      vx: (dx / d + rng.gauss() * spread) * v,
      vy: (dy / d + rng.gauss() * spread * 0.5) * v,
      vz: (dz / d + rng.gauss() * spread) * v,
      life: ORB_LIFE,
      dmg: e.def.orbDmg,
      mesh,
    });
  }

  function killOrb(i) {
    const o = orbs[i];
    scene.remove(o.mesh);
    orbPool.push(o.mesh);
    orbs.splice(i, 1);
  }

  /** Move orbs; returns a list of { x, y, z, hitPlayer } pops for fx. */
  function stepOrbs(dt, player, boxes, damagePlayer) {
    const pops = [];
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      o.life -= dt;
      // hit the player? (a vertical capsule from the feet to the head)
      const py = Math.max(player.y + PLAYER.RADIUS, Math.min(player.y + PLAYER.HEIGHT - PLAYER.RADIUS, o.y));
      const hit = Math.hypot(o.x - player.x, o.y - py, o.z - player.z) < PLAYER.RADIUS + ORB_RADIUS;
      if (hit) {
        damagePlayer(o.dmg, 'gunner');
        pops.push({ x: o.x, y: o.y, z: o.z, hitPlayer: true });
        killOrb(i);
      } else if (o.life <= 0 || pointSolid(o, boxes) || Math.abs(o.x) > 40 || Math.abs(o.z) > 40) {
        pops.push({ x: o.x, y: Math.max(0.05, o.y), z: o.z, hitPlayer: false });
        killOrb(i);
      } else {
        o.mesh.position.set(o.x, o.y, o.z);
        o.mesh.scale.setScalar(1 + Math.sin(o.life * 30) * 0.08);
      }
    }
    return pops;
  }

  function clearOrbs() {
    for (let i = orbs.length - 1; i >= 0; i--) killOrb(i);
  }

  return { spawn, spawnSwarmer: (x, z) => spawn('swarmer', x, z), dispose, step, separate, animate, animateDeath, orbs, fireOrb, stepOrbs, clearOrbs };
}
