// Gemfall: a small Three.js match-3 (a Glitchless genre demo).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { LEVELS, TRIES_PER_LEVEL, levelIndex } from './levels.js';
import { ROWS, COLS, findHint, gridToText, listMoves, isVoid, isGem, specialKind } from './board.js';
import { createLevel, playSwap, playHammer, playShuffle, placeSpecial, goalProgress, starsFor, adjacent, stonesLeft } from './play.js';
import { T, phaseDuration } from './timing.js';
import { createGemKit, GEM_CSS } from './gems.js';
import { createFx } from './fx.js';
import { createBoardView, cellX, cellY } from './view.js';
import { hud, fmt } from './hud.js';
import { input, bindPointer } from './input.js';
import { sfx } from './audio.js';
import { createRng } from './rng.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay, evaluateMove } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const HINT_DELAY_MS = 5000; // idle time before the hint glows
const BOT_PATIENCE_S = 200; // the bot closes the tab after this long in a run
const HUMAN_CARD_MIN = 0.8; // s before a click skips a card
const HUMAN_CARD_AUTO = 4; // s before a card moves on by itself

// ─────────────────────────────────────────────────────────────── renderer / scene

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
const hemi = new THREE.HemisphereLight(0xe2d8ff, 0x2a1050, 0.55);
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-4, 7, 10);
const rimLight = new THREE.PointLight(0xff6ac8, 0.9, 0, 0);
rimLight.position.set(7, -6, 5);
scene.add(hemi, key, rimLight);

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); // visible height per unit of distance
  const byHeight = 8.9 / (0.84 * span);
  const byWidth = 9.6 / ((aspect < 1.25 ? 0.96 : 0.6) * span * aspect);
  const d = Math.max(byHeight, byWidth);
  camera.position.set(0, -0.6, d);
  camera.lookAt(0, -0.25, 0);
  camera.updateProjectionMatrix();
}
fitCamera();

const kit = createGemKit();
const view = createBoardView(scene, kit, createFx);
const fx = view.fx;
const rng = createRng((params.seed ^ 0x2c1b3c6d) >>> 0); // the game's own randomness (refills, shuffles)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera();
});

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | intro | playing | paused | result | failed | win | gameover
  levelIndex: params.level - 1,
  attempt: 0,
  st: null,
  tries: TRIES_PER_LEVEL,
  queue: [],
  phase: null,
  phaseT: 0,
  phaseD: 0,
  busy: false,
  shown: { score: 0, have: 0, moves: 0 },
  selected: null,
  dragFrom: null,
  pointerDown: false,
  cursor: [ROWS - 1, 3],
  cursorOn: false,
  hammerArmed: false,
  hint: null,
  timer: 0,
  levelTime: 0,
  runTime: 0,
  totals: { score: 0, stars: 0, time: 0, fails: 0 },
  lastResult: null,
  halted: false,
};

let hintTimer = 0;

const io = {
  cellToScreen,
  pointer(type, x, y) {
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  },
  booster(kind) {
    document.getElementById(`bst-${kind}`)?.click();
  },
  key(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  },
  menuClick() {
    document.getElementById('press')?.click();
  },
};
const bot = params.autoplay ? createAutoplay({ skill: params.skill, seed: params.seed, io }) : null;

const level = () => LEVELS[game.levelIndex];
const idle = () => game.state === 'playing' && !game.phase && game.queue.length === 0 && !game.busy && game.st && !game.st.done;

// ─────────────────────────────────────────────────────────────── screen <-> board

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

function cellToScreen(r, c) {
  view.group.updateMatrixWorld();
  _v.set(cellX(c), cellY(r), 0.32);
  view.group.localToWorld(_v);
  _v.project(camera);
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + ((_v.x + 1) / 2) * rect.width, y: rect.top + ((1 - _v.y) / 2) * rect.height };
}

/** The pointer on the board, in board units: { x, y } or null. */
function pickLocal(x, y) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  view.group.updateMatrixWorld();
  view.group.getWorldQuaternion(_q);
  _n.set(0, 0, 1).applyQuaternion(_q);
  _p.set(0, 0, 0.32);
  view.group.localToWorld(_p);
  plane.setFromNormalAndCoplanarPoint(_n, _p);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return view.group.worldToLocal(hit.clone());
}

