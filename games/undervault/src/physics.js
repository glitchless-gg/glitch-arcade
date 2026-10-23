// Side-view platformer physics on the x/y plane: AABBs, coyote time, jump buffer, variable jump
// height, a double jump (the Boots) and an air dash (the Dash Cloak). Pure module (no THREE), so the
// bot and Node scripts can run it headless.

export const PHYS = {
  STEP: 1 / 120, // fixed simulation step (s)
  RUN: 7.2, // u/s
  ACCEL_GROUND: 65,
  TURN_GROUND: 120,
  DECEL_GROUND: 70,
  ACCEL_AIR: 42,
  DECEL_AIR: 16,
  GRAVITY_UP: 38,
  GRAVITY_DOWN: 54,
  JUMP_V: 15, // ≈ 2.96 u apex
  AIR_JUMP_V: 14, // ≈ 2.58 u more
  JUMP_CUT: 0.45, // releasing jump early multiplies vy by this
  MAX_FALL: 22,
  COYOTE: 0.09,
  BUFFER: 0.1,
  DASH_SPEED: 20,
  DASH_TIME: 0.16, // ≈ 3.2 u
  DASH_COOLDOWN: 0.4,
  HALF_W: 0.36,
  HEIGHT: 1.3,
};

const EPS = 0.001;

export function createBody(x, y, facing = 1) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    grounded: false,
    ground: null,
    coyote: 0,
    buffer: 0,
    jumping: false,
    jumpWasDown: true, // need a fresh press
    dashWasDown: true,
    facing,
    airJumps: 0,
    canDash: true,
    dashT: 0,
    dashCd: 0,
    knockT: 0,
    airTime: 0,
  };
}

function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

export function overlapsSolid(b, s) {
  return b.x + PHYS.HALF_W > s.x + EPS && b.x - PHYS.HALF_W < s.x + s.w - EPS && b.y + PHYS.HEIGHT > s.y - s.h + EPS && b.y < s.y - EPS;
}

/** body AABB vs a rect { x0, y0, x1, y1 } (shrunk a little: hazards are forgiving at the edges) */
export function touchesRect(b, r, shrink = 0.08) {
  return b.x + PHYS.HALF_W - shrink > r.x0 && b.x - PHYS.HALF_W + shrink < r.x1 && b.y + PHYS.HEIGHT - shrink > r.y0 && b.y + shrink < r.y1;
}

/**
 * Advance the body one fixed step.
 * input: { left, right, jump, dash } (held booleans); abilities: { dash, doubleJump }
 * solids: [{ x, y, w, h, oneWay?, dy? }] — x = left edge, y = TOP surface, h = thickness below the top
 */
