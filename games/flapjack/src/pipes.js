// Pipe pairs: the meshes for the course in course.js (the gameplay never reads these; collisions use the
// course data). Each pipe pair is a column up from the ground, a column down from the sky, chunky caps
// with a lip and bolts, a shine stripe, and a little bit of biome scenery at its foot.
import * as THREE from 'three';
import { PIPE_W, pipeAt, mapBounds, MAP_PIPES, GROUND_Y } from './course.js';

const CAP_R = PIPE_W / 2;
const BODY_R = CAP_R * 0.9;
const CAP_H = 0.55;
const TOP_Y = 18; // the sky column goes up past the top of the screen
const FOOT_Y = -1.2; // the ground column starts under the ground strip
const BOLTS = 3; // per cap
const SPAWN_AHEAD = 8; // units past the right edge of the screen: pipes never pop in

export const PIPE_COLORS = {
  meadow: { body: 0x5ccf45, cap: 0x4cbd38, lip: 0x2f8f2a, shine: 0xb5f59a, bolt: 0x2a7a25, emissive: 0x000000 },
  canyon: { body: 0x2fb5a5, cap: 0x27a092, lip: 0x146b62, shine: 0x9ff3e6, bolt: 0x0f5a52, emissive: 0x000000 }, // copper-patina teal: it pops on the orange rock
  city: { body: 0x34418a, cap: 0xff3caa, lip: 0x1b2352, shine: 0x6fe3ff, bolt: 0x9aa8ff, emissive: 0xff3caa },
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts });
}

function part(name, geometry, material, x, y, z, parent) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** one column: body from y0 to y1, its cap at the gap end (up = the cap faces up) */
function column(group, pal, biome, y0, y1, capAtTop) {
  // the body stops inside the cap, so their end faces never z-fight
  const b0 = capAtTop ? y0 : y0 + CAP_H / 2;
  const b1 = capAtTop ? y1 - CAP_H / 2 : y1;
  const len = b1 - b0;
  part('pipe-body', new THREE.CylinderGeometry(BODY_R, BODY_R, len, 24), mat(pal.body), 0, (b0 + b1) / 2, 0, group);
  part('pipe-shine', new THREE.BoxGeometry(0.16, len, 0.06), mat(pal.shine, { roughness: 0.3 }), -BODY_R * 0.42, (b0 + b1) / 2, BODY_R * 0.88, group);
  const capY = capAtTop ? y1 - CAP_H / 2 : y0 + CAP_H / 2;
  const neon = biome === 'city';
  part('pipe-cap', new THREE.CylinderGeometry(CAP_R, CAP_R, CAP_H, 24), mat(pal.cap, neon ? { emissive: pal.emissive, emissiveIntensity: 0.9 } : {}), 0, capY, 0, group);
  const lipY = capAtTop ? y1 - 0.09 : y0 + 0.09; // just inside the cap's end face, so the two never z-fight
  part('pipe-lip', new THREE.CylinderGeometry(CAP_R * 1.03, CAP_R * 1.03, 0.1, 24), mat(pal.lip), 0, lipY, 0, group);
  for (let i = 0; i < BOLTS; i++) {
    const a = -0.7 + (i / (BOLTS - 1)) * 1.4;
    part('pipe-bolt', new THREE.SphereGeometry(0.075, 10, 8), mat(pal.bolt, { metalness: 0.4, roughness: 0.35 }), Math.sin(a) * CAP_R * 0.98, capY, Math.cos(a) * CAP_R * 0.98, group);
  }
}

