// The hero, the enemies, loot and projectiles: built from simple shapes with shared geometries and materials.
// Each model faces +z; rotation.y = the sim's facing angle.
import * as THREE from 'three';
import { RARITY_COLOR } from './gear.js';

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 18, 12),
  sphereLo: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylHi: new THREE.CylinderGeometry(1, 1, 1, 18),
  cone: new THREE.ConeGeometry(1, 1, 12),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 8),
  torusHalf: new THREE.TorusGeometry(1, 0.06, 6, 20, Math.PI),
  ribs: new THREE.TorusGeometry(1, 0.13, 5, 14, Math.PI * 1.35),
  ring: new THREE.TorusGeometry(1, 0.18, 8, 24),
  disc: new THREE.CircleGeometry(1, 32),
  beam: new THREE.CylinderGeometry(0.16, 0.42, 1, 16, 1, true),
  coin: new THREE.CylinderGeometry(0.12, 0.12, 0.035, 12),
};
G.beam.translate(0, 0.5, 0);

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...o });

export const M = {
  cloak: std(0x35553f, { roughness: 0.9 }),
  hood: std(0x283f30, { roughness: 0.95 }),
  leather: std(0x5e3f29, { roughness: 0.85 }),
  skin: std(0xc89a78, { roughness: 0.7 }),
  shade: std(0x120f0e, { roughness: 1 }),
  steel: std(0xc3cad2, { metalness: 0.85, roughness: 0.32 }),
  gold: std(0xe0aa45, { metalness: 0.9, roughness: 0.3, emissive: 0x3a2200, emissiveIntensity: 0.4 }),
  bone: std(0xe9dfc6, { roughness: 0.8 }),
  boneDark: std(0x9d917a, { roughness: 0.85 }),
  rust: std(0x7d5034, { metalness: 0.5, roughness: 0.6 }),
  redEye: new THREE.MeshBasicMaterial({ color: 0xff3a22 }),
  emberEye: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
  archerHood: std(0x6c1d26, { roughness: 0.9 }),
  bowWood: std(0x6a4426, { roughness: 0.7 }),
  string: new THREE.MeshBasicMaterial({ color: 0xd8d0c0 }),
  slime: std(0x5bd774, { roughness: 0.25, metalness: 0, transparent: true, opacity: 0.82, emissive: 0x13461d, emissiveIntensity: 0.6 }),
  slimeCore: std(0x2a8a3e, { roughness: 0.4 }),
  white: std(0xf4f4f0, { roughness: 0.4 }),
  black: std(0x0b0b0d, { roughness: 0.3 }),
  ash: std(0x2b2727, { roughness: 0.95 }),
  ashDark: std(0x1a1717, { roughness: 1 }),
  ember: new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.6 }),
  emberSoft: new THREE.MeshStandardMaterial({ color: 0xff8a40, emissive: 0xff5a10, emissiveIntensity: 1.1, roughness: 0.6 }),
  potion: new THREE.MeshStandardMaterial({ color: 0xe8364a, emissive: 0x9a0f20, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.92 }),
  glass: std(0xcfe6ff, { roughness: 0.1, transparent: true, opacity: 0.35 }),
  arrowShaft: std(0x7a5a38),
  fletch: new THREE.MeshBasicMaterial({ color: 0xf0e6d0, side: THREE.DoubleSide }),
  bolt: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
};

