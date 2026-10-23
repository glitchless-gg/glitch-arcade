// Pickups on fixed pads: health (+25), shells (+8), rockets (+3). They respawn a while after being taken.
import * as THREE from 'three';
import { PICKUP_SPOTS } from './arena.js';

export const PICKUP = {
  health: { amount: 25, respawn: 14 },
  shells: { amount: 8, respawn: 12 },
  rockets: { amount: 3, respawn: 16 },
};

export function createPickups(scene) {
  const health = new THREE.MeshStandardMaterial({ color: 0x4dff9a, emissive: 0x16a05a, emissiveIntensity: 0.9, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, roughness: 0.4 });
  const shells = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x7a4a00, emissiveIntensity: 0.8, roughness: 0.45, metalness: 0.4 });
  const rocket = new THREE.MeshStandardMaterial({ color: 0xff3caa, emissive: 0x7a0a48, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f3c, roughness: 0.4, metalness: 0.8 });

  function model(kind) {
    const g = new THREE.Group();
    g.name = `pickup-${kind}`;
    if (kind === 'health') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.6), white));
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.14), health);
      a.position.y = 0.2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.42), health);
      b.position.y = 0.2;
      g.add(a, b);
    } else if (kind === 'shells') {
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), shells);
        s.position.set(-0.18 + i * 0.12, 0, 0);
        g.add(s);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10), steel);
        cap.position.set(-0.18 + i * 0.12, -0.14, 0);
        g.add(cap);
      }
    } else {
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12), rocket);
        r.position.set(-0.1 + i * 0.2, 0, 0);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 12), steel);
        tip.position.set(-0.1 + i * 0.2, 0.38, 0);
        g.add(r, tip);
      }
    }
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  const items = PICKUP_SPOTS.map((s, i) => {
    const mesh = model(s.kind);
    mesh.position.set(s.x, 0.7, s.z);
    scene.add(mesh);
    return { ...s, i, mesh, up: true, t: 0 };
  });

  return {
    items,
    reset() {
      for (const it of items) {
        it.up = true;
        it.t = 0;
        it.mesh.visible = true;
      }
    },
    /** Tick respawn timers; returns the items the player is touching that are up. */
    step(dt, player) {
      const touching = [];
      for (const it of items) {
        if (!it.up) {
          it.t -= dt;
          if (it.t <= 0) {
            it.up = true;
            it.mesh.visible = true;
          }
          continue;
        }
        if (Math.hypot(player.x - it.x, player.z - it.z) < 0.95 && player.y < 1.2) touching.push(it);
      }
      return touching;
    },
    take(it) {
      it.up = false;
      it.t = PICKUP[it.kind].respawn;
      it.mesh.visible = false;
    },
    animate(clock) {
      for (const it of items) {
        if (!it.up) continue;
        it.mesh.rotation.y = clock * 1.6 + it.i;
        it.mesh.position.y = 0.72 + Math.sin(clock * 2.4 + it.i) * 0.1;
      }
    },
  };
}
