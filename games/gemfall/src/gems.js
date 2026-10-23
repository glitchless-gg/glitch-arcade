// Gem looks: one shared geometry and material per colour (each colour has its own cut, so the board reads
// without colour too), plus the specials' decorations, the prism and the crown. Gem meshes are pooled.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const GEM_COLORS = [0xff3b5c, 0xff9a2e, 0xffd23b, 0x2ee87a, 0x3b8bff, 0xb45cff];
export const GEM_CSS = ['#ff3b5c', '#ff9a2e', '#ffd23b', '#2ee87a', '#3b8bff', '#b45cff'];

// Lathe profiles (radius, height), pavilion tip first; the lathe axis becomes +z (towards the camera).
function cut(segments, profile, phiStart, sx = 1, sy = 1) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(pts, segments, phiStart);
  g.rotateX(Math.PI / 2);
  g.scale(sx, sy, 1);
  g.computeVertexNormals();
  return g;
}

function buildGeometries() {
  const brilliant = [
    [0, -0.3],
    [0.42, -0.02],
    [0.42, 0.04],
    [0.27, 0.18],
    [0, 0.18],
  ];
  return [
    cut(8, brilliant, Math.PI / 8), // ruby: round brilliant (octagon)
    cut(6, [[0, -0.28], [0.44, -0.03], [0.44, 0.05], [0.3, 0.2], [0, 0.2]], Math.PI / 6), // amber: hexagon
    cut(4, [[0, -0.26], [0.52, -0.02], [0.52, 0.05], [0.34, 0.19], [0, 0.19]], Math.PI / 4), // topaz: square cushion
    cut(8, [[0, -0.24], [0.4, -0.04], [0.4, 0.06], [0.3, 0.17], [0, 0.17]], Math.PI / 8, 0.82, 1.14), // emerald: tall step cut
    (() => {
      const g = new THREE.IcosahedronGeometry(0.4, 0);
      g.scale(1, 1, 0.78);
      return g;
    })(), // sapphire: faceted ball
    cut(3, [[0, -0.24], [0.54, -0.02], [0.54, 0.05], [0.34, 0.2], [0, 0.2]], Math.PI, 1, 1).translate(0, -0.06, 0), // amethyst: trillion (points up)
  ];
}

function gemMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.14,
    metalness: 0.0,
    specularIntensity: 0.7,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    flatShading: true,
    envMapIntensity: 1.0,
  });
}

function crownGeometry() {
  const parts = [];
  const band = new THREE.CylinderGeometry(0.34, 0.3, 0.2, 10, 1, true);
  band.translate(0, -0.12, 0);
  parts.push(band);
  const base = new THREE.TorusGeometry(0.31, 0.055, 6, 18);
  base.rotateX(Math.PI / 2);
  base.translate(0, -0.22, 0);
  parts.push(base);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.075, 0.26, 5);
    spike.translate(Math.sin(a) * 0.31, 0.1, Math.cos(a) * 0.31);
    parts.push(spike);
    const ball = new THREE.SphereGeometry(0.05, 8, 6);
    ball.translate(Math.sin(a) * 0.31, 0.25, Math.cos(a) * 0.31);
    parts.push(ball);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.rotateX(0.55); // tipped towards the camera so it reads as a crown
  return g;
}

