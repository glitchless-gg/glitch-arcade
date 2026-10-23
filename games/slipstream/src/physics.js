// Arcade car physics on a flat plane (pure, no THREE): speed, steering with grip, handbrake drift,
// boost pads, barriers from the lateral offset to the centerline, and cars as circles.
//
// Heading θ: the car points along (sin θ, cos θ) in xz; "left" is (cos θ, -sin θ). Steer +1 = right.
import { WALL_IN, ROAD, nearestLocal, lateralOffset, wrapDelta, inSpan } from './track-geom.js';

export const STEP = 1 / 60;

export const CAR = {
  TOP: 50, // m/s (180 km/h)
  ACC: 40,
  BRAKE: 27,
  REV_ACC: 14,
  REV_MAX: 11,
  COAST: 4,
  STEER_RATE: 5.5, // how fast the wheels follow the input (per second)
  YAW_MAX: 2.6, // rad/s at low speed, full lock
  YAW_FALL: 0.42, // yaw authority lost at top speed
  GRIP: 8.5, // how fast sideways slip is removed (1/s)…
  GRIP_HB: 2.0,
  LAT: 40, // …up to this much sideways acceleration (m/s²): past it the car slides wide
  LAT_HB: 15,
  HB_YAW: 1.35,
  HB_DECEL: 6,
  BOOST_MULT: 1.4,
  BOOST_TIME: 1.2,
  RADIUS: 1.4,
  WALL_E: 0.3,
  WRECK_SPEED: 0.7, // × TOP
  WRECK_SIN: Math.sin((25 * Math.PI) / 180),
  RIVAL_WRECK_CLOSING: 13, // m/s closing speed of a side hit that wrecks
  WRECK_TIME: 1.5,
  GHOST_TIME: 1.4,
};

export function createCar(id, opts = {}) {
  return {
    id,
    name: opts.name || id,
    color: opts.color ?? 0xffffff,
    isPlayer: !!opts.isPlayer,
    power: opts.power ?? 1, // top speed multiplier (rival cars are a little slower than yours)
    x: 0,
    z: 0,
    h: 0,
    vx: 0,
    vz: 0,
    vf: 0,
    vl: 0,
    steer: 0,
    idx: 0,
    lat: 0,
    dist: 0,
    lapsDone: 0,
    lapStartT: 0,
    lastLap: 0,
    bestLap: 0,
    boostT: 0,
    padCooldown: 0,
    wreckT: 0,
    ghostT: 0,
    finished: false,
    finishT: 0,
    skidding: false,
    handbrake: false,
    braking: false,
    throttle: 0,
    wrecks: 0,
    hitT: 0,
    lastHit: null,
  };
}

export function speedOf(car) {
  return Math.hypot(car.vx, car.vz);
}

/** yaw rate available at a forward speed (rad/s, full lock) */
export function yawMax(v) {
  const a = Math.abs(v);
  return CAR.YAW_MAX * Math.min(1, a / 7) * (1 - (CAR.YAW_FALL * Math.min(a, CAR.TOP)) / CAR.TOP);
}

/** the fastest steady speed for a path curvature κ (1/m): limited by steering (v · yawMax(v) = v² |κ|) and by grip (v² |κ| = LAT) */
export function cornerSpeed(k) {
  const ak = Math.abs(k);
  if (ak < 1e-4) return Infinity;
  const steer = CAR.YAW_MAX / (ak + (CAR.YAW_MAX * CAR.YAW_FALL) / CAR.TOP);
  return Math.min(steer, Math.sqrt(CAR.LAT / ak));
}