/** the scenery at the foot of a pipe, by biome */
function foot(group, biome, n) {
  const side = n % 2 ? -1 : 1;
  if (biome === 'meadow') {
    const leaf = 0x3fae4f;
    part('bush', new THREE.SphereGeometry(0.55, 14, 10), mat(leaf, { roughness: 0.8 }), side * 1.25, 0.25, 0.7, group);
    part('bush', new THREE.SphereGeometry(0.42, 14, 10), mat(0x52c25c, { roughness: 0.8 }), side * 1.75, 0.18, 0.95, group);
    part('flower-stem', new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), mat(0x2f8f2a), -side * 1.2, 0.27, 1.1, group);
    part('flower', new THREE.SphereGeometry(0.12, 10, 8), mat(n % 3 ? 0xff5a7a : 0xffd23a, { roughness: 0.6 }), -side * 1.2, 0.58, 1.1, group);
    part('flower-stem', new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), mat(0x2f8f2a), -side * 1.5, 0.2, 0.8, group);
    part('flower', new THREE.SphereGeometry(0.1, 10, 8), mat(0xffffff, { roughness: 0.6 }), -side * 1.5, 0.43, 0.8, group);
  } else if (biome === 'canyon') {
    const green = 0x5f9c4a;
    part('cactus', new THREE.CylinderGeometry(0.17, 0.2, 1.3, 10), mat(green, { roughness: 0.75 }), side * 1.45, 0.65, 0.8, group);
    const arm = part('cactus-arm', new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8), mat(green, { roughness: 0.75 }), side * 1.45 + 0.27, 0.85, 0.8, group);
    arm.rotation.z = -0.25;
    const arm2 = part('cactus-arm', new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8), mat(green, { roughness: 0.75 }), side * 1.45 - 0.25, 0.7, 0.8, group);
    arm2.rotation.z = 0.25;
    part('rock', new THREE.DodecahedronGeometry(0.32, 0), mat(0xc0703f, { roughness: 0.9 }), -side * 1.3, 0.12, 0.95, group);
    part('rock', new THREE.DodecahedronGeometry(0.22, 0), mat(0xa85d33, { roughness: 0.9 }), -side * 1.7, 0.08, 0.7, group);
  } else {
    part('lamp-post', new THREE.CylinderGeometry(0.05, 0.07, 2.2, 8), mat(0x2a2f4a, { metalness: 0.5 }), side * 1.4, 1.1, 0.9, group);
    part('lamp-arm', new THREE.BoxGeometry(0.45, 0.06, 0.06), mat(0x2a2f4a, { metalness: 0.5 }), side * 1.4 - side * 0.2, 2.18, 0.9, group);
    part('lamp-bulb', new THREE.BoxGeometry(0.26, 0.12, 0.18), mat(0xfff2b0, { emissive: 0xffd97a, emissiveIntensity: 1.6 }), side * 1.4 - side * 0.38, 2.12, 0.9, group);
    part('crate', new THREE.BoxGeometry(0.5, 0.42, 0.45), mat(0x4a3f7a, { roughness: 0.7 }), -side * 1.35, 0.21, 0.85, group);
    part('crate', new THREE.BoxGeometry(0.36, 0.3, 0.34), mat(0x6a5aa8, { roughness: 0.7 }), -side * 1.55, 0.57, 0.8, group);
  }
}

/** a brand-new pipe pair for pipe n of the course */
function buildPipe(n) {
  const def = pipeAt(n);
  const pal = PIPE_COLORS[def.biome];
  const group = new THREE.Group();
  group.name = `pipe-pair`;
  group.position.x = def.x;
  column(group, pal, def.biome, FOOT_Y, def.y - def.gap / 2, true);
  column(group, pal, def.biome, def.y + def.gap / 2, TOP_Y, false);
  foot(group, def.biome, n);
  return { n, x: def.x, group };
}

