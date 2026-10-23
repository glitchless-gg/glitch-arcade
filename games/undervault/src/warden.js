// The Warden: a big stone golem guarding the Keep. 12 HP. Two telegraphed attacks:
//   slam   — raises both fists (wind-up), slams: a hit around it plus a shockwave along the floor each
//            way (jump over it), then it recovers with its fists in the floor (hit it now)
//   charge — paws the floor (wind-up), charges to the wall (double jump over it), then it's stunned
// At half HP it gets faster: shorter wind-ups, faster waves and charges, shorter recoveries.
import * as THREE from 'three';
import { PHYS } from './physics.js';

export const WARDEN_HP = 12;
const PATTERN = ['slam', 'charge', 'slam', 'slam', 'charge', 'slam', 'charge'];
const HALF_W = 1.2;
const HEIGHT = 3.0; // the hitbox (the head pokes a little above it)

const T = {
  calm: { windupSlam: 0.85, windupCharge: 0.75, recover: 1.5, stun: 1.6, idle: 0.7, wave: 10.5, charge: 10, walk: 1.3 },
  angry: { windupSlam: 0.55, windupCharge: 0.5, recover: 1.05, stun: 1.15, idle: 0.4, wave: 14, charge: 13, walk: 2.0 },
};

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function buildMesh() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const stone = std(0x6c6480, { roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0 });
  const dark = std(0x3c3550, { roughness: 0.95 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });

  const legs = [];
  for (const z of [-0.45, 0.45]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.05, 0.7), dark);
    leg.position.set(0, 0.52, z);
    body.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.75, 1.7), stone);
  torso.position.y = 1.9;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.5), dark);
  belly.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.95), stone);
  head.position.set(0.25, 3.0, 0);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.0), dark);
  brow.position.set(0.62, 3.18, 0);
  const eyes = [-0.2, 0.2].map((z) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.2), glowMat);
    e.position.set(0.73, 3.04, z);
    return e;
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), glowMat);
  core.position.set(0.96, 1.95, 0);
  // runes (thin glowing cracks)
  const runes = [
    [0.96, 2.35, 0.5, 0.06],
    [0.96, 1.55, 0.06, 0.5],
    [0.96, 2.2, 0.06, 0.3],
  ].map(([x, y, w, h]) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.02, h, w), glowMat);
    r.position.set(x, y, -0.35);
    return r;
  });
  body.add(torso, belly, head, brow, ...eyes, core, ...runes);

  const arms = [];
  for (const z of [-1.15, 1.15]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.1, 2.55, z);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.75), stone);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 0.55), dark);
    arm.position.y = -0.85;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.8), stone);
    fist.position.y = -1.75;
    shoulder.add(pad, arm, fist);
    body.add(shoulder);
    arms.push(shoulder);
  }
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.userData = { body, legs, arms, head, stone, glowMat, core };
  return root;
}

function waveMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 10, 1, true), mat);
  ring.position.y = 0.55;
  const rocks = [];
  const rockMat = std(0x5d5470);
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + i * 0.03), rockMat);
    r.position.set((i - 1.5) * 0.22, 0.2 + (i % 2) * 0.25, (i % 2 ? -0.5 : 0.5) * 0.6);
    rocks.push(r);
    g.add(r);
  }
  g.add(ring);
  g.userData = { mat, rocks };
  return g;
}

export class Warden {
  constructor(spec, scene) {
    this.spec = spec;
    this.arena = spec.arena;
    this.floor = spec.y;
    this.mesh = buildMesh();
    this.waveMeshes = [waveMesh(), waveMesh()];
    for (const w of this.waveMeshes) {
      w.visible = false;
      scene.add(w);
    }
    this.reset();
  }

  reset() {
    this.x = this.spec.x;
    this.y = this.spec.y;
    this.hp = WARDEN_HP;
    this.state = 'dormant';
    this.t = 0;
    this.facing = -1;
    this.pattern = 0;
    this.waves = [];
    this.flash = 0;
    this.deadT = 0;
    this.anim = { arms: 0, crouch: 0, lean: 0, shake: 0 };
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.userData.body.position.set(0, 0, 0);
    this.mesh.userData.body.rotation.set(0, 0, 0);
    for (const w of this.waveMeshes) w.visible = false;
  }

