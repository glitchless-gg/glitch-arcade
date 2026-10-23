// Pooled particles in two InstancedMeshes: sparks (wall scrapes, wrecks) and puffs (tire smoke,
// wreck smoke, boost flames). Fixed capacity, one draw call each.
import * as THREE from 'three';

function pool(scene, geo, mat, cap, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = name;
  mesh.count = 0;
  const color = new THREE.Color();
  mesh.setColorAt(0, color);
  scene.add(mesh);
  const ps = [];
  for (let i = 0; i < cap; i++) ps.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 0, g: 0, drag: 0, color: new THREE.Color() });
  let next = 0;
  return {
    mesh,
    spawn(o) {
      const p = ps[next];
      next = (next + 1) % cap;
      Object.assign(p, { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life, max: o.life, s0: o.s0 ?? 1, s1: o.s1 ?? 0, g: o.g ?? 0, drag: o.drag ?? 0 });
      p.color.setHex(o.color);
    },
    alive() {
      let n = 0;
      for (const p of ps) if (p.life > 0) n++;
      return n;
    },
    update(dt) {
      const m = new THREE.Matrix4();
      let n = 0;
      for (const p of ps) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) continue;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vz *= k;
        p.vy = p.vy * k - p.g * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
        const a = 1 - p.life / p.max;
        const s = p.s0 + (p.s1 - p.s0) * a;
        m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, p.color);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

export function createFx(scene) {
  const sparks = pool(scene, new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ toneMapped: false }), 240, 'fx_sparks');
  const puffs = pool(scene, new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false }), 220, 'fx_puffs');
  const rnd = (a) => (Math.random() - 0.5) * a;

  return {
    get count() {
      return sparks.mesh.count + puffs.mesh.count;
    },
    sparks(x, z, nx, nz, n = 10) {
      for (let i = 0; i < n; i++) {
        sparks.spawn({ x, y: 0.5, z, vx: nx * 6 + rnd(9), vy: 3 + Math.random() * 5, vz: nz * 6 + rnd(9), life: 0.35 + Math.random() * 0.3, s0: 1, s1: 0.2, g: 18, drag: 2, color: Math.random() < 0.5 ? 0xffd34d : 0xff8a2a });
      }
    },
    smoke(x, z, n = 1, color = 0xeeeeee, big = 1) {
      for (let i = 0; i < n; i++) {
        puffs.spawn({ x: x + rnd(0.6), y: 0.3, z: z + rnd(0.6), vx: rnd(1.5), vy: 0.6 + Math.random() * 0.6, vz: rnd(1.5), life: 0.3 + Math.random() * 0.25, s0: 0.3 * big, s1: 0.85 * big, drag: 1.5, color });
      }
    },
    boost(x, z, bx, bz) {
      puffs.spawn({ x: x + rnd(0.4), y: 0.55, z: z + rnd(0.4), vx: bx * 4 + rnd(1), vy: 0.4, vz: bz * 4 + rnd(1), life: 0.25, s0: 0.7, s1: 0.1, drag: 3, color: Math.random() < 0.5 ? 0x7ff6ff : 0xffb13d });
    },
    wreck(x, z) {
      for (let i = 0; i < 26; i++) sparks.spawn({ x, y: 0.8, z, vx: rnd(18), vy: 4 + Math.random() * 9, vz: rnd(18), life: 0.5 + Math.random() * 0.5, s0: 1.4, s1: 0.2, g: 20, drag: 1.2, color: i % 3 ? 0xffd34d : 0xffffff });
      for (let i = 0; i < 10; i++) puffs.spawn({ x: x + rnd(2), y: 0.6, z: z + rnd(2), vx: rnd(4), vy: 1 + Math.random() * 2, vz: rnd(4), life: 1 + Math.random() * 0.8, s0: 1, s1: 4, drag: 1, color: 0x55575e });
    },
    update(dt) {
      sparks.update(dt);
      puffs.update(dt);
    },
  };
}
