// Effects: one pooled particle system (sparks, embers, dust, slime), swing slashes, nova and level-up rings,
// the red telegraphs under enemy attacks, and drifting ash. Everything is pooled or reused: no per-hit allocations
// on the GPU side.
import * as THREE from 'three';

const MAX = 1400;

const vert = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float a = (1.0 - r * r) * vAlpha;
    gl_FragColor = vec4(vColor * (1.0 + (1.0 - r) * 0.6), a);
  }`;

function makePoints(n, blending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

const RED = 0xff2a1a;

export function createFx(scene) {
  const group = new THREE.Group();
  group.name = 'fx';
  scene.add(group);

  // ── particles
  const pts = makePoints(MAX, THREE.AdditiveBlending);
  pts.name = 'particles';
  group.add(pts);
  const P = { x: new Float32Array(MAX), y: new Float32Array(MAX), z: new Float32Array(MAX), vx: new Float32Array(MAX), vy: new Float32Array(MAX), vz: new Float32Array(MAX), life: new Float32Array(MAX), max: new Float32Array(MAX), size: new Float32Array(MAX), g: new Float32Array(MAX), drag: new Float32Array(MAX), r: new Float32Array(MAX), gr: new Float32Array(MAX), b: new Float32Array(MAX) };
  let cursor = 0;
  let live = 0;
  const tmp = new THREE.Color();

  function emit(x, y, z, color, { count = 10, speed = 3, up = 1, life = 0.6, size = 0.25, gravity = 6, drag = 1.5, spread = 0.2 } = {}) {
    tmp.set(color);
    for (let k = 0; k < count; k++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      P.x[i] = x + (Math.random() - 0.5) * spread;
      P.y[i] = y + (Math.random() - 0.5) * spread;
      P.z[i] = z + (Math.random() - 0.5) * spread;
      P.vx[i] = Math.cos(a) * s;
      P.vz[i] = Math.sin(a) * s;
      P.vy[i] = up * (0.4 + Math.random()) * speed * 0.6;
      P.max[i] = P.life[i] = life * (0.6 + Math.random() * 0.6);
      P.size[i] = size * (0.6 + Math.random() * 0.8);
      P.g[i] = gravity;
      P.drag[i] = drag;
      const v = 0.8 + Math.random() * 0.4;
      P.r[i] = tmp.r * v;
      P.gr[i] = tmp.g * v;
      P.b[i] = tmp.b * v;
    }
  }

  // ── drifting ash and embers around the camera's target
  const ASH = 260;
  const ash = makePoints(ASH, THREE.AdditiveBlending);
  ash.name = 'ash';
  group.add(ash);
  const A = { x: new Float32Array(ASH), y: new Float32Array(ASH), z: new Float32Array(ASH), s: new Float32Array(ASH), ph: new Float32Array(ASH) };
  for (let i = 0; i < ASH; i++) {
    A.x[i] = (Math.random() - 0.5) * 40;
    A.y[i] = Math.random() * 7;
    A.z[i] = (Math.random() - 0.5) * 30;
    A.s[i] = 0.25 + Math.random() * 0.6;
    A.ph[i] = Math.random() * 10;
    const ember = Math.random() < 0.3;
    const c = ash.geometry.attributes.color.array;
    c[i * 3] = ember ? 1 : 0.55;
    c[i * 3 + 1] = ember ? 0.45 : 0.5;
    c[i * 3 + 2] = ember ? 0.15 : 0.5;
    ash.geometry.attributes.size.array[i] = ember ? 0.08 + Math.random() * 0.08 : 0.06 + Math.random() * 0.08;
  }
  ash.geometry.attributes.color.needsUpdate = true;
  ash.geometry.attributes.size.needsUpdate = true;

  // ── swing slashes (pool of 4)
  const slashMat = new THREE.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const slashes = [];
  function slashGeo(arc, r0, r1) {
    return new THREE.RingGeometry(r0, r1, 28, 1, -Math.PI / 2 - arc / 2, arc);
  }
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(slashGeo(2.2, 0.9, 2.5), slashMat.clone());
    m.rotation.x = -Math.PI / 2;
    g.add(m);
    g.visible = false;
    group.add(g);
    slashes.push({ g, m, t: 0 });
  }
  let slashIdx = 0;

  // ── rings (nova, level up, stairs, slam impact): pool of 6
  const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    group.add(m);
    rings.push({ m, t: 0, dur: 0.4, r0: 0.5, r1: 5 });
  }
  let ringIdx = 0;
  function ring(x, y, z, color, r1, dur = 0.4, r0 = 0.4) {
    const r = rings[ringIdx];
    ringIdx = (ringIdx + 1) % rings.length;
    r.m.position.set(x, y + 0.06, z);
    r.m.material.color.set(color);
    r.m.visible = true;
    Object.assign(r, { t: 0, dur, r0, r1 });
  }

  // ── level-up pillar
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  pillar.visible = false;
  group.add(pillar);
  let pillarT = 0;

  // ── telegraphs: one reusable mesh set per attacking enemy
  const teleMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const teleFill = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const geoCache = new Map();
  function cached(key, make) {
    let g = geoCache.get(key);
    if (!g) geoCache.set(key, (g = make()));
    return g;
  }
  const teles = new Map(); // enemy id → { g, kind, key, outline, fill }

  function teleFor(e) {
    const tl = e.tele;
    const key = `${tl.kind}:${tl.range ?? tl.r ?? 0}:${tl.arc ?? 0}:${tl.width ?? 0}`;
    let t = teles.get(e.id);
    if (t && t.key === key) return t;
    if (t) group.remove(t.g);
    const g = new THREE.Group();
    let outline;
    let fill;
    if (tl.kind === 'arc') {
      const geo = cached(key, () => new THREE.RingGeometry(0.15, tl.range, 32, 1, -Math.PI / 2 - tl.arc / 2, tl.arc));
      outline = new THREE.Mesh(geo, teleMat);
      fill = new THREE.Mesh(geo, teleFill.clone());
    } else if (tl.kind === 'circle') {
      outline = new THREE.Mesh(cached('circle', () => new THREE.CircleGeometry(1, 48)), teleMat);
      fill = new THREE.Mesh(cached('circleFill', () => new THREE.CircleGeometry(1, 48)), teleFill.clone());
      outline.scale.setScalar(tl.r);
    } else if (tl.kind === 'line') {
      const geo = cached(key, () => new THREE.PlaneGeometry(tl.width, 1).translate(0, -0.5, 0));
      outline = new THREE.Mesh(geo, teleMat);
      fill = new THREE.Mesh(geo, teleFill.clone());
    } else if (tl.kind === 'aim') {
      const geo = cached('aim', () => new THREE.PlaneGeometry(0.07, 1).translate(0, -0.5, 0));
      outline = new THREE.Mesh(geo, teleFill.clone());
      fill = null;
    } else {
      // fan of bolt lines
      outline = new THREE.Group();
      const geo = cached('aim', () => new THREE.PlaneGeometry(0.07, 1).translate(0, -0.5, 0));
      const n = 7;
      for (let i = 0; i < n; i++) {
        const l = new THREE.Mesh(geo, teleFill);
        const holder = new THREE.Group();
        holder.rotation.y = (i - (n - 1) / 2) * (tl.arc / (n - 1));
        l.rotation.x = -Math.PI / 2;
        l.scale.y = tl.len;
        holder.add(l);
        outline.add(holder);
      }
      fill = null;
    }
    for (const m of [outline, fill]) {
      if (!m) continue;
      if (m.isMesh) m.rotation.x = -Math.PI / 2;
      g.add(m);
    }
    group.add(g);
    t = { g, kind: tl.kind, key, outline, fill };
    teles.set(e.id, t);
    return t;
  }

  return {
    group,
    get count() {
      return live;
    },
    emit,
    sparks(x, y, z, color, count = 12, speed = 4, life = 0.4, size = 0.22) {
      emit(x, y, z, color, { count, speed, life, size, gravity: 9, up: 0.8 });
    },
    dust(x, y, z, color = 0x8a8278, count = 14) {
      emit(x, y, z, color, { count, speed: 2.2, life: 0.7, size: 0.4, gravity: -0.5, up: 0.3, drag: 3, spread: 0.6 });
    },
    embers(x, y, z, count = 2, size = 0.18) {
      emit(x, y, z, 0xff7a2a, { count, speed: 0.8, life: 0.7, size, gravity: -3, up: 0.5, drag: 1, spread: 0.6 });
    },
    slash(x, y, z, a, arc, color = 0xfff2d8) {
      const s = slashes[slashIdx];
      slashIdx = (slashIdx + 1) % slashes.length;
      s.g.position.set(x, y + 0.9, z);
      s.g.rotation.y = a;
      s.m.material.color.set(color);
      s.t = 0;
      s.g.visible = true;
    },
    nova(x, y, z, radius) {
      ring(x, y, z, 0xff8a3a, radius, 0.38, 0.4);
      ring(x, y, z, 0xffd080, radius * 0.75, 0.3, 0.2);
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        emit(x + Math.cos(a) * 0.6, y + 0.4, z + Math.sin(a) * 0.6, i % 3 ? 0xff6a1a : 0xffc060, { count: 2, speed: radius * 2.6, life: 0.45, size: 0.45, gravity: 1, up: 0.15, drag: 3.5, spread: 0.1 });
      }
    },
    ring,
    levelUp(x, y, z) {
      pillar.position.set(x, y + 3.5, z);
      pillar.visible = true;
      pillarT = 0;
      ring(x, y, z, 0xffd36a, 3.2, 0.7, 0.3);
      emit(x, y + 0.5, z, 0xffd36a, { count: 60, speed: 3, life: 1.1, size: 0.35, gravity: -2, up: 1.4, drag: 1.2, spread: 0.8 });
    },
    stairs(x, z) {
      ring(x, 0, z, 0xffa040, 2.5, 0.8, 0.2);
      emit(x, 0.3, z, 0xffa040, { count: 50, speed: 2.5, life: 1.2, size: 0.35, gravity: -3, up: 1, drag: 1, spread: 1.2 });
    },
    /** Sync the telegraph meshes with the enemies' current wind-ups. */
    telegraphs(enemies) {
      const seen = new Set();
      for (const e of enemies) {
        if (!e.tele || e.dead) continue;
        seen.add(e.id);
        const t = teleFor(e);
        const tl = e.tele;
        const p = Math.min(1, Math.max(0, 1 - tl.t / tl.total));
        t.g.visible = true;
        if (tl.kind === 'circle') {
          t.g.position.set(tl.x, 0.04, tl.z);
          t.g.rotation.y = 0;
          t.fill.scale.setScalar(tl.r * p);
          t.fill.material.opacity = 0.25 + p * 0.35;
        } else {
          t.g.position.set(e.x, e.y + 0.04, e.z);
          t.g.rotation.y = e.face;
          if (tl.kind === 'arc') {
            t.fill.scale.setScalar(Math.max(0.05, p));
            t.fill.material.opacity = 0.2 + p * 0.4;
          } else if (tl.kind === 'line') {
            t.outline.scale.y = tl.len;
            t.fill.scale.y = tl.len * p;
            t.fill.material.opacity = 0.2 + p * 0.4;
          } else if (tl.kind === 'aim') {
            t.g.position.y = e.y + 1.1;
            t.outline.scale.y = tl.len;
            t.outline.material.opacity = 0.15 + p * 0.6;
          }
        }
      }
      for (const [id, t] of teles) {
        if (seen.has(id)) continue;
        group.remove(t.g);
        teles.delete(id);
      }
    },
    clearTelegraphs() {
      for (const t of teles.values()) group.remove(t.g);
      teles.clear();
    },
    update(dt, focus) {
      // particles
      const pos = pts.geometry.attributes.position.array;
      const col = pts.geometry.attributes.color.array;
      const siz = pts.geometry.attributes.size.array;
      const alp = pts.geometry.attributes.alpha.array;
      live = 0;
      for (let i = 0; i < MAX; i++) {
        if (P.life[i] <= 0) {
          if (alp[i] !== 0) alp[i] = 0;
          continue;
        }
        live++;
        P.life[i] -= dt;
        const k = Math.max(0, 1 - P.drag[i] * dt);
        P.vx[i] *= k;
        P.vz[i] *= k;
        P.vy[i] = P.vy[i] * k - P.g[i] * dt;
        P.x[i] += P.vx[i] * dt;
        P.y[i] += P.vy[i] * dt;
        P.z[i] += P.vz[i] * dt;
        if (P.y[i] < 0.03 && P.g[i] > 0) {
          P.y[i] = 0.03;
          P.vy[i] *= -0.3;
        }
        const f = Math.max(0, P.life[i] / P.max[i]);
        pos[i * 3] = P.x[i];
        pos[i * 3 + 1] = P.y[i];
        pos[i * 3 + 2] = P.z[i];
        col[i * 3] = P.r[i];
        col[i * 3 + 1] = P.gr[i];
        col[i * 3 + 2] = P.b[i];
        siz[i] = P.size[i] * (0.4 + f * 0.6);
        alp[i] = Math.min(1, f * 1.6);
      }
      for (const a of ['position', 'color', 'size', 'alpha']) pts.geometry.attributes[a].needsUpdate = true;

      // ash: drifts up and sideways in a box that follows the camera's target
      const ap = ash.geometry.attributes.position.array;
      const aa = ash.geometry.attributes.alpha.array;
      for (let i = 0; i < ASH; i++) {
        A.ph[i] += dt;
        A.y[i] += A.s[i] * dt * 0.6;
        A.x[i] += Math.sin(A.ph[i] * 0.7) * dt * 0.4 + dt * 0.15;
        if (A.y[i] > 7) A.y[i] = 0;
        let x = A.x[i] - focus.x;
        let z = A.z[i] - focus.z;
        x = ((((x + 20) % 40) + 40) % 40) - 20;
        z = ((((z + 15) % 30) + 30) % 30) - 15;
        A.x[i] = focus.x + x;
        A.z[i] = focus.z + z;
        ap[i * 3] = A.x[i];
        ap[i * 3 + 1] = A.y[i];
        ap[i * 3 + 2] = A.z[i];
        aa[i] = Math.min(1, A.y[i] * 0.6) * Math.min(1, (7 - A.y[i]) * 0.5) * 0.7;
      }
      ash.geometry.attributes.position.needsUpdate = true;
      ash.geometry.attributes.alpha.needsUpdate = true;

      for (const s of slashes) {
        if (!s.g.visible) continue;
        s.t += dt;
        const p = s.t / 0.2;
        if (p >= 1) {
          s.g.visible = false;
          continue;
        }
        s.m.material.opacity = (1 - p) * (1 - p) * 0.55;
        s.m.scale.setScalar(0.85 + p * 0.25);
        s.m.rotation.z = (0.5 - p) * 0.9;
      }
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.t += dt;
        const p = r.t / r.dur;
        if (p >= 1) {
          r.m.visible = false;
          continue;
        }
        const e = 1 - Math.pow(1 - p, 2);
        r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
        r.m.material.opacity = (1 - p) * 0.9;
      }
      if (pillar.visible) {
        pillarT += dt;
        const p = pillarT / 1.1;
        if (p >= 1) pillar.visible = false;
        else {
          pillar.material.opacity = Math.sin(p * Math.PI) * 0.45;
          pillar.scale.set(1 - p * 0.6, 1, 1 - p * 0.6);
        }
      }
    },
    reset() {
      P.life.fill(0);
      for (const s of slashes) s.g.visible = false;
      for (const r of rings) r.m.visible = false;
      pillar.visible = false;
      this.clearTelegraphs();
    },
  };
}
