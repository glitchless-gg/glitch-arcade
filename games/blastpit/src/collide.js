// Collision and ray helpers (pure, no THREE). The arena's solids are axis-aligned boxes standing on the
// floor: { minX, maxX, minZ, maxZ, top }. Players and enemies are vertical cylinders.

export const ARENA_HALF = 19.6; // inner edge of the outer walls, minus a little

/** Push a circle (x, z, r) whose feet are at feetY out of every box it is inside of. Mutates p. */
export function resolveCircle(p, r, feetY, boxes) {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (feetY >= b.top - 0.02) continue; // standing on top of it, or above it
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // centre inside the box: leave along the shortest way out
        const out = [
          [p.x - b.minX + r, -1, 0],
          [b.maxX - p.x + r, 1, 0],
          [p.z - b.minZ + r, 0, -1],
          [b.maxZ - p.z + r, 0, 1],
        ].sort((a, c) => a[0] - c[0])[0];
        p.x += out[1] * out[0];
        p.z += out[2] * out[0];
      }
    }
  }
  p.x = Math.max(-ARENA_HALF + r, Math.min(ARENA_HALF - r, p.x));
  p.z = Math.max(-ARENA_HALF + r, Math.min(ARENA_HALF - r, p.z));
  return p;
}

/** Height of the highest box top under a circle that the feet are at or above (0 = the floor). */
export function groundUnder(x, z, r, feetY, boxes) {
  let g = 0;
  for (const b of boxes) {
    if (b.top > feetY + 0.06 || b.top <= g) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) g = b.top;
  }
  return g;
}

/** Ray (origin o, unit dir d) against one box (y from 0 to top). Returns the entry distance or Infinity. */
export function rayBox(o, d, b, maxT = Infinity) {
  let t0 = 0;
  let t1 = maxT;
  const axes = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, 0, b.top],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [p, v, lo, hi] of axes) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return Infinity;
      continue;
    }
    let a = (lo - p) / v;
    let c = (hi - p) / v;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Nearest solid (box or floor) along a ray, up to maxT. */
export function rayWorld(o, d, maxT, boxes) {
  let best = maxT;
  if (d.y < -1e-6) {
    const tf = -o.y / d.y;
    if (tf >= 0 && tf < best) best = tf;
  }
  for (const b of boxes) {
    const t = rayBox(o, d, b, best);
    if (t < best) best = t;
  }
  return best;
}

/** True if nothing solid is between a and b. */
export function lineOfSight(a, b, boxes) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (const bx of boxes) if (rayBox(a, d, bx, len) < len - 0.05) return false;
  return true;
}

/** Ray against a vertical cylinder (centre cx/cz, radius r, from y0 to y1). Returns the distance or Infinity. */
export function rayCylinder(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let best = Infinity;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  // the top cap (shooting down at a short enemy)
  if (Math.abs(d.y) > 1e-6) {
    const t = (y1 - o.y) / d.y;
    if (t >= 0 && t < best) {
      const x = ox + d.x * t;
      const z = oz + d.z * t;
      if (x * x + z * z <= r * r) best = t;
    }
  }
  return best;
}

/** Is a point inside a box (or under the floor)? */
export function pointSolid(p, boxes) {
  if (p.y <= 0) return true;
  for (const b of boxes) if (p.y <= b.top && p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ) return true;
  return false;
}
