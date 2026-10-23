// Builds a floor's meshes from its grid: stone slabs, walls (tall at the back of a room, low at the front so the
// angled camera can see in), the gallery ledges, pillars, the stairs, torches with a fixed pool of lights, and
// decor. Lights never change in number (a new light count would recompile every lit material).
import * as THREE from 'three';
import { TILE, tileCenter } from './floors.js';
import { T, get, walkable, LEDGE_HEIGHT } from './grid.js';
import { createRng } from './rng.js';

const TORCH_LIGHTS = 6;
const WALL = { tall: 3.2, side: 2.6, short: 0.55 };

// ─────────────────────────────────────────────────────────────── procedural textures

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function speckle(g, size, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

const slabTex = () =>
  canvasTex(256, (g, s) => {
    g.fillStyle = '#7a746c';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 4000, 0.07);
    // worn centre, darker edges
    const grad = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
    grad.addColorStop(0, 'rgba(255,240,220,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(20,16,14,0.55)';
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      g.moveTo(x, y);
      for (let i = 0; i < 5; i++) {
        x += (Math.random() - 0.5) * 70;
        y += (Math.random() - 0.5) * 70;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, s, s);
  });

const brickTex = () =>
  canvasTex(256, (g, s) => {
    g.fillStyle = '#2b2622';
    g.fillRect(0, 0, s, s);
    const rows = 6;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? h * 0.9 : 0;
      for (let x = -off; x < s; x += h * 1.8) {
        const v = 88 + Math.floor(Math.random() * 30);
        g.fillStyle = `rgb(${v},${v - 6},${v - 12})`;
        g.fillRect(x + 3, r * h + 3, h * 1.8 - 6, h - 6);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + 3, r * h + h - 10, h * 1.8 - 6, 7);
      }
    }
    speckle(g, s, 3000, 0.08);
  });

const capTex = () =>
  canvasTex(128, (g, s) => {
    g.fillStyle = '#4a423b';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 2500, 0.1);
    g.strokeStyle = 'rgba(20,16,14,0.7)';
    g.lineWidth = 5;
    g.strokeRect(0, 0, s, s);
  });

const glowTex = () =>
  canvasTex(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,220,160,1)');
    grad.addColorStop(0.25, 'rgba(255,140,50,0.55)');
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

function addTo(group, m) {
  if (m) group.add(m);
}

