// The tile grid of a floor: carving, collision (circle vs tiles), line of sight and breadth-first paths.
// Pure: no THREE, no DOM, so the sim, the bot and Node tests share it.
import { TILE } from './floors.js';

export const T = { VOID: 0, FLOOR: 1, LEDGE: 2, WALL: 3, PILLAR: 4, STAIRS: 5 };
export const LEDGE_HEIGHT = 0.8;

export function buildGrid(floor) {
  const [cols, rows] = floor.size;
  const t = new Uint8Array(cols * rows);
  const room = new Int8Array(cols * rows).fill(-1);
  const fill = ([c0, r0, w, h], v, roomIndex = -1) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        t[r * cols + c] = v;
        if (roomIndex >= 0) room[r * cols + c] = roomIndex;
      }
    }
  };
  floor.rooms.forEach((rm, i) => fill(rm.rect, T.FLOOR, i));
  for (const h of floor.halls) fill(h, T.FLOOR);
  for (const l of floor.ledges) fill(l, T.LEDGE);
  for (const [c, r] of floor.pillars) t[r * cols + c] = T.PILLAR;
  t[floor.stairs[1] * cols + floor.stairs[0]] = T.STAIRS;
  // walls: rock that touches open floor (8-neighbourhood)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (t[r * cols + c] !== T.VOID) continue;
      let open = false;
      for (let dr = -1; dr <= 1 && !open; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const v = get({ cols, rows, t }, c + dc, r + dr);
          if (v === T.FLOOR || v === T.LEDGE || v === T.STAIRS) {
            open = true;
            break;
          }
        }
      }
      if (open) t[r * cols + c] = T.WALL;
    }
  }
  return { cols, rows, t, room, floor, w: cols * TILE, h: rows * TILE };
}

export function get(g, c, r) {
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return T.VOID;
  return g.t[r * g.cols + c];
}

export function walkable(v) {
  return v === T.FLOOR || v === T.LEDGE || v === T.STAIRS;
}

export const tileOf = (x) => Math.floor(x / TILE);

export function tileAt(g, x, z) {
  return get(g, tileOf(x), tileOf(z));
}

export function roomAt(g, x, z) {
  const c = tileOf(x);
  const r = tileOf(z);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return g.room[r * g.cols + c];
}

export function heightAt(g, x, z) {
  return tileAt(g, x, z) === T.LEDGE ? LEDGE_HEIGHT : 0;
}

const solidDefault = (v) => !walkable(v);
export const solidForLedgeWalker = (v) => v !== T.LEDGE;

/** Move a circle by (dx, dz), sliding along solid tiles. Sub-stepped so a fast roll can't tunnel. */
export function moveCircle(g, b, dx, dz, r, solid = solidDefault) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35));
  for (let i = 0; i < n; i++) {
    b.x += dx / n;
    resolve(g, b, r, solid);
    b.z += dz / n;
    resolve(g, b, r, solid);
  }
}

/** Push a circle out of every solid tile it overlaps. */
export function resolve(g, b, r, solid = solidDefault) {
  const c0 = tileOf(b.x - r);
  const c1 = tileOf(b.x + r);
  const r0 = tileOf(b.z - r);
  const r1 = tileOf(b.z + r);
  for (let rr = r0; rr <= r1; rr++) {
    for (let c = c0; c <= c1; c++) {
      if (!solid(get(g, c, rr))) continue;
      const minX = c * TILE;
      const minZ = rr * TILE;
      const px = Math.max(minX, Math.min(b.x, minX + TILE));
      const pz = Math.max(minZ, Math.min(b.z, minZ + TILE));
      let dx = b.x - px;
      let dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) {
        b.x = px + (dx / d) * r;
        b.z = pz + (dz / d) * r;
      } else {
        // centre inside the tile: out along the shortest axis
        const left = b.x - minX;
        const right = minX + TILE - b.x;
        const up = b.z - minZ;
        const down = minZ + TILE - b.z;
        const m = Math.min(left, right, up, down);
        if (m === left) b.x = minX - r;
        else if (m === right) b.x = minX + TILE + r;
        else if (m === up) b.z = minZ - r;
        else b.z = minZ + TILE + r;
      }
    }
  }
}

function blocksSight(v) {
  return v === T.WALL || v === T.VOID || v === T.PILLAR;
}

/** Is the straight line from a to b free of walls and pillars? (sampled every 0.25 m) */
export function lineOfSight(g, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.25));
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (blocksSight(tileAt(g, ax + (bx - ax) * k, az + (bz - az) * k))) return false;
  }
  return true;
}

/** Can a circle of radius r walk straight from a to b? */
export function walkLine(g, ax, az, bx, bz, r, solid = solidDefault) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.3));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = ax + (bx - ax) * k;
    const z = az + (bz - az) * k;
    if (solid(tileAt(g, x - r, z - r)) || solid(tileAt(g, x + r, z - r)) || solid(tileAt(g, x - r, z + r)) || solid(tileAt(g, x + r, z + r))) return false;
  }
  return true;
}

const N8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
];

/**
 * Distance field (in tiles) from one tile over walkable tiles, 8-way without cutting corners.
 * Unreachable tiles stay Infinity. A small Dijkstra with a bucketed queue; grids are ~1000 tiles.
 */
export function distanceField(g, c0, r0, solid = solidDefault) {
  const dist = new Float32Array(g.cols * g.rows).fill(Infinity);
  if (solid(get(g, c0, r0))) return dist;
  dist[r0 * g.cols + c0] = 0;
  let frontier = [r0 * g.cols + c0];
  // a few relaxation sweeps of a simple queue are plenty at this size
  while (frontier.length) {
    const next = [];
    for (const i of frontier) {
      const c = i % g.cols;
      const r = (i / g.cols) | 0;
      const base = dist[i];
      for (const [dc, dr, cost] of N8) {
        const nc = c + dc;
        const nr = r + dr;
        if (solid(get(g, nc, nr))) continue;
        if (dc && dr && (solid(get(g, c + dc, r)) || solid(get(g, c, r + dr)))) continue;
        const j = nr * g.cols + nc;
        const nd = base + cost;
        if (nd < dist[j] - 1e-6) {
          dist[j] = nd;
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** The neighbour tile of (c, r) that is closest to the field's source, or null. */
export function downhill(g, dist, c, r, solid = solidDefault) {
  let best = null;
  let bd = dist[r * g.cols + c];
  if (!Number.isFinite(bd)) bd = Infinity;
  for (const [dc, dr] of N8) {
    const nc = c + dc;
    const nr = r + dr;
    if (solid(get(g, nc, nr))) continue;
    if (dc && dr && (solid(get(g, c + dc, r)) || solid(get(g, c, r + dr)))) continue;
    const d = dist[nr * g.cols + nc];
    if (d < bd) {
      bd = d;
      best = [nc, nr];
    }
  }
  return best;
}
