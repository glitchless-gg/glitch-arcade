// The static scene: the plateau with its tile grid, the dirt path, rocks and trees, the cave, the
// castle gate, the meadow around it, lights and fog. Built once.
import * as THREE from 'three';
import { COLS, ROWS, PATH_TILES, PROPS, CAVE, GATE, tileX, tileZ, isPath } from './map.js';
import { createRng } from './rng.js';

const C = {
  sky: 0xb9e3f2,
  meadow: 0x6aa84f,
  grassA: 0x86c75e,
  grassB: 0x7dbd57,
  slabTop: 0x4f8a3a,
  cliff: 0x8a6440,
  cliffDark: 0x6b4a2e,
  dirt: 0xd3a46a,
  dirtDark: 0xb98a55,
  rock: 0x9a958e,
  rockDark: 0x77726c,
  trunk: 0x7a5434,
  leaf: 0x3f8f45,
  leafLight: 0x58a84e,
  stone: 0xc9c2b6,
  stoneDark: 0xa39b8f,
  roof: 0xc8463d,
  wood: 0x7b4f2c,
  banner: 0x6d3fc4,
};

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

export const PLATEAU = { minX: -12, maxX: 12.2, minZ: -5.6, maxZ: 5.6, top: -0.12 };

export function createWorld(scene, renderer) {
  const rng = createRng(4242);
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 34, 70);

  // ── lights ──────────────────────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x4f7a3a, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-7, 16, 9);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -14;
  sc.right = 14;
  sc.top = 10;
  sc.bottom = -10;
  sc.near = 1;
  sc.far = 45;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // ── meadow + plateau ────────────────────────────────────────────────────────────────────────
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(140, 100), std(C.meadow));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -1.0;
  meadow.receiveShadow = true;
  scene.add(meadow);

  const P = PLATEAU;
  const slabW = P.maxX - P.minX;
  const slabD = P.maxZ - P.minZ;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, 0.9, slabD), [
    std(C.cliff),
    std(C.cliff),
    std(C.slabTop),
    std(C.cliffDark),
    std(C.cliff),
    std(C.cliffDark),
  ]);
  slab.position.set((P.minX + P.maxX) / 2, P.top - 0.45, (P.minZ + P.maxZ) / 2);
  slab.receiveShadow = true;
  scene.add(slab);
  // a grassy lip so the cliff reads as a cliff
  const lip = new THREE.Mesh(new THREE.BoxGeometry(slabW + 0.12, 0.14, slabD + 0.12), std(C.grassB));
  lip.position.set(slab.position.x, P.top - 0.05, slab.position.z);
  lip.receiveShadow = true;
  scene.add(lip);

  // ── tiles (one InstancedMesh for grass, one for path) ──────────────────────────────────────
  const tileGeo = new THREE.BoxGeometry(0.95, 0.2, 0.95);
  const grassCount = COLS * ROWS - PATH_TILES.length;
  const grass = new THREE.InstancedMesh(tileGeo, std(0xffffff), grassCount);
  const path = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.16, 1.0), std(0xffffff), PATH_TILES.length);
  grass.receiveShadow = true;
  path.receiveShadow = true;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let gi = 0;
  let pi = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (isPath(c, r)) {
        m.makeTranslation(tileX(c), -0.12, tileZ(r));
        path.setMatrixAt(pi, m);
        col.setHex(C.dirt).offsetHSL(0, 0, rng.range(-0.025, 0.02));
        path.setColorAt(pi++, col);
      } else {
        m.makeTranslation(tileX(c), -0.1, tileZ(r));
        grass.setMatrixAt(gi, m);
        col.setHex((c + r) % 2 ? C.grassA : C.grassB).offsetHSL(0, rng.range(-0.02, 0.02), rng.range(-0.02, 0.015));
        grass.setColorAt(gi++, col);
      }
    }
  }
  scene.add(grass, path);

  // the path's off-grid ends: out of the cave, into the gate
  const caveRun = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.0), std(C.dirtDark));
  caveRun.position.set(tileX(-0.5) - 1.0, -0.12, tileZ(CAVE.row));
  const gateRun = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 1.0), std(C.dirt));
  gateRun.position.set(tileX(15.5) + 0.6, -0.12, tileZ(GATE.row));
  caveRun.receiveShadow = gateRun.receiveShadow = true;
  scene.add(caveRun, gateRun);

  // pebbles along the path
  const pebbleGeo = new THREE.DodecahedronGeometry(0.06, 0);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, std(C.dirtDark, { flatShading: true }), 70);
  for (let i = 0; i < 70; i++) {
    const [c, r] = PATH_TILES[rng.int(0, PATH_TILES.length - 1)];
    m.makeTranslation(tileX(c) + rng.range(-0.4, 0.4), -0.03, tileZ(r) + rng.range(-0.4, 0.4));
    pebbles.setMatrixAt(i, m);
  }
  scene.add(pebbles);

  // ── props on grid tiles + trees around the plateau ─────────────────────────────────────────
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.42, 6);
  const crownGeo = new THREE.ConeGeometry(0.42, 0.95, 7);
  const crown2Geo = new THREE.ConeGeometry(0.32, 0.7, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.34, 0);
  const trunkMat = std(C.trunk);
  const leafMat = std(C.leaf, { flatShading: true });
  const leafLightMat = std(C.leafLight, { flatShading: true });
  const rockMat = std(C.rock, { flatShading: true });
  const rockDarkMat = std(C.rockDark, { flatShading: true });

  function tree(x, z, s = 1, y = 0) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.21;
    const crown = new THREE.Mesh(crownGeo, leafMat);
    crown.position.y = 0.82;
    const crown2 = new THREE.Mesh(crown2Geo, leafLightMat);
    crown2.position.y = 1.22;
    for (const o of [trunk, crown, crown2]) {
      o.castShadow = true;
      g.add(o);
    }
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    g.rotation.y = rng.range(0, Math.PI);
    scene.add(g);
    return g;
  }
  function rock(x, z, s = 1, y = 0, mat = rockMat) {
    const r = new THREE.Mesh(rockGeo, mat);
    r.position.set(x, y + 0.16 * s, z);
    r.scale.set(s * rng.range(0.9, 1.25), s * rng.range(0.6, 0.85), s * rng.range(0.9, 1.2));
    r.rotation.set(rng.range(0, 1), rng.range(0, 6), rng.range(0, 1));
    r.castShadow = true;
    r.receiveShadow = true;
    scene.add(r);
    return r;
  }

  for (const p of PROPS) {
    const x = tileX(p.col);
    const z = tileZ(p.row);
    if (p.kind === 'tree') tree(x + rng.range(-0.1, 0.1), z + rng.range(-0.1, 0.1), rng.range(0.85, 1.05));
    else {
      rock(x - 0.08, z, 1.0);
      rock(x + 0.22, z + 0.18, 0.55, 0, rockDarkMat);
    }
  }

  // a forest and boulders on the meadow around the plateau (instanced: a couple of draw calls)
  const forest = [];
  for (let i = 0; i < 90; i++) {
    let x;
    let z;
    do {
      x = rng.range(-22, 22);
      z = rng.range(-14, 9);
    } while (x > P.minX - 1 && x < P.maxX + 1 && z > P.minZ - 1 && z < P.maxZ + 1);
    forest.push({ x, z, s: rng.range(0.9, 1.5), r: rng.range(0, Math.PI) });
  }
  const parts = [
    [trunkGeo, trunkMat, 0.21],
    [crownGeo, leafMat, 0.82],
    [crown2Geo, leafLightMat, 1.22],
  ];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (const [geo, mat, y] of parts) {
    const inst = new THREE.InstancedMesh(geo, mat, forest.length);
    forest.forEach((t, i) => {
      q.setFromAxisAngle(up, t.r);
      inst.setMatrixAt(i, m.compose(pos.set(t.x, -1.0 + y * t.s, t.z), q, scl.setScalar(t.s)));
    });
    inst.castShadow = true;
    scene.add(inst);
  }
  const boulders = new THREE.InstancedMesh(rockGeo, rockMat, 26);
  const e = new THREE.Euler();
  for (let i = 0; i < 26; i++) {
    let x;
    let z;
    do {
      x = rng.range(-20, 20);
      z = rng.range(-12, 9);
    } while (x > P.minX - 0.6 && x < P.maxX + 0.6 && z > P.minZ - 0.6 && z < P.maxZ + 0.6);
    const k = rng.range(0.6, 1.4);
    q.setFromEuler(e.set(rng.range(0, 1), rng.range(0, 6), rng.range(0, 1)));
    boulders.setMatrixAt(i, m.compose(pos.set(x, -1.0 + 0.16 * k, z), q, scl.set(k * rng.range(0.9, 1.25), k * rng.range(0.6, 0.85), k * rng.range(0.9, 1.2))));
  }
  boulders.castShadow = true;
  scene.add(boulders);
  // flowers / tufts on the plateau edges outside the grid
  const tuftGeo = new THREE.ConeGeometry(0.07, 0.22, 4);
  const tufts = new THREE.InstancedMesh(tuftGeo, std(0x9ad66b, { flatShading: true }), 60);
  for (let i = 0; i < 60; i++) {
    const side = rng.chance(0.5);
    const x = side ? rng.range(P.minX + 0.3, -8.3) : rng.range(8.3, P.maxX - 0.3);
    const z = rng.range(P.minZ + 0.3, P.maxZ - 0.3);
    if (Math.abs(z - tileZ(CAVE.row)) < 1.6 && x < 0) continue;
    if (Math.abs(z - tileZ(GATE.row)) < 2.2 && x > 0) continue;
    m.makeTranslation(x, -0.02, z);
    tufts.setMatrixAt(i, m);
  }
  scene.add(tufts);

  const cave = buildCave(scene, rock, rockMat, rockDarkMat);
  const castle = buildCastle(scene);

  return {
    sun,
    cave,
    castle,
    update(dt, t) {
      castle.flag.rotation.y = Math.sin(t * 2.1) * 0.25;
      castle.flag.scale.x = 1 + Math.sin(t * 5.3) * 0.06;
      if (castle.flash > 0) {
        castle.flash = Math.max(0, castle.flash - dt * 2.5);
        castle.gateMat.emissive.setRGB(castle.flash * 0.9, castle.flash * 0.15, castle.flash * 0.1);
      }
    },
    hitGate() {
      castle.flash = 1;
    },
  };
}