function part(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

function pivot(x, y, z, parent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ─────────────────────────────────────────────────────────────── hero

export function createHero() {
  const root = new THREE.Group();
  root.name = 'hero';
  const body = pivot(0, 0, 0, root);
  const cloak = M.cloak.clone(); // its own, for the hurt flash
  const hood = M.hood.clone();
  const legL = pivot(0.13, 0.82, 0, body);
  const legR = pivot(-0.13, 0.82, 0, body);
  for (const leg of [legL, legR]) {
    part(G.capsule, M.leather, 0.1, 0.48, 0.1, 0, -0.36, 0, leg);
    part(G.box, M.shade, 0.16, 0.1, 0.26, 0, -0.78, 0.04, leg);
  }
  part(G.cyl, cloak, 0.27, 0.72, 0.25, 0, 1.15, 0, body).scale.set(0.27, 0.72, 0.24);
  const skirt = part(G.cone, cloak, 0.42, 0.62, 0.38, 0, 0.88, 0, body);
  skirt.rotation.x = Math.PI;
  skirt.position.y = 0.92;
  part(G.cyl, M.leather, 0.29, 0.07, 0.27, 0, 0.98, 0, body);
  part(G.box, M.gold, 0.08, 0.06, 0.03, 0, 0.98, 0.27, body);
  // cape and quiver on the back
  const cape = part(G.box, hood, 0.56, 0.95, 0.04, 0, 1.05, -0.26, body);
  cape.rotation.x = 0.12;
  const quiver = part(G.cyl, M.leather, 0.09, 0.62, 0.09, 0.14, 1.25, -0.3, body);
  quiver.rotation.z = -0.35;
  for (let i = 0; i < 3; i++) part(G.box, M.fletch, 0.05, 0.12, 0.01, 0.24 + i * 0.03, 1.6 + i * 0.01, -0.3 + (i - 1) * 0.04, body).rotation.z = -0.35;
  // head: a deep hood over a shadowed face
  const head = pivot(0, 1.62, 0, body);
  part(G.sphere, hood, 0.25, 0.27, 0.27, 0, 0.02, -0.02, head);
  const tip = part(G.cone, hood, 0.15, 0.32, 0.15, 0, 0.12, -0.2, head);
  tip.rotation.x = -1.1;
  part(G.sphere, M.shade, 0.17, 0.18, 0.12, 0, -0.01, 0.15, head);
  part(G.sphere, M.skin, 0.06, 0.05, 0.04, 0, -0.08, 0.23, head);
  for (const s of [-1, 1]) part(G.sphereLo, M.emberEye, 0.025, 0.02, 0.02, s * 0.065, 0.02, 0.26, head);
  // sword arm (the hero's right, -x) and buckler arm
  const armR = pivot(-0.34, 1.4, 0, body);
  armR.rotation.order = 'YXZ'; // raise forward first, then sweep sideways
  part(G.capsule, cloak, 0.08, 0.32, 0.08, 0, -0.26, 0, armR);
  const hand = pivot(0, -0.52, 0, armR);
  part(G.sphereLo, M.leather, 0.08, 0.08, 0.08, 0, 0, 0, hand);
  const sword = pivot(0, 0, 0, hand);
  sword.rotation.x = Math.PI * 0.62; // held forward and a little down
  part(G.cyl, M.leather, 0.03, 0.2, 0.03, 0, 0.02, 0, sword);
  part(G.box, M.gold, 0.32, 0.05, 0.07, 0, 0.13, 0, sword);
  const bladeMat = M.steel.clone();
  bladeMat.emissive = new THREE.Color(0x000000);
  const blade = part(G.box, bladeMat, 0.08, 0.95, 0.025, 0, 0.62, 0, sword);
  part(G.cone, bladeMat, 0.057, 0.14, 0.02, 0, 1.15, 0, sword);
  const armL = pivot(0.34, 1.4, 0, body);
  part(G.capsule, cloak, 0.08, 0.32, 0.08, 0, -0.26, 0, armL);
  const buckler = part(G.cylHi, M.rust, 0.2, 0.04, 0.2, 0.06, -0.42, 0.08, armL);
  buckler.rotation.z = Math.PI / 2;
  part(G.sphereLo, M.steel, 0.06, 0.06, 0.06, 0.09, -0.42, 0.08, armL);
  root.traverse((o) => o.isMesh && (o.castShadow = true));
  return { root, body, legL, legR, armR, armL, sword, blade, bladeMat, cloak, hood, head, cape, phase: 0, face: Math.PI, rarity: 'common' };
}

const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function animateHero(v, hr, dt, clock, { swing, dodge }) {
  v.root.position.set(hr.x, hr.y, hr.z);
  v.face = lerpAngle(v.face, hr.face, Math.min(1, dt * 18));
  v.root.rotation.y = v.face;
  const speed = Math.hypot(hr.vx, hr.vz);
  const moving = Math.min(1, speed / 5);
  v.phase += dt * (4 + speed * 1.6) * (speed > 0.3 ? 1 : 0.2);
  const s = Math.sin(v.phase);
  v.legL.rotation.x = s * 0.75 * moving;
  v.legR.rotation.x = -s * 0.75 * moving;
  v.body.position.y = Math.abs(Math.cos(v.phase)) * 0.05 * moving + Math.sin(clock * 2) * 0.008;
  v.armL.rotation.x = -s * 0.5 * moving - 0.15;
  v.cape.rotation.x = 0.12 + moving * 0.35 + Math.sin(clock * 3) * 0.03;
  // sword arm: swing across, or hang with a slight swing while walking
  if (hr.swingT > 0) {
    const p = 1 - hr.swingT / swing.anim;
    const e = 1 - Math.pow(1 - p, 3);
    v.armR.rotation.set(-1.45, -1.3 + e * 2.55, 0);
    v.sword.rotation.x = Math.PI; // the blade carries on from the arm
    v.body.rotation.y = -0.35 + e * 0.7;
  } else {
    v.armR.rotation.x += (s * 0.4 * moving + 0.35 - v.armR.rotation.x) * Math.min(1, dt * 12);
    v.armR.rotation.y += (0 - v.armR.rotation.y) * Math.min(1, dt * 12);
    v.armR.rotation.z = 0;
    v.sword.rotation.x += (Math.PI * 0.62 - v.sword.rotation.x) * Math.min(1, dt * 10);
    v.body.rotation.y *= Math.max(0, 1 - dt * 12);
  }
  // roll
  if (hr.dodgeT > 0) {
    // tumble forward around the middle of the body, tucked in and low
    const p = 1 - hr.dodgeT / dodge.time;
    const th = p * Math.PI * 2;
    const sc = 1 - Math.sin(p * Math.PI) * 0.25;
    const h = 0.85 - 0.35 * Math.sin(p * Math.PI);
    v.body.rotation.x = th;
    v.body.scale.setScalar(sc);
    v.body.position.set(0, h - sc * 0.85 * Math.cos(th), -sc * 0.85 * Math.sin(th));
  } else {
    v.body.rotation.x = 0;
    v.body.position.z = 0;
    v.body.scale.setScalar(1);
  }
  // hurt flash
  const hurt = Math.max(0, hr.hurtT) / 0.25;
  v.cloak.emissive.setRGB(hurt * 0.9, hurt * 0.1, hurt * 0.05);
  v.hood.emissive.setRGB(hurt * 0.6, 0, 0);
  // the blade glows in its rarity's colour
  const r = hr.gear.weapon?.rarity || 'common';
  if (r !== v.rarity) {
    v.rarity = r;
    v.bladeMat.emissive.set(r === 'common' ? 0x000000 : RARITY_COLOR[r]);
  }
  v.bladeMat.emissiveIntensity = r === 'common' ? 0 : 0.5 + Math.sin(clock * 4) * 0.2;
}

// ─────────────────────────────────────────────────────────────── enemies

function flashable(mat) {
  const m = mat.clone();
  m.emissive = m.emissive || new THREE.Color(0);
  m.userData.baseEmissive = m.emissive.clone();
  m.userData.baseIntensity = m.emissiveIntensity ?? 1;
  return m;
}

function createSkeleton(archer) {
  const root = new THREE.Group();
  const body = pivot(0, 0, 0, root);
  const bone = flashable(M.bone);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = pivot(sx * 0.11, 0.8, 0, body);
    part(G.cyl, bone, 0.045, 0.78, 0.045, 0, -0.39, 0, leg);
    part(G.box, M.boneDark, 0.1, 0.06, 0.2, 0, -0.78, 0.04, leg);
    legs.push(leg);
  }
  part(G.box, bone, 0.32, 0.12, 0.17, 0, 0.84, 0, body);
  part(G.cyl, M.boneDark, 0.045, 0.5, 0.045, 0, 1.1, -0.03, body);
  for (let i = 0; i < 3; i++) {
    const rib = part(G.ribs, bone, 0.19 - i * 0.015, 0.19 - i * 0.015, 0.19, 0, 1.3 - i * 0.11, 0, body);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.82);
  }
  const head = pivot(0, 1.52, 0, body);
  part(G.sphere, bone, 0.17, 0.17, 0.18, 0, 0.02, 0, head);
  part(G.box, bone, 0.18, 0.07, 0.15, 0, -0.12, 0.04, head);
  for (const sx of [-1, 1]) {
    part(G.sphereLo, M.shade, 0.05, 0.05, 0.03, sx * 0.065, 0.02, 0.15, head);
    part(G.sphereLo, M.redEye, 0.022, 0.022, 0.02, sx * 0.065, 0.02, 0.17, head);
  }
  if (archer) {
    const hood = part(G.cone, M.archerHood, 0.24, 0.42, 0.24, 0, 0.12, -0.03, head);
    hood.rotation.x = -0.25;
    part(G.box, M.archerHood, 0.42, 0.7, 0.05, 0, 1.12, -0.17, body).rotation.x = 0.1;
  }
  const armR = pivot(-0.24, 1.34, 0, body);
  part(G.cyl, bone, 0.04, 0.6, 0.04, 0, -0.3, 0, armR);
  const armL = pivot(0.24, 1.34, 0, body);
  part(G.cyl, bone, 0.04, 0.6, 0.04, 0, -0.3, 0, armL);
  let weapon;
  if (archer) {
    weapon = pivot(0, -0.6, 0.05, armL);
    const bow = part(G.torusHalf, M.bowWood, 0.48, 0.48, 0.48, 0, 0, 0, weapon);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    part(G.cyl, M.string, 0.006, 0.96, 0.006, 0, 0, 0, weapon);
  } else {
    weapon = pivot(0, -0.6, 0, armR);
    weapon.rotation.x = Math.PI / 2;
    part(G.box, M.rust, 0.07, 0.75, 0.025, 0, 0.42, 0, weapon);
    part(G.box, M.boneDark, 0.22, 0.04, 0.05, 0, 0.05, 0, weapon);
  }
  root.traverse((o) => o.isMesh && (o.castShadow = true));
  return { root, body, legs, armR, armL, head, weapon, flash: [bone], phase: Math.random() * 6 };
}