  get enraged() {
    return this.hp <= WARDEN_HP / 2;
  }
  get fighting() {
    return this.state !== 'dormant' && this.state !== 'dying' && this.state !== 'dead';
  }
  /** fists in the floor or stunned against the wall: the time to hit it */
  get open() {
    return this.state === 'recover' || this.state === 'stunned';
  }
  get tune() {
    return this.enraged ? T.angry : T.calm;
  }

  wake() {
    this.state = 'idle';
    this.t = 1.1;
  }

  hitbox() {
    return { x0: this.x - HALF_W, x1: this.x + HALF_W, y0: this.y, y1: this.y + HEIGHT };
  }

  /** one sword hit; returns true if that killed it */
  hurt() {
    if (!this.fighting) return false;
    this.hp--;
    this.flash = 0.16;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.deadT = 0;
      this.waves = [];
      return true;
    }
    return false;
  }

  /** p = { x, y, alive }; returns events [{ type: 'telegraph'|'slam'|'wall'|'hit', ... }] */
  step(dt, p) {
    const ev = [];
    const k = this.tune;
    this.t -= dt;
    if (this.flash > 0) this.flash -= dt;
    const a = this.arena;
    for (const w of this.waves) {
      w.x += w.dir * w.speed * dt;
      if (w.x < a.x0 + 0.3 || w.x > a.x1 - 0.3) w.dead = true;
    }
    this.waves = this.waves.filter((w) => !w.dead);

    const dx = p.x - this.x;
    switch (this.state) {
      case 'idle': {
        this.facing = Math.sign(dx) || this.facing;
        if (Math.abs(dx) > 3.4) this.x += this.facing * k.walk * dt;
        if (this.t <= 0) {
          let next = PATTERN[this.pattern++ % PATTERN.length];
          if (Math.abs(dx) > 9) next = 'charge';
          else if (Math.abs(dx) < 2.6) next = 'slam';
          this.state = next === 'slam' ? 'windup_slam' : 'windup_charge';
          this.t = next === 'slam' ? k.windupSlam : k.windupCharge;
          this.windup = this.t;
          ev.push({ type: 'telegraph', attack: next });
        }
        break;
      }
      case 'windup_slam':
        if (this.t <= 0) {
          this.state = 'recover';
          this.t = k.recover;
          for (const dir of [-1, 1]) this.waves.push({ x: this.x + dir * 1.4, dir, speed: k.wave });
          ev.push({ type: 'slam' });
          if (p.alive && Math.abs(dx) < 2.6 && p.y < this.floor + 1.0) ev.push({ type: 'hit', damage: 3, from: this.x });
        }
        break;
      case 'windup_charge':
        this.facing = Math.sign(dx) || this.facing;
        if (this.t <= 0) {
          this.state = 'charge';
          ev.push({ type: 'charge' });
        }
        break;
      case 'charge': {
        this.x += this.facing * k.charge * dt;
        const lo = a.x0 + HALF_W + 0.1;
        const hi = a.x1 - HALF_W - 0.1;
        if (this.x <= lo || this.x >= hi) {
          this.x = Math.min(hi, Math.max(lo, this.x));
          this.state = 'stunned';
          this.t = k.stun;
          ev.push({ type: 'wall' });
        }
        break;
      }
      case 'recover':
      case 'stunned':
        if (this.t <= 0) {
          this.state = 'idle';
          this.t = k.idle;
        }
        break;
      case 'dying':
        this.deadT += dt;
        if (this.deadT > 1.9) this.state = 'dead';
        break;
      default:
        break;
    }
    this.x = Math.min(a.x1 - HALF_W - 0.1, Math.max(a.x0 + HALF_W + 0.1, this.x));

    if (this.fighting && p.alive) {
      const hb = this.hitbox();
      const touching = p.x + PHYS.HALF_W > hb.x0 && p.x - PHYS.HALF_W < hb.x1 && p.y + PHYS.HEIGHT > hb.y0 && p.y < hb.y1;
      if (touching && this.state === 'charge') ev.push({ type: 'hit', damage: 3, from: this.x });
      else if (touching && !this.open) ev.push({ type: 'hit', damage: 1, from: this.x });
      for (const w of this.waves) {
        if (Math.abs(w.x - p.x) < 0.5 + PHYS.HALF_W && p.y < this.floor + 1.05) ev.push({ type: 'hit', damage: 3, from: w.x - w.dir });
      }
    }
    return ev;
  }

  animate(dt, time) {
    const u = this.mesh.userData;
    const an = this.anim;
    const s = this.state;
    const windupP = this.windup ? 1 - Math.max(0, this.t) / this.windup : 0;
    const armsTarget = s === 'windup_slam' ? 2.7 * Math.min(1, windupP * 1.4) : s === 'recover' ? 0.65 : s === 'charge' ? 1.2 : 0.15;
    an.arms += (armsTarget - an.arms) * Math.min(1, dt * (s === 'recover' ? 30 : 9));
    const crouchTarget = s === 'windup_charge' ? 0.35 : s === 'recover' ? 0.55 : s === 'stunned' ? 0.15 : 0;
    an.crouch += (crouchTarget - an.crouch) * Math.min(1, dt * 10);
    const leanTarget = s === 'charge' ? -0.35 : s === 'windup_charge' ? 0.15 : s === 'stunned' ? 0.25 : 0;
    an.lean += (leanTarget - an.lean) * Math.min(1, dt * 8);

    this.mesh.position.set(this.x, this.y, -0.2);
    this.mesh.rotation.y = this.facing > 0 ? -0.5 : Math.PI + 0.5;
    u.body.position.y = -an.crouch;
    u.body.rotation.z = an.lean;
    for (const arm of u.arms) arm.rotation.z = an.arms;
    const walk = s === 'idle' || s === 'charge' ? Math.sin(time * (s === 'charge' ? 16 : 6)) : 0;
    u.legs[0].rotation.z = walk * 0.35;
    u.legs[1].rotation.z = -walk * 0.35;
    if (s === 'windup_charge') u.body.position.x = Math.sin(time * 40) * 0.05;
    else u.body.position.x = 0;
    if (s === 'stunned') u.head.rotation.x = Math.sin(time * 5) * 0.15;
    else u.head.rotation.x = 0;

    // telegraph glow: eyes and runes flare during a wind-up; orange → red when enraged; white hit flash
    const hot = s === 'windup_slam' || s === 'windup_charge' ? 0.6 + 0.4 * Math.sin(time * 30) : 0;
    u.glowMat.color.setHex(this.enraged ? 0xff3b3b : 0xff8a3d);
    u.glowMat.color.multiplyScalar(0.75 + hot * 0.6);
    u.core.rotation.y += dt * (this.enraged ? 4 : 1.5);
    u.core.scale.setScalar(1 + hot * 0.4);
    u.stone.emissiveIntensity = this.flash > 0 ? 0.9 : hot * 0.12;
    u.stone.emissive.setHex(this.flash > 0 ? 0xffffff : 0xff6a2a);

    if (s === 'dying' || s === 'dead') {
      const d = Math.min(1, this.deadT / 1.6);
      u.body.position.y = -d * 1.4;
      u.body.rotation.z = d * 0.5;
      u.body.position.x = Math.sin(time * 50) * 0.08 * (1 - d);
      if (s === 'dead') this.mesh.visible = false;
    }

    this.waveMeshes.forEach((m, i) => {
      const w = this.waves[i];
      m.visible = !!w;
      if (w) {
        m.position.set(w.x, this.floor, 0);
        m.userData.mat.opacity = 0.6 + Math.sin(time * 40 + i) * 0.25;
        m.rotation.y += dt * 8;
        m.userData.rocks.forEach((r, j) => (r.position.y = 0.2 + Math.abs(Math.sin(time * 18 + j)) * 0.45));
      }
    });
  }
}