function cellAt(local) {
  if (!local) return null;
  const c = Math.round(local.x + (COLS - 1) / 2);
  const r = Math.round((ROWS - 1) / 2 - local.y);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  const cell = game.st?.grid[r][c];
  if (!cell || isVoid(cell)) return null;
  return [r, c];
}

function screenOfCells(cells) {
  let x = 0;
  let y = 0;
  for (const [r, c] of cells) {
    const p = cellToScreen(r, c);
    x += p.x;
    y += p.y;
  }
  return { x: x / cells.length, y: y / cells.length };
}

// ─────────────────────────────────────────────────────────────── the hint

function armHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(showHint, HINT_DELAY_MS);
}

function clearHint() {
  clearTimeout(hintTimer);
  hintTimer = 0;
  if (game.hint) {
    game.hint = null;
    fx.showHint(null);
  }
}

/** The idle-hint timer: after 5 s without a move, glow the first move findHint() finds. */
function showHint() {
  hintTimer = 0;
  if (!idle()) return;
  const hint = findHint(game.st.grid);
  if (!hint) return;
  game.hint = hint;
  fx.showHint(hint);
  gd.track('hint_shown', {});
}

// ─────────────────────────────────────────────────────────────── level flow

function totalsReset() {
  game.totals = { score: 0, stars: 0, time: 0, fails: 0 };
  game.runTime = 0;
}

function beginLevel(index, fresh) {
  clearHint();
  game.levelIndex = index;
  if (fresh) game.tries = TRIES_PER_LEVEL;
  game.attempt++;
  game.st = createLevel(LEVELS[index], rng);
  game.queue.length = 0;
  game.phase = null;
  game.busy = false;
  game.selected = null;
  game.dragFrom = null;
  game.hammerArmed = false;
  game.lastResult = null;
  game.shown = { score: 0, have: 0, moves: game.st.movesLeft };
  game.levelTime = 0;
  view.build(game.st);
  fx.showSelect(null);
  fx.showCursor(null);
  const need = goalProgress(game.st).need;
  hud.level(index + 1, level(), need);
  hud.banner(index + 1, level(), need, game.tries, TRIES_PER_LEVEL);
  hud.show(true);
  hud.screen(null);
  input.clear();
  game.state = 'intro';
  game.timer = T.intro;
  gd.levelStart(level().id);
}

function startRun(index = game.levelIndex) {
  totalsReset();
  beginLevel(index, true);
}

function levelResult(stars, movesLeft) {
  gd.track('level_result', { stars, moves_left: Math.max(0, Math.round(movesLeft)) });
}

function completeLevel() {
  const st = game.st;
  const durationS = Math.round(game.levelTime * 100) / 100;
  const stars = starsFor(st);
  const done = game.lastResult || { bonus: 0, movesLeft: st.movesLeft };
  gd.levelComplete(level().id, { durationS, score: st.score });
  levelResult(stars, done.movesLeft);
  game.totals.score += st.score;
  game.totals.stars += stars;
  clearHint();
  sfx.win();
  const last = game.levelIndex >= LEVELS.length - 1;
  hud.result(game.levelIndex + 1, level(), { stars, score: st.score, movesLeft: done.movesLeft, bonus: done.bonus, next: last ? null : LEVELS[game.levelIndex + 1] });
  hud.screen('result');
  game.state = 'result';
  game.timer = 0;
  setTimeout(() => [0, 1, 2].forEach((i) => i < stars && setTimeout(() => sfx.star(i), 250 + i * 220)), 0);
}

function failLevel(cause) {
  const st = game.st;
  const p = goalProgress(st);
  gd.levelFail(level().id, { cause });
  levelResult(0, cause === 'out_of_moves' ? 0 : st.movesLeft);
  if (cause !== 'restart') game.tries--; // a restart from the pause menu doesn't cost a try
  game.totals.fails++;
  clearHint();
  if (cause === 'quit') return;
  sfx.fail();
  hud.failed(game.levelIndex + 1, level(), { cause, have: p.have, need: p.need, triesLeft: game.tries });
  hud.screen('failed');
  game.state = 'failed';
  game.timer = 0;
}

