// Builds and unloads a track's meshes (road, curbs, barriers, gantry, boost pads, scenery), plus the
// sky and lights that stay for the whole session.
import * as THREE from 'three';
import { ROAD, WALL_IN } from './track-geom.js';
import { createRng } from './rng.js';
import { asphaltTexture, curbTexture, wallTexture, groundTexture, padTexture, checkerTexture, bannerTexture, windowsTexture, waterTexture } from './textures.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// ─────────────────────────────────────────────────────────────── sky + lights (persistent)

export function createEnvironment(scene) {
  const skyGeo = new THREE.SphereGeometry(700, 32, 16);
  const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.name = 'sky';
  sky.renderOrder = -10;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 1;
  sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  scene.fog = new THREE.Fog(0xffffff, 100, 400);

  let sunDir = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  return {
    sky,
    applyTheme(theme, renderer) {
      const pos = skyGeo.attributes.position;
      const top = new THREE.Color(theme.sky.top);
      const mid = new THREE.Color(theme.sky.mid);
      const bot = new THREE.Color(theme.sky.bottom);
      for (let i = 0; i < pos.count; i++) {
        const h = pos.getY(i) / 700;
        if (h > 0.18) c.copy(mid).lerp(top, Math.min(1, (h - 0.18) / 0.6));
        else c.copy(bot).lerp(mid, Math.max(0, (h + 0.05) / 0.23));
        skyColors[i * 3] = c.r;
        skyColors[i * 3 + 1] = c.g;
        skyColors[i * 3 + 2] = c.b;
      }
      skyGeo.attributes.color.needsUpdate = true;
      scene.fog.color.setHex(theme.fog.color);
      scene.fog.near = theme.fog.near;
      scene.fog.far = theme.fog.far;
      hemi.color.setHex(theme.hemi.sky);
      hemi.groundColor.setHex(theme.hemi.ground);
      hemi.intensity = theme.hemi.intensity;
      sun.color.setHex(theme.sun.color);
      sun.intensity = theme.sun.intensity;
      sunDir = new THREE.Vector3(...theme.sun.dir).normalize();
      renderer.toneMappingExposure = theme.exposure;
    },
    follow(x, z) {
      // keep the shadow box around the player
      sun.target.position.set(x, 0, z);
      sun.position.set(x + sunDir.x * 120, sunDir.y * 120, z + sunDir.z * 120);
      sky.position.set(x, 0, z);
    },
  };
}

// ─────────────────────────────────────────────────────────────── geometry helpers

