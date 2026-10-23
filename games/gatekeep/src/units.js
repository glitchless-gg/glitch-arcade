// Tower and enemy models: simple shapes with shared geometries and materials (one set per type).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra });

export const TOWER_COLORS = { arrow: '#c8463d', cannon: '#3b4252', frost: '#5cc8f0' };

// ── towers ───────────────────────────────────────────────────────────────────────────────────

const T = {
  footGeo: new THREE.CylinderGeometry(0.4, 0.44, 0.16, 10),
  footMat: std(0xb8b0a3),
  ringGeo: new THREE.TorusGeometry(0.37, 0.035, 6, 20),
  ringMat: std(0xffc83d, { metalness: 0.4, roughness: 0.4, emissive: 0x3a2800 }),
  // arrow: a wooden lookout with a red roof and a crossbow
  postGeo: new THREE.CylinderGeometry(0.24, 0.3, 0.62, 8),
  woodMat: std(0x8b5a2b),
  deckGeo: new THREE.CylinderGeometry(0.34, 0.3, 0.1, 8),
  roofGeo: new THREE.ConeGeometry(0.4, 0.38, 8),
  roofMat: std(0xc8463d),
  bowGeo: new THREE.BoxGeometry(0.42, 0.05, 0.06),
  stockGeo: new THREE.BoxGeometry(0.06, 0.06, 0.34),
  darkWoodMat: std(0x5a3a1c),
  // cannon: a stone drum with a black barrel
  drumGeo: new THREE.CylinderGeometry(0.34, 0.38, 0.42, 8),
  drumMat: std(0x9aa0a6),
  barrelGeo: new THREE.CylinderGeometry(0.1, 0.13, 0.58, 12),
  barrelMat: std(0x2b2f3a, { metalness: 0.5, roughness: 0.45 }),
  hubGeo: new THREE.SphereGeometry(0.17, 12, 8),
  // frost: a pale plinth with a floating ice crystal
  plinthGeo: new THREE.CylinderGeometry(0.22, 0.32, 0.4, 6),
  plinthMat: std(0xdbe7f2),
  crystalGeo: new THREE.OctahedronGeometry(0.24, 0),
  crystalMat: std(0x8fe3ff, { emissive: 0x2a8fc0, emissiveIntensity: 0.6, roughness: 0.2, flatShading: true, transparent: true, opacity: 0.92 }),
  shardGeo: new THREE.OctahedronGeometry(0.07, 0),
};

