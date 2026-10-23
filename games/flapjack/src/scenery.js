// Everything behind the pipes: the sky, sun or moon and stars, two parallax layers per biome (rolling
// hills and trees, mesas and rock spires, a night skyline), clouds, the ground strip, and the lights.
// The layers sit at real depths, so the perspective camera gives the parallax; each layer is a ring of
// segments that wraps around the camera. Shared geometries and materials throughout.
import * as THREE from 'three';
import { createRng } from './rng.js';
import { BIOMES } from './course.js';

const FAR_Z = -90;
const MID_Z = -38;
const FAR_SPAN = 200;
const MID_SPAN = 120;
const GROUND_W = 150;

const PALETTE = {
  meadow: {
    skyTop: 0x3d9bff,
    skyMid: 0x8fd0ff,
    skyLow: 0xdaf4ff,
    fog: 0xc4ebff,
    far: 0x9ad6b4,
    mid: 0x58b56a,
    cloud: 0xffffff,
    groundTop: 0x62c447,
    groundLip: 0x8fe063,
    groundSide: 0xdba35f,
    hemiSky: 0xe4f4ff,
    hemiGround: 0x76a85e,
    hemi: 1.5,
    sunColor: 0xfff3d6,
    sun: 2.6,
    disc: 0xfff6c4,
    discPos: [34, 30],
    discR: 6,
    stars: 0,
  },
  canyon: {
    skyTop: 0xff7f50,
    skyMid: 0xffb877,
    skyLow: 0xffe6b8,
    fog: 0xffd6a4,
    far: 0xe08356,
    mid: 0xb85a35,
    cloud: 0xfff0dc,
    groundTop: 0xf0bd72,
    groundLip: 0xffd28a,
    groundSide: 0xd98f52,
    hemiSky: 0xffe2c4,
    hemiGround: 0xb0704a,
    hemi: 1.45,
    sunColor: 0xffd7a8,
    sun: 2.5,
    disc: 0xffe39a,
    discPos: [26, 14],
    discR: 9,
    stars: 0,
  },
  city: {
    skyTop: 0x090c2a,
    skyMid: 0x1d1a4d,
    skyLow: 0x4a2f72,
    fog: 0x2e2558,
    far: 0x252454,
    mid: 0x161638,
    cloud: 0x4c4282,
    groundTop: 0x3d4060,
    groundLip: 0x5a5f86,
    groundSide: 0x4a4d6e,
    hemiSky: 0x8f8fe0,
    hemiGround: 0x2a2444,
    hemi: 1.45,
    sunColor: 0xc4ceff,
    sun: 1.1,
    disc: 0xf2f0ff,
    discPos: [36, 32],
    discR: 4.5,
    stars: 1,
  },
};

const COLOR_KEYS = ['skyTop', 'skyMid', 'skyLow', 'fog', 'far', 'mid', 'cloud', 'groundTop', 'groundLip', 'groundSide', 'hemiSky', 'hemiGround', 'sunColor', 'disc'];
const lerpColor = (out, a, b, t) => out.copy(a).lerp(b, t);

