// Bats (swoop at you) and crawlers (patrol a floor). One hit from the sword kills either.
// Logic is plain numbers; each enemy also owns its mesh, added to its room's group.
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

const BAT_AGGRO = 7.5;
const BAT_SPEED = 5.6;
const CRAWLER_SPEED = 1.5;

// Geometry and materials are shared by every enemy (made once), so a new run doesn't allocate more.
let shared = null;
function parts() {
  if (shared) return shared;
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(0.75, 0.25);
  wingShape.lineTo(0.62, -0.05);
  wingShape.lineTo(0.42, 0.02);
  wingShape.lineTo(0.3, -0.12);
  wingShape.lineTo(0.12, -0.04);
  wingShape.closePath();
  shared = {
    batBody: new THREE.SphereGeometry(0.26, 12, 10),
    batEar: new THREE.ConeGeometry(0.07, 0.18, 5),
    eye: new THREE.SphereGeometry(0.045, 6, 5),
    wing: new THREE.ShapeGeometry(wingShape),
    shell: new THREE.SphereGeometry(0.48, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    belly: new THREE.CylinderGeometry(0.5, 0.45, 0.14, 14),
    spike: new THREE.ConeGeometry(0.08, 0.26, 5),
    leg: new THREE.BoxGeometry(0.06, 0.18, 0.06),
    batMat: std(0x5b4a7a, { emissive: 0x24163a, emissiveIntensity: 0.6 }),
    wingMat: std(0x46385f, { side: THREE.DoubleSide, emissive: 0x1a1030, emissiveIntensity: 0.6 }),
    batEye: new THREE.MeshBasicMaterial({ color: 0xff4d5e }),
    crawlerEye: new THREE.MeshBasicMaterial({ color: 0xffd24a }),
    bellyMat: std(0x3a2b26),
    legMat: std(0x2a201c),
    shellMat: { foundry: std(0x8a4a2a, { roughness: 0.55 }), other: std(0xd8ccb0, { roughness: 0.55 }) },
    spikeMat: { foundry: std(0xffb066, { roughness: 0.4 }), other: std(0xf4ead2, { roughness: 0.4 }) },
  };
  return shared;
}

function batMesh() {
  const P = parts();
  const g = new THREE.Group();
  const body = new THREE.Mesh(P.batBody, P.batMat);
  const ears = [-0.1, 0.1].map((z) => {
    const ear = new THREE.Mesh(P.batEar, P.batMat);
    ear.position.set(0, 0.26, z);
    return ear;
  });
  const eyes = [-0.08, 0.08].map((z) => {
    const e = new THREE.Mesh(P.eye, P.batEye);
    e.position.set(0.12, 0.06, z + 0.12);
    return e;
  });
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    const w = new THREE.Mesh(P.wing, P.wingMat);
    w.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    pivot.add(w);
    pivot.position.z = side * 0.12;
    pivot.userData.side = side;
    return pivot;
  });
  g.add(body, ...ears, ...eyes, ...wings);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.scale.setScalar(1.35);
  g.userData.wings = wings;
  return g;
}

function crawlerMesh(area) {
  const P = parts();
  const key = area === 'foundry' ? 'foundry' : 'other';
  const g = new THREE.Group();
  const shell = new THREE.Mesh(P.shell, P.shellMat[key]);
  shell.scale.set(1.1, 0.75, 0.9);
  shell.position.y = 0.12;
  const belly = new THREE.Mesh(P.belly, P.bellyMat);
  belly.position.y = 0.1;
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(P.spike, P.spikeMat[key]);
    sp.position.set(-0.3 + i * 0.2, 0.47 - Math.abs(i - 1.5) * 0.06, 0);
    g.add(sp);
  }
  for (const z of [-0.14, 0.14]) {
    const e = new THREE.Mesh(P.eye, P.crawlerEye);
    e.scale.setScalar(1.1);
    e.position.set(0.48, 0.2, z);
    g.add(e);
  }
  const legs = [];
  for (let i = 0; i < 3; i++) {
    for (const z of [-0.36, 0.36]) {
      const l = new THREE.Mesh(P.leg, P.legMat);
      l.position.set(-0.28 + i * 0.28, 0.06, z);
      g.add(l);
      legs.push(l);
    }
  }
  g.add(shell, belly);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.userData.legs = legs;
  return g;
}

