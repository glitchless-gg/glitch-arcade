// Builds the castle's meshes from rooms.js: one THREE.Group per room (only the current room, and the
// one you came from during a transition, are visible), plus lights, torches, lava, spikes, statues,
// relics, movers and decor. Shared geometry and materials per area: nothing here grows at runtime.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOMS, AREAS } from './rooms.js';
import { brickTexture, flagstoneTexture, lavaTexture, glowSprite } from './textures.js';
import { createRng } from './rng.js';

const TILE = 2; // world units per brick-texture repeat
const Z_FRONT = 1.6;
const Z_BACK = -2.6;
const LIGHT_POOL = 6;

// ─────────────────────────────────────────────────────────────── helpers

/** BoxGeometry whose UVs are in world units (so bricks line up across blocks) */
function boxGeo(w, h, d, x0 = 0, y0 = 0, tile = TILE) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: +x, -x, +y, -y, +z, -z  →  [u span, v span, u offset, v offset]
  const faces = [
    [d, h, 0, y0],
    [d, h, 0, y0],
    [w, d, x0, 0],
    [w, d, x0, 0],
    [w, h, x0, y0],
    [w, h, x0, y0],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faces[f][0] + faces[f][2]) / tile, (uv.getY(k) * faces[f][1] + faces[f][3]) / tile);
    }
  }
  return g;
}

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

// ─────────────────────────────────────────────────────────────── per-area materials

const matCache = {};
function areaMats(areaId) {
  if (matCache[areaId]) return matCache[areaId];
  const a = AREAS[areaId];
  const seed = { catacombs: 1, foundry: 2, keep: 3 }[areaId];
  const stoneCol = new THREE.Color(a.stone);
  const topCol = stoneCol.clone().offsetHSL(0, -0.04, 0.08);
  const wallCol = stoneCol.clone().offsetHSL(0, -0.02, -0.1);
  const side = std(0xffffff, { map: brickTexture(a.stone, a.dark, { seed, moss: areaId === 'catacombs' ? '#6f8a6a' : null }), roughness: 0.92 });
  const top = std(0xffffff, { map: flagstoneTexture(topCol.getHex(), a.dark, seed + 10), roughness: 0.8 });
  const wall = std(0xffffff, { map: brickTexture(wallCol.getHex(), a.dark, { rows: 5, cols: 2, seed: seed + 20 }), roughness: 0.95 });
  const back = std(0xffffff, { map: brickTexture(a.back, new THREE.Color(a.back).offsetHSL(0, 0, -0.06).getHex(), { rows: 6, cols: 3, seed: seed + 30, jitter: 0.04 }), roughness: 1 });
  const trim = std(a.trim, { roughness: 0.7 });
  const pillar = std(0xffffff, { map: brickTexture(new THREE.Color(a.stone).offsetHSL(0, -0.05, -0.04).getHex(), a.dark, { rows: 2, cols: 1, seed: seed + 40, jitter: 0.03 }), roughness: 0.95 });
  const iron = std(0x2a2a33, { roughness: 0.5, metalness: 0.6 });
  const spikes = std(areaId === 'keep' ? 0xc9bde6 : 0xb9c2d0, { roughness: 0.3, metalness: 0.75 });
  matCache[areaId] = { side, top, wall, back, trim, pillar, iron, spikes, area: a };
  return matCache[areaId];
}

const SHARED = {
  wood: std(0x6b4a2f, { roughness: 0.9 }),
  bone: std(0xe6dcc4, { roughness: 0.8 }),
  pale: std(0xc9ccd6, { roughness: 0.75 }),
  gold: std(0xf1b84a, { roughness: 0.35, metalness: 0.8, emissive: 0x6b3d00, emissiveIntensity: 0.4 }),
  cloth: std(0xe2672b, { roughness: 0.8, emissive: 0x6a1d00, emissiveIntensity: 0.4, side: THREE.DoubleSide }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }),
};

// ─────────────────────────────────────────────────────────────── pieces

function blockMesh(s, m) {
  const isWall = s.kind === 'wall';
  const z0 = isWall ? Z_BACK : -Z_FRONT;
  const d = Z_FRONT - z0;
  const geo = boxGeo(s.w, s.h, d, s.x, s.y - s.h);
  const mat = isWall ? m.wall : m.side;
  const out = mesh(geo, [mat, mat, isWall ? m.wall : m.top, mat, mat, mat]);
  out.position.set(s.x + s.w / 2, s.y - s.h / 2, z0 + d / 2);
  return out;
}

