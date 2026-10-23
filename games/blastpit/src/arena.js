// The pit: a 40 x 40 m neon-industrial arena with low outer walls, pillars and crates for cover, spawn
// gates on the edges, pickup pads, lights, fog and a dark skyline. Everything is procedural.
import * as THREE from 'three';

export const HALF = 20;
const WALL_H = 1.4;

export const GATES = {
  N1: { x: -7, z: -18.3, nx: 0, nz: 1 },
  N2: { x: 7, z: -18.3, nx: 0, nz: 1 },
  S1: { x: -7, z: 18.3, nx: 0, nz: -1 },
  S2: { x: 7, z: 18.3, nx: 0, nz: -1 },
  E1: { x: 18.3, z: -7, nx: -1, nz: 0 },
  E2: { x: 18.3, z: 7, nx: -1, nz: 0 },
  W1: { x: -18.3, z: -7, nx: 1, nz: 0 },
  W2: { x: -18.3, z: 7, nx: 1, nz: 0 },
};

export const PICKUP_SPOTS = [
  { kind: 'health', x: -15, z: 14 },
  { kind: 'health', x: 15, z: -14 },
  { kind: 'shells', x: -15, z: -14 },
  { kind: 'shells', x: 15, z: 14 },
  { kind: 'rockets', x: 0, z: 0 },
];

export const PLAYER_START = { x: 0, z: 13, yaw: 0 };

// cover: [x, z, sizeX, height, sizeZ, kind]
const COVER = [
  [-9, -9, 1.6, 5, 1.6, 'pillar'],
  [9, -9, 1.6, 5, 1.6, 'pillar'],
  [-9, 9, 1.6, 5, 1.6, 'pillar'],
  [9, 9, 1.6, 5, 1.6, 'pillar'],
  [0, -5.5, 3.2, 1.1, 1.0, 'barrier'],
  [0, 5.5, 3.2, 1.1, 1.0, 'barrier'],
  [-13, 0, 1.4, 1.4, 1.4, 'crate'],
  [13, 0, 1.4, 1.4, 1.4, 'crate'],
  [-4.5, -0.6, 1.2, 0.95, 1.2, 'crate'],
  [4.5, 0.6, 1.2, 0.95, 1.2, 'crate'],
];

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 512 px = 4 m of floor: dark plates, a 1 m grid and a brighter 4 m line
function floorTextures() {
  const base = canvasTexture(
    512,
    (g, s) => {
      g.fillStyle = '#1a1e2a';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const v = 14 + Math.random() * 14;
        g.fillStyle = `rgba(${v},${v + 2},${v + 8},0.5)`;
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.05)';
          g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
        }
      g.strokeStyle = '#212a36';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(i * 128, 0);
        g.lineTo(i * 128, s);
        g.moveTo(0, i * 128);
        g.lineTo(s, i * 128);
        g.stroke();
      }
    },
    10,
  );
  const glow = canvasTexture(
    512,
    (g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#0c3a40';
      g.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 128, 0);
        g.lineTo(i * 128, s);
        g.moveTo(0, i * 128);
        g.lineTo(s, i * 128);
        g.stroke();
      }
      g.strokeStyle = '#2de2e6';
      g.lineWidth = 4;
      g.strokeRect(0, 0, s, s);
    },
    10,
  );
  return { base, glow };
}

function crateTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#2b2116';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#3a2c1a';
    g.fillRect(18, 18, s - 36, s - 36);
    // hazard stripes along the top and bottom
    g.save();
    g.beginPath();
    g.rect(0, 0, s, 18);
    g.rect(0, s - 18, s, 18);
    g.clip();
    for (let x = -s; x < s * 2; x += 28) {
      g.fillStyle = '#f2a51a';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 14, 0);
      g.lineTo(x + 14 - s, s);
      g.lineTo(x - s, s);
      g.fill();
    }
    g.restore();
    g.strokeStyle = '#120d07';
    g.lineWidth = 6;
    g.strokeRect(18, 18, s - 36, s - 36);
    g.beginPath();
    g.moveTo(18, 18);
    g.lineTo(s - 18, s - 18);
    g.moveTo(s - 18, 18);
    g.lineTo(18, s - 18);
    g.stroke();
  });
}

