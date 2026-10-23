// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// The brain (pure, so Node can run it for balancing) looks at the board the way a person does: it notices
// some of the moves (more with skill), and either takes the first one it sees scanning the board (low skill)
// or the one that looks best: specials and combos first, moves that help the goal (stones, the goal colour,
// crowns), and moves low on the board, which set off more cascades. It uses the hammer when it is one or
// two short of the goal at the end, shuffles when no move helps, sometimes tries a swap that doesn't match,
// and sometimes zones out for 5.6-7 s (low skill), long enough for the idle hint to fire. Below 0.65 it
// restarts a hopeless level now and then; below 0.5 it can rage quit on its last try at a wall.
//
// The driver turns each decision into the same input a person makes: pointer events on the canvas (a
// click on one gem then its neighbour, or a drag), a click on a booster button, or Esc then R / Q.
// Deterministic per seed: the brain only draws random numbers when it decides.
import { createRng } from './rng.js';
import { ROWS, COLS, cloneGrid, findGroups, listMoves, swapWorks, isPrism, isCrown, isGem, isVoid, isSpecial, inside, key, rc } from './board.js';
import { goalProgress } from './play.js';

const SPECIAL_VALUE = { row: 5, col: 5, bomb: 7, prism: 12 };

/** The cells a move would clear right away (before cascades), and how good it looks. */
export function evaluateMove(st, move, skill = 1) {
  const g = cloneGrid(st.grid);
  const [[r1, c1], [r2, c2]] = move;
  const A = g[r1][c1];
  const B = g[r2][c2];
  g[r1][c1] = B;
  g[r2][c2] = A;
  const hit = new Set();
  let val = 0;
  let specials = 0;
  const addRows = (rows) => rows.forEach((r) => r >= 0 && r < ROWS && Array.from({ length: COLS }, (_, c) => hit.add(key(r, c))));
  const addCols = (cols) => cols.forEach((c) => c >= 0 && c < COLS && Array.from({ length: ROWS }, (_, r) => hit.add(key(r, c))));
  const combo = (isPrism(A) && !isCrown(B)) || (isPrism(B) && !isCrown(A)) || (A.special && B.special);
  if (combo) {
    specials = 2;
    if (isPrism(A) && isPrism(B)) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) hit.add(key(r, c));
      val = 60;
    } else if (isPrism(A) || isPrism(B)) {
      const k = (isPrism(A) ? B : A).kind;
      const sp = (isPrism(A) ? B : A).special;
      let n = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!isGem(g[r][c]) || g[r][c].kind !== k) continue;
          n++;
          hit.add(key(r, c));
          if (sp === 'row' || sp === 'col') (n % 2 ? addRows([r]) : addCols([c]));
          else if (sp === 'bomb') for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (inside(y, x)) hit.add(key(y, x));
        }
      }
      val = sp ? 30 + n * 2 : 8 + n * 1.2;
    } else {
      const bombs = (A.special === 'bomb') + (B.special === 'bomb');
      if (bombs === 2) {
        for (let y = r2 - 2; y <= r2 + 2; y++) for (let x = c2 - 2; x <= c2 + 2; x++) if (inside(y, x)) hit.add(key(y, x));
        val = 24;
      } else if (bombs === 1) {
        addRows([r2 - 1, r2, r2 + 1]);
        addCols([c2 - 1, c2, c2 + 1]);
        val = 28;
      } else {
        addRows([r2]);
        addCols([c2]);
        val = 17;
      }
    }
  } else {
    for (const gr of findGroups(g)) {
      val += gr.size;
      if (gr.special) {
        val += SPECIAL_VALUE[gr.special];
        specials++;
      }
      for (const k of gr.cells) {
        hit.add(k);
        const [r, c] = rc(k);
        if (isSpecial(g[r][c])) val += 4;
      }
    }
  }
  // the goal
  const goal = st.def.goal;
  let goalHits = 0;
  for (const k of hit) {
    const [r, c] = rc(k);
    if (goal.type === 'stone' && st.stones[r][c] > 0) goalHits++;
    else if (goal.type === 'collect' && isGem(g[r][c]) && g[r][c].kind === goal.kind) goalHits++;
  }
  if (goal.type === 'crown') {
    if (isCrown(A) && r2 > r1) goalHits += 2;
    if (isCrown(B) && r1 > r2) goalHits += 2;
    for (const k of hit) {
      const [r, c] = rc(k);
      for (let y = r - 1; y >= 0; y--) if (isCrown(g[y][c])) goalHits += 1;
    }
  }
  val += goalHits * (1.2 + 1.8 * skill);
  // lower on the board = more cascades (good players know)
  let rows = 0;
  for (const k of hit) rows += rc(k)[0];
  if (hit.size) val += (rows / hit.size / (ROWS - 1)) * 2.5 * skill;
  return { val, goalHits, specials, cleared: hit.size };
}

