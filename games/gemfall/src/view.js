// The board on screen: a tilted slab with tiles, stone tiles, the gems, and how they move. It animates the
// phases play.js returns (swap, clear, fall, collect, reshuffle); the logic is already final by then.
import * as THREE from 'three';
import { ROWS, COLS, isVoid } from './board.js';
import { T } from './timing.js';
import { GEM_COLORS } from './gems.js';

export const TILT = 0.3; // rad: the top of the board leans away from the camera
const GEM_Z = 0.32;

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
export const cellX = (c) => c - (COLS - 1) / 2;
export const cellY = (r) => (ROWS - 1) / 2 - r;

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#a7a3ba';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 120 + Math.floor(Math.random() * 90);
    g.fillStyle = `rgba(${v},${v - 4},${v + 10},0.45)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  g.strokeStyle = 'rgba(70,64,92,0.9)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.strokeStyle = 'rgba(30,24,48,0.95)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(30, 18);
  g.lineTo(52, 54);
  g.lineTo(40, 88);
  g.moveTo(52, 54);
  g.lineTo(92, 62);
  g.lineTo(108, 40);
  g.moveTo(92, 62);
  g.lineTo(98, 104);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBoardView(scene, kit, makeFx) {
  const group = new THREE.Group();
  group.name = 'board';
  group.rotation.x = -TILT;
  scene.add(group);

  // slab + frame
  const slabGeo = new THREE.ExtrudeGeometry(roundedRect(8.9, 8.9, 0.55), { depth: 0.42, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 10 });
  slabGeo.translate(0, 0, -0.62); // top face at z = -0.12, under the tiles
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x1d1442, roughness: 0.55, metalness: 0.2, envMapIntensity: 0.4 }));
  slab.name = 'slab';
  group.add(slab);
  const rimGeo = new THREE.ExtrudeGeometry(roundedRect(9.25, 9.25, 0.7), { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 });
  rimGeo.translate(0, 0, -0.74);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.28, metalness: 0.9, emissive: 0x3a2400, emissiveIntensity: 0.3, envMapIntensity: 1.2 }));
  rim.name = 'rim';
  group.add(rim);

  // soft glow behind the board
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,120,220,0.85)');
    grd.addColorStop(0.45, 'rgba(140,90,255,0.45)');
    grd.addColorStop(1, 'rgba(60,40,160,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, toneMapped: false }));
  glow.position.z = -0.9;
  glow.name = 'glow';
  group.add(glow);

  // tiles: one instanced mesh (a checker of two tones; gaps are dark)
  const tileGeo = new THREE.ExtrudeGeometry(roundedRect(0.94, 0.94, 0.14), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 4 });
  tileGeo.translate(0, 0, -0.06);
  const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.3 }), ROWS * COLS);
  tiles.name = 'tiles';
  const m4 = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) tiles.setMatrixAt(r * COLS + c, m4.makeTranslation(cellX(c), cellY(r), 0));
  group.add(tiles);
  const TILE_A = new THREE.Color(0x33256a);
  const TILE_B = new THREE.Color(0x2b1f5c);
  const TILE_VOID = new THREE.Color(0x0d0820);

  // stones (pooled meshes, one shared geometry/material)
  const stoneGeo = new THREE.ExtrudeGeometry(roundedRect(0.9, 0.9, 0.14), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 4 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9, metalness: 0.0, color: 0xffffff, envMapIntensity: 0.6 });
  const stoneMeshes = new Map(); // key → mesh
  const stonePool = [];

  // light sparkles drifting behind the board (static pool)
  const SPARK = 90;
  const sparkPos = new Float32Array(SPARK * 3);
  const sparkSeed = [];
  for (let i = 0; i < SPARK; i++) {
    sparkSeed.push({ x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 14, z: -2 - Math.random() * 6, s: 0.2 + Math.random() * 0.5, p: Math.random() * 10 });
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.09, color: 0xc9b6ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sparks.frustumCulled = false;
  sparks.name = 'ambient-sparks';
  scene.add(sparks);

  const fx = makeFx(group);
  const gems = new Map(); // id → gem object
  let shake = 0;

  function place(g, r, c) {
    g.userData.r = r;
    g.userData.c = c;
    g.position.set(cellX(c), cellY(r), GEM_Z);
  }

  function addGem(cell, r, c) {
    const g = kit.make(cell);
    g.userData.id = cell.id;
    g.userData.kind = cell.kind;
    g.userData.special = cell.special;
    g.userData.anim = null;
    g.userData.phase = Math.random() * 10;
    place(g, r, c);
    group.add(g);
    gems.set(cell.id, g);
    return g;
  }

  function removeGem(id) {
    const g = gems.get(id);
    if (!g) return;
    gems.delete(id);
    kit.release(g);
  }

  function setStone(r, c, layers) {
    const k = r * COLS + c;
    const have = stoneMeshes.get(k);
    if (layers > 0 && !have) {
      const m = stonePool.pop() || new THREE.Mesh(stoneGeo, stoneMat);
      m.name = 'stone';
      m.position.set(cellX(c), cellY(r), -0.02);
      m.scale.setScalar(1);
      group.add(m);
      stoneMeshes.set(k, m);
    } else if (layers <= 0 && have) {
      stoneMeshes.delete(k);
      have.removeFromParent();
      stonePool.push(have);
    }
  }

  /** Animate a gem from where it is to (r, c) over d seconds. */
  function slide(g, r, c, d, ease = easeInOut) {
    g.userData.anim = { type: 'slide', x0: g.position.x, y0: g.position.y, x1: cellX(c), y1: cellY(r), t: 0, d, ease };
    g.userData.r = r;
    g.userData.c = c;
  }

  const view = {
    group,
    fx,
    gems,
    /** Lay out a fresh level. */
    build(st) {
      for (const id of [...gems.keys()]) removeGem(id);
      for (const k of [...stoneMeshes.keys()]) setStone(Math.floor(k / COLS), k % COLS, 0);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = st.grid[r][c];
          tiles.setColorAt(r * COLS + c, isVoid(cell) ? TILE_VOID : (r + c) % 2 ? TILE_A : TILE_B);
          // gaps have no tile: the slab shows through, so the board's shape reads at a glance
          tiles.setMatrixAt(r * COLS + c, isVoid(cell) ? m4.makeScale(0, 0, 0) : m4.makeTranslation(cellX(c), cellY(r), 0));
          setStone(r, c, st.stones[r][c]);
          if (cell && !isVoid(cell)) addGem(cell, r, c);
        }
      }
      tiles.instanceColor.needsUpdate = true;
      tiles.instanceMatrix.needsUpdate = true;
      fx.showSelect(null);
      fx.showHint(null);
    },
    /** Snap every gem to the logic grid (agent tools change the board directly). */
    sync(st) {
      const seen = new Set();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = st.grid[r][c];
          if (!cell || isVoid(cell)) continue;
          seen.add(cell.id);
          let g = gems.get(cell.id);
          if (!g) g = addGem(cell, r, c);
          else if (g.userData.kind !== cell.kind || g.userData.special !== cell.special) {
            kit.restyle(g, cell);
            g.userData.kind = cell.kind;
            g.userData.special = cell.special;
          }
          g.userData.anim = null;
          g.scale.setScalar(1);
          place(g, r, c);
          setStone(r, c, st.stones[r][c]);
        }
      }
      for (const id of [...gems.keys()]) if (!seen.has(id)) removeGem(id);
    },
    swap(ph, back) {
      const [ida, idb] = ph.ids;
      const ga = gems.get(ida);
      const gb = gems.get(idb);
      if (ga) slide(ga, ...(back ? ph.a : ph.b), T.swap);
      if (gb) slide(gb, ...(back ? ph.b : ph.a), T.swap);
    },
    /** One clear step: pop the gems (shards!), fire special effects, break stones, show new specials. */
    clear(ph) {
      for (const c of ph.cleared) {
        const g = gems.get(c.id);
        const color = typeof c.kind === 'number' ? GEM_COLORS[c.kind] : c.kind === 'prism' ? 0xffffff : 0xffc83a;
        fx.burst(cellX(c.c), cellY(c.r), color);
        if (g) {
          gems.delete(c.id);
          g.userData.anim = { type: 'pop', t: 0, d: ph.fx.length ? T.popFx : T.pop };
          g.userData.dying = true;
          dying.push(g);
        }
      }
      for (const e of ph.fx) {
        const color = typeof e.kind === 'number' ? GEM_COLORS[e.kind] : 0xffffff;
        if (e.type === 'row' || e.type === 'col') fx.beam(e.type, e.r, e.c, color, e.wide);
        else if (e.type === 'bomb') fx.shockwave(e.r, e.c, color, e.size === 2 ? 4.2 : 2.6);
        else if (e.type === 'prism') {
          fx.shockwave(e.r, e.c, 0xffffff, e.all ? 9 : 6);
          fx.shockwave(e.r, e.c, 0xc8a8ff, e.all ? 6 : 4);
        }
      }
      for (const s of ph.stones) {
        setStone(s.r, s.c, s.left);
        fx.dustBurst(cellX(s.c), cellY(s.r), 0xb8b0d8, 12, 2.2, 0.55);
      }
      for (const cr of ph.created) {
        const g = addGem(cr.cell, cr.r, cr.c);
        g.scale.setScalar(0.01);
        g.userData.anim = { type: 'appear', t: -0.06, d: 0.24 };
        fx.dustBurst(cellX(cr.c), cellY(cr.r), 0xffffff, 18, 3, 0.4);
      }
      shake = Math.max(shake, Math.min(0.35, ph.cleared.length / 70));
    },
    fall(ph) {
      for (const m of ph.moves) {
        const g = gems.get(m.id);
        if (!g) continue;
        const d = T.fallBase + (m.r - m.from) * T.fallPerCell;
        g.userData.anim = { type: 'fall', y0: g.position.y, y1: cellY(m.r), x: cellX(m.c), t: 0, d, grow: g.scale.x < 0.99 };
        g.userData.r = m.r;
        g.userData.c = m.c;
      }
      for (const s of ph.spawns) {
        const g = addGem(s.cell, s.r, s.c);
        g.position.y = cellY(s.from);
        const d = T.fallBase + (s.r - s.from) * T.fallPerCell;
        g.userData.anim = { type: 'fall', y0: cellY(s.from), y1: cellY(s.r), x: cellX(s.c), t: 0, d, spawn: true };
      }
    },
    collect(ph) {
      for (const cr of ph.crowns) {
        const g = gems.get(cr.id);
        fx.dustBurst(cellX(cr.c), cellY(cr.r), 0xffd25a, 30, 3.5, 0.7);
        fx.shockwave(cr.r, cr.c, 0xffd25a, 2.4);
        if (g) {
          gems.delete(cr.id);
          g.userData.anim = { type: 'lift', t: 0, d: T.collect, y0: g.position.y };
          dying.push(g);
        }
      }
    },
    reshuffle(ph) {
      for (const p of ph.positions) {
        const g = gems.get(p.id);
        if (g) {
          slide(g, p.r, p.c, T.reshuffle * 0.9);
          g.userData.spin = 1;
        }
      }
    },
    hammer(r, c) {
      fx.shockwave(r, c, 0xffe9a8, 1.8);
      fx.dustBurst(cellX(c), cellY(r), 0xffe9a8, 16, 3, 0.4);
      shake = Math.max(shake, 0.25);
    },
    placeSpecial(info) {
      removeGem(info.old.id);
      const g = addGem(info.cell, info.r, info.c);
      g.scale.setScalar(0.01);
      g.userData.anim = { type: 'appear', t: 0, d: 0.25 };
    },
    update(dt, clock) {
      for (const g of gems.values()) {
        const u = g.userData;
        const a = u.anim;
        if (a) {
          a.t += dt;
          const k = Math.max(0, Math.min(1, a.t / a.d));
          if (a.type === 'slide') {
            const e = a.ease(k);
            g.position.x = a.x0 + (a.x1 - a.x0) * e;
            g.position.y = a.y0 + (a.y1 - a.y0) * e;
            g.position.z = GEM_Z + Math.sin(k * Math.PI) * 0.25;
          } else if (a.type === 'fall') {
            const e = k * k;
            g.position.x = a.x;
            g.position.y = a.y0 + (a.y1 - a.y0) * e;
            if (a.spawn || a.grow) g.scale.setScalar(Math.min(1, 0.5 + k));
          } else if (a.type === 'appear') {
            g.scale.setScalar(k <= 0 ? 0.01 : 0.01 + easeOut(k) * 1.15 - Math.max(0, k - 0.7) * 0.5);
          } else if (a.type === 'land') {
            const sq = Math.sin(k * Math.PI) * 0.12;
            g.scale.set(1 + sq, 1 - sq, 1);
          }
          if (k >= 1) {
            if (a.type === 'fall') {
              g.position.y = a.y1;
              u.anim = { type: 'land', t: 0, d: 0.12 };
            } else {
              u.anim = null;
              g.scale.setScalar(1);
              g.position.z = GEM_Z;
              if (a.type === 'slide') g.position.set(a.x1, a.y1, GEM_Z);
              u.spin = 0;
            }
          }
        }
        // idle sparkle: facets catch the light
        const p = u.phase;
        g.rotation.y = Math.sin(clock * 1.3 + p) * 0.22 + (u.spin ? (u.anim ? u.anim.t * 14 : 0) : 0);
        g.rotation.x = Math.cos(clock * 1.1 + p * 1.7) * 0.12;
        const deco = g.userData.deco;
        if (u.special === 'bomb') deco.rotation.z = clock * 2.2;
      }
      for (let i = dying.length - 1; i >= 0; i--) {
        const g = dying[i];
        const a = g.userData.anim;
        a.t += dt;
        const k = Math.min(1, a.t / a.d);
        if (a.type === 'pop') {
          g.scale.setScalar(k < 0.35 ? 1 + (k / 0.35) * 0.3 : Math.max(0.001, 1.3 * (1 - (k - 0.35) / 0.65)));
          g.rotation.z += dt * 10;
        } else if (a.type === 'lift') {
          g.position.y = a.y0 + easeOut(k) * 1.2;
          g.position.z = GEM_Z + k * 1.2;
          g.scale.setScalar(1 + k * 0.4);
          g.rotation.y += dt * 9;
        }
        if (k >= 1) {
          dying.splice(i, 1);
          kit.release(g);
        }
      }
      // shake the board a little on big clears
      shake *= Math.exp(-dt * 9);
      group.position.x = (Math.random() - 0.5) * shake * 0.3;
      group.position.y = (Math.random() - 0.5) * shake * 0.3;
      // ambient sparkles
      for (let i = 0; i < SPARK; i++) {
        const s = sparkSeed[i];
        sparkPos[i * 3] = s.x + Math.sin(clock * 0.2 * s.s + s.p) * 0.8;
        sparkPos[i * 3 + 1] = ((s.y + clock * s.s * 0.4 + 7) % 14) - 7;
        sparkPos[i * 3 + 2] = s.z;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      glow.material.opacity = 0.5 + Math.sin(clock * 0.8) * 0.06;
      return fx.update(dt);
    },
    /** Gems on the board right now (not counting ones popping). */
    get gemCount() {
      return gems.size;
    },
    isAnimating() {
      for (const g of gems.values()) if (g.userData.anim && g.userData.anim.type !== 'land') return true;
      return dying.length > 0;
    },
  };
  const dying = [];
  return view;
}
