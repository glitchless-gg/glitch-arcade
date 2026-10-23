// Board effects: the shard burst when a gem pops (planted problem 2), plus pooled beams, shockwaves,
// prism rays, stone dust and the selection / hint / cursor markers. Everything here lives in the board's
// local space (x right, y up, z towards the camera).
import * as THREE from 'three';

const SHARDS_PER_GEM = 12;
const DUST_MAX = 400;

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.4, outer);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFx(parent) {
  // ── shard bursts (GLITCHLESS-DEMO, see burst() below)
  const shards = [];
  const glints = [];
  const glintGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const glintTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)');

  // ── row / column beams (pooled)
  const beamGeo = new THREE.PlaneGeometry(1, 1);
  const beamTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const beams = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    m.visible = false;
    m.name = 'beam';
    m.renderOrder = 5;
    parent.add(m);
    return { m, t: 0, life: 0.35 };
  });
  let beamIdx = 0;

  // ── shockwave rings (pooled)
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
  const rings = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    m.visible = false;
    m.name = 'shockwave';
    m.renderOrder = 5;
    parent.add(m);
    return { m, t: 0, life: 0.4, size: 1.5 };
  });
  let ringIdx = 0;

  // ── stone dust and sparkle: one Points buffer, CPU-simulated (pooled)
  const dustPos = new Float32Array(DUST_MAX * 3);
  const dustCol = new Float32Array(DUST_MAX * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
  const dustTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)');
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.13, map: dustTex, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
  dust.frustumCulled = false;
  dust.name = 'dust';
  dust.renderOrder = 4;
  parent.add(dust);
  const dp = Array.from({ length: DUST_MAX }, () => ({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1 }));
  let dustIdx = 0;

  // ── markers: selection ring, hint halos, keyboard cursor, hammer target
  const haloTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,240,200,0.35)');
  const markerMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity, toneMapped: false });
  const select = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), markerMat(0xfff2b0, 0.9));
  select.name = 'select';
  select.visible = false;
  parent.add(select);
  const hints = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), markerMat(0x9ff7ff, 0.9));
    m.name = 'hint';
    m.visible = false;
    parent.add(m);
    return m;
  });
  const cursorShape = new THREE.Shape();
  const s = 0.48;
  const rr = 0.12;
  cursorShape.moveTo(-s + rr, -s);
  cursorShape.lineTo(s - rr, -s);
  cursorShape.quadraticCurveTo(s, -s, s, -s + rr);
  cursorShape.lineTo(s, s - rr);
  cursorShape.quadraticCurveTo(s, s, s - rr, s);
  cursorShape.lineTo(-s + rr, s);
  cursorShape.quadraticCurveTo(-s, s, -s, s - rr);
  cursorShape.lineTo(-s, -s + rr);
  cursorShape.quadraticCurveTo(-s, -s, -s + rr, -s);
  const hole = new THREE.Path();
  const h = 0.41;
  hole.moveTo(-h, -h);
  hole.lineTo(-h, h);
  hole.lineTo(h, h);
  hole.lineTo(h, -h);
  hole.lineTo(-h, -h);
  cursorShape.holes.push(hole);
  const cursor = new THREE.Mesh(new THREE.ShapeGeometry(cursorShape), new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
  cursor.name = 'cursor';
  cursor.visible = false;
  parent.add(cursor);

  let clock = 0;

  /**
   * A gem pops: a burst of faceted shards in its colour plus a glint.
   *
   * GLITCHLESS-DEMO: cascade particles that are never cleaned up. Every shard gets its own new geometry
   * (jittered so no two look alike) and its own material (so each can fade on its own), is added to the
   * board and kept in `shards` forever: update() hides it once it has faded, but nothing ever removes it
   * from the scene or calls dispose(). A combo that clears 30-40 gems in one step creates ~400-500 meshes
   * in a single frame, and three.js uploads every one of their buffers on the next render: a long frame the
   * SDK attributes to geometry_upload. The hidden shards (and their geometries) then pile up level after
   * level, and the glints are only faded to opacity 0, never hidden, so each one still costs a draw call.
   */
  function burst(x, y, color, n = SHARDS_PER_GEM) {
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const geo = new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.07, 0);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) pos.setXYZ(v, pos.getX(v) * (0.6 + Math.random() * 0.8), pos.getY(v) * (0.6 + Math.random() * 0.8), pos.getZ(v) * (0.5 + Math.random() * 0.6));
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.1, flatShading: true, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'shard';
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 3.2;
      mesh.position.set(x, y, 0.35);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      parent.add(mesh);
      shards.push({ mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1.5, vz: 1 + Math.random() * 3, spin: (Math.random() - 0.5) * 16, t: 0, life: 0.45 + Math.random() * 0.35, done: false });
    }
    const glint = new THREE.Mesh(glintGeo, new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.5), map: glintTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }));
    glint.name = 'glint';
    glint.position.set(x, y, 0.45);
    glint.renderOrder = 6;
    parent.add(glint);
    glints.push({ mesh: glint, t: 0, life: 0.3, done: false });
  }

  function beam(type, r, c, color, wide = false) {
    const b = beams[beamIdx];
    beamIdx = (beamIdx + 1) % beams.length;
    b.t = 0;
    b.m.visible = true;
    b.m.material.color.set(color).lerp(new THREE.Color(0xffffff), 0.35);
    const x = c - 3.5;
    const y = 3.5 - r;
    const thick = wide ? 3 : 1.05;
    if (type === 'row') {
      b.m.position.set(0, y, 0.6);
      b.m.rotation.z = 0;
      b.m.scale.set(9.5, thick, 1);
    } else {
      b.m.position.set(x, 0, 0.6);
      b.m.rotation.z = Math.PI / 2;
      b.m.scale.set(9.5, thick, 1);
    }
  }

  function shockwave(r, c, color, size = 1.6) {
    const w = rings[ringIdx];
    ringIdx = (ringIdx + 1) % rings.length;
    w.t = 0;
    w.size = size;
    w.m.visible = true;
    w.m.material.color.set(color).lerp(new THREE.Color(0xffffff), 0.3);
    w.m.position.set(c - 3.5, 3.5 - r, 0.55);
  }

  function dustBurst(x, y, color, n = 14, speed = 2.4, life = 0.5) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = dp[dustIdx];
      dustIdx = (dustIdx + 1) % DUST_MAX;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      p.x = x + (Math.random() - 0.5) * 0.5;
      p.y = y + (Math.random() - 0.5) * 0.5;
      p.z = 0.2;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp + 0.8;
      p.vz = Math.random() * 2;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.r = c.r;
      p.g = c.g;
      p.b = c.b;
    }
  }

  function update(dt) {
    clock += dt;
    for (const s of shards) {
      if (s.done) continue;
      s.t += dt;
      const m = s.mesh;
      s.vy -= 9 * dt;
      m.position.x += s.vx * dt;
      m.position.y += s.vy * dt;
      m.position.z += s.vz * dt;
      m.rotation.x += s.spin * dt;
      m.rotation.y += s.spin * 0.7 * dt;
      const k = s.t / s.life;
      m.material.opacity = Math.max(0, 1 - k * k);
      m.scale.setScalar(1 - k * 0.5);
      if (k >= 1) {
        s.done = true;
        m.visible = false; // faded out: hide it
      }
    }
    for (const g of glints) {
      if (g.done) continue;
      g.t += dt;
      const k = Math.min(1, g.t / g.life);
      g.mesh.material.opacity = 0.9 * (1 - k);
      g.mesh.scale.setScalar(0.6 + k * 0.9);
      if (k >= 1) g.done = true; // faded to nothing
    }
    for (const b of beams) {
      if (!b.m.visible) continue;
      b.t += dt;
      const k = b.t / b.life;
      b.m.material.opacity = Math.max(0, 1 - k) * 1.1;
      b.m.scale.y *= 1 + dt * 1.5;
      if (k >= 1) b.m.visible = false;
    }
    for (const w of rings) {
      if (!w.m.visible) continue;
      w.t += dt;
      const k = w.t / w.life;
      const sc = 0.3 + k * w.size;
      w.m.scale.set(sc, sc, 1);
      w.m.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) w.m.visible = false;
    }
    let live = 0;
    for (let i = 0; i < DUST_MAX; i++) {
      const p = dp[i];
      if (p.life <= 0) {
        dustPos[i * 3 + 2] = -50;
        continue;
      }
      live++;
      p.life -= dt;
      p.vy -= 6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const f = Math.max(0, p.life / p.max);
      dustPos[i * 3] = p.x;
      dustPos[i * 3 + 1] = p.y;
      dustPos[i * 3 + 2] = p.z;
      dustCol[i * 3] = p.r * f;
      dustCol[i * 3 + 1] = p.g * f;
      dustCol[i * 3 + 2] = p.b * f;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustGeo.attributes.color.needsUpdate = true;
    // markers breathe
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    select.scale.setScalar(1 + pulse * 0.06);
    for (const hm of hints) {
      hm.material.opacity = 0.35 + 0.6 * pulse;
      hm.scale.setScalar(0.95 + pulse * 0.12);
    }
    cursor.material.opacity = 0.6 + 0.35 * pulse;
    return live;
  }

  const at = (m, r, c, z) => m.position.set(c - 3.5, 3.5 - r, z);

  return {
    shards,
    glints,
    burst,
    beam,
    shockwave,
    dustBurst,
    update,
    showSelect(cell) {
      select.visible = !!cell;
      if (cell) at(select, cell[0], cell[1], 0.05);
    },
    showHint(pair) {
      hints.forEach((m, i) => {
        m.visible = !!pair;
        if (pair) at(m, pair[i][0], pair[i][1], 0.06);
      });
    },
    showCursor(cell, color = 0x9ff7ff) {
      cursor.visible = !!cell;
      if (cell) {
        at(cursor, cell[0], cell[1], 0.62);
        cursor.material.color.set(color);
      }
    },
    /** Make one shard and glint and hide them again, so their shader is compiled before play (not counted). */
    warmup() {
      burst(0, 0, 0xffffff, 1);
      const s = shards.pop();
      const g = glints.pop();
      return [s.mesh, g.mesh];
    },
  };
}