function createSlime(small) {
  const root = new THREE.Group();
  const body = pivot(0, 0, 0, root);
  const skin = flashable(M.slime);
  const blob = part(G.sphere, skin, 0.62, 0.5, 0.62, 0, 0.5, 0, body);
  blob.castShadow = true;
  part(G.sphereLo, M.slimeCore, 0.28, 0.22, 0.28, 0, 0.42, -0.05, body).castShadow = false;
  for (const sx of [-1, 1]) {
    part(G.sphereLo, M.white, 0.11, 0.12, 0.08, sx * 0.2, 0.7, 0.48, body);
    part(G.sphereLo, M.black, 0.055, 0.06, 0.04, sx * 0.2, 0.7, 0.55, body);
  }
  root.scale.setScalar(small ? 0.62 : 1);
  return { root, body, blob, flash: [skin], phase: Math.random() * 6, small };
}

function createAshLord() {
  const root = new THREE.Group();
  const body = pivot(0, 0, 0, root);
  const robe = flashable(M.ash);
  const r = part(G.cone, robe, 1.15, 2.3, 1.0, 0, 1.15, 0, body);
  r.receiveShadow = true;
  // ember seams down the robe
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const seam = part(G.box, M.ember, 0.05, 1.7, 0.05, Math.sin(a) * 0.62, 0.95, Math.cos(a) * 0.55, body);
    seam.rotation.set(Math.cos(a) * 0.42, 0, -Math.sin(a) * 0.42);
  }
  part(G.sphere, robe, 0.78, 0.82, 0.62, 0, 2.55, 0, body);
  const core = part(G.sphere, M.ember, 0.24, 0.24, 0.2, 0, 2.55, 0.48, body);
  for (const sx of [-1, 1]) {
    part(G.sphere, M.ashDark, 0.45, 0.38, 0.45, sx * 0.86, 2.95, 0, body);
    for (let k = 0; k < 3; k++) {
      const spike = part(G.cone, M.boneDark, 0.08, 0.42, 0.08, sx * (0.78 + k * 0.12), 3.32, (k - 1) * 0.18, body);
      spike.rotation.z = -sx * 0.3;
    }
  }
  const head = pivot(0, 3.45, 0.05, body);
  part(G.sphere, M.boneDark, 0.38, 0.4, 0.42, 0, 0, 0, head);
  part(G.box, M.boneDark, 0.36, 0.14, 0.3, 0, -0.27, 0.12, head);
  for (const sx of [-1, 1]) {
    part(G.sphereLo, M.emberEye, 0.07, 0.05, 0.04, sx * 0.14, 0.03, 0.38, head);
    const horn = part(G.cone, M.ashDark, 0.1, 0.75, 0.1, sx * 0.38, 0.38, -0.05, head);
    horn.rotation.z = -sx * 0.75;
    horn.rotation.x = -0.25;
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    part(G.cone, M.ember, 0.05, 0.22, 0.05, Math.sin(a) * 0.3, 0.42, Math.cos(a) * 0.3, head);
  }
  const armR = pivot(-0.95, 2.85, 0, body);
  part(G.cyl, M.ashDark, 0.15, 1.2, 0.15, 0, -0.6, 0, armR);
  const armL = pivot(0.95, 2.85, 0, body);
  part(G.cyl, M.ashDark, 0.15, 1.2, 0.15, 0, -0.6, 0, armL);
  const weapon = pivot(0, -1.2, 0, armR);
  weapon.rotation.x = Math.PI / 2;
  part(G.box, M.ashDark, 0.3, 2.6, 0.08, 0, 1.55, 0, weapon);
  part(G.box, M.ember, 0.06, 2.4, 0.1, 0.16, 1.6, 0, weapon);
  part(G.box, M.ember, 0.06, 2.4, 0.1, -0.16, 1.6, 0, weapon);
  part(G.box, M.boneDark, 0.8, 0.14, 0.16, 0, 0.2, 0, weapon);
  root.scale.setScalar(1.05);
  root.traverse((o) => o.isMesh && (o.castShadow = true));
  return { root, body, head, armR, armL, weapon, core, flash: [robe], phase: 0 };
}