export function createScenery(scene, renderer) {
  const rng = createRng(77);
  const root = new THREE.Group();
  root.name = 'scenery';
  scene.add(root);
  // the palettes with their colours as THREE.Colors
  const pal = {};
  for (const [name, p] of Object.entries(PALETTE)) {
    pal[name] = { ...p };
    for (const k of COLOR_KEYS) pal[name][k] = new THREE.Color(p[k]);
  }

  // ── sky: a big gradient card far behind everything, plus the sun / moon and stars
  const sky = new THREE.Group();
  sky.name = 'sky';
  root.add(sky);
  const skyGeo = new THREE.PlaneGeometry(520, 220, 1, 4);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, depthWrite: false }));
  skyMesh.position.set(0, 20, -160);
  skyMesh.renderOrder = -10;
  sky.add(skyMesh);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }));
  disc.position.z = -150;
  sky.add(disc);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, transparent: true, opacity: 0.18, depthWrite: false }));
  halo.position.z = -151;
  sky.add(halo);
  const starPos = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) {
    starPos[i * 3] = rng.range(-240, 240);
    starPos[i * 3 + 1] = rng.range(4, 110);
    starPos[i * 3 + 2] = -155;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  sky.add(stars);

  // ── parallax layers, one pair per biome
  const layers = {};
  for (const biome of BIOMES) layers[biome] = buildLayers(biome);

  function buildLayers(biome) {
    const far = new THREE.Group();
    const mid = new THREE.Group();
    far.name = `far-${biome}`;
    mid.name = `mid-${biome}`;
    far.position.z = FAR_Z;
    mid.position.z = MID_Z;
    const farMat = new THREE.MeshStandardMaterial({ color: pal[biome].far, roughness: 1 });
    const midMat = new THREE.MeshStandardMaterial({ color: pal[biome].mid, roughness: 0.95 });
    const segs = (group, span, n, fill) => {
      for (let i = 0; i < n; i++) {
        const seg = new THREE.Group();
        seg.userData.home = (i * span) / n;
        fill(seg, span / n);
        group.add(seg);
      }
    };
    if (biome === 'meadow') {
      const ball = new THREE.SphereGeometry(1, 28, 16);
      const trunk = new THREE.CylinderGeometry(0.35, 0.45, 1, 8);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 });
      segs(far, FAR_SPAN, 7, (seg, w) => {
        for (let k = 0; k < 2; k++) {
          const r = rng.range(16, 24);
          const m = new THREE.Mesh(ball, farMat);
          m.scale.set(r * rng.range(1.1, 1.5), r * 0.75, r * 0.5);
          m.position.set(k * w * 0.5 + rng.range(-3, 3), rng.range(-14, -8), 0);
          seg.add(m);
        }
      });
      segs(mid, MID_SPAN, 6, (seg, w) => {
        for (let k = 0; k < 3; k++) {
          const x = (k / 3) * w + rng.range(-2, 2);
          const r = rng.range(2.2, 3.6);
          const t = new THREE.Mesh(trunk, trunkMat);
          t.scale.set(1, 5, 1);
          t.position.set(x, -0.5, 0);
          seg.add(t);
          const crown = new THREE.Mesh(ball, midMat);
          crown.scale.set(r, r * 1.05, r);
          crown.position.set(x, 1.6 + r * 0.6, 0);
          seg.add(crown);
        }
        const hill = new THREE.Mesh(ball, midMat);
        hill.scale.set(w * 0.7, 7, 6);
        hill.position.set(w * 0.5, -4.5, -3);
        seg.add(hill);
      });
    } else if (biome === 'canyon') {
      const box = new THREE.BoxGeometry(1, 1, 1);
      const spire = new THREE.CylinderGeometry(0.55, 1, 1, 7);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xf0a070, roughness: 1 });
      segs(far, FAR_SPAN, 7, (seg, w) => {
        for (let k = 0; k < 2; k++) {
          const mw = rng.range(12, 22);
          const h = rng.range(26, 40);
          const x = k * w * 0.55 + rng.range(-2, 2);
          const m = new THREE.Mesh(box, farMat);
          m.scale.set(mw, h, 8);
          m.position.set(x, -24 + h / 2, 0);
          seg.add(m);
          const top = new THREE.Mesh(box, capMat);
          top.scale.set(mw + 1.2, 1.4, 8.6);
          top.position.set(x, -24 + h, 0);
          seg.add(top);
        }
      });
      segs(mid, MID_SPAN, 6, (seg, w) => {
        for (let k = 0; k < 2; k++) {
          const h = rng.range(8, 15);
          const s = new THREE.Mesh(spire, midMat);
          s.scale.set(rng.range(1.6, 2.4), h, 1.8);
          s.position.set((k / 2) * w + rng.range(-2, 2), -3 + h / 2, 0);
          seg.add(s);
        }
        const mesa = new THREE.Mesh(box, midMat);
        const h = rng.range(5, 8);
        mesa.scale.set(w * 0.45, h, 4);
        mesa.position.set(w * 0.7, -3 + h / 2, -2);
        seg.add(mesa);
      });
    } else {
      const box = new THREE.BoxGeometry(1, 1, 1);
      const windows = windowTexture(rng);
      const lit = (color, w, h) => {
        const tex = windows.clone();
        tex.repeat.set(Math.max(1, Math.round(w / 2.2)), Math.max(1, Math.round(h / 2.6)));
        tex.needsUpdate = true;
        return new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 });
      };
      segs(far, FAR_SPAN, 8, (seg, w) => {
        for (let k = 0; k < 3; k++) {
          const bw = rng.range(6, 10);
          const h = rng.range(30, 52);
          const m = new THREE.Mesh(box, lit(pal.city.far, bw, h));
          m.scale.set(bw, h, 8);
          m.position.set((k / 3) * w + rng.range(-1, 1), -24 + h / 2, 0);
          seg.add(m);
          if (rng.chance(0.4)) {
            const ant = new THREE.Mesh(box, farMat);
            ant.scale.set(0.3, 6, 0.3);
            ant.position.set(m.position.x, -24 + h + 3, 0);
            seg.add(ant);
          }
        }
      });
      segs(mid, MID_SPAN, 6, (seg, w) => {
        for (let k = 0; k < 3; k++) {
          const bw = rng.range(4, 7);
          const h = rng.range(9, 17);
          const m = new THREE.Mesh(box, lit(pal.city.mid, bw, h));
          m.scale.set(bw, h, 5);
          m.position.set((k / 3) * w + rng.range(-1, 1), -4 + h / 2, 0);
          seg.add(m);
        }
      });
    }
    root.add(far, mid);
    return { far, mid, offset: biome === 'meadow' ? 0 : -60 };
  }

  // ── clouds
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const puff = new THREE.SphereGeometry(1, 16, 12);
  const clouds = new THREE.Group();
  clouds.name = 'clouds';
  root.add(clouds);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const n = rng.int(3, 5);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(puff, cloudMat);
      const r = rng.range(1.6, 2.8);
      s.scale.set(r * 1.3, r, r);
      s.position.set(k * 2.1 - n, rng.range(-0.4, 0.6) + (k === 1 || k === 2 ? 0.8 : 0), rng.range(-0.5, 0.5));
      c.add(s);
    }
    c.userData.home = (i / 9) * 170;
    c.position.set(0, rng.range(13, 24), rng.range(-75, -50));
    clouds.add(c);
  }

  // ── the ground strip
  const groundTex = stripeTexture();
  const groundSideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: groundTex, roughness: 0.95 });
  const groundBody = new THREE.Mesh(new THREE.BoxGeometry(GROUND_W, 6, 7.5), groundSideMat);
  groundBody.position.set(0, -3.25, -1.25);
  groundBody.receiveShadow = true;
  root.add(groundBody);
  const groundTopMat = new THREE.MeshStandardMaterial({ color: 0x7fd65a, roughness: 0.9 });
  const groundTop = new THREE.Mesh(new THREE.BoxGeometry(GROUND_W, 0.5, 7.5), groundTopMat);
  groundTop.position.set(0, -0.25, -1.25);
  groundTop.receiveShadow = true;
  root.add(groundTop);
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x9be86e, roughness: 0.8 });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(GROUND_W, 0.22, 0.3), lipMat);
  lip.position.set(0, -0.12, 2.55);
  root.add(lip);

  // ── lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xc4ebff, 70, 260);

  // ── biome blending
  const cur = {
    skyTop: new THREE.Color(),
    skyMid: new THREE.Color(),
    skyLow: new THREE.Color(),
    fog: new THREE.Color(),
    cloud: new THREE.Color(),
    groundTop: new THREE.Color(),
    groundLip: new THREE.Color(),
    groundSide: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sunColor: new THREE.Color(),
    disc: new THREE.Color(),
  };
  const blend = { from: 'meadow', to: 'meadow', t: 1 };
  let biome = 'meadow';

  function applyBlend() {
    const a = pal[blend.from];
    const b = pal[blend.to];
    const t = blend.t * blend.t * (3 - 2 * blend.t);
    for (const k of Object.keys(cur)) lerpColor(cur[k], a[k], b[k], t);
    const col = skyGeo.attributes.color;
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = (pos.getY(i) + 110) / 220; // 0 bottom … 1 top
      const c = v < 0.5 ? cur.skyLow.clone().lerp(cur.skyMid, v / 0.5) : cur.skyMid.clone().lerp(cur.skyTop, (v - 0.5) / 0.5);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    scene.fog.color.copy(cur.fog);
    cloudMat.color.copy(cur.cloud);
    cloudMat.emissive.copy(cur.cloud);
    groundTopMat.color.copy(cur.groundTop);
    lipMat.color.copy(cur.groundLip);
    groundSideMat.color.copy(cur.groundSide);
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * t;
    sun.color.copy(cur.sunColor);
    sun.intensity = a.sun + (b.sun - a.sun) * t;
    disc.material.color.copy(cur.disc);
    halo.material.color.copy(cur.disc);
    const r = a.discR + (b.discR - a.discR) * t;
    disc.scale.setScalar(r);
    halo.scale.setScalar(r * 1.9);
    disc.position.x = halo.position.x = a.discPos[0] + (b.discPos[0] - a.discPos[0]) * t;
    disc.position.y = halo.position.y = a.discPos[1] + (b.discPos[1] - a.discPos[1]) * t;
    starMat.opacity = a.stars + (b.stars - a.stars) * t;
    stars.visible = starMat.opacity > 0.01;
  }
  applyBlend();

  const wrap = (obj, camX, span) => {
    const d = ((((obj.userData.home - camX) % span) + span * 1.5) % span) - span / 2;
    obj.position.x = camX + d;
  };

  return {
    root,
    sky,
    clouds,
    sun,
    hemi,
    ground: [groundBody, groundTop, lip],
    get biome() {
      return biome;
    },
    /** switch the backdrop (instant for a fresh run or a skip) */
    setBiome(name, instant = false) {
      if (!pal[name]) return;
      if (instant) {
        blend.from = blend.to = name;
        blend.t = 1;
        for (const [k, l] of Object.entries(layers)) l.offset = k === name ? 0 : -60;
      } else if (name !== blend.to) {
        blend.from = biome;
        blend.to = name;
        blend.t = 0;
      }
      biome = name;
      applyBlend();
    },
    update(dt, camX) {
      if (blend.t < 1) {
        blend.t = Math.min(1, blend.t + dt / 1.4);
        applyBlend();
      }
      sky.position.x = camX;
      for (const [k, l] of Object.entries(layers)) {
        const target = k === biome ? 0 : -60;
        // the old skyline sinks, the new one rises
        const rate = target < l.offset ? 2.6 : 1.7;
        l.offset += (target - l.offset) * Math.min(1, dt * rate);
        if (Math.abs(target - l.offset) < 0.02) l.offset = target;
        const visible = l.offset > -58;
        l.far.visible = l.mid.visible = visible;
        if (!visible) continue;
        l.far.position.y = l.offset;
        l.mid.position.y = l.offset * 0.6;
        for (const seg of l.far.children) wrap(seg, camX, FAR_SPAN);
        for (const seg of l.mid.children) wrap(seg, camX, MID_SPAN);
      }
      for (const c of clouds.children) {
        c.userData.home += dt * 0.6; // a breeze
        wrap(c, camX, 170);
      }
      groundBody.position.x = groundTop.position.x = lip.position.x = camX;
      groundTex.offset.x = camX / 3;
      sun.position.set(camX - 7, 30, 18);
      sun.target.position.set(camX + 1, 0, -1);
    },
    /** show every biome's layers at once (shader warm-up) or put them back */
    showAll(on) {
      for (const [k, l] of Object.entries(layers)) {
        const v = on || k === biome;
        l.far.visible = l.mid.visible = v;
      }
    },
  };
}

/** a lit-windows texture for the night skyline */
function windowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 32, 32);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const on = rng.chance(0.42);
      g.fillStyle = on ? (rng.chance(0.25) ? '#7fe6ff' : '#ffd77a') : '#14142c';
      g.fillRect(4 + x * 16, 5 + y * 16, 8, 9);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** the ground's side: chunky diagonal stripes in greys, tinted by the material colour */
function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d4d4d4';
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 + 64, 64);
    g.lineTo(i + 64, 64);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GROUND_W / 3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
