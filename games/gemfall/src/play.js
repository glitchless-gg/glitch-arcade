// One level being played: the board, stones, moves, score and goal, and what a move does, step by step.
// Pure (no three.js, no DOM). A move returns a list of phases for the view to animate and for main.js to
// report as they play: swap, swapback, clear (one per cascade step), fall, collect (crowns), reshuffle.
import { ROWS, COLS, VOID, createGrid, fillNoMatches, findGroups, clearCells, gravity, hasMove, listMoves, shuffleGrid, newCell, isCrown, isPrism, isGem, isVoid, isSpecial, specialKind, key, rc, inside } from './board.js';
import { MOVE_BONUS } from './levels.js';

const POINTS = {
  gem: 30, // per gem in a match
  blast: 40, // per gem cleared by a special
  stone: 60,
  crown: 500,
  special: { striped: 120, bomb: 200, prism: 400 },
};
export const CASCADE_CAP = 5;

export function createLevel(def, rng) {
  const grid = createGrid();
  // layout: '.' a cell, '#' a cell with a stone tile under its gem, ' ' a gap in the board
  def.layout.forEach((row, r) => [...row].forEach((ch, c) => ch === ' ' && (grid[r][c] = VOID)));
  for (const [r, c] of def.crowns || []) grid[r][c] = newCell('crown');
  const stones = def.layout.map((row) => [...row].map((ch) => (ch === '#' ? 1 : 0)));
  // the lowest playable cell of each column, where crowns are collected
  const floor = Array.from({ length: COLS }, (_, c) => {
    for (let r = ROWS - 1; r >= 0; r--) if (!isVoid(grid[r][c])) return r;
    return -1;
  });
  const stoneTotal = stones.flat().reduce((a, b) => a + b, 0);
  const st = {
    def,
    rng,
    grid,
    stones,
    stoneTotal,
    floor,
    colors: def.colors,
    movesLeft: def.moves,
    movesMade: 0,
    score: 0,
    broken: 0,
    collected: [0, 0, 0, 0, 0, 0],
    crowns: 0,
    boosters: { hammer: 1, shuffle: 1 },
    done: null, // null | 'complete' | 'fail'
  };
  fillNoMatches(grid, rng, def.colors);
  // a fresh board always has a move
  for (let i = 0; i < 50 && !hasMove(grid); i++) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!isCrown(grid[r][c]) && !isVoid(grid[r][c])) grid[r][c] = null;
    fillNoMatches(grid, rng, def.colors);
  }
  return st;
}

/** { have, need, label } for the HUD and the bot */
export function goalProgress(st) {
  const g = st.def.goal;
  if (g.type === 'score') return { have: Math.min(st.score, g.target), need: g.target };
  if (g.type === 'collect') return { have: Math.min(st.collected[g.kind], g.count), need: g.count };
  if (g.type === 'stone') return { have: st.broken, need: st.stoneTotal };
  return { have: st.crowns, need: g.count };
}

export function goalMet(st) {
  const p = goalProgress(st);
  return p.have >= p.need;
}

export function starsFor(st) {
  if (!goalMet(st)) return 0;
  const [, two, three] = st.def.stars;
  return st.score >= three ? 3 : st.score >= two ? 2 : 1;
}

export function stonesLeft(st) {
  return st.stoneTotal - st.broken;
}

// ───────────────────────────────────────────────────────── one clear step

function applyClear(st, cleared) {
  const stones = [];
  for (const g of cleared) {
    if (typeof g.kind === 'number') st.collected[g.kind]++;
    if (st.stones[g.r][g.c] > 0) {
      st.stones[g.r][g.c]--;
      st.broken++;
      stones.push({ r: g.r, c: g.c, left: st.stones[g.r][g.c] });
    }
  }
  return stones;
}

/**
 * Clear the given match groups (plus any specials they set off) as one step. `swapped` = the two keys of
 * the player's swap (cascade 0), where new specials appear.
 */