export function createEnemyView(e) {
  let v;
  if (e.kind === 'skeleton') v = createSkeleton(false);
  else if (e.kind === 'archer') v = createSkeleton(true);
  else if (e.kind === 'slime') v = createSlime(e.small);
  else v = createAshLord();
  v.root.name = `enemy_${e.kind}`;
  v.kind = e.kind;
  v.face = e.face;
  v.dying = 0;
  return v;
}

export function animateEnemy(v, e, dt, clock) {
  // walking speed from how far it moved since the last frame (the view never writes to the sim)
  const moved = dt > 0 ? Math.hypot(e.x - v.root.position.x, e.z - v.root.position.z) / dt : 0;
  v.speed = (v.speed || 0) + (Math.min(moved, 12) - (v.speed || 0)) * Math.min(1, dt * 10);
  const speed = v.speed;
  v.root.position.set(e.x, e.y, e.z);
  v.face = lerpAngle(v.face, e.face, Math.min(1, dt * 14));
  v.root.rotation.y = v.face;
  for (const m of v.flash) {
    const f = e.flash > 0 ? 1 : 0;
    const big = v.kind === 'ash_lord';
    if (f) m.emissive.setRGB(1, big ? 0.45 : 0.8, big ? 0.2 : 0.65);
    else m.emissive.copy(m.userData.baseEmissive);
    m.emissiveIntensity = f ? (big ? 0.5 : 0.9) : m.userData.baseIntensity;
  }
  const burning = !!e.burn;
  const st = e.state;
  const wind = e.tele ? 1 - Math.max(0, e.tele.t) / e.tele.total : 0;
  if (v.kind === 'skeleton' || v.kind === 'archer') {
    v.phase += dt * (3 + speed * 2.2) * (speed > 0.2 ? 1 : 0);
    const s = Math.sin(v.phase) * Math.min(1, speed / 2.5);
    v.legs[0].rotation.x = s * 0.7;
    v.legs[1].rotation.x = -s * 0.7;
    v.body.position.y = Math.abs(Math.cos(v.phase)) * 0.04;
    v.head.rotation.z = Math.sin(clock * 2 + v.phase) * 0.06;
    if (v.kind === 'skeleton') {
      if (st === 'windup') v.armR.rotation.set(-0.4 - wind * 2.4, 0, 0);
      else if (st === 'recover') v.armR.rotation.x += (-0.2 - v.armR.rotation.x) * Math.min(1, dt * 6);
      else v.armR.rotation.set(-s * 0.4 - 0.2, 0, 0);
      v.armL.rotation.x = s * 0.4;
      if (st === 'recover' && e.t > e.def.recover - 0.12) v.armR.rotation.x = 0.6;
    } else {
      // archer: bow up, string arm pulls back while drawing
      const aiming = st === 'draw' ? 1 : 0;
      v.armL.rotation.set(-1.45 * Math.max(aiming, 0.25) - 0.1, 0, 0);
      v.armR.rotation.set(-1.4 * aiming + (aiming ? wind * 0.6 : 0.2), aiming ? 0.6 : 0, 0);
    }
  } else if (v.kind === 'slime') {
    v.phase = e.hop;
    let sy = 1;
    let sxz = 1;
    let lift = 0;
    if (st === 'windup') {
      sy = 1 - wind * 0.35;
      sxz = 1 + wind * 0.22;
    } else if (st === 'lunge') {
      sy = 0.9;
      sxz = 1.08;
      lift = 0.45;
    } else {
      const hop = Math.max(0, Math.sin(e.hop));
      lift = hop * 0.32 * (e.awake ? 1 : 0.2);
      sy = 1 + hop * 0.12 - (1 - hop) * 0.08;
      sxz = 1 / Math.sqrt(sy);
    }
    v.body.position.y = lift;
    v.body.scale.set(sxz, sy, sxz);
  } else if (v.kind === 'ash_lord') {
    v.phase += dt;
    const breathe = Math.sin(clock * 1.6) * 0.04;
    v.body.position.y = breathe;
    v.core.scale.setScalar(0.24 * (1 + (e.enraged ? 0.35 : 0.1) * Math.sin(clock * (e.enraged ? 9 : 4))));
    M.ember.emissiveIntensity = e.enraged ? 3.2 + Math.sin(clock * 10) : 2.2;
    let armR = -0.2;
    let armL = 0.1;
    let headUp = 0;
    if (st === 'roar') {
      armR = -1.6;
      armL = -1.6;
      headUp = -0.4;
    } else if (st === 'windup') {
      if (e.attack === 'cleave') armR = -0.6 - wind * 1.5;
      else if (e.attack === 'slam') {
        armR = -0.6 - wind * 2.6;
        armL = -0.6 - wind * 2.6;
      } else {
        armL = -1.4;
        armR = -1.4;
      }
    } else if (st === 'recover') {
      armR = e.attack === 'slam' ? -0.3 : 0.5;
      armL = e.attack === 'slam' ? -0.3 : 0.1;
    } else {
      armR = -0.2 + Math.sin(clock * 2) * 0.1;
    }
    v.armR.rotation.x += (armR - v.armR.rotation.x) * Math.min(1, dt * 10);
    v.armL.rotation.x += (armL - v.armL.rotation.x) * Math.min(1, dt * 10);
    v.head.rotation.x += (headUp - v.head.rotation.x) * Math.min(1, dt * 6);
  }
  v.burning = burning;
}