function ledgeMesh(s, m) {
  const g = new THREE.Group();
  const plank = mesh(boxGeo(s.w, 0.3, 2.4, s.x, s.y - 0.3, 1.2), SHARED.wood);
  plank.position.set(s.x + s.w / 2, s.y - 0.15, -0.6);
  g.add(plank);
  // iron brackets under the plank
  for (const fx of [0.4, s.w - 0.4]) {
    const br = mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), m.iron);
    br.position.set(s.x + fx, s.y - 0.6, -1.6);
    br.rotation.z = fx < 1 ? 0.5 : -0.5;
    g.add(br);
  }
  return g;
}

const CONE = new THREE.ConeGeometry(0.16, 0.75, 6);
function spikesMesh(h, m) {
  const parts = [];
  const rows = [-1.0, -0.2, 0.6, 1.3];
  rows.forEach((z, ri) => {
    for (let x = h.x0 + 0.2 + (ri % 2) * 0.2; x <= h.x1 - 0.15; x += 0.4) {
      const c = CONE.clone();
      if (h.dir < 0) c.rotateX(Math.PI);
      c.translate(x, h.base + h.dir * 0.375, z);
      parts.push(c);
    }
  });
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return mesh(geo, m.spikes, { receive: false });
}

const lavaTex = lavaTexture();
const lavaMat = new THREE.MeshStandardMaterial({ color: 0x3a0a00, emissive: 0xffffff, emissiveMap: lavaTex, emissiveIntensity: 1.5, roughness: 0.6 });
function lavaMesh(h) {
  const w = h.x1 - h.x0;
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, 1.4, 3.2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 3), uv.getY(i));
  const body = mesh(geo, lavaMat, { cast: false });
  body.position.set(h.x0 + w / 2, h.surface - 0.7, 0);
  g.add(body);
  for (let x = h.x0 + 0.8; x < h.x1; x += 2) {
    const s = glowSprite(0xff6a1a, 3.2, 0.32);
    s.position.set(x, h.surface + 0.4, 1.0);
    g.add(s);
  }
  return g;
}

function torchMesh(x, y, m) {
  const g = new THREE.Group();
  const bracket = mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), m.iron, { cast: false });
  bracket.position.set(0, -0.3, 0.05);
  const cup = mesh(new THREE.CylinderGeometry(0.2, 0.11, 0.2, 8), m.iron, { cast: false });
  cup.position.set(0, 0.02, 0.12);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.48, 8), SHARED.flame);
  flame.position.set(0, 0.34, 0.12);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 8), SHARED.flameCore);
  core.position.set(0, 0.27, 0.16);
  const glow = glowSprite(m.area.light, 2.8, 0.55);
  glow.position.set(0, 0.38, 0.3);
  g.add(bracket, cup, flame, core, glow);
  g.position.set(x, y, Z_BACK + 0.3);
  return { group: g, flame, core, glow, x, y, phase: Math.random() * 10 };
}

function saveStatueMesh(x, y, m) {
  const g = new THREE.Group();
  const plinth = mesh(new THREE.BoxGeometry(1.6, 0.4, 1.4), m.trim);
  plinth.position.y = 0.2;
  const step = mesh(new THREE.BoxGeometry(1.15, 0.3, 1.05), SHARED.pale);
  step.position.y = 0.55;
  const body = mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.1, 10), SHARED.pale);
  body.position.y = 1.25;
  const head = mesh(new THREE.SphereGeometry(0.24, 12, 10), SHARED.pale);
  head.position.y = 2.0;
  const hood = mesh(new THREE.ConeGeometry(0.27, 0.5, 10), SHARED.pale);
  hood.position.set(0, 2.18, -0.04);
  const blade = mesh(new THREE.BoxGeometry(0.09, 1.25, 0.05), SHARED.pale);
  blade.position.set(0, 1.15, 0.5);
  const guard = mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), SHARED.pale);
  guard.position.set(0, 1.7, 0.5);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x9fe6ff, emissive: 0x3ec7ff, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.1 });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), gemMat);
  gem.position.y = 2.85;
  const glow = glowSprite(0x6fd6ff, 2.4, 0.18);
  glow.position.set(0, 2.85, 0.3);
  g.add(plinth, step, body, head, hood, blade, guard, gem, glow);
  g.position.set(x, y, -1.0);
  return { group: g, gem, glow, gemMat, active: false, pulse: 0 };
}