/** A box whose side UVs are in metres/2, so bricks keep their size on walls of any height. */
function wallGeo(h) {
  const geo = new THREE.BoxGeometry(TILE, h, TILE);
  const uv = geo.attributes.uv;
  const n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) continue;
    uv.setY(i, uv.getY(i) * (h / TILE));
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const tex = { slab: slabTex(), brick: brickTex(), cap: capTex(), glow: glowTex() };
  const mat = {
    floor: new THREE.MeshStandardMaterial({ map: tex.slab, roughness: 0.92, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.brick, roughness: 0.95, metalness: 0 }),
    cap: new THREE.MeshStandardMaterial({ map: tex.cap, roughness: 1, color: 0xb0a69c }),
    ledgeTop: new THREE.MeshStandardMaterial({ map: tex.slab, roughness: 0.9, color: 0xb9ae9e }),
    trim: new THREE.MeshStandardMaterial({ color: 0x4a423a, roughness: 0.8 }),
    pillar: new THREE.MeshStandardMaterial({ map: tex.brick, roughness: 0.9, color: 0xb0a69a }),
    void: new THREE.MeshBasicMaterial({ color: 0x050407 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.45 }),
    pit: new THREE.MeshBasicMaterial({ color: 0x020203 }),
    step: new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.95 }),
    rune: new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    beam: new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.85 }),
    band: new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.6, roughness: 0.5 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.85 }),
    rubble: new THREE.MeshStandardMaterial({ color: 0x5e5750, roughness: 1 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    glow: new THREE.SpriteMaterial({ map: tex.glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    banner: new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.9, side: THREE.DoubleSide }),
    bannerTrim: new THREE.MeshStandardMaterial({ color: 0xc08a3a, roughness: 0.6, metalness: 0.5 }),
  };
  const geo = {
    slab: new THREE.BoxGeometry(TILE - 0.06, 0.3, TILE - 0.06).translate(0, -0.15, 0),
    ledge: new THREE.BoxGeometry(TILE, LEDGE_HEIGHT + 0.3, TILE).translate(0, (LEDGE_HEIGHT + 0.3) / 2 - 0.3, 0),
    wallTall: wallGeo(WALL.tall),
    wallSide: wallGeo(WALL.side),
    wallShort: wallGeo(WALL.short),
    pillar: new THREE.CylinderGeometry(0.62, 0.72, 1, 14).translate(0, 0.5, 0),
    pillarBase: new THREE.BoxGeometry(1.6, 0.4, 1.6).translate(0, 0.2, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    barrel: new THREE.CylinderGeometry(0.34, 0.3, 0.8, 12).translate(0, 0.4, 0),
    hoop: new THREE.CylinderGeometry(0.355, 0.355, 0.06, 12),
    bone: new THREE.CapsuleGeometry(0.05, 0.4, 2, 6),
    skull: new THREE.SphereGeometry(0.13, 10, 8),
    rubble: new THREE.DodecahedronGeometry(0.22, 0),
    flame: new THREE.ConeGeometry(0.12, 0.38, 8).translate(0, 0.19, 0),
    ring: new THREE.RingGeometry(0.75, 0.95, 40),
    disc: new THREE.CircleGeometry(0.9, 32),
    beam: new THREE.CylinderGeometry(0.75, 0.9, 6, 24, 1, true).translate(0, 3, 0),
    banner: new THREE.PlaneGeometry(0.8, 1.5),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  const wallMats = [mat.wall, mat.wall, mat.cap, mat.cap, mat.wall, mat.wall];

  // ── lights: hemisphere + a moon-ish key light with shadows + a fixed pool of torch lights
  const hemi = new THREE.HemisphereLight(0x8d92b8, 0x2a1a10, 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe2c4, 1.25);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);
  const pool = [];
  for (let i = 0; i < TORCH_LIGHTS; i++) {
    const l = new THREE.PointLight(0xff9a50, 0, 11, 1.6);
    scene.add(l);
    pool.push(l);
  }

  let built = null;

  function clear() {
    if (!built) return;
    root.remove(built.group);
    built.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    built = null;
  }

  function instanced(geometry, material, items, place, { shadow = true, receive = true, colors = null } = {}) {
    if (!items.length) return null;
    const m = new THREE.InstancedMesh(geometry, material, items.length);
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      place(o, it, i);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (colors) m.setColorAt(i, colors(it, i));
    });
    m.castShadow = shadow;
    m.receiveShadow = receive;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return m;
  }

  /** Build the meshes for a floor. */
  function build(grid, floor) {
    clear();
    const group = new THREE.Group();
    group.name = floor.id;
    const rng = createRng(floor.id.length * 7919 + floor.size[0] * 31);
    const tint = new THREE.Color(floor.tint);
    const floors = [];
    const ledges = [];
    const walls = { tall: [], side: [], short: [] };
    const open = (c, r) => walkable(get(grid, c, r));
    const blocked = new Set();
    for (const [c, r] of floor.pillars) blocked.add(`${c},${r}`);
    blocked.add(`${floor.stairs[0]},${floor.stairs[1]}`);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const v = get(grid, c, r);
        if (v === T.FLOOR || v === T.PILLAR) floors.push([c, r]);
        else if (v === T.LEDGE) ledges.push([c, r]);
        else if (v === T.WALL) {
          let cls;
          if (open(c, r + 1)) cls = 'tall';
          else if (open(c, r - 1)) cls = 'short';
          else if (open(c + 1, r) || open(c - 1, r)) cls = 'side';
          else if (open(c + 1, r + 1) || open(c - 1, r + 1)) cls = 'tall';
          else cls = 'short';
          walls[cls].push([c, r]);
        }
      }
    }
    const at = (o, [c, r], y = 0) => {
      const p = tileCenter(c, r);
      o.position.set(p.x, y, p.z);
    };
    const shade = new THREE.Color();
    const roomOf = (c, r) => grid.room[r * grid.cols + c];
    const bossRoom = floor.rooms.findIndex((rm) => rm.boss);
    addTo(
      group,
      instanced(geo.slab, mat.floor, floors, (o, t) => at(o, t), {
        shadow: false,
        colors: ([c, r]) => {
          const k = 0.72 + rng.next() * 0.22;
          shade.setRGB(k, k * 0.97, k * 0.93);
          if (bossRoom >= 0 && roomOf(c, r) === bossRoom) shade.lerp(new THREE.Color(0.75, 0.45, 0.38), 0.45);
          return shade.clone();
        },
      }),
    );
    const ledgeMesh = instanced(geo.ledge, [mat.trim, mat.trim, mat.ledgeTop, mat.trim, mat.trim, mat.trim], ledges, (o, t) => at(o, t));
    addTo(group, ledgeMesh);
    for (const cls of ['tall', 'side', 'short']) {
      const g = cls === 'tall' ? geo.wallTall : cls === 'side' ? geo.wallSide : geo.wallShort;
      const m = instanced(g, wallMats, walls[cls], (o, t) => at(o, t), {
        colors: () => {
          const k = 0.8 + rng.next() * 0.25;
          return new THREE.Color(k, k, k);
        },
      });
      addTo(group, m);
    }
    // a black floor under everything, so the void between rooms reads as nothing
    const under = new THREE.Mesh(geo.plane, mat.void);
    under.rotation.x = -Math.PI / 2;
    under.scale.set(grid.w + 40, grid.h + 40, 1);
    under.position.set(grid.w / 2, -0.32, grid.h / 2);
    group.add(under);

    // pillars (the gallery's one is broken off at waist height)
    const pillars = floor.pillars.map(([c, r]) => ({ c, r, broken: floor.id === 'floor-2' && c === 33 }));
    addTo(group, instanced(geo.pillarBase, mat.trim, pillars, (o, p) => at(o, [p.c, p.r])));
    addTo(
      group,
      instanced(geo.pillar, mat.pillar, pillars, (o, p) => {
        at(o, [p.c, p.r], 0.35);
        o.scale.set(1, p.broken ? 1.3 : 3.1, 1);
        if (p.broken) o.rotation.z = 0.08;
      }),
    );
    const caps = pillars.filter((p) => !p.broken);
    if (caps.length) addTo(group, instanced(geo.pillarBase, mat.trim, caps, (o, p) => at(o, [p.c, p.r], 3.4)));

    // stairs: a pit with steps going down, an iron grate until the floor is cleared, then a glow
    const sp = tileCenter(floor.stairs[0], floor.stairs[1]);
    const stairs = new THREE.Group();
    stairs.position.set(sp.x, 0, sp.z);
    const pit = new THREE.Mesh(geo.box, mat.pit);
    pit.scale.set(1.8, 0.02, 1.8);
    pit.position.y = 0.005;
    stairs.add(pit);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(geo.box, mat.step);
      s.scale.set(1.7, 0.06, 0.38);
      s.position.set(0, 0.02 - i * 0.003, -0.7 + i * 0.42);
      s.material = mat.step;
      s.receiveShadow = true;
      const k = 1 - i * 0.22;
      s.scale.x = 1.7 * k + 0.2;
      stairs.add(s);
    }
    for (const [x, z, w, d] of [
      [0, -0.95, 2.1, 0.2],
      [0, 0.95, 2.1, 0.2],
      [-0.95, 0, 0.2, 1.7],
      [0.95, 0, 0.2, 1.7],
    ]) {
      const f = new THREE.Mesh(geo.box, mat.trim);
      f.scale.set(w, 0.22, d);
      f.position.set(x, 0.11, z);
      f.castShadow = f.receiveShadow = true;
      stairs.add(f);
    }
    const grate = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(geo.box, mat.iron);
      b.scale.set(0.07, 0.07, 1.8);
      b.position.set(-0.75 + i * 0.3, 0.22, 0);
      b.castShadow = true;
      grate.add(b);
    }
    for (const z of [-0.5, 0.5]) {
      const b = new THREE.Mesh(geo.box, mat.iron);
      b.scale.set(1.8, 0.07, 0.07);
      b.position.set(0, 0.24, z);
      grate.add(b);
    }
    stairs.add(grate);
    const rune = new THREE.Mesh(geo.ring, mat.rune);
    rune.rotation.x = -Math.PI / 2;
    rune.position.y = 0.25;
    rune.scale.setScalar(1.25);
    stairs.add(rune);
    const beam = new THREE.Mesh(geo.beam, mat.beam);
    stairs.add(beam);
    group.add(stairs);

    // torches on the back walls (every third tile) and the side walls (every fourth)
    const torches = [];
    for (const [c, r] of walls.tall) {
      if (!open(c, r + 1) || (c + r) % 3 !== 0) continue;
      const p = tileCenter(c, r);
      torches.push({ x: p.x, y: 2.15, z: p.z + TILE / 2 + 0.12, nx: 0, nz: 1 });
    }
    for (const [c, r] of walls.side) {
      if (r % 4 !== 1) continue;
      const p = tileCenter(c, r);
      if (open(c + 1, r)) torches.push({ x: p.x + TILE / 2 + 0.12, y: 1.9, z: p.z, nx: 1, nz: 0 });
      else if (open(c - 1, r)) torches.push({ x: p.x - TILE / 2 - 0.12, y: 1.9, z: p.z, nx: -1, nz: 0 });
    }
    addTo(
      group,
      instanced(geo.box, mat.iron, torches, (o, t) => {
        o.position.set(t.x - t.nx * 0.08, t.y - 0.18, t.z - t.nz * 0.08);
        o.scale.set(0.12 + Math.abs(t.nz) * 0.1, 0.36, 0.12 + Math.abs(t.nx) * 0.1);
      }),
    );
    const flames = [];
    for (const t of torches) {
      const f = new THREE.Mesh(geo.flame, mat.flame);
      f.position.set(t.x, t.y, t.z);
      group.add(f);
      const s = new THREE.Sprite(mat.glow);
      s.position.set(t.x + t.nx * 0.1, t.y + 0.2, t.z + t.nz * 0.1);
      s.scale.setScalar(1.6);
      group.add(s);
      flames.push({ f, s, ph: rng.next() * 10, t });
    }
    // banners between torches on some back walls
    const banners = walls.tall.filter(([c, r]) => open(c, r + 1) && (c + r) % 3 === 1 && rng.chance(0.45));
    for (const [c, r] of banners) {
      const p = tileCenter(c, r);
      const b = new THREE.Mesh(geo.banner, mat.banner);
      b.position.set(p.x, 2.0, p.z + TILE / 2 + 0.03);
      group.add(b);
      const bar = new THREE.Mesh(geo.box, mat.bannerTrim);
      bar.scale.set(0.95, 0.06, 0.06);
      bar.position.set(p.x, 2.78, p.z + TILE / 2 + 0.05);
      group.add(bar);
      const emblem = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: tint }));
      emblem.scale.setScalar(0.2);
      emblem.position.set(p.x, 2.15, p.z + TILE / 2 + 0.04);
      group.add(emblem);
    }

    // decor along the walls, away from where things happen
    const spots = floors.filter(([c, r]) => {
      if (blocked.has(`${c},${r}`)) return false;
      const near = !open(c - 1, r) || !open(c + 1, r) || !open(c, r - 1);
      return near && Math.hypot(c - floor.start[0], r - floor.start[1]) > 2;
    });
    const take = (n) => {
      const out = [];
      for (let i = 0; i < n && spots.length; i++) out.push(spots.splice(Math.floor(rng.next() * spots.length), 1)[0]);
      return out;
    };
    const nudge = ([c, r]) => {
      const p = tileCenter(c, r);
      let x = p.x;
      let z = p.z;
      if (!open(c - 1, r)) x -= 0.55;
      if (!open(c + 1, r)) x += 0.55;
      if (!open(c, r - 1)) z -= 0.55;
      return { x: x + (rng.next() - 0.5) * 0.3, z: z + (rng.next() - 0.5) * 0.3, a: rng.next() * 6.28 };
    };
    const barrels = take(floor.decor.barrels).map(nudge);
    addTo(group, instanced(geo.barrel, mat.wood, barrels, (o, b) => o.position.set(b.x, 0, b.z)));
    addTo(
      group,
      instanced(geo.hoop, mat.band, [...barrels, ...barrels], (o, b, i) => {
        o.position.set(b.x, i < barrels.length ? 0.18 : 0.62, b.z);
      }),
    );
    const bones = take(floor.decor.bones).map(nudge);
    addTo(
      group,
      instanced(geo.bone, mat.bone, [...bones, ...bones], (o, b, i) => {
        o.position.set(b.x + (i % 2) * 0.15, 0.05, b.z);
        o.rotation.set(Math.PI / 2, 0, b.a + i);
      }),
    );
    addTo(group, instanced(geo.skull, mat.bone, bones.filter((_, i) => i % 2 === 0), (o, b) => o.position.set(b.x + 0.2, 0.1, b.z - 0.15)));
    const rubble = take(floor.decor.rubble).flatMap((t) => {
      const b = nudge(t);
      return [0, 1, 2].map((k) => ({ x: b.x + (rng.next() - 0.5) * 0.7, z: b.z + (rng.next() - 0.5) * 0.7, s: 0.5 + rng.next() * 0.9, a: rng.next() * 6 + k }));
    });
    addTo(
      group,
      instanced(geo.rubble, mat.rubble, rubble, (o, b) => {
        o.position.set(b.x, 0.08 * b.s, b.z);
        o.rotation.set(b.a, b.a * 2, 0);
        o.scale.setScalar(b.s);
      }),
    );

    root.add(group);
    built = { group, grid, floor, torches, flames, stairs: { group: stairs, grate, rune, beam, open: false, t: 0 } };
    return built;
  }

  function setStairsOpen(open) {
    if (!built) return;
    built.stairs.open = open;
    built.stairs.t = 0;
    built.stairs.grate.visible = !open;
  }

  const focus = new THREE.Vector3();
  let poolT = 0;
  function update(dt, clock, target) {
    focus.copy(target);
    key.position.set(target.x - 7, 20, target.z + 9);
    key.target.position.set(target.x, 0, target.z);
    if (!built) return;
    // flicker
    for (const fl of built.flames) {
      const k = 1 + Math.sin(clock * 13 + fl.ph) * 0.12 + Math.sin(clock * 29 + fl.ph * 2) * 0.08;
      fl.f.scale.set(1, k, 1);
      fl.s.scale.setScalar(1.5 * k);
    }
    // the torch lights go to the torches nearest the camera's target
    poolT -= dt;
    if (poolT <= 0) {
      poolT = 0.25;
      const ranked = built.torches.map((t) => ({ t, d: (t.x - target.x) ** 2 + (t.z - target.z) ** 2 })).sort((a, b) => a.d - b.d);
      pool.forEach((l, i) => {
        const r = ranked[i];
        if (!r || r.d > 26 * 26) {
          l.userData.on = false;
          return;
        }
        l.userData.on = true;
        l.position.set(r.t.x + r.t.nx * 0.7, r.t.y + 0.2, r.t.z + r.t.nz * 0.7);
        l.userData.ph = r.t.x + r.t.z;
      });
    }
    for (const l of pool) {
      const on = l.userData.on ? 1 : 0;
      l.intensity = on * (16 + Math.sin(clock * 11 + (l.userData.ph || 0)) * 2.5 + Math.sin(clock * 23 + (l.userData.ph || 0)) * 1.5);
    }
    // stairs
    const s = built.stairs;
    s.t += dt;
    if (s.open) {
      const a = Math.min(1, s.t / 0.8);
      mat.rune.opacity = a * (0.7 + Math.sin(clock * 4) * 0.2);
      mat.beam.opacity = a * (0.16 + Math.sin(clock * 3) * 0.05);
      s.rune.rotation.z = clock * 0.8;
    } else {
      mat.rune.opacity = 0.08 + Math.sin(clock * 2) * 0.04;
      mat.beam.opacity = 0;
    }
  }

  return {
    root,
    build,
    update,
    setStairsOpen,
    get built() {
      return built;
    },
    lights: { hemi, key, pool },
  };
}