export function createBrain({ skill, seed }) {
  const rng = createRng(seed);
  const s1 = 1 - skill;
  const see = 0.35 + 0.65 * skill; // chance to notice any one move
  const greedy = 0.12 + 0.88 * skill ** 1.3; // chance to weigh the moves rather than take the first seen
  const noiseAmp = 0.5 + 6 * s1; // misjudging how good a move is
  const invalidP = 0.02 + 0.14 * s1; // tries a swap that doesn't match
  const zoneP = 0.07 * s1 * s1; // zones out long enough for the 5 s hint
  const brain = { skill, seed, rng, stats: { plans: 0, zoned: 0, invalid: 0, hammer: 0, shuffle: 0, restart: 0, quit: 0 } };
  let restartedLevel = -1; // it restarts a level at most once

  function thinkTime() {
    if (rng.chance(zoneP)) {
      brain.stats.zoned++;
      return rng.range(5.6, 7);
    }
    return 0.04 + 0.25 * s1 + rng.range(0, 0.04 + 0.3 * s1);
  }

  function goalCell(st) {
    const goal = st.def.goal;
    const cands = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = st.grid[r][c];
        if (!cell || isCrown(cell) || isVoid(cell)) continue;
        if (goal.type === 'stone' && st.stones[r][c] > 0) cands.push([r, c]);
        else if (goal.type === 'collect' && isGem(cell) && cell.kind === goal.kind) cands.push([r, c]);
        else if (goal.type === 'crown' && r > 0 && isCrown(st.grid[r - 1][c])) cands.push([r, c]);
      }
    }
    // the gem right under a crown on row 6 drops the crown onto the bottom row
    if (goal.type === 'crown') cands.sort((a, b) => b[0] - a[0]);
    return cands[0] || null;
  }

  brain.onLevelStart = () => {};

  /** Decide the next action. ctx = { tries, levelIndex } */
  brain.plan = (st, ctx) => {
    brain.stats.plans++;
    const think = thinkTime();
    const moves = listMoves(st.grid);
    const prog = goalProgress(st);
    const short = prog.need - prog.have;
    const frac = prog.have / prog.need;

    // give up on it (restart) or on the whole run (quit)
    if (skill < 0.5 && ctx.levelIndex >= 5 && ctx.tries <= 1 && st.movesLeft <= 8 && frac < 0.5 && rng.chance(0.3)) {
      brain.stats.quit++;
      return { action: 'quit', think: think * 0.5 + 0.6 };
    }
    if (skill < 0.65 && restartedLevel !== ctx.levelIndex && st.movesLeft <= 4 && frac < 0.6 && rng.chance(0.35)) {
      restartedLevel = ctx.levelIndex;
      brain.stats.restart++;
      return { action: 'restart', think: think * 0.5 + 0.5 };
    }

    if (!moves.length) return { action: 'wait', think: 0.5 };
    const scored = moves.map((m) => ({ m, ...evaluateMove(st, m, skill) }));

    // boosters
    if (st.boosters.hammer > 0) {
      const cell = st.def.goal.type !== 'score' ? goalCell(st) : null;
      const late = st.movesLeft <= 3 && short <= 2;
      const crownDrop = st.def.goal.type === 'crown' && cell && cell[0] === st.floor[cell[1]] && st.movesLeft <= 6;
      if (skill >= 0.55 && cell && (late || crownDrop || (st.movesLeft === 1 && short <= 3))) {
        brain.stats.hammer++;
        return { action: 'hammer', at: cell, think: think + 0.3 };
      }
      if (skill < 0.55 && rng.chance(0.07)) {
        brain.stats.hammer++;
        const at = cell && rng.chance(0.6) ? cell : [rng.int(0, ROWS - 1), rng.int(0, COLS - 1)];
        const t = st.grid[at[0]][at[1]];
        if (t && !isCrown(t) && !isVoid(t)) return { action: 'hammer', at, think: think + 0.3 };
      }
    }
    if (st.boosters.shuffle > 0) {
      const helps = scored.some((s) => s.goalHits > 0);
      if (skill >= 0.55 && !helps && st.def.goal.type !== 'score' && st.movesLeft >= 3 && rng.chance(0.6)) {
        brain.stats.shuffle++;
        return { action: 'shuffle', think: think + 0.3 };
      }
      if (skill < 0.55 && rng.chance(0.035)) {
        brain.stats.shuffle++;
        return { action: 'shuffle', think: think + 0.3 };
      }
    }

    // a swap that doesn't match (it swaps back; no move used)
    if (rng.chance(invalidP)) {
      for (let i = 0; i < 20; i++) {
        const r = rng.int(0, ROWS - 1);
        const c = rng.int(0, COLS - 1);
        const [dr, dc] = rng.pick([
          [0, 1],
          [1, 0],
          [0, -1],
          [-1, 0],
        ]);
        const r2 = r + dr;
        const c2 = c + dc;
        if (!inside(r2, c2)) continue;
        const a = st.grid[r][c];
        const b = st.grid[r2][c2];
        if (!a || !b || isCrown(a) || isCrown(b) || isVoid(a) || isVoid(b) || swapWorks(st.grid, r, c, r2, c2)) continue;
        brain.stats.invalid++;
        return { action: 'swap', a: [r, c], b: [r2, c2], expectValid: false, think, drag: rng.chance(0.5) };
      }
    }

    // the moves it notices
    let seen = scored.filter(() => rng.chance(see));
    if (!seen.length) seen = [rng.pick(scored)];
    let pick;
    if (rng.chance(greedy)) {
      let best = -Infinity;
      for (const s of seen) {
        const v = s.val + rng.gauss() * noiseAmp;
        if (v > best) {
          best = v;
          pick = s;
        }
      }
    } else {
      // the first match its eye lands on, scanning from some row (on a goal level, often among the goal's gems)
      const start = rng.int(0, ROWS - 1);
      const order = (s) => ((s.m[0][0] - start + ROWS) % ROWS) * COLS + s.m[0][1];
      const useful = seen.filter((s) => s.goalHits > 0);
      const pool = useful.length && rng.chance(0.55 + 0.3 * skill) ? useful : seen;
      pick = pool.reduce((a, b) => (order(b) < order(a) ? b : a));
    }
    // swap direction: drag from either end
    const [a, b] = rng.chance(0.5) ? [pick.m[0], pick.m[1]] : [pick.m[1], pick.m[0]];
    return { action: 'swap', a, b, expectValid: true, think, drag: rng.chance(0.5), val: pick.val };
  };

  /** The hint glowed while it was thinking: a weaker player takes it. */
  brain.onHint = (hint) => {
    if (skill >= 0.7 || !rng.chance(0.85)) return null;
    return { action: 'swap', a: hint[0], b: hint[1], expectValid: true, think: rng.range(0.5, 1.1), drag: rng.chance(0.5), fromHint: true };
  };

  return brain;
}