function clearStep(st, groups, cascade, swapped = []) {
  const grid = st.grid;
  const keys = new Set(groups.flatMap((g) => g.cells));
  // where each group's special goes, decided before anything is cleared
  const created = [];
  const taken = new Set();
  for (const g of groups) {
    if (!g.special) continue;
    let at = swapped.find((k) => g.cells.includes(k) && !taken.has(k));
    if (at === undefined) at = g.pivot ?? g.longest.cells[Math.floor((g.longest.cells.length - 1) / 2)];
    if (taken.has(at)) at = g.cells.find((k) => !taken.has(k));
    if (at === undefined) continue;
    taken.add(at);
    created.push({ at, kind: g.special === 'prism' ? 'prism' : g.kind, special: g.special === 'prism' ? null : g.special });
  }
  const { cleared, used, fx } = clearCells(grid, keys);
  const mult = 1 + Math.min(cascade, CASCADE_CAP) * 0.5;
  let gained = 0;
  for (const g of groups) gained += g.size * POINTS.gem * mult;
  for (const c of cleared) if (c.blast) gained += POINTS.blast * mult;
  const stones = applyClear(st, cleared);
  gained += stones.length * POINTS.stone;
  const made = [];
  for (const cr of created) {
    const [r, c] = rc(cr.at);
    if (grid[r][c]) continue; // a crown sat there (can't happen for a match cell, but be safe)
    const cell = newCell(cr.kind, cr.special);
    grid[r][c] = cell;
    made.push({ cell: { ...cell }, r, c });
    gained += POINTS.special[specialKind(cell)];
  }
  gained = Math.round(gained / 10) * 10;
  st.score += gained;
  return {
    type: 'clear',
    cascade: Math.min(cascade, CASCADE_CAP),
    matches: groups.map((g) => ({ size: Math.min(g.size, 5), shape: g.shape, kind: g.kind, cells: g.cells.map(rc) })),
    cleared,
    created: made,
    used,
    fx,
    stones,
    score: gained,
  };
}

/** Crowns on the bottom cell of their column are collected. */
function collectCrowns(st) {
  const out = [];
  for (let c = 0; c < COLS; c++) {
    const r = st.floor[c];
    const cell = r >= 0 ? st.grid[r][c] : null;
    if (isCrown(cell)) {
      out.push({ id: cell.id, r, c });
      st.grid[r][c] = null;
      st.crowns++;
      st.score += POINTS.crown;
    }
  }
  return out;
}

/** Gravity, crown collection and cascades until the board is still. */
function settle(st, phases, cascadeFrom) {
  let cascade = cascadeFrom;
  for (let guard = 0; guard < 60; guard++) {
    const f = gravity(st.grid, st.rng, st.colors);
    if (f.moves.length || f.spawns.length) phases.push({ type: 'fall', ...f });
    const crowns = collectCrowns(st);
    if (crowns.length) {
      phases.push({ type: 'collect', crowns, score: crowns.length * POINTS.crown });
      continue;
    }
    const groups = findGroups(st.grid);
    if (!groups.length) break;
    cascade++;
    phases.push(clearStep(st, groups, cascade));
  }
}

/** After the board settles: level over, or a reshuffle if no move is left. */
function finish(st, phases) {
  if (goalMet(st)) {
    const bonus = st.movesLeft * MOVE_BONUS;
    st.score += bonus;
    st.done = 'complete';
    phases.push({ type: 'complete', bonus, movesLeft: st.movesLeft });
    return;
  }
  if (st.movesLeft <= 0) {
    st.done = 'fail';
    phases.push({ type: 'fail' });
    return;
  }
  if (!hasMove(st.grid)) {
    const positions = shuffleGrid(st.grid, st.rng, st.colors);
    phases.push({ type: 'reshuffle', reason: 'no_moves', positions });
  }
}

// ───────────────────────────────────────────────────────── combos

function cellsWhere(grid, pred) {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] && pred(grid[r][c])) out.push(key(r, c));
  return out;
}