function afterCard() {
  if (game.state === 'result') {
    if (game.levelIndex >= LEVELS.length - 1) {
      game.state = 'win';
      game.timer = 0;
      hud.win(game.totals);
      hud.show(false);
      hud.screen('win');
      return;
    }
    beginLevel(game.levelIndex + 1, true);
  } else if (game.state === 'failed') {
    if (game.tries > 0) beginLevel(game.levelIndex, false);
    else {
      game.state = 'gameover';
      game.timer = 0;
      hud.gameover(game.levelIndex + 1, level(), game.totals);
      hud.show(false);
      hud.screen('gameover');
    }
  } else if (game.state === 'win' || game.state === 'gameover') {
    startRun(0);
  }
}

function pause() {
  if (game.state !== 'playing' && game.state !== 'intro') return;
  game.pausedFrom = game.state;
  game.state = 'paused';
  clearTimeout(hintTimer);
  hintTimer = 0;
  hud.screen('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = game.pausedFrom || 'playing';
  hud.screen(null);
  input.clear();
  if (idle()) armHint();
}

function restartLevel() {
  failLevel('restart');
}

function quitRun() {
  failLevel('quit');
  if (bot) {
    halt('RAGE QUIT', 'Nope. Not this one.', `The bot gave up on ${level().name} (level ${game.levelIndex + 1}) with ${game.st.movesLeft} moves left and closed the tab.`, true);
    return;
  }
  toTitle();
}

function toTitle() {
  game.state = 'title';
  hud.show(false);
  hud.screen('title');
  showcase();
}

function halt(ribbon, title, text, red = false) {
  if (game.halted) return;
  game.halted = true;
  clearHint();
  hud.show(false);
  hud.halted(ribbon, title, text, red);
  hud.screen('halted');
  window.gemfall.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  setTimeout(() => endSession(), 1000);
}

// ─────────────────────────────────────────────────────────────── moves

function enqueue(phases) {
  game.queue.push(...phases);
  game.busy = true;
}

function trySwap(a, b) {
  if (!idle()) return { ok: false, reason: `busy (${game.state})` };
  const res = playSwap(game.st, a, b);
  if (!res.ok) return res;
  clearHint();
  game.selected = null;
  fx.showSelect(null);
  gd.track('swap', { result: res.valid ? 'match' : 'invalid' });
  res.phases[0].valid = res.valid;
  enqueue(res.phases);
  return res;
}

function useBooster(kind) {
  if (kind === 'hammer' && game.state === 'playing' && game.st && !game.st.done) {
    // arming is fine mid-cascade; the smash itself waits for the board to settle
    if (game.st.boosters.hammer <= 0) return hud.toast('No hammers left', 1000);
    game.hammerArmed = !game.hammerArmed;
    game.selected = null;
    fx.showSelect(null);
    if (game.hammerArmed) hud.toast('Hammer: pick a gem to smash', 1400);
    return;
  }
  if (!idle()) return;
  if (kind === 'shuffle') {
    const res = playShuffle(game.st);
    if (!res.ok) return hud.toast('No shuffles left', 1000);
    clearHint();
    game.selected = null;
    fx.showSelect(null);
    gd.track('booster', { kind: 'shuffle' });
    sfx.shuffle();
    enqueue(res.phases);
  }
}

function smash(r, c) {
  const res = playHammer(game.st, r, c);
  game.hammerArmed = false;
  if (!res.ok) return hud.toast(res.reason, 1000);
  clearHint();
  gd.track('booster', { kind: 'hammer' });
  enqueue(res.phases);
}

function select(cell) {
  game.selected = cell;
  fx.showSelect(cell);
  if (cell) sfx.select();
}

// ─────────────────────────────────────────────────────────────── phases (what a move does, on screen)

function startPhase(ph) {
  const st = game.st;
  switch (ph.type) {
    case 'swap':
      view.swap(ph, false);
      if (ph.valid) game.shown.moves--;
      sfx.swap();
      break;
    case 'swapback':
      view.swap(ph, true);
      sfx.invalid();
      break;
    case 'clear': {
      for (const m of ph.matches) gd.track('match', { size: m.size, shape: m.shape, cascade: Math.min(5, ph.cascade) });
      for (const c of ph.created) gd.track('special_created', { kind: specialKind(c.cell) });
      for (const u of ph.used) gd.track('special_used', { kind: u });
      view.clear(ph);
      game.shown.score += ph.score;
      const goal = st.def.goal;
      if (goal.type === 'collect') game.shown.have += ph.cleared.filter((c) => c.kind === goal.kind).length;
      if (goal.type === 'stone') game.shown.have += ph.stones.length;
      const cells = ph.cleared.map((c) => [c.r, c.c]);
      if (cells.length) {
        const at = screenOfCells(cells);
        const k = ph.matches[0]?.kind;
        hud.popup(at.x, at.y, `+${fmt(ph.score)}`, typeof k === 'number' ? GEM_CSS[k] : '#ffffff', ph.score >= 600);
      }
      if (ph.matches.length) sfx.match(ph.cascade, Math.max(...ph.matches.map((m) => m.size)));
      if (ph.used.length) sfx.blast();
      if (ph.created.length) sfx.special();
      if (ph.stones.length) sfx.stone();
      if (ph.cleared.length >= 20) hud.callout(ph.cleared.length >= 35 ? 'Spectacular!' : 'Brilliant!', 'gold', 1000);
      else if (ph.combo) hud.callout('Combo!', 'cyan', 900);
      else if (ph.created.some((c) => c.cell.kind === 'prism')) hud.callout('Prism!', 'cyan', 900);
      else if (ph.cascade >= 2) hud.callout(`Cascade ×${ph.cascade}`, '', 800);
      break;
    }
    case 'fall':
      view.fall(ph);
      break;
    case 'collect': {
      view.collect(ph);
      game.shown.score += ph.score;
      game.shown.have += ph.crowns.length;
      const at = screenOfCells(ph.crowns.map((c) => [c.r, c.c]));
      hud.popup(at.x, at.y - 30, `+${fmt(ph.score)}`, '#ffd25a', true);
      hud.callout('Crown!', 'gold', 900);
      sfx.crown();
      break;
    }
    case 'reshuffle':
      if (ph.reason === 'no_moves') {
        gd.track('reshuffle', { reason: 'no_moves' });
        hud.toast('No moves left: reshuffling', 1500);
      }
      view.reshuffle(ph);
      break;
    case 'hammer':
      view.hammer(ph.r, ph.c);
      sfx.hammer();
      break;
    case 'complete':
      game.shown.score += ph.bonus;
      game.lastResult = { bonus: ph.bonus, movesLeft: ph.movesLeft };
      if (ph.bonus) hud.callout(`+${fmt(ph.bonus)} move bonus`, 'gold', 1100);
      break;
    default:
      break;
  }
}

function stepPhases(dt) {
  if (game.phase) {
    game.phaseT += dt;
    if (game.phaseT < game.phaseD) return;
    game.phase = null;
  }
  while (!game.phase && game.queue.length) {
    const ph = game.queue.shift();
    startPhase(ph);
    const d = phaseDuration(ph);
    if (d > 0) {
      game.phase = ph;
      game.phaseT = 0;
      game.phaseD = d;
    }
  }
  if (!game.phase && !game.queue.length && game.busy) {
    game.busy = false;
    onSettled();
  }
}

function onSettled() {
  const st = game.st;
  if (st.done) {
    game.state = 'ending';
    game.timer = 0.25;
    return;
  }
  armHint();
}

// ─────────────────────────────────────────────────────────────── input

function handlePointer(ev) {
  if (game.state === 'title') return;
  if (game.state !== 'playing') return;
  const local = pickLocal(ev.x, ev.y);
  const cell = cellAt(local);
  if (ev.type === 'pointerdown') {
    game.pointerDown = true;
    game.cursorOn = false;
    fx.showCursor(null);
    if (!idle()) return;
    if (!cell) {
      select(null);
      return;
    }
    if (hintTimer || game.hint) {
      clearHint();
      armHint();
    }
    if (game.hammerArmed) {
      smash(...cell);
      return;
    }
    if (game.selected && adjacent(game.selected, cell)) {
      const a = game.selected;
      game.dragFrom = null;
      trySwap(a, cell);
      return;
    }
    if (game.selected && game.selected[0] === cell[0] && game.selected[1] === cell[1]) {
      select(null);
      game.dragFrom = null;
      return;
    }
    select(cell);
    game.dragFrom = cell;
  } else if (ev.type === 'pointermove') {
    if (!game.pointerDown || !game.dragFrom || !local || !idle()) return;
    // a drag: once the pointer is more than half a cell away, swap towards it
    const [r0, c0] = game.dragFrom;
    const dx = local.x - cellX(c0);
    const dy = local.y - cellY(r0);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.5) return;
    const to = Math.abs(dx) > Math.abs(dy) ? [r0, c0 + Math.sign(dx)] : [r0 - Math.sign(dy), c0];
    game.dragFrom = null;
    if (to[1] < 0 || to[1] >= COLS || to[0] < 0 || to[0] >= ROWS) return;
    trySwap([r0, c0], to);
  } else if (ev.type === 'pointerup') {
    game.pointerDown = false;
    game.dragFrom = null;
  }
}