export function buildArena(scene) {
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);
  const boxes = [];

  scene.background = new THREE.Color(0x07080e);
  scene.fog = new THREE.FogExp2(0x0a0a16, 0.021);

  // ── sky dome: dark with a violet horizon glow
  const skyGeo = new THREE.SphereGeometry(220, 32, 16);
  const col = [];
  const pos = skyGeo.attributes.position;
  const top = new THREE.Color(0x05060c);
  const hor = new THREE.Color(0x2a1340);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / 120));
    c.copy(hor).lerp(top, Math.pow(t, 0.55));
    col.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.name = 'sky';
  sky.renderOrder = -10;
  scene.add(sky);

  // ── floor
  const ft = floorTextures();
  // a glossy coated floor so the neon reads as reflections (clearcoat = a second specular layer per light)
  const floorMat = new THREE.MeshPhysicalMaterial({ map: ft.base, emissiveMap: ft.glow, emissive: 0x2de2e6, emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.18 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), floorMat);
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // the ground outside the walls (fades into the fog)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x10121c, roughness: 0.9, metalness: 0.1 }));
  outside.name = 'outside';
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.02;
  group.add(outside);

  // ── outer walls with neon trim
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c3346, roughness: 0.55, metalness: 0.35 });
  const trimCyan = new THREE.MeshBasicMaterial({ color: 0x2de2e6 });
  const trimMagenta = new THREE.MeshBasicMaterial({ color: 0xff3caa });
  const trimAmber = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  const wallT = 0.6;
  const walls = [
    [0, -HALF - wallT / 2, HALF * 2 + wallT * 2, wallT],
    [0, HALF + wallT / 2, HALF * 2 + wallT * 2, wallT],
    [-HALF - wallT / 2, 0, wallT, HALF * 2],
    [HALF + wallT / 2, 0, wallT, HALF * 2],
  ];
  for (const [x, z, sx, sz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_H, sz), steel);
    m.position.set(x, WALL_H / 2, z);
    m.castShadow = m.receiveShadow = true;
    m.name = 'wall';
    group.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.07, sz + 0.02), trimCyan);
    trim.position.set(x, WALL_H + 0.01, z);
    group.add(trim);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.05, sz + 0.02), trimMagenta);
    kick.position.set(x, 0.12, z);
    group.add(kick);
    boxes.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, top: WALL_H, kind: 'wall' });
  }

  // ── cover
  const concrete = new THREE.MeshStandardMaterial({ color: 0x41475a, roughness: 0.8, metalness: 0.1 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.7, metalness: 0.2 });
  for (const [x, z, sx, h, sz, kind] of COVER) {
    const mat = kind === 'crate' ? crateMat : concrete;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    m.name = kind;
    group.add(m);
    if (kind === 'pillar') {
      for (const [y, mat2] of [
        [0.9, trimMagenta],
        [3.4, trimCyan],
      ]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, 0.12, sz + 0.04), mat2);
        band.position.set(x, y, z);
        group.add(band);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.3, 0.25, sz + 0.3), steel);
      cap.position.set(x, h + 0.12, z);
      cap.castShadow = true;
      group.add(cap);
    } else if (kind === 'barrier') {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.08, sz + 0.02), trimAmber);
      stripe.position.set(x, h - 0.18, z);
      group.add(stripe);
    }
    boxes.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, top: kind === 'pillar' ? h + 0.25 : h, kind });
  }

  // ── spawn gates: a lit door frame in the wall + a floor ring that pulses before something comes out
  const gateFrame = new THREE.MeshBasicMaterial({ color: 0xff3caa });
  const doorMat = new THREE.MeshBasicMaterial({ color: 0x12061a });
  const ringGeo = new THREE.RingGeometry(0.9, 1.25, 40);
  const gateFx = {};
  for (const [id, g] of Object.entries(GATES)) {
    const along = g.nx === 0; // wall runs along x
    const gx = g.x - g.nx * 1.75;
    const gz = g.z - g.nz * 1.75;
    const door = new THREE.Mesh(new THREE.BoxGeometry(along ? 2.4 : 0.2, 2.6, along ? 0.2 : 2.4), doorMat);
    door.position.set(gx, 1.3, gz);
    group.add(door);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.18 : 0.3, 2.8, along ? 0.3 : 0.18), gateFrame);
      post.position.set(gx + (along ? s * 1.3 : 0), 1.4, gz + (along ? 0 : s * 1.3));
      group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(along ? 2.8 : 0.3, 0.18, along ? 0.3 : 2.8), gateFrame);
    lintel.position.set(gx, 2.8, gz);
    group.add(lintel);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3caa, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(g.x, 0.03, g.z);
    ring.name = 'gate-ring';
    group.add(ring);
    gateFx[id] = { ring, t: 0, dur: 0 };
  }

  // ── pickup pads
  const padGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.06, 6);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2c, roughness: 0.5, metalness: 0.7 });
  const padRingGeo = new THREE.RingGeometry(0.62, 0.72, 6);
  const PAD_COL = { health: 0x4dff9a, shells: 0xffb020, rockets: 0xff3caa };
  for (const s of PICKUP_SPOTS) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(s.x, 0.03, s.z);
    pad.receiveShadow = true;
    group.add(pad);
    const ring = new THREE.Mesh(padRingGeo, new THREE.MeshBasicMaterial({ color: PAD_COL[s.kind] }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.065, s.z);
    group.add(ring);
  }

  // ── skyline: dark towers with lit strips, fading into the fog
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x151826, roughness: 0.8, metalness: 0.3 });
  const stripMats = [trimCyan, trimMagenta, trimAmber];
  const rnd = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.15;
    const r = 34 + rnd() * 26;
    const w = 3 + rnd() * 6;
    const h = 8 + rnd() * 26;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
    t.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
    t.rotation.y = rnd() * Math.PI;
    group.add(t);
    const strips = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < strips; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.25, w + 0.1), stripMats[Math.floor(rnd() * 3)]);
      s.position.set(t.position.x, 2 + rnd() * (h - 3), t.position.z);
      s.rotation.y = t.rotation.y;
      group.add(s);
    }
  }

  // ── lights: two shadow casters (moon + a work light over the middle) and four neon corner lamps
  const hemi = new THREE.HemisphereLight(0x8a9cff, 0x2a1428, 1.5);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xc4d4ff, 2.3);
  moon.position.set(14, 26, 9);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 70 });
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  scene.add(moon);
  const work = new THREE.SpotLight(0xffc27a, 650, 46, 0.62, 0.55, 1.6);
  work.position.set(0, 17, 1);
  work.target.position.set(0, 0, 0);
  work.castShadow = true;
  work.shadow.mapSize.set(1024, 1024);
  work.shadow.bias = -0.0006;
  scene.add(work, work.target);
  const corners = [
    [-17, -17, 0x2de2e6],
    [17, -17, 0xff3caa],
    [-17, 17, 0xff3caa],
    [17, 17, 0x2de2e6],
  ];
  for (const [x, z, color] of corners) {
    const l = new THREE.PointLight(color, 60, 24, 1.7);
    l.position.set(x, 3.2, z);
    scene.add(l);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color }));
    lamp.position.set(x, 3.2, z);
    group.add(lamp);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), steel);
    pole.position.set(x, 1.6, z);
    pole.castShadow = true;
    group.add(pole);
  }

  function telegraph(gateId, dur) {
    const fx = gateFx[gateId];
    if (fx) {
      fx.t = dur;
      fx.dur = dur;
    }
  }

  function update(dt, clock) {
    for (const fx of Object.values(gateFx)) {
      const m = fx.ring.material;
      if (fx.t > 0) {
        fx.t -= dt;
        const k = 1 - fx.t / fx.dur;
        m.opacity = 0.45 + 0.5 * Math.abs(Math.sin(clock * 14));
        fx.ring.scale.setScalar(1 + k * 0.6);
      } else {
        m.opacity = 0.14 + 0.06 * Math.sin(clock * 2);
        fx.ring.scale.setScalar(1);
      }
    }
  }

  function resetFx() {
    for (const fx of Object.values(gateFx)) fx.t = 0;
  }

  return { group, boxes, sky, gates: GATES, telegraph, update, resetFx };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