// The cave the enemies come out of: a heap of boulders with a dark mouth facing the path.
function buildCave(scene, rock, rockMat, rockDarkMat) {
  const x0 = tileX(CAVE.col) - 0.2;
  const z0 = tileZ(CAVE.row);
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1.7, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: 1, flatShading: true }));
  mound.scale.set(1.25, 1.0, 1.0);
  mound.position.set(x0 - 1.4, -0.1, z0);
  mound.castShadow = true;
  mound.receiveShadow = true;
  g.add(mound);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x14100e }));
  mouth.position.set(x0 + 0.79, -0.08, z0);
  mouth.rotation.y = Math.PI / 2;
  mouth.scale.set(1, 1.25, 1);
  g.add(mouth);
  // a timber frame around the mouth, and something watching from inside
  const beam = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
  for (const dz of [-0.62, 0.62]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.16), beam);
    post.position.set(x0 + 0.86, 0.36, z0 + dz);
    post.castShadow = true;
    g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 1.5), beam);
  lintel.position.set(x0 + 0.88, 0.86, z0);
  lintel.castShadow = true;
  g.add(lintel);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  for (const dz of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
    eye.position.set(x0 + 0.82, 0.3, z0 + dz);
    g.add(eye);
  }
  scene.add(g);
  // boulders around the mouth
  rock(x0 + 0.75, z0 - 0.85, 0.8, -0.1);
  rock(x0 + 0.75, z0 + 0.85, 0.75, -0.1, rockDarkMat);
  rock(x0 - 0.3, z0 - 1.45, 1.2, -0.1, rockDarkMat);
  rock(x0 - 0.4, z0 + 1.45, 1.1, -0.1);
  rock(x0 - 1.2, z0 + 1.6, 0.9, 0.0);
  rock(x0 - 2.4, z0 - 1.2, 1.3, 0.1);
  rock(x0 - 1.0, z0 - 0.4, 0.8, 1.15, rockMat);
  return g;
}

