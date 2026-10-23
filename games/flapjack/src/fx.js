// Pooled particles in one InstancedMesh: flap puffs, feathers, sparkles. Nothing is allocated after boot.
import * as THREE from 'three';

const MAX = 220;

export function createFx(scene) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = 'particles';
  mesh.frustumCulled = false; // instances move around; the base geometry's bounds don't cover them
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  scene.add(mesh);

  const ps = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, g: 0, drag: 0, spin: 0, rot: 0, color: new THREE.Color() }));
  let live = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  function emit(x, y, z, { count = 8, color = 0xffffff, speed = 3, size = 0.1, life = 0.6, g = -6, drag = 1.5, spread = Math.PI * 2, dir = 0, vx = 0, vy = 0, jitter = 0.2 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count && live < MAX; i++) {
      const p = ps[live++];
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.x = x + (Math.random() - 0.5) * jitter;
      p.y = y + (Math.random() - 0.5) * jitter;
      p.z = z + (Math.random() - 0.5) * jitter;
      p.vx = vx + Math.cos(a) * s;
      p.vy = vy + Math.sin(a) * s;
      p.vz = (Math.random() - 0.5) * s * 0.6;
      p.life = p.max = life * (0.6 + Math.random() * 0.7);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.g = g;
      p.drag = drag;
      p.rot = Math.random() * 6;
      p.spin = (Math.random() - 0.5) * 12;
      p.color.copy(c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
    }
  }

  return {
    mesh,
    get count() {
      return live;
    },
    puff(x, y) {
      emit(x - 0.35, y - 0.1, 0.2, { count: 3, color: 0xffffff, speed: 1.6, size: 0.09, life: 0.4, g: 1, drag: 4, dir: Math.PI + 0.5, spread: 1.2, vx: 1 });
    },
    feathers(x, y) {
      emit(x, y, 0.3, { count: 18, color: 0xf2a93b, speed: 5, size: 0.11, life: 1.1, g: -9, drag: 2 });
      emit(x, y, 0.3, { count: 8, color: 0xfff09a, speed: 4, size: 0.08, life: 0.9, g: -9, drag: 2 });
      emit(x, y, 0.3, { count: 10, color: 0xffffff, speed: 6.5, size: 0.06, life: 0.35, g: 0, drag: 5 });
    },
    sparkle(x, y, color = 0xffe066, count = 7) {
      emit(x, y, 0.4, { count, color, speed: 3.2, size: 0.08, life: 0.55, g: -3, drag: 3 });
    },
    burst(x, y, color, count = 26) {
      emit(x, y, 0.5, { count, color, speed: 7, size: 0.12, life: 1, g: -5, drag: 2.5 });
    },
    dust(x, y) {
      emit(x, y, 0.4, { count: 10, color: 0xe6d2b0, speed: 2.4, size: 0.13, life: 0.6, g: 1.5, drag: 4, dir: Math.PI / 2, spread: 2.6 });
    },
    reset() {
      live = 0;
      mesh.count = 0;
    },
    update(dt) {
      for (let i = 0; i < live; i++) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) {
          // swap-remove
          const last = ps[--live];
          ps[live] = p;
          ps[i] = last;
          i--;
          continue;
        }
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vz *= k;
        p.vy = p.vy * k + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rot += p.spin * dt;
      }
      for (let i = 0; i < live; i++) {
        const p = ps[i];
        const s = p.size * Math.min(1, (p.life / p.max) * 2.2);
        e.set(p.rot, p.rot * 0.7, 0);
        q.setFromEuler(e);
        m4.compose(v.set(p.x, p.y, p.z), q, sc.set(s, s, s));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, p.color);
      }
      mesh.count = live;
      if (live) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