/** A death: the body crumples and sinks. Returns false when it's gone. */
export function animateDeath(v, dt) {
  v.dying += dt;
  const t = v.dying;
  if (v.kind === 'slime') {
    v.body.scale.set(1 + t * 2.2, Math.max(0.05, 1 - t * 3.5), 1 + t * 2.2);
    v.body.position.y = 0;
  } else {
    v.body.rotation.x = Math.min(1.5, t * 4);
    v.body.position.y = -Math.max(0, t - 0.35) * 1.4;
  }
  return t < (v.kind === 'ash_lord' ? 1.8 : 0.9);
}

// ─────────────────────────────────────────────────────────────── loot

const beamMats = {};
function beamMat(rarity) {
  if (!beamMats[rarity]) {
    beamMats[rarity] = new THREE.MeshBasicMaterial({ color: RARITY_COLOR[rarity], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }
  return beamMats[rarity];
}
const discMats = {};
function discMat(color) {
  if (!discMats[color]) discMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  return discMats[color];
}
const gearMats = {};
function gearMat(rarity) {
  if (!gearMats[rarity]) gearMats[rarity] = std(RARITY_COLOR[rarity], { metalness: 0.7, roughness: 0.35, emissive: RARITY_COLOR[rarity], emissiveIntensity: rarity === 'common' ? 0.05 : 0.35 });
  return gearMats[rarity];
}

const BEAM_HEIGHT = { common: 1.1, magic: 3, rare: 4.5, legendary: 9 };

export function createLootView(it) {
  const root = new THREE.Group();
  root.name = 'loot';
  const item = pivot(0, 0, 0, root);
  let beam = null;
  if (it.kind === 'gold') {
    for (let i = 0; i < 5; i++) part(G.coin, M.gold, 1, 1, 1, (i % 3) * 0.12 - 0.12, 0.03 + Math.floor(i / 3) * 0.04, (i % 2) * 0.12 - 0.06, item);
    part(G.disc, discMat('#ffcc55'), 0.4, 0.4, 0.4, 0, 0.02, 0, root).rotation.x = -Math.PI / 2;
  } else if (it.kind === 'potion') {
    part(G.sphere, M.potion, 0.16, 0.16, 0.16, 0, 0.2, 0, item);
    part(G.cyl, M.glass, 0.05, 0.14, 0.05, 0, 0.38, 0, item);
    part(G.cyl, M.leather, 0.06, 0.05, 0.06, 0, 0.47, 0, item);
    part(G.disc, discMat('#ff4a5a'), 0.38, 0.38, 0.38, 0, 0.02, 0, root).rotation.x = -Math.PI / 2;
  } else {
    const mat = gearMat(it.rarity);
    if (it.slot === 'weapon') {
      const s = pivot(0, 0.12, 0, item);
      s.rotation.z = Math.PI / 2;
      part(G.box, mat, 0.08, 0.9, 0.03, 0, 0.2, 0, s);
      part(G.box, M.gold, 0.28, 0.05, 0.07, 0, -0.27, 0, s);
      part(G.cyl, M.leather, 0.03, 0.2, 0.03, 0, -0.4, 0, s);
    } else if (it.slot === 'armor') {
      part(G.box, mat, 0.46, 0.42, 0.22, 0, 0.3, 0, item);
      for (const sx of [-1, 1]) part(G.sphere, mat, 0.13, 0.1, 0.13, sx * 0.26, 0.48, 0, item);
    } else {
      const ring = part(G.ring, mat, 0.17, 0.17, 0.17, 0, 0.3, 0, item);
      ring.rotation.x = 0.3;
      part(G.sphereLo, M.ember, 0.05, 0.05, 0.05, 0, 0.47, 0, item);
    }
    const h = BEAM_HEIGHT[it.rarity] || 1;
    beam = part(G.beam, beamMat(it.rarity), 1, h, 1, 0, 0, 0, root);
    beam.castShadow = false;
    const disc = part(G.disc, discMat(RARITY_COLOR[it.rarity]), 0.55, 0.55, 0.55, 0, 0.02, 0, root);
    disc.rotation.x = -Math.PI / 2;
    disc.castShadow = false;
    if (it.rarity === 'legendary') {
      const halo = part(G.ring, discMat(RARITY_COLOR.legendary), 0.9, 0.9, 0.9, 0, 0.05, 0, root);
      halo.rotation.x = -Math.PI / 2;
      halo.castShadow = false;
      root.userData.halo = halo;
    }
  }
  root.userData.item = item;
  root.userData.beam = beam;
  return root;
}

export function animateLoot(root, it, clock) {
  const pop = Math.min(1, it.t / 0.35);
  root.position.set(it.x, it.y + Math.sin(pop * Math.PI) * 0.9, it.z);
  root.scale.setScalar(0.3 + pop * 0.7);
  const item = root.userData.item;
  item.rotation.y = clock * 1.4 + it.id;
  item.position.y = it.kind === 'gear' ? 0.08 + Math.sin(clock * 3 + it.id) * 0.06 : 0;
  const beam = root.userData.beam;
  if (beam) beam.material.opacity = 0.26 + Math.sin(clock * 4 + it.id) * 0.08;
  const halo = root.userData.halo;
  if (halo) {
    halo.rotation.z = clock * 2;
    halo.scale.setScalar(0.8 + Math.sin(clock * 5) * 0.15);
  }
}

// ─────────────────────────────────────────────────────────────── projectiles

export function createProjectileView(p) {
  const root = new THREE.Group();
  root.name = 'projectile';
  if (p.kind === 'arrow') {
    const a = pivot(0, 0, 0, root);
    const shaft = part(G.cyl, M.arrowShaft, 0.025, 0.8, 0.025, 0, 0, 0, a);
    shaft.rotation.x = Math.PI / 2;
    const head = part(G.cone, M.steel, 0.05, 0.14, 0.05, 0, 0, 0.45, a);
    head.rotation.x = Math.PI / 2;
    for (const r of [0, Math.PI / 2]) {
      const f = part(G.box, M.fletch, 0.12, 0.005, 0.16, 0, 0, -0.34, a);
      f.rotation.z = r;
    }
    root.scale.setScalar(1.25);
  } else {
    part(G.sphere, M.bolt, 0.24, 0.24, 0.24, 0, 0, 0, root);
    part(G.sphere, discMat('#ff7a2a'), 0.5, 0.5, 0.5, 0, 0, 0, root).castShadow = false;
  }
  return root;
}
