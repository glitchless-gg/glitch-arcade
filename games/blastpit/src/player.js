// First-person player physics (pure, no THREE): walk, strafe, jump, look, collide with the arena.
import { resolveCircle, groundUnder } from './collide.js';

export const PLAYER = {
  RADIUS: 0.35,
  EYE: 1.6,
  HEIGHT: 1.75,
  SPEED: 5.8,
  ACCEL: 70,
  AIR_ACCEL: 18,
  GRAVITY: 21,
  JUMP_V: 6.6,
  MAX_HP: 100,
  PITCH_LIMIT: 1.45,
};

export function createPlayer(at) {
  return { x: at.x, y: 0, z: at.z, vx: 0, vy: 0, vz: 0, yaw: at.yaw || 0, pitch: 0, hp: PLAYER.MAX_HP, grounded: true, jumpHeld: false, bob: 0 };
}

/** Unit view direction for yaw/pitch (yaw 0 looks down -z). */
export function viewDir(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** Yaw that faces from (x, z) toward (tx, tz). */
export function yawTo(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * One fixed step. input = { move, strafe, yawDelta, pitchDelta, jump } (move/strafe in -1..1).
 * Returns { jumped, landed }.
 */
export function stepPlayer(p, input, dt, boxes) {
  p.yaw = wrapAngle(p.yaw + (input.yawDelta || 0));
  p.pitch = Math.max(-PLAYER.PITCH_LIMIT, Math.min(PLAYER.PITCH_LIMIT, p.pitch + (input.pitchDelta || 0)));

  let mf = input.move || 0;
  let ms = input.strafe || 0;
  const len = Math.hypot(mf, ms);
  if (len > 1) {
    mf /= len;
    ms /= len;
  }
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const tx = (-sy * mf + cy * ms) * PLAYER.SPEED;
  const tz = (-cy * mf - sy * ms) * PLAYER.SPEED;
  const a = (p.grounded ? PLAYER.ACCEL : PLAYER.AIR_ACCEL) * dt;
  const dvx = tx - p.vx;
  const dvz = tz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl <= a) {
    p.vx = tx;
    p.vz = tz;
  } else {
    p.vx += (dvx / dl) * a;
    p.vz += (dvz / dl) * a;
  }

  const ev = { jumped: false, landed: false };
  if (input.jump && !p.jumpHeld && p.grounded) {
    p.vy = PLAYER.JUMP_V;
    p.grounded = false;
    ev.jumped = true;
  }
  p.jumpHeld = !!input.jump;

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  resolveCircle(p, PLAYER.RADIUS, p.y, boxes);

  p.vy -= PLAYER.GRAVITY * dt;
  p.y += p.vy * dt;
  const g = groundUnder(p.x, p.z, PLAYER.RADIUS * 0.7, Math.max(p.y, p.y - p.vy * dt), boxes);
  if (p.y <= g) {
    if (!p.grounded && p.vy < -2) ev.landed = true;
    p.y = g;
    p.vy = 0;
    p.grounded = true;
  } else if (p.y > g + 0.02) {
    p.grounded = false;
  }
  const speed = Math.hypot(p.vx, p.vz);
  if (p.grounded) p.bob += speed * dt * 1.6;
  return ev;
}