function relicMesh(p, m) {
  const g = new THREE.Group();
  const ped = mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.9, 10), m.trim);
  ped.position.y = 0.45;
  const cap = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), SHARED.gold);
  cap.position.y = 0.96;
  g.add(ped, cap);
  const item = new THREE.Group();
  if (p.ability === 'dash') {
    const cloak = mesh(new THREE.ConeGeometry(0.42, 0.95, 5, 1, true), SHARED.cloth);
    cloak.rotation.z = 0.15;
    const clasp = mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14), SHARED.gold);
    clasp.position.y = 0.42;
    item.add(cloak, clasp);
  } else {
    for (const side of [-1, 1]) {
      const shaft = mesh(new THREE.BoxGeometry(0.2, 0.42, 0.24), SHARED.gold);
      shaft.position.set(side * 0.17, 0.08, 0);
      const foot = mesh(new THREE.BoxGeometry(0.2, 0.14, 0.42), SHARED.gold);
      foot.position.set(side * 0.17, -0.12, 0.1);
      const wing = mesh(new THREE.ConeGeometry(0.12, 0.42, 3), SHARED.pale);
      wing.rotation.z = side * 1.1;
      wing.position.set(side * 0.38, 0.2, -0.05);
      item.add(shaft, foot, wing);
    }
  }
  item.position.y = 1.85;
  const halo = glowSprite(p.ability === 'dash' ? 0xff8a3d : 0xffd36b, 2.6, 0.7);
  halo.position.set(0, 1.85, 0.2);
  g.add(item, halo);
  g.position.set(p.x, p.y, -0.6);
  return { group: g, item, halo, taken: false };
}

// ─────────────────────────────────────────────────────────────── decor