/** a flat strip between lateral offsets a..b, over samples [from, to] (closed loop when from == to) */
function ribbon(g, a, b, y, vLen, from = 0, to = g.N) {
  const count = (to - from + g.N) % g.N || g.N;
  const n = count + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let k = 0; k < n; k++) {
    const i = (from + k) % g.N;
    const s = k * g.ds;
    for (let side = 0; side < 2; side++) {
      const off = side ? b : a;
      const o = (k * 2 + side) * 3;
      pos[o] = g.x[i] + g.nx[i] * off;
      pos[o + 1] = y;
      pos[o + 2] = g.z[i] + g.nz[i] * off;
      uv[(k * 2 + side) * 2] = side;
      uv[(k * 2 + side) * 2 + 1] = s / vLen;
    }
    if (k < n - 1) {
      const p = k * 2;
      // left offset b > a; winding so the strip faces up
      idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure the normals point up whatever the winding came out as
  const nrm = geo.attributes.normal;
  if (nrm.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

/** barrier along one side: inner face, top, outer face */
function wallGeometry(g, side, vLen) {
  const off0 = side * WALL_IN;
  const off1 = side * (WALL_IN + ROAD.WALL_T);
  const H = ROAD.WALL_H;
  const n = g.N + 1;
  const pos = [];
  const uv = [];
  const idx = [];
  const strips = [
    [off0, 0, off0, H],
    [off0, H, off1, H],
    [off1, H, off1, 0],
  ];
  for (const [oa, ya, ob, yb] of strips) {
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const i = k % g.N;
      const v = (k * g.ds) / vLen;
      pos.push(g.x[i] + g.nx[i] * oa, ya, g.z[i] + g.nz[i] * oa, g.x[i] + g.nx[i] * ob, yb, g.z[i] + g.nz[i] * ob);
      uv.push(0, v, 1, v);
      if (k < n - 1) {
        const p = base + k * 2;
        if (side > 0) idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        else idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** contiguous sample ranges where the centerline bends harder than radius r */
function cornerRanges(g, r) {
  const hot = (i) => Math.abs(g.kCenter[i]) > 1 / r;
  const ranges = [];
  let start = -1;
  // find a cold sample to start from
  let i0 = 0;
  while (i0 < g.N && hot(i0)) i0++;
  for (let k = 0; k <= g.N; k++) {
    const i = (i0 + k) % g.N;
    if (hot(i) && start < 0) start = i;
    if ((!hot(i) || k === g.N) && start >= 0) {
      ranges.push([(start - 6 + g.N) % g.N, (i + 6) % g.N]);
      start = -1;
    }
  }
  return ranges;
}

/** distance from (x, z) to the centerline (coarse) */
function trackDistance(g, x, z) {
  let best = Infinity;
  for (let i = 0; i < g.N; i += 3) {
    const d = (g.x[i] - x) ** 2 + (g.z[i] - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ─────────────────────────────────────────────────────────────── track

export function buildTrack(scene, g, theme) {
  const group = new THREE.Group();
  group.name = `track:${g.id}`;
  const roofs = [];
  const anim = [];
  const add = (mesh, { shadow = false, receive = true } = {}) => {
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  const rng = createRng([...g.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7));
  const e = g.extent;
  const cx = (e.minX + e.maxX) / 2;
  const cz = (e.minZ + e.maxZ) / 2;

  // ground
  const groundTex = groundTexture(hex(theme.ground), hex(theme.groundAlt), { grid: theme.wallGlow ? '#3a2f7a' : null });
  groundTex.repeat.set(36, 36);
  const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.02, cz);
  ground.name = 'ground';

  // road, shoulders, curbs
  const roadTex = asphaltTexture(theme.asphalt, { neon: !!theme.wallGlow });
  const roadLen = g.length / Math.round(g.length / 16);
  const road = add(new THREE.Mesh(ribbon(g, -ROAD.HW, ROAD.HW, 0.02, roadLen), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 })));
  road.name = 'road';
  const shoulderMat = new THREE.MeshStandardMaterial({ color: theme.shoulder, roughness: 0.95 });
  add(new THREE.Mesh(ribbon(g, ROAD.HW, WALL_IN + 0.05, 0.01, 8), shoulderMat)).name = 'shoulder';
  add(new THREE.Mesh(ribbon(g, -WALL_IN - 0.05, -ROAD.HW, 0.01, 8), shoulderMat)).name = 'shoulder';
  const curbTex = curbTexture();
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const [a, b] of cornerRanges(g, 75)) {
    add(new THREE.Mesh(ribbon(g, ROAD.HW - 0.15, ROAD.HW + 1.0, 0.03, 3, a, b), curbMat)).name = 'curb';
    add(new THREE.Mesh(ribbon(g, -ROAD.HW - 1.0, -ROAD.HW + 0.15, 0.03, 3, a, b), curbMat)).name = 'curb';
  }

  // barriers
  const wallTex = wallTexture(hex(theme.wall), hex(theme.wallStripe));
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, side: THREE.DoubleSide });
  for (const side of [-1, 1]) add(new THREE.Mesh(wallGeometry(g, side, 8), wallMat), { shadow: true }).name = 'barrier';
  if (theme.wallGlow) {
    theme.wallGlow.forEach((col, k) => {
      const side = k ? -1 : 1;
      const glow = new THREE.Mesh(
        ribbon(g, side > 0 ? WALL_IN : -WALL_IN - ROAD.WALL_T, side > 0 ? WALL_IN + ROAD.WALL_T : -WALL_IN, ROAD.WALL_H + 0.02, 8),
        new THREE.MeshBasicMaterial({ color: col }),
      );
      glow.name = 'barrier_glow';
      add(glow, { receive: false });
    });
  }

  // start/finish: checkered line + gantry
  {
    const i = 0;
    const h = Math.atan2(g.tx[i], g.tz[i]);
    const line = add(new THREE.Mesh(new THREE.PlaneGeometry(ROAD.HW * 2, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(12, 2), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })));
    line.rotation.order = 'YXZ';
    line.rotation.set(-Math.PI / 2, h, 0);
    line.position.set(g.x[i], 0.04, g.z[i]);
    line.name = 'start_line';

    const gantry = new THREE.Group();
    gantry.name = 'gantry';
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.4 });
    const postGeo = new THREE.BoxGeometry(0.7, 7.4, 0.7);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(s * (WALL_IN + 0.9), 3.7, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * (WALL_IN + 1.3), 1.8, 0.6), postMat);
    beam.position.y = 7.1;
    beam.castShadow = true;
    gantry.add(beam);
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTexture(g.def.name.toUpperCase()), toneMapped: false });
    for (const s of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * WALL_IN, 1.6), bannerMat);
      banner.position.set(0, 7.1, s * 0.31);
      if (s < 0) banner.rotation.y = Math.PI;
      gantry.add(banner);
    }
    gantry.position.set(g.x[i], 0, g.z[i]);
    gantry.rotation.y = h + Math.PI;
    group.add(gantry);
  }

  // boost pads
  const padTex = padTexture();
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const pad of g.pads) {
    const i = pad.center;
    const mesh = add(new THREE.Mesh(new THREE.PlaneGeometry(pad.halfW * 2, pad.len), padMat), { receive: false });
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-Math.PI / 2, Math.atan2(g.tx[i], g.tz[i]) + Math.PI, 0);
    mesh.position.set(g.x[i] + g.nx[i] * pad.lat, 0.05, g.z[i] + g.nz[i] * pad.lat);
    mesh.name = 'boost_pad';
  }
  anim.push((dt) => (padTex.offset.y = (padTex.offset.y - dt * 1.6) % 1));

  // tunnel roof (canyon)
  if (g.tunnel) {
    const roofMat = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.95 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false });
    const span = (g.tunnel.end - g.tunnel.start + g.N) % g.N;
    for (let k = 0; k < span; k += Math.round(6 / g.ds)) {
      const i = (g.tunnel.start + k) % g.N;
      const h = Math.atan2(g.tx[i], g.tz[i]);
      const seg = new THREE.Group();
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2 * (WALL_IN + 2.2), 1.6, 6.6), roofMat);
      roof.position.y = 8.4;
      roof.castShadow = true;
      seg.add(roof);
      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 8.2, 6.6), roofMat);
        pillar.position.set(s * (WALL_IN + 1.6), 4.1, 0);
        seg.add(pillar);
      }
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 0.6), lampMat);
      lamp.position.y = 7.55;
      seg.add(lamp);
      seg.position.set(g.x[i], 0, g.z[i]);
      seg.rotation.y = h;
      seg.name = 'tunnel_roof';
      group.add(seg);
      roofs.push(seg);
    }
  }

  buildScenery(group, g, theme, rng, anim);

  scene.add(group);
  return {
    group,
    roofs,
    update(dt, t) {
      for (const f of anim) f(dt, t);
    },
  };
}