/** one fixed step of driving; input = { throttle, brake, steer, handbrake } */
export function stepCar(car, input, dt) {
  car.padCooldown = Math.max(0, car.padCooldown - dt);
  car.ghostT = Math.max(0, car.ghostT - dt);
  car.hitT = Math.max(0, car.hitT - dt);
  if (car.boostT > 0) car.boostT = Math.max(0, car.boostT - dt);

  const steerIn = Math.max(-1, Math.min(1, input.steer || 0));
  const ds = steerIn - car.steer;
  const maxD = CAR.STEER_RATE * dt;
  car.steer += Math.max(-maxD, Math.min(maxD, ds));

  // yaw from the forward speed before this step
  let fx = Math.sin(car.h);
  let fz = Math.cos(car.h);
  const vfPrev = car.vx * fx + car.vz * fz;
  const hb = !!input.handbrake && Math.abs(vfPrev) > 3;
  const yaw = -car.steer * yawMax(vfPrev) * (hb ? CAR.HB_YAW : 1) * Math.sign(vfPrev || 1);
  car.h += yaw * dt;

  // decompose the velocity in the new frame: turning creates lateral slip that grip removes
  fx = Math.sin(car.h);
  fz = Math.cos(car.h);
  const lx = fz;
  const lz = -fx;
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * lx + car.vz * lz;

  const throttle = Math.max(0, Math.min(1, input.throttle || 0));
  const brake = Math.max(0, Math.min(1, input.brake || 0));
  const cap = CAR.TOP * car.power * (car.boostT > 0 ? CAR.BOOST_MULT : 1);
  if (throttle > 0 && vf >= -0.5) {
    if (vf < cap) vf += CAR.ACC * throttle * Math.max(0, 1 - vf / cap) * dt;
  } else if (throttle > 0) {
    vf = Math.min(0, vf + CAR.BRAKE * dt); // throttle while rolling backwards = brake
  }
  if (vf > cap) vf -= (vf - cap) * 1.4 * dt; // boost wearing off
  if (brake > 0) {
    // friction circle: braking at full lock only gets half the grip
    if (vf > 0.5) vf = Math.max(0, vf - CAR.BRAKE * brake * (1 - 0.5 * Math.abs(car.steer)) * dt);
    else vf = Math.max(-CAR.REV_MAX, vf - CAR.REV_ACC * brake * dt);
  }
  if (throttle === 0 && brake === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), CAR.COAST * dt);
  if (hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), CAR.HB_DECEL * dt);

  const slipFix = vl * (1 - Math.exp(-(hb ? CAR.GRIP_HB : CAR.GRIP) * dt));
  const slipMax = (hb ? CAR.LAT_HB : CAR.LAT) * dt;
  vl -= Math.sign(slipFix) * Math.min(Math.abs(slipFix), slipMax);

  car.vx = fx * vf + lx * vl;
  car.vz = fz * vf + lz * vl;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.vf = vf;
  car.vl = vl;
  car.throttle = throttle;
  car.braking = brake > 0.5 && vf > 18;
  car.handbrake = hb;
  car.skidding = car.braking || (hb && Math.abs(vf) > 10) || Math.abs(vl) > 5;
}

/**
 * Track progress and barriers. Returns null, or { kind: 'hit'|'wreck', speed, sinA, impact }.
 * A hard hit (fast and steep) is a wreck; anything else bounces and scrubs speed.
 */
export function trackContact(car, g) {
  const prev = car.idx;
  const idx = nearestLocal(g, car.x, car.z, prev, 30);
  car.idx = idx;
  car.dist += wrapDelta(g, idx - prev) * g.ds;
  const o = lateralOffset(g, idx, car.x, car.z);
  car.lat = o;
  // how far the car's body reaches sideways depends on its angle to the track (a sliding car is wider)
  const rel = car.h - Math.atan2(g.tx[idx], g.tz[idx]);
  const reach = ROAD.CAR_HALF * Math.abs(Math.cos(rel)) + ROAD.CAR_HALF_LEN * Math.abs(Math.sin(rel));
  const limit = WALL_IN - reach;
  if (Math.abs(o) <= limit) return null;

  const s = Math.sign(o);
  const nx = g.nx[idx] * s; // outward (into the barrier)
  const nz = g.nz[idx] * s;
  const pen = Math.abs(o) - limit;
  car.x -= nx * pen;
  car.z -= nz * pen;
  car.lat = s * limit;
  const vn = car.vx * nx + car.vz * nz;
  if (vn <= 0) return null;
  const speed = Math.hypot(car.vx, car.vz);
  const sinA = vn / (speed || 1);
  if (speed > CAR.WRECK_SPEED * CAR.TOP && sinA > CAR.WRECK_SIN) return { kind: 'wreck', speed, sinA, impact: vn };

  // bounce off, lose speed along the wall, and get turned toward the wall's direction
  car.vx -= (1 + CAR.WALL_E) * vn * nx;
  car.vz -= (1 + CAR.WALL_E) * vn * nz;
  const keep = 1 - 0.55 * sinA;
  car.vx *= keep;
  car.vz *= keep;
  const tx = g.tx[idx];
  const tz = g.tz[idx];
  const along = Math.sign(car.vx * tx + car.vz * tz) || 1;
  const wallH = Math.atan2(tx * along, tz * along);
  let d = wallH - car.h;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  car.h += d * Math.min(0.6, sinA * 1.2);
  car.hitT = 0.25;
  return { kind: 'hit', speed, sinA, impact: vn };
}

