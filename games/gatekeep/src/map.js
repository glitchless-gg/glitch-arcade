// The map: a 16 x 10 tile grid with one winding dirt path from the cave (left) to the castle gate
// (right). Plain data and math, no THREE, so the sim and the bot can run in Node too.
//
// Tiles are 1 world unit. Column c / row r sits at x = c - 7.5, z = r - 4.5 (row 0 is the far side).

export const COLS = 16;
export const ROWS = 10;

// Corners of the path, in tiles. The cave mouth is just off the grid at col -1, the gate at col 16.
const CORNERS = [
  [0, 5],
  [2, 5],
  [2, 1],
  [6, 1],
  [6, 7],
  [9, 7],
  [9, 2],
  [12, 2],
  [12, 4],
  [15, 4],
];
export const CAVE = { col: -1.2, row: 5 };
export const GATE = { col: 16.1, row: 4 };

// Rocks and trees sitting on grid tiles: nobody can build there.
export const PROPS = [
  { col: 0, row: 1, kind: 'tree' },
  { col: 4, row: 8, kind: 'tree' },
  { col: 8, row: 4, kind: 'rock' },
  { col: 11, row: 6, kind: 'tree' },
  { col: 14, row: 1, kind: 'tree' },
  { col: 13, row: 8, kind: 'rock' },
  { col: 0, row: 8, kind: 'tree' },
  { col: 10, row: 0, kind: 'rock' },
  { col: 15, row: 7, kind: 'tree' },
  { col: 3, row: 8, kind: 'rock' },
];

export const tileX = (col) => col - (COLS - 1) / 2;
export const tileZ = (row) => row - (ROWS - 1) / 2;
export const key = (col, row) => `${col},${row}`;

/** Every path tile in walking order. */
export const PATH_TILES = (() => {
  const out = [[...CORNERS[0]]];
  for (let i = 1; i < CORNERS.length; i++) {
    const [c0, r0] = CORNERS[i - 1];
    const [c1, r1] = CORNERS[i];
    const dc = Math.sign(c1 - c0);
    const dr = Math.sign(r1 - r0);
    let c = c0;
    let r = r0;
    while (c !== c1 || r !== r1) {
      c += dc;
      r += dr;
      out.push([c, r]);
    }
  }
  return out;
})();

const pathIndex = new Map(PATH_TILES.map(([c, r], i) => [key(c, r), i]));
const propAt = new Map(PROPS.map((p) => [key(p.col, p.row), p]));

export const isPath = (col, row) => pathIndex.has(key(col, row));
export const inGrid = (col, row) => col >= 0 && col < COLS && row >= 0 && row < ROWS;
/** Grass with nothing on it (towers are checked by the sim). */
export const isBuildable = (col, row) => inGrid(col, row) && !isPath(col, row) && !propAt.has(key(col, row));

// The path as a world-space polyline, from inside the cave to the gate.
export const PATH_POINTS = [
  { x: tileX(CAVE.col), z: tileZ(CAVE.row) },
  ...CORNERS.map(([c, r]) => ({ x: tileX(c), z: tileZ(r) })),
  { x: tileX(GATE.col), z: tileZ(GATE.row) },
];
const SEG = [];
let total = 0;
for (let i = 1; i < PATH_POINTS.length; i++) {
  const a = PATH_POINTS[i - 1];
  const b = PATH_POINTS[i];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  SEG.push({ a, b, len, start: total, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len });
  total += len;
}
export const PATH_LENGTH = total;

/** Point at distance d along the path (d < 0 extends back into the cave). `out` gets x, z, dx, dz. */
export function pointAt(d, out = {}) {
  let s = SEG[SEG.length - 1];
  if (d <= 0) s = SEG[0];
  else {
    for (const seg of SEG) {
      if (d < seg.start + seg.len) {
        s = seg;
        break;
      }
    }
  }
  const t = d - s.start;
  out.x = s.a.x + s.dx * t;
  out.z = s.a.z + s.dz * t;
  out.dx = s.dx;
  out.dz = s.dz;
  return out;
}

// Path stretches, for the tower_built `zone` attribute: by path tile index.
export const ZONES = ['entry', 'middle', 'gate'];
export function zoneOfIndex(i) {
  return i < 11 ? 'entry' : i < 22 ? 'middle' : 'gate';
}

/** Which stretch of the path a tower at (col, row) with this range covers (mean index of covered tiles). */
export function zoneFor(col, row, range) {
  const x = tileX(col);
  const z = tileZ(row);
  let sum = 0;
  let n = 0;
  let nearest = 0;
  let best = Infinity;
  PATH_TILES.forEach(([c, r], i) => {
    const dist = Math.hypot(tileX(c) - x, tileZ(r) - z);
    if (dist <= range) {
      sum += i;
      n++;
    }
    if (dist < best) {
      best = dist;
      nearest = i;
    }
  });
  return zoneOfIndex(n ? Math.round(sum / n) : nearest);
}

/** How much of the path (in tiles, sampled every 0.25) a tower at (col, row) reaches. */
export function coverage(col, row, range) {
  const x = tileX(col);
  const z = tileZ(row);
  const p = {};
  let n = 0;
  for (let d = 0.6; d < PATH_LENGTH - 0.6; d += 0.25) {
    pointAt(d, p);
    if (Math.hypot(p.x - x, p.z - z) <= range) n++;
  }
  return n / 4;
}

/** Buildable tiles ranked by path coverage for a tower range (best first). */
export function rankTiles(range) {
  const out = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (!isBuildable(col, row)) continue;
      out.push({ col, row, cover: coverage(col, row, range), zone: zoneFor(col, row, range) });
    }
  }
  return out.sort((a, b) => b.cover - a.cover || a.col - b.col || a.row - b.row);
}

/** Tile under a world point, or null. */
export function tileAt(x, z) {
  const col = Math.round(x + (COLS - 1) / 2);
  const row = Math.round(z + (ROWS - 1) / 2);
  return inGrid(col, row) ? { col, row } : null;
}
