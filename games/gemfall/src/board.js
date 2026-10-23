// The match-3 board: an 8x8 grid of cells, matches, specials, clearing, gravity, moves and the hint.
// Pure (no three.js, no DOM), so Node can run it for balancing and tests.
//
// A cell is { id, kind, special }:
//   kind    0..5 for a gem colour, 'crown' (falls, never matches, collected on the bottom row), 'prism', or
//           'void' (VOID: a gap in a shaped board; nothing lives there, gems fall past it)
//   special null, 'row' or 'col' (striped: clears its row or column), or 'bomb' (clears 3x3)
// Row 0 is the top of the board.
export const ROWS = 8;
export const COLS = 8;

let nextId = 1;
export function newCell(kind, special = null) {
  return { id: nextId++, kind, special };
}

/** A gap in a shaped board (one shared object: it never moves, matches or clears). */
export const VOID = Object.freeze({ id: 0, kind: 'void', special: null });

export const isGem = (cell) => !!cell && typeof cell.kind === 'number';
export const isVoid = (cell) => !!cell && cell.kind === 'void';
export const isCrown = (cell) => !!cell && cell.kind === 'crown';
export const isPrism = (cell) => !!cell && cell.kind === 'prism';
export const isSpecial = (cell) => !!cell && (cell.special !== null || cell.kind === 'prism');
export const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
export const key = (r, c) => r * COLS + c;
export const rc = (k) => [Math.floor(k / COLS), k % COLS];

/** 'striped' | 'bomb' | 'prism' | null: the special's family, as telemetry names it */
export function specialKind(cell) {
  if (!cell) return null;
  if (cell.kind === 'prism') return 'prism';
  if (cell.special === 'row' || cell.special === 'col') return 'striped';
  if (cell.special === 'bomb') return 'bomb';
  return null;
}

export function createGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

export function cloneGrid(grid) {
  return grid.map((row) => row.map((c) => (c && c !== VOID ? { ...c } : c)));
}

function randomKind(rng, colors) {
  return Math.floor(rng.next() * colors);
}

/** Would `kind` at (r, c) complete a line of three with what's already to its left or above? */
function makesLineWith(grid, r, c, kind) {
  const same = (rr, cc) => inside(rr, cc) && isGem(grid[rr][cc]) && grid[rr][cc].kind === kind;
  return (same(r, c - 1) && same(r, c - 2)) || (same(r - 1, c) && same(r - 2, c)) || (same(r, c + 1) && same(r, c + 2)) || (same(r + 1, c) && same(r + 2, c)) || (same(r, c - 1) && same(r, c + 1)) || (same(r - 1, c) && same(r + 1, c));
}

/** Fill every empty cell with a gem that doesn't make a match. */
export function fillNoMatches(grid, rng, colors) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) continue;
      let kind = randomKind(rng, colors);
      for (let i = 0; i < colors && makesLineWith(grid, r, c, kind); i++) kind = (kind + 1) % colors;
      grid[r][c] = newCell(kind);
    }
  }
  return grid;
}

// ───────────────────────────────────────────────────────── matches

/** Maximal straight runs of 3+ same-colour gems. */
export function findRuns(grid) {
  const runs = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const cell = grid[r][c];
      if (!isGem(cell)) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < COLS && isGem(grid[r][e + 1]) && grid[r][e + 1].kind === cell.kind) e++;
      if (e - c >= 2) runs.push({ dir: 'h', kind: cell.kind, cells: Array.from({ length: e - c + 1 }, (_, i) => key(r, c + i)) });
      c = e + 1;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const cell = grid[r][c];
      if (!isGem(cell)) {
        r++;
        continue;
      }
      let e = r;
      while (e + 1 < ROWS && isGem(grid[e + 1][c]) && grid[e + 1][c].kind === cell.kind) e++;
      if (e - r >= 2) runs.push({ dir: 'v', kind: cell.kind, cells: Array.from({ length: e - r + 1 }, (_, i) => key(r + i, c)) });
      r = e + 1;
    }
  }
  return runs;
}

/**
 * Match groups: runs that share a cell form one group (an L or a T).
 * Each: { kind, cells: [keys], size, shape: 'line'|'L'|'T', special: null|'row'|'col'|'bomb'|'prism', pivot: key|null, runs }
 */