// ─────────────────────────────────────────────────────────────── scenery

function scatter(g, rng, count, minDist, maxDist, spread, avoid = []) {
  const e = g.extent;
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 40) {
    const x = rng.range(e.minX - spread, e.maxX + spread);
    const z = rng.range(e.minZ - spread, e.maxZ + spread);
    const d = trackDistance(g, x, z);
    if (d < minDist || d > maxDist) continue;
    if (avoid.some((f) => f(x, z))) continue;
    out.push({ x, z, d });
  }
  return out;
}

function instanced(group, geo, mat, items, place, { shadow = true } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  items.forEach((it, k) => {
    const r = place(it, p, q, s, c);
    m.compose(p, q, s);
    mesh.setMatrixAt(k, m);
    if (r !== false && mesh.instanceColor !== undefined) mesh.setColorAt(k, c);
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

function buildScenery(group, g, theme, rng, anim) {
  // everything here is instanced or a handful of meshes, so a track costs ~60 draw calls
  const yAxis = new THREE.Vector3(0, 1, 0);
  const trees = (items, scale = 1) => {
    const leaves = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    instanced(group, new THREE.ConeGeometry(2.2, 6.5, 7), leaves, items, (it, p, q, s, c) => {
      const k = rng.range(0.8, 1.35) * scale;
      it.k = k;
      p.set(it.x, 4.4 * k, it.z);
      q.setFromAxisAngle(yAxis, rng.next() * 6);
      s.set(k, k, k);
      c.setHex(rng.pick(theme.trees));
    }).name = 'trees';
    instanced(group, new THREE.CylinderGeometry(0.35, 0.45, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 1 }), items, (it, p, q, s, c) => {
      p.set(it.x, 0.8 * it.k, it.z);
      q.identity();
      s.set(it.k, it.k, it.k);
      c.setHex(0xffffff);
    }).name = 'trunks';
  };
  const boxes = (items, colors, { hMin, hMax, wMin, wMax, mat, name }) => {
    instanced(group, new THREE.BoxGeometry(1, 1, 1), mat, items, (it, p, q, s, c) => {
      const h = rng.range(hMin, hMax);
      const w = rng.range(wMin, wMax);
      const d = rng.range(wMin, wMax);
      p.set(it.x, h / 2, it.z);
      q.setFromAxisAngle(yAxis, rng.next() * Math.PI);
      s.set(w, h, d);
      c.setHex(rng.pick(colors));
    }).name = name;
  };

  if (theme.water !== undefined) {
    // harbor: the bay sits north of the pier run
    const e = g.extent;
    const waterTex = waterTexture();
    waterTex.repeat.set(30, 8);
    const waterMat = new THREE.MeshStandardMaterial({ color: theme.water, map: waterTex, roughness: 0.25, metalness: 0.1 });
    const bayZ = e.minZ - 4;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 400), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((e.minX + e.maxX) / 2, 0.0, bayZ - 200);
    water.receiveShadow = true;
    water.name = 'water';
    group.add(water);
    anim.push((dt) => (waterTex.offset.x = (waterTex.offset.x + dt * 0.01) % 1));
    const quay = new THREE.Mesh(new THREE.BoxGeometry(1400, 1.2, 2.5), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.9 }));
    quay.position.set((e.minX + e.maxX) / 2, 0.3, bayZ);
    quay.receiveShadow = true;
    quay.name = 'quay';
    group.add(quay);
    const onWater = (x, z) => z < bayZ + 3;
    trees(scatter(g, rng, 120, WALL_IN + 5, 120, 70, [onWater]));
    // warehouses and container stacks
    const wh = scatter(g, rng, 26, WALL_IN + 14, 90, 50, [onWater]);
    boxes(wh, theme.buildings, { hMin: 6, hMax: 14, wMin: 9, wMax: 18, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), name: 'warehouses' });
    const cont = scatter(g, rng, 40, WALL_IN + 6, 40, 30, [onWater]);
    boxes(cont, [0xd9534f, 0x2f7cf6, 0xf0ad4e, 0x2fbf71, 0x8a4dff], { hMin: 2.4, hMax: 5, wMin: 2.4, wMax: 6, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), name: 'containers' });
    // lighthouse on the quay near the lighthouse turn
    const li = g.sections.find((s) => s.id === 'lighthouse_turn')?.start ?? 0;
    const lh = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd63031, roughness: 0.6 });
    for (let k = 0; k < 4; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.4 - k * 0.35, 2.6 - k * 0.35, 4, 12), k % 2 ? red : white);
      seg.position.y = 2 + k * 4;
      seg.castShadow = true;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xffef9a }));
    lamp.position.y = 17;
    lh.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 10), red);
    cap.position.y = 18.9;
    lh.add(cap);
    lh.position.set(g.x[li] - 6, 0, bayZ - 6);
    lh.name = 'lighthouse';
    group.add(lh);
  } else if (theme.mesas) {
    // canyon: mesas, rocks, cacti and a few cliffs around the hairpin
    const mesas = scatter(g, rng, 34, WALL_IN + 22, 160, 90);
    instanced(group, new THREE.CylinderGeometry(1, 1.15, 1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), mesas, (it, p, q, s, c) => {
      const r = rng.range(8, 20);
      const h = rng.range(10, 34);
      p.set(it.x, h / 2, it.z);
      q.setFromAxisAngle(yAxis, rng.next() * 6);
      s.set(r, h, r * rng.range(0.7, 1.2));
      c.setHex(rng.pick(theme.mesas));
    }).name = 'mesas';
    const rocks = scatter(g, rng, 70, WALL_IN + 3, 70, 40);
    instanced(group, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), rocks, (it, p, q, s, c) => {
      const k = rng.range(0.8, 2.6);
      p.set(it.x, k * 0.4, it.z);
      q.setFromAxisAngle(new THREE.Vector3(rng.next(), 1, rng.next()).normalize(), rng.next() * 6);
      s.set(k, k * 0.8, k);
      c.setHex(theme.rock).offsetHSL(0, 0, rng.range(-0.05, 0.05));
    }).name = 'rocks';
    const cacti = scatter(g, rng, 46, WALL_IN + 4, 60, 30);
    instanced(group, new THREE.CylinderGeometry(0.45, 0.5, 3.6, 7), new THREE.MeshStandardMaterial({ color: theme.cactus, roughness: 0.9, flatShading: true }), cacti, (it, p, q, s, c) => {
      const k = rng.range(0.7, 1.3);
      p.set(it.x, 1.8 * k, it.z);
      q.identity();
      s.set(k, k, k);
      c.setHex(0xffffff);
    }).name = 'cacti';
    trees(scatter(g, rng, 30, WALL_IN + 6, 80, 40), 0.8);
    // the cliff: tall rock wall outside the hairpin
    const hp = g.sections.find((s) => s.id === 'cliff_hairpin');
    if (hp) {
      const cliffMat = new THREE.MeshStandardMaterial({ color: 0xb35a32, roughness: 1, flatShading: true });
      for (let k = 0; k < 70; k += 3) {
        const i = (hp.start + k) % g.N;
        if (Math.abs(g.kCenter[i]) < 1 / 30) continue; // only around the bend itself
        const side = Math.sign(g.kCenter[i]);
        const off = -side * (WALL_IN + 7 + rng.range(0, 4)); // outside of the bend
        const bx = g.x[i] + g.nx[i] * off;
        const bz = g.z[i] + g.nz[i] * off;
        if (trackDistance(g, bx, bz) < WALL_IN + 5) continue;
        const h = rng.range(9, 18);
        const block = new THREE.Mesh(new THREE.BoxGeometry(rng.range(6, 10), h, rng.range(6, 9)), cliffMat);
        block.position.set(bx, h / 2, bz);
        block.rotation.y = rng.next() * 3;
        block.castShadow = true;
        block.receiveShadow = true;
        block.name = 'cliff';
        group.add(block);
      }
    }
  } else {
    // neon: towers with lit windows, glowing arches over the road
    const towers = scatter(g, rng, 44, WALL_IN + 16, 140, 70);
    const winTex = windowsTexture(theme.windows);
    winTex.repeat.set(1, 2);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.1, roughness: 0.7 });
    instanced(group, new THREE.BoxGeometry(1, 1, 1), towerMat, towers, (it, p, q, s, c) => {
      const h = rng.range(14, 48);
      const w = rng.range(8, 16);
      p.set(it.x, h / 2, it.z);
      q.setFromAxisAngle(yAxis, rng.next() * Math.PI);
      s.set(w, h, w * rng.range(0.7, 1.2));
      c.setHex(rng.pick(theme.buildings));
    }).name = 'towers';
    const archMat = [new THREE.MeshBasicMaterial({ color: theme.wallGlow[0], toneMapped: false }), new THREE.MeshBasicMaterial({ color: theme.wallGlow[1], toneMapped: false })];
    let k = 0;
    for (let i = 20; i < g.N - 10; i += Math.round(70 / g.ds)) {
      const h = Math.atan2(g.tx[i], g.tz[i]);
      const arch = new THREE.Group();
      const mat = archMat[k++ % 2];
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), mat);
        post.position.set(s * (WALL_IN + 0.8), 4, 0);
        arch.add(post);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(2 * (WALL_IN + 1.05), 0.5, 0.5), mat);
      top.position.y = 8;
      arch.add(top);
      arch.position.set(g.x[i], 0, g.z[i]);
      arch.rotation.y = h;
      arch.name = 'neon_arch';
      group.add(arch);
    }
    const props = scatter(g, rng, 40, WALL_IN + 4, 30, 20);
    instanced(group, new THREE.CylinderGeometry(0.18, 0.18, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), props, (it, p, q, s, c) => {
      p.set(it.x, 3, it.z);
      q.identity();
      s.set(1, 1, 1);
      c.setHex(rng.pick(theme.wallGlow));
    }, { shadow: false }).name = 'light_posts';
  }
}

/** remove a track and free its GPU memory */
export function unloadTrack(world, scene) {
  scene.remove(world.group);
  const seen = new Set();
  world.group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const key of ['map', 'emissiveMap']) if (m[key] && !seen.has(m[key])) (seen.add(m[key]), m[key].dispose());
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
}