function decorate(room, group, m, rng) {
  const b = room.bounds;
  const floorY = b.y0 + 1.5;
  // back-wall pillars every ~6.5 units (rhythm + depth)
  for (let x = b.x0 + 3.2; x < b.x1 - 2; x += 6.5) {
    const h = b.y1 - b.y0;
    const p = mesh(boxGeo(0.9, h, 0.5, x - 0.45, b.y0, 1.6), m.pillar, { cast: false });
    p.position.set(x, (b.y0 + b.y1) / 2, Z_BACK + 0.25);
    group.add(p);
    for (const cy of [b.y1 - 1.4, b.y0 + 1.9]) {
      const cap = mesh(new THREE.BoxGeometry(1.25, 0.3, 0.7), m.pillar, { cast: false });
      cap.position.set(x, cy, Z_BACK + 0.35);
      group.add(cap);
    }
  }
  for (const tag of room.decor || []) {
    if (tag === 'portcullis') {
      for (let i = 0; i < 6; i++) {
        const bar = mesh(new THREE.BoxGeometry(0.1, 4.6, 0.1), m.iron, { cast: false });
        bar.position.set(1.6 + i * 0.5, floorY + 2.3, Z_BACK + 0.4);
        group.add(bar);
      }
      for (let j = 0; j < 4; j++) {
        const rail = mesh(new THREE.BoxGeometry(2.8, 0.1, 0.1), m.iron, { cast: false });
        rail.position.set(2.85, floorY + 0.6 + j * 1.2, Z_BACK + 0.45);
        group.add(rail);
      }
    } else if (tag === 'coffins') {
      for (const x of [9.4, 20]) {
        const c = mesh(new THREE.BoxGeometry(2.0, 0.8, 0.9), SHARED.pale);
        c.position.set(x, floorY + 0.4, -2.0);
        const lid = mesh(new THREE.BoxGeometry(2.1, 0.18, 1.0), m.trim);
        lid.position.set(x, floorY + 0.88, -2.0);
        group.add(c, lid);
      }
    } else if (tag === 'skulls') {
      // bone piles along the back wall: a few skulls (with dark eye sockets) on heaps of bones
      const skull = new THREE.SphereGeometry(0.17, 8, 6);
      const socket = new THREE.SphereGeometry(0.045, 5, 4);
      const boneGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 5);
      const dark = std(0x1a1712, { roughness: 1 });
      for (const px of [27.5, 34.8, 40.2, 48.6]) {
        for (let i = 0; i < 6; i++) {
          const bn = mesh(boneGeo, SHARED.bone, { cast: false });
          bn.position.set(px + rng.range(-0.6, 0.6), floorY + 0.06 + rng.range(0, 0.15), -2.05 + rng.range(-0.2, 0.2));
          bn.rotation.set(rng.range(0, 3), rng.range(0, 3), Math.PI / 2 + rng.range(-0.4, 0.4));
          group.add(bn);
        }
        for (let i = 0; i < 3; i++) {
          const sk = mesh(skull, SHARED.bone, { cast: false });
          const sx = px + (i - 1) * 0.38;
          const sy = floorY + 0.2 + (i === 1 ? 0.22 : 0);
          sk.position.set(sx, sy, -1.9);
          group.add(sk);
          for (const dx of [-0.06, 0.06]) {
            const e = new THREE.Mesh(socket, dark);
            e.position.set(sx + dx, sy + 0.02, -1.74);
            group.add(e);
          }
        }
      }
    } else if (tag === 'chains') {
      const link = new THREE.TorusGeometry(0.12, 0.035, 5, 10);
      for (const cx of [57.5, 62.5]) {
        for (let y = b.y1 - 1.2; y > b.y1 - 9; y -= 0.2) {
          const l = mesh(link, m.iron, { cast: false });
          l.position.set(cx + (cx < 60 ? 0.6 : -0.6), y, -2.0);
          l.rotation.y = (Math.round(y * 5) % 2) * (Math.PI / 2);
          group.add(l);
        }
      }
    } else if (tag === 'furnace') {
      const mouthMat = new THREE.MeshBasicMaterial({ color: 0xff7a26 });
      const frame = mesh(boxGeo(6.4, 6.2, 0.6, 38, floorY + 1.1, 1.6), m.wall, { cast: false });
      frame.position.set(41.2, floorY + 4.2, Z_BACK + 0.3);
      const hood = mesh(new THREE.BoxGeometry(7, 0.5, 0.9), m.iron, { cast: false });
      hood.position.set(41.2, floorY + 7.3, Z_BACK + 0.5);
      const flue = mesh(boxGeo(2.2, 6, 0.5, 40.1, floorY + 7.5, 1.6), m.wall, { cast: false });
      flue.position.set(41.2, floorY + 10.5, Z_BACK + 0.25);
      group.add(hood, flue);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24, 0, Math.PI), mouthMat);
      mouth.position.set(41.2, floorY + 2.7, Z_BACK + 0.62);
      const mouthBox = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), mouthMat);
      mouthBox.position.set(41.2, floorY + 1.9, Z_BACK + 0.62);
      const glow = glowSprite(0xff6a1a, 9, 0.45);
      glow.position.set(41.2, floorY + 2.6, Z_BACK + 1.2);
      group.add(frame, mouth, mouthBox, glow);
      room._furnaceGlow = glow;
    } else if (tag === 'gears') {
      const gears = [];
      const gearGeo = gearGeometry(2.2, 14);
      const gearMat = std(0x6a4426, { roughness: 0.45, metalness: 0.7 });
      for (const [x, y, s, dir] of [
        [9, -21.2, 1, 1],
        [14.8, -23.6, 0.7, -1],
        [24.5, -21.4, 1.2, -1],
      ]) {
        const gm = mesh(gearGeo, gearMat, { cast: false });
        gm.scale.setScalar(s);
        gm.position.set(x, y, Z_BACK + 0.35);
        group.add(gm);
        gears.push({ mesh: gm, speed: (0.25 / s) * dir });
      }
      room._gears = gears;
    } else if (tag === 'shrine') {
      const p = room.pickup;
      const arch = mesh(new THREE.TorusGeometry(2.4, 0.3, 6, 24, Math.PI), m.trim, { cast: false });
      arch.position.set(p.x, floorY + 3.4, Z_BACK + 0.4);
      const l = mesh(new THREE.BoxGeometry(0.6, 3.4, 0.6), m.trim, { cast: false });
      l.position.set(p.x - 2.4, floorY + 1.7, Z_BACK + 0.4);
      const r = l.clone();
      r.position.x = p.x + 2.4;
      group.add(arch, l, r);
      for (const dx of [-1.6, -1.1, 1.1, 1.6]) {
        const candle = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35 + Math.abs(dx) * 0.1, 6), SHARED.bone, { cast: false });
        candle.position.set(p.x + dx, floorY + 0.2, -1.7);
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), SHARED.flame);
        f.position.set(p.x + dx, floorY + 0.48 + Math.abs(dx) * 0.05, -1.7);
        group.add(candle, f);
      }
    } else if (tag === 'bridge') {
      // broken bridge stubs hanging into the gap
      for (const [x, rot] of [
        [14.4, -0.7],
        [20.6, 0.6],
      ]) {
        const plank = mesh(new THREE.BoxGeometry(1.8, 0.22, 2.2), SHARED.wood);
        plank.position.set(x, -15.6, -0.2);
        plank.rotation.z = rot;
        group.add(plank);
      }
      const rope = new THREE.CylinderGeometry(0.03, 0.03, 3.4, 4);
      for (const x of [15, 20]) {
        const r1 = mesh(rope, SHARED.wood, { cast: false });
        r1.position.set(x, -14.4, -1.3);
        r1.rotation.z = x < 17 ? 0.6 : -0.6;
        group.add(r1);
      }
    } else if (tag === 'banners') {
      const bannerMat = std(0x5a2d8c, { side: THREE.DoubleSide, emissive: 0x1a0830, roughness: 0.9 });
      for (const x of [71, 83, 91]) {
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.4, 1, 4), bannerMat);
        ban.position.set(x, 16.8, Z_BACK + 0.55);
        const rod = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), SHARED.gold, { cast: false });
        rod.rotation.z = Math.PI / 2;
        rod.position.set(x, 18.55, Z_BACK + 0.55);
        group.add(ban, rod);
      }
    } else if (tag === 'throne') {
      const seat = mesh(new THREE.BoxGeometry(2.0, 1.0, 1.3), m.trim, { cast: false });
      seat.position.set(119.2, floorY + 0.5, -2.0);
      const back = mesh(new THREE.BoxGeometry(2.0, 3.0, 0.4), m.trim, { cast: false });
      back.position.set(119.2, floorY + 1.9, -2.45);
      const crest = mesh(new THREE.OctahedronGeometry(0.35), SHARED.gold, { cast: false });
      crest.position.set(119.2, floorY + 3.75, -2.4);
      group.add(seat, back, crest);
      const bannerMat = std(0x5a2d8c, { side: THREE.DoubleSide, emissive: 0x1a0830, roughness: 0.9 });
      for (const x of [104, 112, 120]) {
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4, 1, 4), bannerMat);
        ban.position.set(x, 16.2, Z_BACK + 0.55);
        group.add(ban);
      }
    }
  }
}