export function findGroups(grid) {
  const runs = findRuns(grid);
  if (!runs.length) return [];
  const parent = runs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  runs.forEach((run, i) => {
    for (const k of run.cells) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const byRoot = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(run);
  });
  const groups = [];
  for (const list of byRoot.values()) {
    const cells = [...new Set(list.flatMap((r) => r.cells))];
    let shape = 'line';
    let pivot = null;
    if (list.length > 1) {
      shape = 'T';
      outer: for (const h of list.filter((r) => r.dir === 'h')) {
        for (const v of list.filter((r) => r.dir === 'v')) {
          const shared = h.cells.find((k) => v.cells.includes(k));
          if (shared === undefined) continue;
          pivot = shared;
          const endH = shared === h.cells[0] || shared === h.cells[h.cells.length - 1];
          const endV = shared === v.cells[0] || shared === v.cells[v.cells.length - 1];
          shape = endH && endV ? 'L' : 'T';
          break outer;
        }
      }
    }
    const longest = list.reduce((m, r) => (r.cells.length > m.cells.length ? r : m), list[0]);
    let special = null;
    if (longest.cells.length >= 5) special = 'prism';
    else if (shape !== 'line') special = 'bomb';
    else if (longest.cells.length === 4) special = longest.dir === 'h' ? 'row' : 'col';
    groups.push({ kind: list[0].kind, cells, size: cells.length, shape, special, pivot, longest });
  }
  return groups;
}

/** Is there a line of 3 through (r, c)? */
function lineThrough(grid, r, c) {
  const cell = grid[r][c];
  if (!isGem(cell)) return false;
  const k = cell.kind;
  const same = (rr, cc) => inside(rr, cc) && isGem(grid[rr][cc]) && grid[rr][cc].kind === k;
  let h = 1;
  for (let x = c - 1; same(r, x); x--) h++;
  for (let x = c + 1; same(r, x); x++) h++;
  if (h >= 3) return true;
  let v = 1;
  for (let y = r - 1; same(y, c); y--) v++;
  for (let y = r + 1; same(y, c); y++) v++;
  return v >= 3;
}

/** Does swapping (r1, c1) with (r2, c2) do anything: a match, a prism, or two specials combining? */
export function swapWorks(grid, r1, c1, r2, c2) {
  const a = grid[r1][c1];
  const b = grid[r2][c2];
  if (!a || !b || isVoid(a) || isVoid(b)) return false;
  if (isCrown(a) && isCrown(b)) return false;
  if (isPrism(a) || isPrism(b)) return !isCrown(a) && !isCrown(b);
  if (a.special && b.special) return true;
  if (isGem(a) && isGem(b) && a.kind === b.kind) return false;
  grid[r1][c1] = b;
  grid[r2][c2] = a;
  const ok = lineThrough(grid, r1, c1) || lineThrough(grid, r2, c2);
  grid[r1][c1] = a;
  grid[r2][c2] = b;
  return ok;
}

/** Every swap that works, as [[r1, c1], [r2, c2]] (r2/c2 is the right or lower neighbour). */
export function listMoves(grid) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && swapWorks(grid, r, c, r, c + 1)) out.push([[r, c], [r, c + 1]]);
      if (r + 1 < ROWS && swapWorks(grid, r, c, r + 1, c)) out.push([[r, c], [r + 1, c]]);
    }
  }
  return out;
}

export function hasMove(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && swapWorks(grid, r, c, r, c + 1)) return true;
      if (r + 1 < ROWS && swapWorks(grid, r, c, r + 1, c)) return true;
    }
  }
  return false;
}

/**
 * The idle hint: the first swap in reading order that makes a match, or null.
 * Written quickly for the hint glow; listMoves() above is the careful version the reshuffle check uses.
 */