const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

function handleKey(action) {
  if (action === 'mute') {
    hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', 900);
    return;
  }
  const s = game.state;
  if (s === 'title') {
    if (action === 'select' || action === 'confirm') startRun();
  } else if (s === 'paused') {
    if (action === 'restart') restartLevel();
    else if (action === 'quit') quitRun();
    else if (action === 'escape' || action === 'pause' || action === 'confirm' || action === 'select') resume();
  } else if (s === 'playing' || s === 'intro') {
    if (action === 'pause') return pause();
    if (action === 'escape') {
      if (game.hammerArmed) game.hammerArmed = false;
      else if (game.selected) select(null);
      else pause();
      return;
    }
    if (s !== 'playing') return;
    if (action === 'hammer') return useBooster('hammer');
    if (action === 'shuffle') return useBooster('shuffle');
    if (DIRS[action]) {
      const [dr, dc] = DIRS[action];
      if (game.selected && idle()) {
        const a = game.selected;
        const b = [a[0] + dr, a[1] + dc];
        if (cellAt({ x: cellX(b[1]), y: cellY(b[0]) })) trySwap(a, b);
        return;
      }
      game.cursorOn = true;
      game.cursor = [Math.max(0, Math.min(ROWS - 1, game.cursor[0] + dr)), Math.max(0, Math.min(COLS - 1, game.cursor[1] + dc))];
      fx.showCursor(game.cursor, game.hammerArmed ? 0xffe9a8 : 0x9ff7ff);
      return;
    }
    if (action === 'select' || action === 'confirm') {
      if (!idle()) return;
      const cur = game.cursor;
      game.cursorOn = true;
      fx.showCursor(cur);
      if (!cellAt({ x: cellX(cur[1]), y: cellY(cur[0]) })) return;
      if (hintTimer || game.hint) {
        clearHint();
        armHint();
      }
      if (game.hammerArmed) return smash(...cur);
      if (game.selected && game.selected[0] === cur[0] && game.selected[1] === cur[1]) return select(null);
      if (game.selected && adjacent(game.selected, cur)) return trySwap(game.selected, cur);
      select([...cur]);
    }
  } else if (s === 'result' || s === 'failed' || s === 'win' || s === 'gameover') {
    if ((action === 'select' || action === 'confirm') && !bot && game.timer >= HUMAN_CARD_MIN) afterCard();
  }
}