function gearGeometry(r, teeth) {
  const parts = [new THREE.CylinderGeometry(r, r, 0.3, 28).rotateX(Math.PI / 2)];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = new THREE.BoxGeometry(0.45, 0.5, 0.3);
    t.rotateZ(a);
    t.translate(Math.cos(a + Math.PI / 2) * (r + 0.2), Math.sin(a + Math.PI / 2) * (r + 0.2), 0);
    parts.push(t);
  }
  const hub = new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.45, 12).rotateX(Math.PI / 2);
  parts.push(hub);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

// ─────────────────────────────────────────────────────────────── movers

function moverMesh(mv) {
  const m = areaMats('foundry');
  const g = new THREE.Group();
  if (mv.kind === 'lift') {
    const plate = mesh(new THREE.BoxGeometry(mv.w, mv.h, 2.6), m.iron);
    plate.position.set(mv.w / 2, -mv.h / 2, 0);
    const trim = mesh(new THREE.BoxGeometry(mv.w + 0.1, 0.08, 2.7), SHARED.gold, { cast: false });
    trim.position.set(mv.w / 2, -0.02, 0);
    g.add(plate, trim);
    const chainGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
    chainGeo.translate(0, 0.5, 0);
    const chains = [];
    for (const cx of [0.25, mv.w - 0.25]) {
      const c = mesh(chainGeo, m.iron, { cast: false });
      c.position.set(cx, 0, -1.1);
      g.add(c);
      chains.push(c);
    }
    g.userData.chains = chains;
  } else {
    const plate = mesh(new THREE.BoxGeometry(mv.w, mv.h, 2.4), m.iron);
    plate.position.set(mv.w / 2, -mv.h / 2, 0);
    const rim = mesh(new THREE.BoxGeometry(mv.w + 0.1, 0.1, 2.5), SHARED.gold, { cast: false });
    rim.position.set(mv.w / 2, -0.04, 0);
    const cog = mesh(gearGeometry(0.75, 10), m.trim, { cast: false });
    cog.position.set(mv.w / 2, -0.75, -1.35);
    g.add(plate, rim, cog);
    g.userData.cog = cog;
  }
  return g;
}