export function stepBody(b, input, solids, dt, abilities = {}) {
  const ev = { jumped: false, airJumped: false, dashed: false, landed: false, landVy: 0, bonked: false };
  const control = b.knockT <= 0;
  const dir = control ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
  if (b.knockT > 0) b.knockT -= dt;
  if (b.dashCd > 0) b.dashCd -= dt;

  // --- dash (the Dash Cloak): a short burst along facing, no gravity while it lasts
  const dashPressed = input.dash && !b.dashWasDown;
  b.dashWasDown = !!input.dash;
  if (dashPressed && control && abilities.dash && b.dashT <= 0 && b.dashCd <= 0 && b.canDash) {
    if (dir !== 0) b.facing = dir;
    b.dashT = PHYS.DASH_TIME;
    b.dashCd = PHYS.DASH_COOLDOWN;
    b.vy = 0;
    b.jumping = false;
    if (!b.grounded) b.canDash = false;
    ev.dashed = true;
  }
  const dashing = b.dashT > 0;

  // --- horizontal intent
  if (dashing) {
    b.vx = b.facing * PHYS.DASH_SPEED;
  } else {
    let accel;
    if (b.grounded) {
      if (dir === 0) accel = PHYS.DECEL_GROUND;
      else if (Math.sign(b.vx) !== dir && Math.abs(b.vx) > 0.5) accel = PHYS.TURN_GROUND;
      else accel = PHYS.ACCEL_GROUND;
    } else {
      accel = dir === 0 ? PHYS.DECEL_AIR : PHYS.ACCEL_AIR;
    }
    if (Math.abs(b.vx) > PHYS.RUN && control) b.vx = Math.sign(b.vx) * PHYS.RUN; // coming out of a dash
    b.vx = approach(b.vx, dir * PHYS.RUN, accel * dt);
    if (dir !== 0) b.facing = dir;
  }

  // --- jump: buffer + coyote, then the air jump (Boots). Presses during a dash are swallowed.
  let pressed = input.jump && !b.jumpWasDown && control;
  b.jumpWasDown = !!input.jump;
  if (dashing) pressed = false;
  if (pressed) b.buffer = PHYS.BUFFER;
  else b.buffer = Math.max(0, b.buffer - dt);
  if (b.grounded) {
    b.coyote = PHYS.COYOTE;
    b.airJumps = abilities.doubleJump ? 1 : 0;
    b.canDash = true;
  } else b.coyote = Math.max(0, b.coyote - dt);

  if (b.buffer > 0 && b.coyote > 0 && !dashing) {
    b.vy = PHYS.JUMP_V;
    b.grounded = false;
    b.ground = null;
    b.coyote = 0;
    b.buffer = 0;
    b.jumping = true;
    ev.jumped = true;
  } else if (pressed && !b.grounded && b.coyote <= 0 && b.airJumps > 0) {
    b.vy = PHYS.AIR_JUMP_V;
    b.airJumps--;
    b.buffer = 0;
    b.jumping = true;
    ev.airJumped = true;
  }

  // variable jump height
  if (b.jumping && !input.jump && b.vy > 0) {
    b.vy *= PHYS.JUMP_CUT;
    b.jumping = false;
  }
  if (b.vy <= 0) b.jumping = false;

  // --- gravity
  if (dashing) {
    b.vy = 0;
    b.dashT -= dt;
  } else {
    const g = b.vy > 0 ? PHYS.GRAVITY_UP : PHYS.GRAVITY_DOWN;
    b.vy = Math.max(b.vy - g * dt, -PHYS.MAX_FALL);
  }

  // --- move X, resolve (one-way ledges never block sideways)
  b.x += b.vx * dt;
  for (const s of solids) {
    if (s.oneWay || !overlapsSolid(b, s)) continue;
    const cx = s.x + s.w / 2;
    const pushLeft = b.vx > 0 || (b.vx === 0 && b.x < cx);
    b.x = pushLeft ? s.x - PHYS.HALF_W : s.x + s.w + PHYS.HALF_W;
    b.vx = 0;
  }

  // --- move Y, resolve
  const wasGrounded = b.grounded;
  const preVy = b.vy;
  const prevY = b.y;
  b.y += b.vy * dt;
  b.grounded = false;
  b.ground = null;
  for (const s of solids) {
    if (!overlapsSolid(b, s)) continue;
    if (s.oneWay) {
      // only from above: falling, and the feet were on or over the (previous) top last step
      if (b.vy > 0 || prevY < s.y - (s.dy || 0) - 0.02) continue;
    }
    if (b.vy <= 0) {
      b.y = s.y;
      b.vy = 0;
      b.grounded = true;
      b.ground = s;
    } else {
      b.y = s.y - s.h - PHYS.HEIGHT;
      b.vy = 0;
      b.jumping = false;
      ev.bonked = true;
    }
  }

  if (b.grounded && !wasGrounded) {
    ev.landed = true;
    ev.landVy = preVy;
    b.airTime = 0;
  } else if (!b.grounded) b.airTime += dt;
  return ev;
}

/** Move a moving platform (sine between its two ends) and remember how far it went this step. */
export function stepMover(m, t) {
  const prevX = m.x;
  const prevY = m.y;
  const s = Math.sin((t / m.period) * Math.PI * 2 + (m.phase || 0)) * 0.5 + 0.5;
  if (m.axis === 'y') m.y = m.y0 + s * m.range;
  else m.x = m.x0 + s * m.range;
  m.dx = m.x - prevX;
  m.dy = m.y - prevY;
}