export function createPipes(scene) {
  // every pipe pair built this session, in the scene
  const course = { pipes: [], next: 1 };

  // GLITCHLESS-DEMO: pipes that are never recycled. Every pipe pair is a new Group of ~20 meshes, each
  // with its own new geometry and material, added to the scene and to course.pipes, and nothing is
  // ever removed or disposed. update() "recycles" pipes that leave the screen by hiding them, and shows
  // them again whenever they are back on screen. A retry only rewinds the pipe index (rewind() below),
  // so the next run builds the course again on top of every earlier run's meshes: the same pipes at
  // the same places, drawn once per run so far (and again for the shadow map). Geometries climb with
  // every pipe, draw calls with every retry, and a long session gets slower and slower.
  function spawnPipe(n) {
    const p = buildPipe(n);
    scene.add(p.group);
    course.pipes.push(p);
    return p;
  }

  /** a retry: start building the course from pipe n again */
  function rewind(n = 1) {
    course.next = Math.max(1, n);
  }

  /** build what the camera is about to see, and hide what it can't */
  function update(camX, halfW) {
    while (pipeAt(course.next).x < camX + halfW + SPAWN_AHEAD) spawnPipe(course.next++);
    for (const p of course.pipes) p.group.visible = Math.abs(p.x - camX) < halfW + PIPE_W + 1.2; // off screen: hidden, not removed
  }

  return {
    course,
    spawnPipe,
    rewind,
    update,
    get count() {
      return course.pipes.length;
    },
    get visible() {
      let n = 0;
      for (const p of course.pipes) if (p.group.visible) n++;
      return n;
    },
  };
}

/**
 * The heatmap background: the first MAP_PIPES pipes in their colours plus the ground, built from shared
 * geometries and materials into one group that is captured once and then disposed.
 */
export function buildMapStrip() {
  const group = new THREE.Group();
  group.name = 'map-strip';
  const b = mapBounds();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const mats = {};
  for (const [biome, pal] of Object.entries(PIPE_COLORS)) {
    mats[biome] = { body: keep(mat(pal.body)), cap: keep(mat(pal.cap, biome === 'city' ? { emissive: pal.emissive, emissiveIntensity: 0.9 } : {})) };
  }
  const add = (m, x, y, w, h) => {
    const mesh = new THREE.Mesh(box, m);
    mesh.position.set(x, y, 0);
    mesh.scale.set(w, h, 1);
    group.add(mesh);
  };
  const skyTop = b.max[1];
  for (let n = 1; n <= MAP_PIPES; n++) {
    const p = pipeAt(n);
    const lo = p.y - p.gap / 2;
    const hi = p.y + p.gap / 2;
    const m = mats[p.biome];
    add(m.body, p.x, (GROUND_Y + lo) / 2, PIPE_W * 0.9, lo - GROUND_Y);
    add(m.body, p.x, (hi + skyTop) / 2, PIPE_W * 0.9, skyTop - hi);
    add(m.cap, p.x, lo - CAP_H / 2, PIPE_W, CAP_H);
    add(m.cap, p.x, hi + CAP_H / 2, PIPE_W, CAP_H);
  }
  // the sky behind and the ground strip, per biome stretch
  const SKY = { meadow: 0x9fdcff, canyon: 0xffcf9a, city: 0x5a4a9a };
  const GROUND = { meadow: 0x6cc650, canyon: 0xe8b46a, city: 0x3a3d56 };
  for (let n = 1; n <= MAP_PIPES; n += 10) {
    const biome = pipeAt(n).biome;
    const x0 = n === 1 ? b.min[0] : pipeAt(n).x - 2.4;
    const x1 = n + 10 > MAP_PIPES ? b.max[0] : pipeAt(n + 10).x - 2.4;
    const sky = new THREE.Mesh(box, keep(new THREE.MeshBasicMaterial({ color: SKY[biome], fog: false })));
    sky.position.set((x0 + x1) / 2, (GROUND_Y + skyTop) / 2, -3);
    sky.scale.set(x1 - x0, skyTop - GROUND_Y, 0.1);
    group.add(sky);
    const ground = new THREE.Mesh(box, keep(mat(GROUND[biome], { roughness: 0.9 })));
    ground.position.set((x0 + x1) / 2, (b.min[1] + GROUND_Y) / 2, 0);
    ground.scale.set(x1 - x0, GROUND_Y - b.min[1], 2);
    group.add(ground);
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