// ─────────────────────────────────────────────────────────────── environment + world

export function createWorld(scene) {
  scene.background = new THREE.Color(AREAS.catacombs.fog);
  scene.fog = new THREE.Fog(AREAS.catacombs.fog, 22, 42);

  const hemi = new THREE.HemisphereLight(0xb8c8ff, 0x1a1410, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const pool = [];
  for (let i = 0; i < LIGHT_POOL; i++) {
    const l = new THREE.PointLight(0xffaa66, 0, 13, 1.6);
    scene.add(l);
    pool.push(l);
  }

  const rooms = new Map();
  for (const room of ROOMS) {
    const m = areaMats(room.area);
    const rng = createRng(room.id.length * 97 + room.bounds.x0 * 13);
    const group = new THREE.Group();
    group.name = `room:${room.id}`;
    const b = room.bounds;
    // back wall
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const backGeo = new THREE.PlaneGeometry(bw, bh);
    const uv = backGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * bw + b.x0) / 3, (uv.getY(i) * bh + b.y0) / 3);
    const back = mesh(backGeo, m.back, { cast: false });
    back.position.set(b.x0 + bw / 2, b.y0 + bh / 2, Z_BACK);
    group.add(back);
    for (const s of room.solids) group.add(s.oneWay ? ledgeMesh(s, m) : blockMesh(s, m));
    for (const h of room.hazards) group.add(h.kind === 'lava' ? lavaMesh(h) : spikesMesh(h, m));
    const torches = (room.torches || []).map(([x, y]) => {
      const t = torchMesh(x, y, m);
      group.add(t.group);
      return t;
    });
    const statue = room.save ? saveStatueMesh(room.save.x, room.save.y, m) : null;
    if (statue) group.add(statue.group);
    const relic = room.pickup ? relicMesh(room.pickup, m) : null;
    if (relic) group.add(relic.group);
    decorate(room, group, m, rng);
    group.visible = false;
    scene.add(group);
    const lamps = torches.map((t) => ({ x: t.x, y: t.y + 0.5, z: Z_BACK + 1.2, color: m.area.light, intensity: 26 }));
    for (const h of room.hazards) if (h.kind === 'lava') lamps.push({ x: (h.x0 + h.x1) / 2, y: h.surface + 1.2, z: 0.5, color: 0xff6a1a, intensity: 30 });
    rooms.set(room.id, { room, group, torches, statue, relic, lamps });
  }

  const movers = new Map();
  for (const room of ROOMS) {
    for (const mv of room.movers || []) {
      const g = moverMesh(mv);
      scene.add(g);
      movers.set(mv.id, g);
    }
  }

  // arena portcullis
  const keep = areaMats('keep');
  const gate = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const bar = mesh(new THREE.BoxGeometry(0.12, 12.5, 0.12), keep.iron);
    bar.position.set(0.35, 0, -1.2 + i * 0.6);
    gate.add(bar);
  }
  for (let j = 0; j < 6; j++) {
    const rail = mesh(new THREE.BoxGeometry(0.16, 0.14, 2.8), keep.iron);
    rail.position.set(0.35, -5.5 + j * 2.2, 0);
    gate.add(rail);
  }
  gate.position.set(100.3, 8 + 6.25 + 12.5, 0); // starts raised (hidden in the ceiling)
  rooms.get('warden_hall').group.add(gate);
  let gateTarget = 8 + 6.25 + 12.5;

  let current = null;
  let currentArea = null;

  const world = {
    rooms,
    movers,
    hemi,
    key,
    /** show exactly these rooms */
    show(ids) {
      for (const [id, r] of rooms) r.group.visible = ids.includes(id);
    },
    showAll() {
      for (const r of rooms.values()) r.group.visible = true;
    },
    /** point the torch light pool at a room and switch the area mood */
    focus(roomId) {
      current = rooms.get(roomId);
      const lamps = current.lamps;
      pool.forEach((l, i) => {
        const lamp = lamps[i];
        if (lamp) {
          l.position.set(lamp.x, lamp.y, lamp.z);
          l.color.setHex(lamp.color);
          l.intensity = lamp.intensity;
          l.userData.base = lamp.intensity;
        } else {
          l.intensity = 0;
          l.userData.base = 0;
        }
      });
      const area = current.room.area;
      if (area !== currentArea) {
        currentArea = area;
        const a = AREAS[area];
        scene.background.setHex(a.fog);
        scene.fog.color.setHex(a.fog);
        hemi.color.setHex(area === 'foundry' ? 0xffc39a : area === 'keep' ? 0xd2b8ff : 0xb8c8ff);
        hemi.groundColor.setHex(a.dark);
      }
    },
    /** key light + shadow frustum follow the camera */
    follow(x, y) {
      key.position.set(x - 7, y + 14, 16);
      key.target.position.set(x, y, 0);
    },
    setStatue(roomId, active) {
      const s = rooms.get(roomId)?.statue;
      if (!s) return;
      s.active = active;
      if (active) s.pulse = 1;
    },
    takeRelic(roomId) {
      const r = rooms.get(roomId)?.relic;
      if (r) {
        r.taken = true;
        r.item.visible = false;
        r.halo.visible = false;
      }
    },
    resetRelics() {
      for (const r of rooms.values()) {
        if (r.relic) {
          r.relic.taken = false;
          r.relic.item.visible = true;
          r.relic.halo.visible = true;
        }
        if (r.statue) r.statue.active = false;
      }
    },
    setGate(closed) {
      gateTarget = closed ? 8 + 6.25 : 8 + 6.25 + 12.5;
    },
    animate(dt, t, playMovers) {
      for (const mv of playMovers) {
        const g = movers.get(mv.id);
        if (!g) continue;
        g.position.set(mv.x, mv.y, 0);
        if (g.userData.cog) g.userData.cog.rotation.z = -mv.x * 0.9;
        if (g.userData.chains) for (const c of g.userData.chains) c.scale.y = Math.max(0.1, -2.5 - mv.y);
      }
      gate.position.y += (gateTarget - gate.position.y) * (1 - Math.exp(-(gateTarget < gate.position.y ? 14 : 3) * dt));
      lavaTex.offset.x = (t * 0.05) % 1;
      lavaTex.offset.y = Math.sin(t * 0.4) * 0.05;
      for (const r of rooms.values()) {
        if (!r.group.visible) continue;
        for (const tch of r.torches) {
          const f = 1 + Math.sin(t * 13 + tch.phase) * 0.08 + Math.sin(t * 23.7 + tch.phase * 2) * 0.06;
          tch.flame.scale.set(1, f, 1);
          tch.core.scale.set(1, 2 - f, 1);
          tch.glow.material.opacity = 0.45 + (f - 1) * 1.2;
        }
        if (r.statue) {
          const s = r.statue;
          s.pulse = Math.max(0, s.pulse - dt * 1.5);
          const target = s.active ? 2.2 + Math.sin(t * 3) * 0.4 : 0.35;
          s.gemMat.emissiveIntensity += (target + s.pulse * 4 - s.gemMat.emissiveIntensity) * Math.min(1, dt * 6);
          s.glow.material.opacity = s.active ? 0.6 + s.pulse * 0.4 : 0.18;
          s.gem.rotation.y += dt * (s.active ? 1.6 : 0.4);
          s.gem.position.y = 2.85 + Math.sin(t * 2) * 0.06;
        }
        if (r.relic && !r.relic.taken) {
          r.relic.item.rotation.y += dt * 1.4;
          r.relic.item.position.y = 1.85 + Math.sin(t * 2.2) * 0.12;
          r.relic.halo.material.opacity = 0.55 + Math.sin(t * 3) * 0.15;
        }
        if (r.room._gears) for (const g of r.room._gears) g.mesh.rotation.z += g.speed * dt;
        if (r.room._furnaceGlow) r.room._furnaceGlow.material.opacity = 0.4 + Math.sin(t * 2.3) * 0.08 + Math.sin(t * 7.1) * 0.04;
      }
      for (const l of pool) if (l.userData.base) l.intensity = l.userData.base * (0.9 + Math.sin(t * 11 + l.position.x) * 0.06 + Math.sin(t * 17.3 + l.position.y) * 0.04);
    },
  };
  return world;
}