export class Enemy {
  constructor(spec, room) {
    this.kind = spec.kind;
    this.spec = spec;
    this.roomId = room.id;
    this.damage = 1;
    this.mesh = spec.kind === 'bat' ? batMesh() : crawlerMesh(room.area);
    this.reset();
  }

  /** back to its spawn point, alive (called when you come back into the room) */
  reset() {
    const s = this.spec;
    this.x = s.x;
    this.y = s.y;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.t = (s.x * 0.37) % 3; // deterministic per enemy (bot runs replay per seed)
    this.state = 'idle';
    this.stateT = 0;
    this.dir = -1;
    this.hitCd = 0;
    this.mesh.visible = true;
    this.mesh.position.set(this.x, this.y, 0);
  }

  /** player = { x, y (feet), alive } */
  step(dt, player) {
    this.t += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    const px = player.x;
    const py = player.y + 0.7;
    if (this.kind === 'bat') {
      const s = this.spec;
      const d = Math.hypot(px - this.x, py - this.y);
      this.stateT -= dt;
      if (this.state === 'idle') {
        // hover around home
        const tx = s.x + Math.sin(this.t * 0.9) * 1.2;
        const ty = s.y + Math.sin(this.t * 1.7) * 0.4;
        this.vx += (tx - this.x) * 3 * dt - this.vx * 2 * dt;
        this.vy += (ty - this.y) * 3 * dt - this.vy * 2 * dt;
        if (player.alive && d < BAT_AGGRO && this.stateT <= 0) {
          this.state = 'swoop';
          this.stateT = 2.4;
        }
      } else if (this.state === 'swoop') {
        const k = 1 / Math.max(0.001, d);
        this.vx += ((px - this.x) * k * BAT_SPEED - this.vx) * 6 * dt;
        this.vy += ((py - this.y) * k * BAT_SPEED - this.vy) * 6 * dt;
        if (this.stateT <= 0 || !player.alive) {
          this.state = 'retreat';
          this.stateT = 1.1;
        }
      } else {
        // retreat: back up toward home, then idle a moment
        this.vx += ((s.x - this.x) * 1.2 - this.vx) * 2.5 * dt;
        this.vy += ((s.y + 1 - this.y) * 1.2 - this.vy) * 2.5 * dt;
        if (this.stateT <= 0) {
          this.state = 'idle';
          this.stateT = 0.6;
        }
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else {
      // crawler: patrol between x0 and x1; hurry when the knight is close on the same floor
      const s = this.spec;
      const near = player.alive && Math.abs(px - this.x) < 4.5 && Math.abs(player.y - this.y) < 1;
      const speed = near ? CRAWLER_SPEED * 1.7 : CRAWLER_SPEED;
      if (near) this.dir = Math.sign(px - this.x) || this.dir;
      this.x += this.dir * speed * dt;
      if (this.x < s.x0) {
        this.x = s.x0;
        this.dir = 1;
      } else if (this.x > s.x1) {
        this.x = s.x1;
        this.dir = -1;
      }
      this.vx = this.dir * speed;
    }
  }

  hitbox() {
    if (this.kind === 'bat') return { x0: this.x - 0.4, x1: this.x + 0.4, y0: this.y - 0.32, y1: this.y + 0.32 };
    return { x0: this.x - 0.5, x1: this.x + 0.5, y0: this.y, y1: this.y + 0.62 };
  }

  animate(dt) {
    const m = this.mesh;
    m.position.set(this.x, this.y, 0);
    if (this.kind === 'bat') {
      const flap = Math.sin(this.t * (this.state === 'swoop' ? 26 : 16));
      for (const w of m.userData.wings) w.rotation.x = w.userData.side * flap * 0.9;
      m.rotation.y = this.vx >= 0 ? -0.4 : Math.PI + 0.4;
      m.rotation.z = Math.max(-0.5, Math.min(0.5, this.vy * 0.08));
    } else {
      m.rotation.y = this.dir > 0 ? -0.3 : Math.PI + 0.3;
      const step = Math.sin(this.t * 14);
      m.userData.legs.forEach((l, i) => (l.rotation.z = (i % 2 ? 1 : -1) * step * 0.5));
      m.position.y = this.y + Math.abs(step) * 0.03;
    }
  }
}

export function enemyCounts(rooms) {
  let n = 0;
  for (const r of rooms) for (const e of r.enemies) if (e && e.alive) n++;
  return n;
}