/** Two specials (or a prism and anything) swapped together. Returns a clear phase. */
function comboStep(st, ka, kb) {
  const grid = st.grid;
  const [ra, ca] = rc(ka);
  const [rb, cb] = rc(kb);
  const A = grid[ra][ca];
  const B = grid[rb][cb];
  const used = [];
  const fx = [];
  const blasted = new Set();
  let keys = [];
  const prismA = isPrism(A);
  const prismB = isPrism(B);
  if (prismA && prismB) {
    A.fired = B.fired = true;
    used.push('prism', 'prism');
    fx.push({ type: 'prism', r: rb, c: cb, kind: null, all: true });
    keys = cellsWhere(grid, (cell) => !isCrown(cell) && !isVoid(cell));
  } else if (prismA || prismB) {
    const prism = prismA ? A : B;
    const other = prismA ? B : A;
    const [pr, pc] = prismA ? [ra, ca] : [rb, cb];
    prism.fired = true;
    used.push('prism');
    const k = other.kind;
    fx.push({ type: 'prism', r: pr, c: pc, kind: k });
    const same = cellsWhere(grid, (cell) => isGem(cell) && cell.kind === k);
    if (other.special === 'row' || other.special === 'col') {
      // every gem of that colour turns striped and fires
      for (const s of same) {
        const [r, c] = rc(s);
        if (!grid[r][c].special) grid[r][c].special = st.rng.next() < 0.5 ? 'row' : 'col';
      }
    } else if (other.special === 'bomb') {
      for (const s of same) {
        const [r, c] = rc(s);
        if (!grid[r][c].special) grid[r][c].special = 'bomb';
      }
    }
    keys = [prismA ? ka : kb, ...same];
    for (const s of same) blasted.add(s);
  } else {
    // two striped / bomb gems
    const sa = A.special === 'bomb' ? 'bomb' : 'striped';
    const sb = B.special === 'bomb' ? 'bomb' : 'striped';
    A.fired = B.fired = true;
    used.push(specialKind(A), specialKind(B));
    const at = [rb, cb];
    const lines = (rows, cols) => {
      const out = [];
      for (const r of rows) if (r >= 0 && r < ROWS) for (let c = 0; c < COLS; c++) out.push(key(r, c));
      for (const c of cols) if (c >= 0 && c < COLS) for (let r = 0; r < ROWS; r++) out.push(key(r, c));
      return out;
    };
    if (sa === 'striped' && sb === 'striped') {
      keys = lines([at[0]], [at[1]]);
      fx.push({ type: 'row', r: at[0], c: at[1], kind: B.kind }, { type: 'col', r: at[0], c: at[1], kind: A.kind });
    } else if (sa === 'bomb' && sb === 'bomb') {
      for (let r = at[0] - 2; r <= at[0] + 2; r++) for (let c = at[1] - 2; c <= at[1] + 2; c++) if (inside(r, c)) keys.push(key(r, c));
      fx.push({ type: 'bomb', r: at[0], c: at[1], kind: B.kind, size: 2 });
    } else {
      keys = lines([at[0] - 1, at[0], at[0] + 1], [at[1] - 1, at[1], at[1] + 1]);
      fx.push({ type: 'row', r: at[0], c: at[1], kind: A.kind, wide: true }, { type: 'col', r: at[0], c: at[1], kind: B.kind, wide: true });
    }
    keys.push(ka, kb);
    for (const k of keys) blasted.add(k);
  }
  const res = clearCells(grid, keys, { blasted });
  let gained = 0;
  for (const c of res.cleared) gained += POINTS.blast;
  const stones = applyClear(st, res.cleared);
  gained += stones.length * POINTS.stone;
  gained = Math.round(gained / 10) * 10;
  st.score += gained;
  return { type: 'clear', cascade: 0, combo: true, matches: [], cleared: res.cleared, created: [], used: [...used, ...res.used], fx: [...fx, ...res.fx], stones, score: gained };
}

// ───────────────────────────────────────────────────────── player actions