// The castle at the end of the path: a gatehouse facing the path, a curtain wall with two round
// towers at its ends and a keep behind, flying the banner.
function buildCastle(scene) {
  const x0 = tileX(GATE.col) + 0.5;
  const z0 = tileZ(GATE.row);
  const g = new THREE.Group();
  const stone = std(C.stone);
  const stoneDark = std(C.stoneDark);
  const roof = std(C.roof);
  const gateMat = std(C.wood, { emissive: new THREE.Color(0, 0, 0) });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const merlons = (x, y, z0_, z1, w) => {
    for (let z = z0_; z <= z1 + 1e-6; z += 0.5) box(w, 0.2, 0.26, stoneDark, x, y, z);
  };

  // curtain wall
  box(0.6, 1.15, 5.0, stone, x0 + 0.7, 0.45, z0);
  merlons(x0 + 0.7, 1.12, z0 - 2.25, z0 + 2.25, 0.62);
  // keep
  box(1.5, 2.2, 1.7, stone, x0 + 1.75, 0.98, z0 - 0.7);
  merlons(x0 + 1.05, 2.18, z0 - 1.35, z0 - 0.05, 0.2);
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.0, 4), roof);
  keepRoof.rotation.y = Math.PI / 4;
  keepRoof.position.set(x0 + 1.75, 2.6, z0 - 0.7);
  g.add(keepRoof);
  // gatehouse with the door the enemies hit
  box(1.0, 1.55, 1.5, stone, x0 + 0.25, 0.65, z0);
  merlons(x0 - 0.2, 1.52, z0 - 0.5, z0 + 0.5, 0.22);
  box(0.06, 0.9, 0.86, std(0x2a1d14), x0 - 0.27, 0.33, z0);
  const door = box(0.1, 0.78, 0.74, gateMat, x0 - 0.3, 0.31, z0);
  door.name = 'gate-door';
  const doorTop = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.1, 14, 1, false, 0, Math.PI), gateMat);
  doorTop.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  doorTop.position.set(x0 - 0.3, 0.7, z0);
  g.add(doorTop);
  // corner towers
  for (const dz of [-2.45, 2.45]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.8, 12), stone);
    tower.position.set(x0 + 0.75, 0.78, z0 + dz);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.58, 0.2, 12), stoneDark);
    top.position.set(x0 + 0.75, 1.72, z0 + dz);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.9, 12), roof);
    cone.position.set(x0 + 0.75, 2.27, z0 + dz);
    g.add(tower, top, cone);
  }
  // banner on the keep
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), std(0x5b4636));
  pole.position.set(x0 + 1.75, 3.45, z0 - 0.7);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.38), std(C.banner, { side: THREE.DoubleSide }));
  flag.geometry.translate(0.31, 0, 0);
  flag.position.set(x0 + 1.75, 3.75, z0 - 0.7);
  g.add(pole, flag);

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(g);
  return { group: g, flag, gateMat, flash: 0 };
}