export function findHint(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (!cell || isCrown(cell)) continue;
      // GLITCHLESS-DEMO: the hint crashes at the right edge. There is no `c + 1 < COLS` check before reading
      // the right-hand neighbour, so on the last column grid[r][8] is undefined and this throws
      // "TypeError: Cannot read properties of undefined (reading 'kind')". It only gets there when no move
      // was found earlier in the scan: whenever the first move (reading order) is not in the top row, the
      // scan runs off the end of row 0 and the hint never shows.
      const right = grid[r][c + 1];
      if (right.kind !== cell.kind && swapWorks(grid, r, c, r, c + 1)) return [[r, c], [r, c + 1]];
      if (r + 1 < ROWS && swapWorks(grid, r, c, r + 1, c)) return [[r, c], [r + 1, c]];
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────── clearing

function mostCommonKind(grid) {
  const n = [0, 0, 0, 0, 0, 0];
  for (const row of grid) for (const cell of row) if (isGem(cell)) n[cell.kind]++;
  let best = 0;
  for (let k = 1; k < n.length; k++) if (n[k] > n[best]) best = k;
  return best;
}

/** Cells a special clears when it fires at (r, c). */
export function blastArea(grid, cell, r, c) {
  const out = [];
  if (cell.kind === 'prism') {
    const k = mostCommonKind(grid);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (isGem(grid[y][x]) && grid[y][x].kind === k) out.push(key(y, x));
    return { cells: out, fx: { type: 'prism', r, c, kind: k } };
  }
  if (cell.special === 'row') {
    for (let x = 0; x < COLS; x++) out.push(key(r, x));
    return { cells: out, fx: { type: 'row', r, c, kind: cell.kind } };
  }
  if (cell.special === 'col') {
    for (let y = 0; y < ROWS; y++) out.push(key(y, c));
    return { cells: out, fx: { type: 'col', r, c, kind: cell.kind } };
  }
  for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (inside(y, x)) out.push(key(y, x));
  return { cells: out, fx: { type: 'bomb', r, c, kind: cell.kind, size: 1 } };
}

/**
 * Clear a set of cells, firing every special caught in it (chain reactions). Crowns are never cleared.
 * Returns { cleared: [{ id, r, c, kind, special, blast }], used: ['striped'|'bomb'|'prism'], fx: [...] }.
 * The grid cells are set to null. `extraFx` are effects already fired (combos).
 */
export function clearCells(grid, keys, { blasted = new Set() } = {}) {
  const clear = new Set();
  const queue = [];
  const add = (k, blast) => {
    if (clear.has(k)) return;
    const [r, c] = rc(k);
    const cell = grid[r][c];
    if (!cell || isCrown(cell) || isVoid(cell)) return;
    clear.add(k);
    if (blast) blasted.add(k);
    queue.push(k);
  };
  for (const k of keys) add(k, blasted.has(k));
  const used = [];
  const fx = [];
  while (queue.length) {
    const k = queue.shift();
    const [r, c] = rc(k);
    const cell = grid[r][c];
    if (!isSpecial(cell) || cell.fired) continue;
    cell.fired = true;
    used.push(specialKind(cell));
    const area = blastArea(grid, cell, r, c);
    fx.push(area.fx);
    for (const a of area.cells) add(a, true);
  }
  const cleared = [];
  for (const k of clear) {
    const [r, c] = rc(k);
    const cell = grid[r][c];
    cleared.push({ id: cell.id, r, c, kind: cell.kind, special: cell.special, blast: blasted.has(k) });
    grid[r][c] = null;
  }
  return { cleared, used, fx };
}

// ───────────────────────────────────────────────────────── gravity

/**
 * Drop everything down and refill from the top. Returns the moves ({ id, r, c, from }) and the new cells
 * ({ cell, r, c, from }, from < 0 = above the board).
 */
export function gravity(grid, rng, colors) {
  const moves = [];
  const spawns = [];
  for (let c = 0; c < COLS; c++) {
    // the playable cells of this column, bottom first (gems fall past gaps)
    const slots = [];
    for (let r = ROWS - 1; r >= 0; r--) if (!isVoid(grid[r][c])) slots.push(r);
    let w = 0;
    for (const r of slots) {
      const cell = grid[r][c];
      if (!cell) continue;
      const to = slots[w++];
      if (to !== r) {
        grid[to][c] = cell;
        grid[r][c] = null;
        moves.push({ id: cell.id, r: to, c, from: r });
      }
    }
    // new gems drop in from above the column's top cell, the lowest one first in line
    const top = slots.length ? slots[slots.length - 1] : 0;
    for (let i = w; i < slots.length; i++) {
      const r = slots[i];
      const cell = newCell(randomKind(rng, colors));
      grid[r][c] = cell;
      spawns.push({ cell: { ...cell }, r, c, from: top - 1 - (i - w) });
    }
  }
  return { moves, spawns };
}

/**
 * Shuffle the gems (crowns stay put) into an arrangement with no match and at least one move.
 * Returns [{ id, r, c }] of the new positions.
 */
export function shuffleGrid(grid, rng, colors) {
  const spots = [];
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (cell && !isCrown(cell) && !isVoid(cell)) {
        spots.push([r, c]);
        cells.push(cell);
      }
    }
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    spots.forEach(([r, c], i) => (grid[r][c] = cells[i]));
    if (attempt > 120) {
      // stubborn board: recolour plain gems until it works
      for (const cell of cells) if (isGem(cell) && !cell.special) cell.kind = randomKind(rng, colors);
    }
    if (!findGroups(grid).length && hasMove(grid)) break;
  }
  return spots.map(([r, c]) => ({ id: grid[r][c].id, r, c }));
}

/** Rows of text for logs and agent tools: R O Y G B P for gems, lower case = striped, * bomb, ◆ prism, ♛ crown. */
export function gridToText(grid) {
  const letters = 'ROYGBP';
  return grid.map((row) =>
    row
      .map((cell) => {
        if (!cell) return '.';
        if (isVoid(cell)) return ' ';
        if (isCrown(cell)) return 'W';
        if (isPrism(cell)) return '@';
        const ch = letters[cell.kind];
        if (cell.special === 'row' || cell.special === 'col') return ch.toLowerCase();
        if (cell.special === 'bomb') return '*';
        return ch;
      })
      .join(''),
  );
}