export function createGemKit() {
  const geos = buildGeometries();
  const mats = GEM_COLORS.map(gemMaterial);
  const stripeGeo = new THREE.BoxGeometry(0.86, 0.075, 0.08);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const ringGeo = new THREE.TorusGeometry(0.43, 0.05, 8, 28);
  const ringMats = GEM_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.45), toneMapped: false }));
  const coreGeo = new THREE.IcosahedronGeometry(0.2, 1);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.3, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.15 });
  const prismGeo = new THREE.DodecahedronGeometry(0.42, 0);
  const prismMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.1, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [200, 900], clearcoat: 1, flatShading: true, emissive: 0x6655aa, emissiveIntensity: 0.35, envMapIntensity: 2 });
  const crownGeo = crownGeometry();
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: 0x6a4200, emissiveIntensity: 0.4, flatShading: true, envMapIntensity: 1.6 });
  const pool = [];

  function decorate(g, cell) {
    const body = g.userData.body;
    const deco = g.userData.deco;
    deco.clear();
    body.scale.setScalar(1);
    body.visible = true;
    if (cell.kind === 'prism') {
      body.geometry = prismGeo;
      body.material = prismMat;
      return;
    }
    if (cell.kind === 'crown') {
      body.geometry = crownGeo;
      body.material = crownMat;
      return;
    }
    body.geometry = geos[cell.kind];
    body.material = mats[cell.kind];
    if (cell.special === 'row' || cell.special === 'col') {
      for (const y of [-0.17, 0, 0.17]) {
        const s = new THREE.Mesh(stripeGeo, stripeMat);
        s.position.set(0, y, 0.2);
        deco.add(s);
      }
      deco.rotation.z = cell.special === 'col' ? Math.PI / 2 : 0;
    } else if (cell.special === 'bomb') {
      body.scale.setScalar(0.8);
      const ring = new THREE.Mesh(ringGeo, ringMats[cell.kind]);
      ring.name = 'bomb-ring';
      deco.add(ring);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.z = 0.16;
      deco.add(core);
      deco.rotation.z = 0;
    }
  }

  return {
    geos,
    mats,
    /** A gem object for a cell: { group, body, deco }. Pooled. */
    make(cell) {
      let g = pool.pop();
      if (!g) {
        g = new THREE.Group();
        g.name = 'gem';
        const body = new THREE.Mesh(geos[0], mats[0]);
        const deco = new THREE.Group();
        g.add(body, deco);
        g.userData.body = body;
        g.userData.deco = deco;
      }
      g.visible = true;
      g.scale.setScalar(1);
      g.rotation.set(0, 0, 0);
      decorate(g, cell);
      return g;
    },
    restyle(g, cell) {
      decorate(g, cell);
    },
    release(g) {
      g.removeFromParent();
      g.userData.deco.clear();
      pool.push(g);
    },
    get pooled() {
      return pool.length;
    },
  };
}

/** Small inline SVG icons for the HUD goal (same silhouettes as the cuts). */
export function gemIconSvg(kind, size = 30) {
  const c = GEM_CSS[kind];
  const shapes = [
    '<polygon points="12,2 22,7 25,16 20,25 10,27 3,20 2,10 6,4" />',
    '<polygon points="8,3 20,3 26,14 20,25 8,25 2,14" />',
    '<rect x="4" y="4" width="20" height="20" rx="2" />',
    '<polygon points="8,1 20,1 24,6 24,22 20,27 8,27 4,22 4,6" />',
    '<polygon points="14,2 24,8 24,20 14,26 4,20 4,8" />',
    '<polygon points="14,2 26,24 2,24" />',
  ];
  return `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><g fill="${c}" stroke="rgba(255,255,255,0.75)" stroke-width="1.4" stroke-linejoin="round">${shapes[kind]}</g><path d="M9 9 L14 6 L19 9" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

export function stoneIconSvg(size = 30) {
  return `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><rect x="3" y="4" width="22" height="20" rx="4" fill="#8f8aa6" stroke="#d8d4ea" stroke-width="1.4"/><path d="M9 8 L13 14 L10 19 M15 13 L21 11" fill="none" stroke="#4a4560" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

export function crownIconSvg(size = 30) {
  return `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><path d="M3 21 L5 8 L10 14 L14 5 L18 14 L23 8 L25 21 Z" fill="#ffc83a" stroke="#fff2c0" stroke-width="1.4" stroke-linejoin="round"/><rect x="4" y="21" width="20" height="3.5" rx="1.2" fill="#e8a520"/></svg>`;
}

export function starIconSvg(size = 30) {
  return `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><path d="M14 2.5 L17.4 10 L25.5 10.8 L19.4 16.2 L21.2 24.3 L14 20.1 L6.8 24.3 L8.6 16.2 L2.5 10.8 L10.6 10 Z" fill="#ffd25a" stroke="#fff4c8" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