hud.on('start', () => game.state === 'title' && startRun());
hud.on('booster', (kind) => game.state === 'playing' && useBooster(kind));
hud.on('next', () => !bot && game.timer >= HUMAN_CARD_MIN && afterCard());
hud.on('resume', () => resume());

// ─────────────────────────────────────────────────────────────── per frame

function updateFlow(dt) {
  const s = game.state;
  if (s === 'intro') {
    game.levelTime += dt;
    game.runTime += dt;
    game.timer -= dt;
    if (game.timer <= 0) {
      game.state = 'playing';
      armHint();
    }
  } else if (s === 'playing') {
    game.levelTime += dt;
    game.runTime += dt;
    stepPhases(dt);
    if (bot && game.runTime > BOT_PATIENCE_S && idle()) {
      failLevel('quit');
      halt('AUTOPLAY', 'Out of patience', `The bot spent ${Math.round(game.runTime)} s on the run, got as far as level ${game.levelIndex + 1} and closed the tab.`);
    }
  } else if (s === 'ending') {
    game.levelTime += dt;
    game.runTime += dt;
    game.timer -= dt;
    if (game.timer <= 0 && !view.isAnimating()) {
      game.state = 'playing';
      if (game.st.done === 'complete') completeLevel();
      else failLevel('out_of_moves');
    }
  } else if (s === 'result' || s === 'failed') {
    game.timer += dt;
    const wait = bot ? (s === 'result' ? T.complete : T.fail) : HUMAN_CARD_AUTO;
    if (game.timer >= wait) afterCard();
  } else if (s === 'win' || s === 'gameover') {
    game.timer += dt;
    if (bot && game.timer >= T.final) {
      if (s === 'win') halt('AUTOPLAY', 'All eight cleared', `The bot cleared all eight levels with ${game.totals.stars} stars and ${game.totals.fails} ${game.totals.fails === 1 ? 'retry' : 'retries'} in ${Math.round(game.runTime)} s and closed the tab.`);
      else halt('AUTOPLAY', `Stuck on ${level().name}`, `The bot ran out of tries on level ${game.levelIndex + 1} after ${Math.round(game.runTime)} s and closed the tab.`, true);
    }
  }
  if (game.state === 'win' || game.state === 'gameover' || game.state === 'result' || game.state === 'failed') game.totals.time = game.runTime;
  hud.hint(!bot && (game.state === 'playing' || game.state === 'intro') && game.levelIndex === 0 && game.levelTime < 10);
}

