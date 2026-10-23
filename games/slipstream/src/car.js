// Low-poly car: a box body with a cabin, a stripe, a spoiler and four wheels. Geometries are shared
// by every car; each car has its own paint.
import * as THREE from 'three';

const GEO = {
  body: new THREE.BoxGeometry(2.0, 0.55, 4.3),
  nose: new THREE.BoxGeometry(1.9, 0.3, 0.9),
  cabin: new THREE.BoxGeometry(1.5, 0.44, 1.8),
  stripe: new THREE.BoxGeometry(0.42, 0.02, 4.32),
  wing: new THREE.BoxGeometry(2.0, 0.08, 0.5),
  post: new THREE.BoxGeometry(0.1, 0.28, 0.12),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14).rotateZ(Math.PI / 2),
  hub: new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8).rotateZ(Math.PI / 2),
  light: new THREE.BoxGeometry(0.42, 0.14, 0.06),
};
const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: 0x324563, roughness: 0.12, metalness: 0.5 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x18181d, roughness: 0.9 }),
  hub: new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.3, metalness: 0.7 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.5 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff4cc, toneMapped: false }),
};

export const WHEEL_R = 0.42;
// rear wheel contact points (local x, z) — where skid marks come from
export const REAR_WHEELS = [
  [0.98, -1.35],
  [-0.98, -1.35],
];

export function createCarMesh(color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.35 });
  const tail = new THREE.MeshBasicMaterial({ color: 0x9a1010, toneMapped: false });

  const part = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  part(GEO.body, paint, 0, 0.62, 0);
  part(GEO.nose, paint, 0, 0.5, 2.35);
  part(GEO.cabin, MAT.glass, 0, 1.1, -0.3);
  part(GEO.stripe, MAT.stripe, 0, 0.9, 0);
  part(GEO.wing, paint, 0, 1.2, -1.95);
  part(GEO.post, MAT.dark, 0.6, 1.02, -1.95);
  part(GEO.post, MAT.dark, -0.6, 1.02, -1.95);
  for (const s of [-1, 1]) {
    part(GEO.light, MAT.head, s * 0.66, 0.66, 2.16).castShadow = false;
    part(GEO.light, tail, s * 0.66, 0.7, -2.16).castShadow = false;
  }

  const wheels = [];
  for (const [x, z] of [
    [0.98, 1.35],
    [-0.98, 1.35],
    [0.98, -1.35],
    [-0.98, -1.35],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const tire = new THREE.Mesh(GEO.wheel, MAT.tire);
    tire.castShadow = true;
    const hub = new THREE.Mesh(GEO.hub, MAT.hub);
    tire.add(hub);
    pivot.add(tire);
    root.add(pivot);
    wheels.push({ pivot, tire, front: z > 0 });
  }

  root.userData = { body, wheels, paint, tail, spin: 0, roll: 0, pitch: 0 };
  return root;
}

/** pose the mesh from the car's state; dt in seconds */
export function animateCar(mesh, car, dt, t) {
  const u = mesh.userData;
  if (car.wreckT > 0 && car.wreckInfo) {
    // tumble: a short ballistic hop while spinning, then lie there until the respawn
    const w = car.wreckInfo;
    const age = Math.max(0, 1.5 - car.wreckT);
    const k = Math.min(age, 1.0);
    const y = Math.max(0, 6.5 * k - 0.5 * 13 * k * k);
    const drift = 0.3 * (1 - Math.exp(-age * 2.5));
    mesh.position.set(w.x + w.vx * drift, y, w.z + w.vz * drift);
    mesh.rotation.set(0, w.h + age * 2.2, 0);
    u.body.rotation.set(Math.min(age, 0.9) * 4.2, 0, Math.min(age, 0.9) * 3.1);
    mesh.visible = true;
    return;
  }
  mesh.position.set(car.x, 0, car.z);
  mesh.rotation.set(0, car.h, 0);
  const speed = Math.hypot(car.vx, car.vz);
  const vf = car.vf;
  // body lean: roll away from the turn, pitch forward when braking
  const rollT = Math.max(-0.09, Math.min(0.09, -car.steer * Math.min(1, speed / 30) * 0.08 - car.vl * 0.008));
  const pitchT = car.braking ? 0.045 : car.throttle > 0.5 && speed < 25 ? -0.03 : 0;
  u.roll += (rollT - u.roll) * Math.min(1, dt * 8);
  u.pitch += (pitchT - u.pitch) * Math.min(1, dt * 6);
  u.body.rotation.set(u.pitch, 0, u.roll);
  u.body.position.y = car.hitT > 0 ? Math.sin(t * 60) * 0.04 : 0;
  u.spin += (vf / WHEEL_R) * dt;
  for (const w of u.wheels) {
    w.tire.rotation.x = u.spin;
    if (w.front) w.pivot.rotation.y = -car.steer * 0.45;
  }
  u.tail.color.setHex(car.braking || car.handbrake ? 0xff2020 : 0x9a1010);
  // blink while ghosted after a respawn
  mesh.visible = !(car.ghostT > 0 && Math.floor(car.ghostT * 12) % 2 === 0);
}
