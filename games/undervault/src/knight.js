// The hero: a small hooded knight (capsule body, hood with glowing eyes, cape, sword). Origin = feet.
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

export function createKnight() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // squash, lean
  root.add(body);

  const armor = std(0x6b7896, { metalness: 0.55, roughness: 0.4 });
  const cloth = std(0x262a3d, { roughness: 0.85 });
  const capeMat = std(0x9c2335, { roughness: 0.85, side: THREE.DoubleSide });
  const bootMat = std(0x3a3240, { roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.34, 4, 12), armor);
  torso.position.y = 0.6;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.04, 6, 16), std(0x8a6a3a, { metalness: 0.4 }));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.47;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 12), cloth);
  hood.position.y = 1.04;
  hood.scale.set(1, 1.05, 1);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 10), cloth);
  tip.position.set(-0.2, 1.2, 0);
  tip.rotation.z = 1.05;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), std(0x07080d, { roughness: 1 }));
  face.position.set(0.12, 1.0, 0);
  face.scale.set(0.8, 0.95, 1);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xcfeeff });
  const eyes = [];
  for (const z of [-0.075, 0.075]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), eyeMat);
    e.position.set(0.27, 1.03, z);
    eyes.push(e);
  }
  body.add(torso, belt, hood, tip, face, ...eyes);

  // legs (pivot at the hip)
  const legs = [];
  for (const z of [-0.11, 0.11]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.36, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), cloth);
    leg.position.y = -0.15;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), bootMat);
    boot.position.set(0.03, -0.31, 0);
    hip.add(leg, boot);
    body.add(hip);
    legs.push(hip);
  }

  // cape (pivot at the shoulders, hangs behind)
  const capePivot = new THREE.Group();
  capePivot.position.set(-0.04, 0.93, 0);
  // the back half of an open cone: wraps around the shoulders and flares out
  const capeGeo = new THREE.CylinderGeometry(0.25, 0.4, 0.82, 12, 3, true, Math.PI, Math.PI);
  capeGeo.translate(0, -0.41, 0);
  const cape = new THREE.Mesh(capeGeo, capeMat);
  cape.castShadow = true;
  capePivot.add(cape);
  body.add(capePivot);

  // sword (pivot at the hand)
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.16, 0.62, 0.2);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.03), std(0xdfe8f5, { metalness: 0.9, roughness: 0.2, emissive: 0x3a5068, emissiveIntensity: 0.3 }));
  blade.position.y = 0.5;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.06), std(0xc9a35a, { metalness: 0.7, roughness: 0.3 }));
  guard.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), cloth);
  swordPivot.add(blade, guard, grip);
  body.add(swordPivot);

  // slash arc (shown during an attack)
  const arcMat = new THREE.MeshBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const arc = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.45, 24, 1, -1.25, 2.5), arcMat);
  arc.position.set(0.2, 0.7, 0.3);
  root.add(arc);

  root.traverse((o) => {
    if (o.isMesh && o !== arc) o.castShadow = true;
  });

  root.userData = { body, legs, capePivot, capeMat, bootMat, swordPivot, arc, arcMat, eyeMat, phase: 0, cape: 0, squash: 0, turn: 0 };
  return root;
}

/**
 * s = { vx, vy, grounded, facing, attack (0..1 progress or -1), dashing, kick, hurt, abilities, dead }
 */
export function animateKnight(k, s, dt) {
  const u = k.userData;
  // 3/4 view: lean the facing toward the camera a little
  const targetTurn = s.facing > 0 ? -0.38 : Math.PI + 0.38;
  u.turn += (targetTurn - u.turn) * Math.min(1, dt * 22);
  k.rotation.y = u.turn;

  const speed = Math.abs(s.vx);
  const run = s.grounded ? Math.min(1, speed / 7) : 0;
  u.phase += dt * speed * 2.4;
  u.legs[0].rotation.z = s.grounded ? Math.sin(u.phase) * 0.8 * run : 0.5;
  u.legs[1].rotation.z = s.grounded ? -Math.sin(u.phase) * 0.8 * run : -0.25;

  // squash & stretch
  u.squash += (s.kick || 0) * 0.04;
  u.squash *= Math.exp(-12 * dt);
  const air = s.grounded ? 0 : Math.max(-0.12, Math.min(0.12, s.vy * 0.01));
  const sq = Math.max(-0.25, Math.min(0.25, u.squash)) + air;
  u.body.scale.set(1 - sq * 0.5 + (s.dashing ? 0.25 : 0), 1 + sq - (s.dashing ? 0.12 : 0), 1);
  u.body.position.y = s.grounded ? Math.abs(Math.sin(u.phase)) * 0.05 * run : 0;
  u.body.rotation.z = s.dashing ? -0.25 : -Math.min(0.15, speed * 0.015);

  // cape trails behind, lifts when falling
  const capeTarget = Math.min(1.2, speed * 0.09 + (s.grounded ? 0 : s.vy < 0 ? 0.5 : 0.15) + (s.dashing ? 0.6 : 0)) + Math.sin(u.phase * 0.5) * 0.06;
  u.cape += (capeTarget - u.cape) * Math.min(1, dt * 10);
  u.capePivot.rotation.z = -u.cape;

  // sword swing: a fast overhead arc
  if (s.attack >= 0) {
    const p = s.attack;
    u.swordPivot.rotation.z = 1.9 - p * 3.6;
    u.arcMat.opacity = p < 0.75 ? 0.75 * Math.sin(Math.min(1, p / 0.75) * Math.PI) : 0;
    u.arc.rotation.z = 0.6 - p * 1.4;
  } else {
    u.swordPivot.rotation.z += (-0.5 - u.swordPivot.rotation.z) * Math.min(1, dt * 12);
    u.arcMat.opacity = 0;
  }

  // relics change the look: Dash Cloak = orange cape, Boots = gold boots
  u.capeMat.color.setHex(s.abilities?.dash ? 0xe2672b : 0x9c2335);
  u.capeMat.emissive.setHex(s.abilities?.dash ? 0x5a1a00 : 0x000000);
  u.bootMat.color.setHex(s.abilities?.doubleJump ? 0xf1b84a : 0x3a3240);
  u.bootMat.metalness = s.abilities?.doubleJump ? 0.8 : 0;
  u.eyeMat.color.setHex(s.hurt ? 0xff6a6a : 0xcfeeff);
}
