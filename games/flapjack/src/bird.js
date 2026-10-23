// Flapjack: a round, golden, pancake-coloured bird with a pat of butter on its head.
import * as THREE from 'three';
import { PHYS } from './physics.js';

export function createBirdModel() {
  const R = PHYS.RADIUS;
  const root = new THREE.Group();
  root.name = 'flapjack';
  const body = new THREE.Group(); // tilts and squashes
  root.add(body);
  root.scale.setScalar(1.12); // drawn a touch bigger than its hitbox, as flappy games do
  const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });
  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(new THREE.SphereGeometry(R, 32, 20), std(0xf2a93b), 0, 0, 0);
  const belly = add(new THREE.SphereGeometry(R * 0.78, 24, 16), std(0xffdc8f), 0.1, -0.1, 0.12);
  belly.scale.set(1, 0.8, 0.9);
  // a pat of butter, slightly melted
  const butter = add(new THREE.BoxGeometry(0.26, 0.09, 0.22), std(0xfff09a, { roughness: 0.3 }), -0.02, R * 0.93, 0.02);
  butter.rotation.set(0.1, 0.3, -0.12);
  const drip = add(new THREE.SphereGeometry(0.07, 10, 8), std(0xfff09a, { roughness: 0.3 }), 0.1, R * 0.82, 0.12);
  drip.scale.set(1, 1.4, 1);
  // eye
  add(new THREE.SphereGeometry(0.14, 16, 12), std(0xffffff, { roughness: 0.2 }), 0.19, 0.13, 0.3);
  add(new THREE.SphereGeometry(0.07, 12, 10), std(0x1b1530, { roughness: 0.2 }), 0.25, 0.13, 0.39);
  add(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.27, 0.16, 0.45);
  // cheek
  const cheek = add(new THREE.CircleGeometry(0.07, 16), new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.6 }), 0.18, -0.06, R * 0.97);
  cheek.castShadow = false;
  // beak
  const beak = add(new THREE.ConeGeometry(0.11, 0.3, 14), std(0xff7a22), R + 0.08, -0.03, 0.06);
  beak.rotation.z = -Math.PI / 2;
  // tail feathers
  const tailMat = std(0xd98a2a);
  for (let i = 0; i < 2; i++) {
    const t = add(new THREE.ConeGeometry(0.08, 0.3, 8), tailMat, -R - 0.06, 0.08 + i * 0.09, 0);
    t.rotation.z = Math.PI / 2 + 0.3 - i * 0.35;
  }
  // wing, on a pivot at the shoulder
  const wingPivot = new THREE.Group();
  wingPivot.position.set(-0.04, 0.02, R * 0.82);
  body.add(wingPivot);
  const wing = add(new THREE.SphereGeometry(1, 16, 10), std(0xe8912e), -0.12, 0, 0.02, wingPivot);
  wing.scale.set(0.28, 0.13, 0.08);

  const anim = { tilt: 0, flapT: 1, squash: 0, dead: false, spin: 0 };

  return {
    root,
    /** a flap: wing beat + squash */
    flap() {
      anim.flapT = 0;
      anim.squash = 1;
    },
    reset() {
      anim.tilt = 0;
      anim.flapT = 1;
      anim.squash = 0;
      anim.dead = false;
      anim.spin = 0;
      body.rotation.set(0, 0, 0);
    },
    die() {
      anim.dead = true;
    },
    /** vy: vertical speed; idle: bob on the title */
    update(dt, { x, y, vy, clock, idle = false }) {
      root.position.set(x, y, 0);
      if (anim.dead) {
        anim.spin = Math.max(anim.spin - dt * 9, -Math.PI / 2);
        body.rotation.z += (anim.spin - body.rotation.z) * Math.min(1, dt * 14);
      } else {
        const want = idle ? Math.sin(clock * 2.2) * 0.08 : Math.max(-1.2, Math.min(0.45, vy * 0.075));
        anim.tilt += (want - anim.tilt) * Math.min(1, dt * (want < anim.tilt ? 6 : 18));
        body.rotation.z = anim.tilt;
      }
      anim.flapT = Math.min(1, anim.flapT + dt / 0.28);
      const beat = anim.flapT < 1 ? Math.sin(anim.flapT * Math.PI * 3) * (1 - anim.flapT) : Math.sin(clock * (idle ? 9 : 5)) * (anim.dead ? 0 : 0.12);
      wingPivot.rotation.x = -beat * 1.1;
      wingPivot.rotation.z = beat * 0.5;
      anim.squash = Math.max(0, anim.squash - dt * 6);
      const s = anim.squash;
      body.scale.set(1 - 0.12 * s, 1 + 0.16 * s, 1 - 0.06 * s);
    },
  };
}