/** boost pads: returns the pad the car just hit, or null */
export function boostPads(car, g) {
  if (car.padCooldown > 0) return null;
  for (const pad of g.pads) {
    if (!inSpan(g, car.idx, pad.start, pad.end)) continue;
    if (Math.abs(car.lat - pad.lat) > pad.halfW + 0.7) continue;
    const fx = Math.sin(car.h);
    const fz = Math.cos(car.h);
    const vf = car.vx * fx + car.vz * fz;
    if (vf < 2) continue;
    const boosted = Math.min(vf * CAR.BOOST_MULT, CAR.TOP * CAR.BOOST_MULT);
    car.vx += fx * (boosted - vf);
    car.vz += fz * (boosted - vf);
    car.boostT = CAR.BOOST_TIME;
    car.padCooldown = 1.0;
    return pad;
  }
  return null;
}

/**
 * Cars are circles. Overlaps are pushed apart with a soft impulse. A hard hit into a car's side
 * wrecks that car. Returns [{ a, b, closing, wreck: car|null }].
 */
export function collideCars(cars) {
  const out = [];
  const R2 = CAR.RADIUS * 2;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.wreckT > 0 || a.ghostT > 0 || a.finished) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.wreckT > 0 || b.ghostT > 0 || b.finished) continue;
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d >= R2 || d < 1e-6) continue;
      dx /= d;
      dz /= d; // normal from b to a
      const push = (R2 - d) / 2;
      a.x += dx * push;
      a.z += dz * push;
      b.x -= dx * push;
      b.z -= dz * push;
      const rel = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
      if (rel >= 0) continue;
      const closing = -rel;
      const jimp = (closing * (1 + 0.25)) / 2;
      a.vx += dx * jimp;
      a.vz += dz * jimp;
      b.vx -= dx * jimp;
      b.vz -= dz * jimp;
      // how much of the hit lands on each car's side (|normal · car's left|)
      const sideA = Math.abs(dx * Math.cos(a.h) - dz * Math.sin(a.h));
      const sideB = Math.abs(dx * Math.cos(b.h) - dz * Math.sin(b.h));
      let wreck = null;
      if (closing > CAR.RIVAL_WRECK_CLOSING) {
        if (sideA > 0.7 && sideA >= sideB) wreck = a;
        else if (sideB > 0.7) wreck = b;
      }
      out.push({ a, b, closing, wreck });
    }
  }
  return out;
}

/** put a car on the centerline at sample i, pointing along the track, stopped */
export function placeCar(car, g, i, lat = 0) {
  car.dist += wrapDelta(g, i - car.idx) * g.ds;
  car.idx = i;
  car.x = g.x[i] + g.nx[i] * lat;
  car.z = g.z[i] + g.nz[i] * lat;
  car.h = Math.atan2(g.tx[i], g.tz[i]);
  car.vx = car.vz = car.vf = car.vl = 0;
  car.steer = 0;
  car.boostT = 0;
  car.lat = lat;
}