/**
 * The bot in the page. io = { cellToScreen(r, c) → {x, y}, pointer(type, x, y), booster(kind), key(code), menuClick() }
 * tick(dt, view) every frame; view = { state, idle, st, tries, levelIndex, hint }.
 */
export function createAutoplay({ skill, seed, io }) {
  const brain = createBrain({ skill, seed });
  const bot = { skill, seed, brain, plan: null, wait: 0, steps: [], menuT: 0, menuWait: 0.6 + brain.rng.range(0, 0.6), level: null, sawHint: false };

  function queue(...steps) {
    bot.steps.push(...steps);
  }

  function execute(plan) {
    if (plan.action === 'swap') {
      const A = io.cellToScreen(...plan.a);
      const B = io.cellToScreen(...plan.b);
      if (plan.drag) {
        queue(
          { t: 0, run: () => io.pointer('pointerdown', A.x, A.y) },
          { t: 0.05, run: () => io.pointer('pointermove', A.x + (B.x - A.x) * 0.4, A.y + (B.y - A.y) * 0.4) },
          { t: 0.05, run: () => io.pointer('pointermove', B.x, B.y) },
          { t: 0.04, run: () => io.pointer('pointerup', B.x, B.y) },
        );
      } else {
        queue(
          { t: 0, run: () => io.pointer('pointerdown', A.x, A.y) },
          { t: 0.04, run: () => io.pointer('pointerup', A.x, A.y) },
          { t: 0.06 + (1 - skill) * 0.1, run: () => io.pointer('pointerdown', B.x, B.y) },
          { t: 0.04, run: () => io.pointer('pointerup', B.x, B.y) },
        );
      }
    } else if (plan.action === 'hammer') {
      const P = io.cellToScreen(...plan.at);
      queue({ t: 0, run: () => io.booster('hammer') }, { t: 0.35, run: () => io.pointer('pointerdown', P.x, P.y) }, { t: 0.06, run: () => io.pointer('pointerup', P.x, P.y) });
    } else if (plan.action === 'shuffle') {
      queue({ t: 0, run: () => io.booster('shuffle') });
    } else if (plan.action === 'restart') {
      queue({ t: 0, run: () => io.key('Escape') }, { t: 0.7, run: () => io.key('KeyR') });
    } else if (plan.action === 'quit') {
      queue({ t: 0, run: () => io.key('Escape') }, { t: 0.9, run: () => io.key('KeyQ') });
    }
  }

  bot.tick = (dt, view) => {
    // input already on its way (a click, a drag)
    if (bot.steps.length) {
      bot.steps[0].t -= dt;
      while (bot.steps.length && bot.steps[0].t <= 0) {
        const s = bot.steps.shift();
        s.run();
      }
      return;
    }
    if (view.state === 'title') {
      bot.menuT += dt;
      if (bot.menuT >= bot.menuWait) {
        bot.menuT = 0;
        io.menuClick();
      }
      return;
    }
    if (view.state !== 'playing' || !view.idle) {
      if (view.state !== 'playing') bot.plan = null;
      return;
    }
    if (view.levelKey !== bot.level) {
      bot.level = view.levelKey;
      bot.plan = null;
      brain.onLevelStart();
    }
    if (!bot.plan) {
      bot.plan = brain.plan(view.st, { tries: view.tries, levelIndex: view.levelIndex });
      bot.wait = bot.plan.think;
      bot.sawHint = false;
    }
    if (view.hint && !bot.sawHint) {
      bot.sawHint = true;
      const h = brain.onHint(view.hint);
      if (h) {
        bot.plan = h;
        bot.wait = h.think;
      }
    }
    bot.wait -= dt;
    if (bot.wait > 0) return;
    const plan = bot.plan;
    bot.plan = null;
    if (plan.action !== 'wait') execute(plan);
  };

  return bot;
}
