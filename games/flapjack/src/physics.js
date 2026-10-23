// Bird physics and collisions, one fixed step at a time. Pure (no three.js): the game, the bot's
// look-ahead and the Node tests all step the same code.
import { SPEED, PIPE_W, GROUND_Y, CEILING_Y, START, pipeAt, pipeNear } from './course.js';

export const PHYS = {
  STEP: 1 / 120,
  GRAVITY: 26, // units/s²
  FLAP_VY: 8.2, // a flap sets the vertical speed to this (a peak gain of ~1.29 units)
  MAX_FALL: 13,
  RADIUS: 0.42,
};

export function createBird(x = START.x, y = START.y) {
  return { x, y, vy: 0, flaps: 0 };
}

/** one fixed step: flap (if asked), gravity, forward speed */
export function stepBird(b, flap, dt = PHYS.STEP) {
  if (flap) {
    b.vy = PHYS.FLAP_VY;
    b.flaps++;
  }
  b.vy = Math.max(-PHYS.MAX_FALL, b.vy - PHYS.GRAVITY * dt);
  b.y += b.vy * dt;
  b.x += SPEED * dt;
}

function circleHitsRect(cx, cy, r, x0, x1, y0, y1) {
  const nx = Math.min(x1, Math.max(x0, cx));
  const ny = Math.min(y1, Math.max(y0, cy));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** does pipe p touch a bird at (x, y)? */
export function hitsPipe(p, x, y, r = PHYS.RADIUS) {
  const x0 = p.x - PIPE_W / 2;
  const x1 = p.x + PIPE_W / 2;
  if (x + r <= x0 || x - r >= x1) return false;
  return circleHitsRect(x, y, r, x0, x1, p.y + p.gap / 2, 1e6) || circleHitsRect(x, y, r, x0, x1, -1e6, p.y - p.gap / 2);
}

/** what the bird hit, if anything: 'pipe' | 'ground' | 'ceiling' | null (pipes win a tie) */
export function collide(b, r = PHYS.RADIUS) {
  const n = pipeNear(b.x);
  for (let k = Math.max(1, n - 1); k <= n + 1; k++) if (hitsPipe(pipeAt(k), b.x, b.y, r)) return 'pipe';
  if (b.y - r <= GROUND_Y) return 'ground';
  if (b.y + r >= CEILING_Y) return 'ceiling';
  return null;
}