function updateHud() {
  const st = game.st;
  if (!st) return;
  const p = goalProgress(st);
  const goal = st.def.goal;
  const have = goal.type === 'score' ? Math.min(game.shown.score, goal.target) : game.shown.have;
  hud.goal(have, p.need);
  hud.moves(Math.max(0, game.shown.moves));
  hud.tries(game.tries, TRIES_PER_LEVEL);
  const [s1, s2, s3] = st.def.stars;
  const met = have >= p.need;
  const stars = !met ? 0 : game.shown.score >= s3 ? 3 : game.shown.score >= s2 ? 2 : 1;
  hud.score(game.shown.score, goal.type === 'score' ? (game.shown.score >= s3 ? 3 : game.shown.score >= s2 ? 2 : game.shown.score >= s1 ? 1 : 0) : stars);
  hud.boosters(st.boosters, game.hammerArmed);
}

let clock = 0;
let last = 0;

function frame(now) {
  if (game.halted) return;
  // keep the loop alive no matter what happens below
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(raw, 0.1);
  clock += dt;

  for (const k of input.keys()) handleKey(k);
  for (const ev of input.pointers()) handlePointer(ev);
  updateFlow(dt);
  if (bot && !game.halted) bot.tick(dt, { state: game.state, idle: idle(), st: game.st, tries: game.tries, levelIndex: game.levelIndex, levelKey: `${game.levelIndex}:${game.attempt}`, hint: game.hint });
  view.update(dt, clock);
  updateHud();
  gd.setContext({ gems: view.gemCount, particles: fx.shards.length, popups: hud.popups });
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────── title board

function showcase() {
  const st = createLevel(LEVELS[0], createRng(4242));
  placeSpecial(st, 'prism', 3, 3);
  placeSpecial(st, 'bomb', 5, 5);
  placeSpecial(st, 'striped_row', 2, 6);
  placeSpecial(st, 'striped_col', 6, 1);
  for (const c of [1, 2, 5, 6]) st.stones[7][c] = 1;
  game.st = null;
  view.build(st);
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

function nextFrames(ms) {
  return new Promise((resolve) => {
    const out = [];
    let prev = performance.now();
    const t0 = prev;
    const tick = (t) => {
      out.push(t - prev);
      prev = t;
      if (t - t0 < ms) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  });
}

async function waitIdle(ms = 5000) {
  const t0 = performance.now();
  while (!idle() && performance.now() - t0 < ms) await new Promise((r) => requestAnimationFrame(r));
  return idle();
}

function ensurePlaying() {
  if (game.state === 'title') startRun();
  if (game.state === 'paused') resume();
  if (game.state === 'intro') {
    game.state = 'playing';
    hud.hideBanner();
    armHint();
  }
  return game.state === 'playing';
}

const agentApi = {
  getState() {
    const st = game.st;
    const info = renderer.info;
    const base = { ok: true, version: GAME_VERSION, state: game.state, paused: game.state === 'paused' };
    if (!st) return { ...base, level: null };
    const p = goalProgress(st);
    return {
      ...base,
      level: st.def.id,
      level_name: st.def.name,
      goal: { type: st.def.goal.type, have: p.have, need: p.need, text: st.def.blurb },
      moves_left: st.movesLeft,
      score: st.score,
      stars_now: starsFor(st),
      tries_left: game.tries,
      busy: !idle(),
      board: gridToText(st.grid),
      board_legend: 'R O Y G B P = ruby amber topaz emerald sapphire amethyst; lower case = striped; * = bomb; @ = prism; W = crown; space = gap',
      stones_left: stonesLeft(st),
      crowns_collected: st.crowns,
      boosters: { ...st.boosters },
      moves_available: listMoves(st.grid).length,
      hint: game.hint,
      hint_timer_armed: !!hintTimer,
      renderer: { draw_calls: info.render.calls, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null },
      fx: { shards: fx.shards.length, shards_live: fx.shards.filter((s) => !s.done).length, glints: fx.glints.length },
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  loadLevel(id) {
    const index = levelIndex(id);
    if (index < 0) return { ok: false, error: `unknown level ${id}` };
    if (game.state === 'title' || game.halted) totalsReset();
    beginLevel(index, true);
    return { ok: true, level: id, state: game.state, goal: game.st.def.blurb, moves: game.st.movesLeft };
  },
  async makeSpecial(kind, row, col) {
    if (!ensurePlaying()) return { ok: false, error: `can only place specials while playing (state: ${game.state})` };
    if (!(await waitIdle())) return { ok: false, error: 'the board is still resolving a move' };
    const info = placeSpecial(game.st, kind, row, col);
    if (!info) return { ok: false, error: `no gem at row ${row}, col ${col} (gaps and crowns can't hold a special)` };
    view.placeSpecial(info);
    clearHint();
    armHint();
    return { ok: true, placed: { kind, row, col, cell: info.cell }, board: gridToText(game.st.grid) };
  },
  async cascade() {
    if (!ensurePlaying()) return { ok: false, error: `not playing (state: ${game.state})` };
    if (!(await waitIdle())) return { ok: false, error: 'the board is still resolving a move' };
    const st = game.st;
    const scored = listMoves(st.grid).map((m) => ({ m, ...evaluateMove(st, m) }));
    let pick = scored.filter((s) => s.specials >= 2).sort((a, b) => b.cleared - a.cleared)[0];
    let made = null;
    if (!pick || pick.cleared < 20) {
      // build the biggest combo there is: a prism next to a striped gem of the commonest colour
      const n = [0, 0, 0, 0, 0, 0];
      for (const row of st.grid) for (const cell of row) if (isGem(cell)) n[cell.kind]++;
      const k = n.indexOf(Math.max(...n));
      let a = null;
      let b = null;
      for (let r = 0; r < ROWS && !a; r++) {
        for (let c = 0; c < COLS && !a; c++) {
          const cell = st.grid[r][c];
          if (!isGem(cell) || cell.kind !== k) continue;
          for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
            const r2 = r + dr;
            const c2 = c + dc;
            if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS || !isGem(st.grid[r2][c2])) continue;
            a = [r, c];
            b = [r2, c2];
            break;
          }
        }
      }
      if (!a) return { ok: false, error: 'no place for a combo on this board' };
      view.placeSpecial(placeSpecial(st, 'striped_row', ...a));
      view.placeSpecial(placeSpecial(st, 'prism', ...b));
      made = { striped: a, prism: b, colour: k };
      pick = { m: [b, a] };
      await nextFrames(300);
    }
    const geoBefore = renderer.info.memory.geometries;
    const shardsBefore = fx.shards.length;
    const res = trySwap(pick.m[0], pick.m[1]);
    if (!res.ok) return { ok: false, error: res.reason || 'swap refused' };
    const firstClear = res.phases.find((p) => p.type === 'clear');
    const frames = await nextFrames(1200);
    const worst = Math.max(...frames);
    return {
      ok: true,
      swapped: pick.m,
      made_combo: made,
      cleared_first_step: firstClear ? firstClear.cleared.length : 0,
      cleared_total: res.phases.filter((p) => p.type === 'clear').reduce((a, p) => a + p.cleared.length, 0),
      cascade_steps: res.phases.filter((p) => p.type === 'clear').length,
      shards_spawned: fx.shards.length - shardsBefore,
      shards_total: fx.shards.length,
      geometries_before: geoBefore,
      geometries_after: renderer.info.memory.geometries,
      worst_frame_ms: Math.round(worst * 10) / 10,
      frames_over_50ms: frames.filter((f) => f > 50).length,
      note: 'the combo went through the same trySwap() → playSwap() → clear path as a player move (it used a move)',
    };
  },
  forceHint({ viaTimer = false } = {}) {
    if (!game.st || (game.state !== 'playing' && game.state !== 'paused' && game.state !== 'intro')) return { ok: false, error: `no level in play (state: ${game.state})` };
    const moves = listMoves(game.st.grid);
    if (viaTimer) {
      if (!ensurePlaying()) return { ok: false, error: 'not playing' };
      clearHint();
      hintTimer = setTimeout(showHint, 0);
      return { ok: true, note: 'showHint() runs on the idle-hint timer path right now, exactly like the 5 s timer (an error there is unhandled and reaches Glitchless)', moves_available: moves.length, first_move: moves[0] || null };
    }
    try {
      const h = findHint(game.st.grid);
      return { ok: true, threw: false, hint: h, moves_available: moves.length, first_move: moves[0] || null };
    } catch (err) {
      return { ok: true, threw: true, error: `${err.name}: ${err.message}`, at: String(err.stack || '').split('\n')[1]?.trim() || null, moves_available: moves.length, first_move: moves[0] || null };
    }
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.gemfall = {
  version: GAME_VERSION,
  game,
  renderer,
  scene,
  camera,
  view,
  bot,
  api: agentApi,
  halted: false,
  cellToScreen,
  get state() {
    return game.state;
  },
  get level() {
    return game.st?.def.id ?? null;
  },
  get info() {
    const i = renderer.info;
    return { calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, shards: fx.shards.length };
  },
};

async function boot() {
  bindPointer(canvas);
  hud.bind();
  hud.titleGems();
  hud.footer(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  try {
    await Promise.race([document.fonts?.load('700 64px "Fredoka"'), new Promise((r) => setTimeout(r, 900))]);
  } catch {
    /* fonts are optional */
  }
  showcase();
  // compile every material up front (shards included) so play never waits on a shader
  const warm = fx.warmup();
  const extras = [{ kind: 'crown', special: null }, { kind: 0, special: 'bomb' }, { kind: 1, special: 'row' }, { kind: 'prism', special: null }].map((cell) => kit.make(cell));
  extras.forEach((g) => view.group.add(g));
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  for (const o of hidden) o.visible = false;
  // take them out but don't dispose(): three.js frees a shader program when its last material is disposed
  for (const m of warm) m.removeFromParent();
  extras.forEach((g) => kit.release(g));

  await initTelemetry({ renderer, scene, camera, THREE });
  if (gd.enabled) registerAgentTools(gd, agentApi);
  hud.footer(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless: press ` for the overlay' : 'telemetry off'}`);

  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
