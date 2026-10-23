// Juice: dust, sparks, embers, poofs, dash afterimages. One fixed pool of meshes (shared geometry, a
// material per slot), so nothing is allocated while playing. `count` = live particles (a gauge).
import * as THREE from 'three';

const POOL = 220;

export function createFx(scene) {
  const geo = new THREE.IcosahedronGeometry(0.2, 0);
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 1, depthWrite: false, flatShading: true });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    pool.push({ mesh: m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1, gravity: 0, size: 1, drag: 3 });
  }
  let cursor = 0;
  let live = 0;

  function spawn(x, y, z, { color = 0xffffff, size = 1, life = 0.5, vx = 0, vy = 0, vz = 0, grow = 1.5, gravity = 0, glow = 0, drag = 3 } = {}) {
    const p = pool[cursor];
    cursor = (cursor + 1) % pool.length;
    p.mesh.position.set(x, y, z);
    p.mesh.material.color.setHex(color);
    p.mesh.material.emissive.setHex(glow ? color : 0x000000);
    p.mesh.material.emissiveIntensity = glow;
    p.mesh.material.opacity = 0.9;
    p.mesh.visible = true;
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    Object.assign(p, { life, max: life, vx, vy, vz, grow, gravity, size, drag });
    p.mesh.scale.setScalar(size);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  return {
    /** one pooled mesh, for the shader warm-up */
    sample: pool[0].mesh,
    get count() {
      return live;
    },
    dust(x, y, n = 6, strength = 1, color = 0xb8b0a8) {
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? 1 : -1;
        spawn(x + rnd(-0.2, 0.2), y + 0.08, rnd(-0.4, 0.4), { color, size: rnd(0.4, 0.8) * strength, life: rnd(0.3, 0.55), vx: dir * rnd(0.8, 2.2) * strength, vy: rnd(0.3, 1.1), vz: rnd(-0.6, 0.6), grow: 1.6 });
      }
    },
    sparks(x, y, color = 0xffe2a8, n = 10, speed = 5) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2);
        spawn(x, y, 0.3, { color, size: rnd(0.18, 0.32), life: rnd(0.25, 0.45), vx: Math.cos(a) * speed * rnd(0.5, 1), vy: Math.sin(a) * speed * rnd(0.5, 1), grow: -1, glow: 1.4, gravity: 9, drag: 2 });
      }
    },
    poof(x, y, color = 0x9a8fb0, n = 12) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        spawn(x, y, 0, { color, size: 0.8, life: 0.5, vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2 + 0.8, vz: rnd(-1.5, 1.5), grow: 1.1 });
      }
    },
    embers(x0, x1, y, n = 1) {
      for (let i = 0; i < n; i++) spawn(rnd(x0, x1), y, rnd(-1, 1.2), { color: Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, size: rnd(0.12, 0.22), life: rnd(0.8, 1.6), vx: rnd(-0.3, 0.3), vy: rnd(1.0, 2.2), grow: -0.8, glow: 1.8, drag: 0.5 });
    },
    afterimage(x, y, color = 0xff8a3d) {
      spawn(x, y + 0.65, -0.1, { color, size: 1.6, life: 0.22, grow: -0.7, glow: 0.9 });
    },
    burst(x, y, color, n = 18, speed = 6) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        spawn(x, y, rnd(-0.5, 0.5), { color, size: rnd(0.4, 0.7), life: rnd(0.5, 0.9), vx: Math.cos(a) * speed * rnd(0.6, 1), vy: Math.sin(a) * speed * rnd(0.6, 1), grow: -0.6, glow: 1.2, gravity: 4, drag: 2.5 });
      }
    },
    debris(x, y, color = 0x6c6480, n = 14) {
      for (let i = 0; i < n; i++) spawn(x + rnd(-1, 1), y + rnd(0, 2.5), rnd(-0.8, 0.8), { color, size: rnd(0.7, 1.3), life: rnd(0.7, 1.2), vx: rnd(-4, 4), vy: rnd(2, 7), grow: -0.3, gravity: 22, drag: 0.5 });
    },
    update(dt) {
      live = 0;
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          continue;
        }
        live++;
        p.vy -= p.gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const k = 1 - p.drag * dt;
        p.vx *= k;
        p.vy *= p.gravity ? 1 : k;
        const t = p.life / p.max;
        p.mesh.scale.setScalar(Math.max(0.01, p.size * (1 + p.grow * (1 - t))));
        p.mesh.material.opacity = Math.min(0.9, t * 1.2);
      }
    },
  };
}