export function createTower(type) {
  const g = new THREE.Group();
  g.name = `tower:${type}`;
  const foot = new THREE.Mesh(T.footGeo, T.footMat);
  foot.position.y = 0.08;
  g.add(foot);
  const parts = { group: g, type, head: null, rings: [], shards: [], t: Math.random() * 6, base: 1.15 };

  if (type === 'arrow') {
    const post = new THREE.Mesh(T.postGeo, T.woodMat);
    post.position.y = 0.47;
    const deck = new THREE.Mesh(T.deckGeo, T.darkWoodMat);
    deck.position.y = 0.82;
    const roof = new THREE.Mesh(T.roofGeo, T.roofMat);
    roof.position.y = 1.32;
    const head = new THREE.Group();
    head.position.y = 0.92;
    const bow = new THREE.Mesh(T.bowGeo, T.darkWoodMat);
    bow.position.z = 0.12;
    const stock = new THREE.Mesh(T.stockGeo, T.woodMat);
    head.add(bow, stock);
    g.add(post, deck, roof, head);
    parts.head = head;
  } else if (type === 'cannon') {
    const drum = new THREE.Mesh(T.drumGeo, T.drumMat);
    drum.position.y = 0.37;
    const head = new THREE.Group();
    head.position.y = 0.66;
    const hub = new THREE.Mesh(T.hubGeo, T.barrelMat);
    const barrel = new THREE.Mesh(T.barrelGeo, T.barrelMat);
    barrel.rotation.x = Math.PI / 2 - 0.45;
    barrel.position.set(0, 0.1, 0.2);
    head.add(hub, barrel);
    g.add(drum, head);
    parts.head = head;
    parts.barrel = barrel;
  } else {
    const plinth = new THREE.Mesh(T.plinthGeo, T.plinthMat);
    plinth.position.y = 0.36;
    const crystal = new THREE.Mesh(T.crystalGeo, T.crystalMat);
    crystal.position.y = 0.98;
    crystal.scale.set(1, 1.5, 1);
    g.add(plinth, crystal);
    parts.crystal = crystal;
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return parts;
}

/** Tier 2 and 3: gold bands on the foot, a slightly bigger tower, extra frost shards. */
export function setTowerTier(parts, tier) {
  const g = parts.group;
  while (parts.rings.length < tier - 1) {
    const ring = new THREE.Mesh(T.ringGeo, T.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2 + parts.rings.length * 0.1;
    ring.scale.setScalar(1 - parts.rings.length * 0.12);
    g.add(ring);
    parts.rings.push(ring);
  }
  if (parts.type === 'frost') {
    while (parts.shards.length < (tier - 1) * 2) {
      const s = new THREE.Mesh(T.shardGeo, T.crystalMat);
      g.add(s);
      parts.shards.push(s);
    }
  }
  g.scale.setScalar(parts.base * (1 + (tier - 1) * 0.09));
}

export function animateTower(parts, tower, dt) {
  parts.t += dt;
  parts.kick = Math.max(0, (parts.kick || 0) - dt * 6);
  if (parts.head) {
    // turn toward the last target (shortest way round)
    let diff = tower.aim - parts.head.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    parts.head.rotation.y += diff * Math.min(1, dt * 14);
  }
  if (parts.barrel) parts.barrel.position.z = 0.2 - parts.kick * 0.08;
  if (parts.crystal) {
    parts.crystal.position.y = 0.98 + Math.sin(parts.t * 2.2) * 0.06;
    parts.crystal.rotation.y += dt * (1.2 + parts.kick * 8);
    const s = 1 + parts.kick * 0.25;
    parts.crystal.scale.set(s, 1.5 * s, s);
    parts.shards.forEach((sh, i) => {
      const a = parts.t * 1.8 + (i / parts.shards.length) * Math.PI * 2;
      sh.position.set(Math.cos(a) * 0.36, 0.95 + Math.sin(a * 2) * 0.05, Math.sin(a) * 0.36);
      sh.rotation.y = a;
    });
  }
}

export function kickTower(parts) {
  parts.kick = 1;
}

// ── enemies ──────────────────────────────────────────────────────────────────────────────────
// Each enemy is one mesh: body, eyes and armor merged into a single vertex-coloured geometry.

function eyes(r, spread, y, z) {
  const a = new THREE.SphereGeometry(r, 10, 8);
  a.translate(-spread, y, z);
  const b = new THREE.SphereGeometry(r, 10, 8);
  b.translate(spread, y, z);
  return mergeGeometries([a, b]);
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const EYE = 0xffffff;
const PUPIL = 0x161320;

const E = {
  runner: {
    geo: mergeGeometries([paint(new THREE.SphereGeometry(0.2, 14, 10), 0xf2a33a), paint(eyes(0.065, 0.075, 0.07, 0.15), EYE), paint(eyes(0.035, 0.078, 0.07, 0.2), PUPIL)]),
    mat: std(0xffffff, { vertexColors: true }),
    y: 0.2,
    scale: [1, 1.1, 1.15],
  },
  grunt: {
    geo: mergeGeometries([paint(new THREE.BoxGeometry(0.42, 0.42, 0.38), 0xd2453c), paint(eyes(0.07, 0.09, 0.08, 0.19), EYE), paint(eyes(0.038, 0.092, 0.08, 0.245), PUPIL)]),
    mat: std(0xffffff, { vertexColors: true }),
    y: 0.24,
    scale: [1, 1, 1],
  },
  brute: {
    geo: mergeGeometries([
      paint(new THREE.BoxGeometry(0.62, 0.56, 0.54), 0x4b5563),
      paint(eyes(0.06, 0.12, 0.12, 0.27), EYE),
      paint(eyes(0.034, 0.122, 0.12, 0.315), PUPIL),
      paint(new THREE.CylinderGeometry(0.24, 0.34, 0.18, 8).translate(0, 0.32, 0), 0xb7c0cc),
      paint(new THREE.ConeGeometry(0.06, 0.24, 6).rotateZ(0.5).translate(-0.3, 0.42, 0), 0xf3ead2),
      paint(new THREE.ConeGeometry(0.06, 0.24, 6).rotateZ(-0.5).translate(0.3, 0.42, 0), 0xf3ead2),
    ]),
    mat: std(0xffffff, { vertexColors: true, metalness: 0.35, roughness: 0.45 }),
    y: 0.3,
    scale: [1, 1, 1],
  },
  swarmling: {
    geo: mergeGeometries([paint(new THREE.SphereGeometry(0.12, 10, 8), 0xb84ce0), paint(eyes(0.04, 0.045, 0.04, 0.09), EYE)]),
    mat: std(0xffffff, { vertexColors: true, roughness: 0.5 }),
    y: 0.12,
    scale: [1, 0.9, 1.1],
  },
};

const iceGeo = new THREE.RingGeometry(0.55, 1, 20);
const iceMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.55, depthWrite: false });
const ICE_SIZE = { runner: 0.3, grunt: 0.36, brute: 0.48, swarmling: 0.19 };

export function createEnemy(type) {
  const def = E[type];
  const g = new THREE.Group();
  g.name = `enemy:${type}`;
  const body = new THREE.Mesh(def.geo, def.mat);
  body.castShadow = type !== 'swarmling'; // too small to matter, and there are hundreds of them
  body.position.y = def.y;
  body.scale.set(...def.scale);
  const ice = new THREE.Mesh(iceGeo, iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = 0.03;
  ice.scale.setScalar(ICE_SIZE[type]);
  ice.visible = false;
  g.add(body, ice);
  g.scale.setScalar(1.2);
  return { group: g, body, ice, type, t: Math.random() * 10, baseY: def.y };
}

export function animateEnemy(parts, enemy, dt) {
  const speed = enemy.slowT > 0 ? enemy.slowMult : 1;
  parts.t += dt * speed;
  const g = parts.group;
  g.position.set(enemy.x, -0.04, enemy.z);
  g.rotation.y = Math.atan2(enemy.dx, enemy.dz);
  const b = parts.body;
  if (parts.type === 'runner') {
    b.position.y = parts.baseY + Math.abs(Math.sin(parts.t * 14)) * 0.14;
  } else if (parts.type === 'swarmling') {
    b.position.y = parts.baseY + Math.abs(Math.sin(parts.t * 18)) * 0.07;
  } else if (parts.type === 'grunt') {
    b.position.y = parts.baseY + Math.abs(Math.sin(parts.t * 9)) * 0.06;
    b.rotation.z = Math.sin(parts.t * 9) * 0.12;
  } else {
    b.position.y = parts.baseY + Math.abs(Math.sin(parts.t * 6)) * 0.04;
    b.rotation.z = Math.sin(parts.t * 6) * 0.07;
  }
  // frost: an icy ring and a shiver instead of a material swap (materials are shared)
  const cold = enemy.slowT > 0;
  parts.ice.visible = cold;
  b.position.x = cold ? Math.sin(parts.t * 60) * 0.015 : 0;
}
