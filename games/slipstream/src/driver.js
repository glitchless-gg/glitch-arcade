// The AI driver, shared by the rivals and the autoplay bot. Pure pursuit on the racing line (the
// lookahead grows with speed) and a target speed from the curvature coming up, braking back from
// each corner. `skill` scales the mistakes: late braking, optimistic corner speeds, overshooting the
// target, a wobbly line and clumsy handbrake turns. Only good drivers know that a boost pad right
// before a corner has to be taken slowly.
import { CAR, cornerSpeed, yawMax } from './physics.js';

const LOOK_M = 170;

export function createDriver({ skill, rng }) {
  const s = Math.max(0, Math.min(1, skill));
  const p = {
    lateness: 0.03 + (1 - s) * 0.34, // s: how late the driver reacts to a braking point
    cornerTrust: 0.95 + s * 0.11, // experts carry more speed through corners
    brakeTrust: 0.92 + (1 - s) * 0.3, // thinks the car stops faster than it does
    overshoot: 0.6 + (1 - s) * 4.5, // m/s over the target before touching the brake
    lineNoise: (1 - s) * 2.4, // m of drift around the racing line
    steerNoise: (1 - s) * 0.12,
    hbChance: 0.55 + (1 - s) * 0.4,
    hbHold: 0.22 + (1 - s) * 0.35,
    speedLag: 0.04 + (1 - s) * 0.6, // s: how long it takes to notice a sudden change of speed (a boost)
  };
  // knowing that a pad into a corner must be hit slowly: experts always, average drivers rarely
  const padSense = Math.pow(Math.max(0, Math.min(1, (s - 0.62) / 0.33)), 1.3);

  const d = {
    skill: s,
    mood: 1,
    cornerKey: -1,
    knowsPad: false,
    padKey: -1,
    hbT: 0,
    hbCool: 0,
    noiseT: 0,
    lineOff: 0,
    lineOffTarget: 0,
    wob: rng.range(0, Math.PI * 2),
    input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    target: CAR.TOP,
    feltV: 0,
  };

  function cornerAhead(g, idx) {
    for (let k = 0; k < 60; k += 2) {
      const j = (idx + k) % g.N;
      if (Math.abs(g.kLine[j]) > 1 / 55) return j;
    }
    return -1;
  }

  function targetSpeed(car, g, v) {
    const brake = CAR.BRAKE * p.brakeTrust;
    const late = Math.max(0, v) * p.lateness;
    let target = CAR.TOP * (car.boostT > 0 ? CAR.BOOST_MULT : 1);
    // the next boost pad ahead (only an expert plans for it)
    let padAt = -1;
    if (d.knowsPad) {
      for (const pad of g.pads) {
        const ahead = (pad.start - car.idx + g.N) % g.N;
        if (ahead < LOOK_M && (padAt < 0 || ahead < padAt)) padAt = ahead;
      }
    }
    for (let k = 2; k < LOOK_M; k += 2) {
      const j = (car.idx + k) % g.N;
      const vc = cornerSpeed(g.kLine[j]) * p.cornerTrust * d.mood;
      if (!Number.isFinite(vc)) continue;
      const dist = k * g.ds;
      let allowed;
      if (padAt >= 0 && k > padAt) {
        const atPad = Math.sqrt(vc * vc + 2 * brake * (dist - padAt * g.ds)) / CAR.BOOST_MULT;
        allowed = Math.sqrt(atPad * atPad + 2 * brake * Math.max(0, padAt * g.ds - late - 3));
      } else {
        allowed = Math.sqrt(vc * vc + 2 * brake * Math.max(0, dist - late - 2));
      }
      if (allowed < target) target = allowed;
    }
    return target;
  }

  /** one fixed step: returns { throttle, brake, steer, handbrake } */
  d.step = (car, g, dt) => {
    const inp = d.input;
    const fx = Math.sin(car.h);
    const fz = Math.cos(car.h);
    const v = car.vx * fx + car.vz * fz;
    const speed = Math.hypot(car.vx, car.vz);
    // the speed the driver *feels*: lags behind a sudden boost
    d.feltV += (v - d.feltV) * Math.min(1, dt / p.speedLag);

    // a new corner: roll this corner's mood (how brave the driver feels)
    const cj = cornerAhead(g, car.idx);
    const ck = cj < 0 ? -1 : Math.floor(cj / 40);
    if (ck !== d.cornerKey) {
      d.cornerKey = ck;
      d.mood = 1 + rng.gauss() * 0.08 * (1.2 - s);
    }
    // a new boost pad ahead: does the driver remember what comes after it?
    for (const pad of g.pads) {
      const ahead = (pad.start - car.idx + g.N) % g.N;
      if (ahead < LOOK_M && d.padKey !== pad.id + g.N * Math.floor(car.dist / g.length)) {
        d.padKey = pad.id + g.N * Math.floor(car.dist / g.length);
        d.knowsPad = rng.chance(padSense);
      }
    }

    // wandering off the racing line a little
    d.noiseT -= dt;
    if (d.noiseT <= 0) {
      d.noiseT = rng.range(0.6, 1.6);
      d.lineOffTarget = rng.gauss() * p.lineNoise;
    }
    d.lineOff += (d.lineOffTarget - d.lineOff) * Math.min(1, dt * 1.5);

    // pure pursuit
    const Ld = 7 + Math.max(0, v) * 0.34;
    const j = (car.idx + Math.round(Ld / g.ds)) % g.N;
    const off = Math.max(-5.2, Math.min(5.2, g.line[j] + d.lineOff));
    const qx = g.x[j] + g.nx[j] * off;
    const qz = g.z[j] + g.nz[j] * off;
    const dx = qx - car.x;
    const dz = qz - car.z;
    let alpha = Math.atan2(dx, dz) - car.h;
    alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));

    // facing the wrong way and slow: back up while turning
    if (Math.abs(alpha) > 1.75 && speed < 7) {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = Math.sign(alpha);
      inp.handbrake = false;
      return inp;
    }

    const dist = Math.hypot(dx, dz) || 1;
    const yawNeed = (2 * Math.max(4, v) * Math.sin(alpha)) / dist;
    const hbMul = d.hbT > 0 ? CAR.HB_YAW : 1;
    let steer = -yawNeed / Math.max(0.25, yawMax(Math.max(4, v)) * hbMul);
    d.wob += dt * (1.3 + s);
    steer += Math.sin(d.wob) * p.steerNoise;
    inp.steer = Math.max(-1, Math.min(1, steer));

    // speed
    const fv = d.feltV;
    const target = targetSpeed(car, g, fv);
    d.target = target;
    if (fv > target + p.overshoot) {
      inp.brake = 1;
      inp.throttle = 0;
    } else if (fv > target - 0.8) {
      inp.brake = 0;
      inp.throttle = 0.25;
    } else {
      inp.brake = 0;
      inp.throttle = 1;
    }

    // handbrake flicks into tight corners
    d.hbCool = Math.max(0, d.hbCool - dt);
    if (d.hbT > 0) d.hbT -= dt;
    else if (d.hbCool <= 0 && v > 18) {
      const k = cj >= 0 ? Math.abs(g.kLine[cj]) : 0;
      const near = cj >= 0 ? ((cj - car.idx + g.N) % g.N) * g.ds : 999;
      if (k > 1 / 30 && near < 14 && Math.abs(inp.steer) > 0.55 && v > cornerSpeed(k) * 0.95) {
        d.hbCool = 1.2;
        if (rng.chance(p.hbChance)) d.hbT = p.hbHold * rng.range(0.7, 1.3);
      }
    }
    inp.handbrake = d.hbT > 0;
    return inp;
  };

  d.reset = () => {
    d.feltV = 0;
    d.hbT = 0;
    d.lineOff = 0;
    d.cornerKey = -1;
  };

  return d;
}