export const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/**
 * Swap two neighbouring cells. Returns { ok, valid, phases }: valid false = no match (it swaps back,
 * no move is used); ok false = not a legal swap at all (not neighbours, a crown with a crown, level over).
 */
export function playSwap(st, a, b) {
  if (st.done) return { ok: false, reason: 'level over' };
  if (!adjacent(a, b) || !inside(...a) || !inside(...b)) return { ok: false, reason: 'not neighbours' };
  const grid = st.grid;
  const A = grid[a[0]][a[1]];
  const B = grid[b[0]][b[1]];
  if (!A || !B || isVoid(A) || isVoid(B) || (isCrown(A) && isCrown(B))) return { ok: false, reason: 'nothing to swap' };
  const ka = key(...a);
  const kb = key(...b);
  const phases = [{ type: 'swap', a, b, ids: [A.id, B.id] }];
  grid[a[0]][a[1]] = B;
  grid[b[0]][b[1]] = A;
  // after the swap A sits at b and B at a
  const combo = (isPrism(A) && !isCrown(B)) || (isPrism(B) && !isCrown(A)) || (A.special && B.special);
  let groups = combo ? [] : findGroups(grid);
  if (!combo && !groups.length) {
    grid[a[0]][a[1]] = A;
    grid[b[0]][b[1]] = B;
    phases.push({ type: 'swapback', a, b, ids: [A.id, B.id] });
    return { ok: true, valid: false, phases };
  }
  st.movesLeft--;
  st.movesMade++;
  if (combo) phases.push(comboStep(st, ka, kb));
  else phases.push(clearStep(st, groups, 0, [kb, ka]));
  settle(st, phases, 0);
  finish(st, phases);
  return { ok: true, valid: true, phases };
}

/** Hammer booster: smash one gem (no move used). */
export function playHammer(st, r, c) {
  if (st.done) return { ok: false, reason: 'level over' };
  if (st.boosters.hammer <= 0) return { ok: false, reason: 'no hammer left' };
  if (!inside(r, c)) return { ok: false, reason: 'off the board' };
  const cell = st.grid[r][c];
  if (!cell || isCrown(cell) || isVoid(cell)) return { ok: false, reason: 'the hammer only smashes gems' };
  st.boosters.hammer--;
  const blasted = new Set([key(r, c)]);
  const res = clearCells(st.grid, [key(r, c)], { blasted });
  const stones = applyClear(st, res.cleared);
  const gained = res.cleared.length * POINTS.blast + stones.length * POINTS.stone;
  st.score += gained;
  const phases = [{ type: 'hammer', r, c }, { type: 'clear', cascade: 0, hammer: true, matches: [], cleared: res.cleared, created: [], used: res.used, fx: res.fx, stones, score: gained }];
  settle(st, phases, 0);
  finish(st, phases);
  return { ok: true, valid: true, phases };
}

/** Shuffle booster (no move used). */
export function playShuffle(st) {
  if (st.done) return { ok: false, reason: 'level over' };
  if (st.boosters.shuffle <= 0) return { ok: false, reason: 'no shuffle left' };
  st.boosters.shuffle--;
  const positions = shuffleGrid(st.grid, st.rng, st.colors);
  return { ok: true, valid: true, phases: [{ type: 'reshuffle', reason: 'booster', positions }] };
}

/** Put a special on the board (agent tool): replaces the gem at (r, c). */
export function placeSpecial(st, kind, r, c) {
  if (!inside(r, c)) return null;
  const old = st.grid[r][c];
  if (!old || isCrown(old) || isVoid(old)) return null;
  let cell;
  if (kind === 'prism') cell = newCell('prism');
  else {
    const k = isGem(old) ? old.kind : Math.floor(st.rng.next() * st.colors);
    const special = kind === 'bomb' ? 'bomb' : kind === 'striped_col' ? 'col' : 'row';
    cell = newCell(k, special);
  }
  st.grid[r][c] = cell;
  return { old: { ...old }, cell: { ...cell }, r, c };
}

export { listMoves, hasMove, isSpecial, isPrism, isCrown, isGem, isVoid };
