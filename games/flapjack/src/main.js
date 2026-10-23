// Flapjack — a small one-button flappy game in Three.js (a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { LEVEL_ID, START, GROUND_Y, BIOME_NAMES, MEDALS, PIPE_W, pipeAt, pipeX, pipeNear, pipesPassed, biomeOfScore, medalFor, mapBounds } from './course.js';
import { PHYS, createBird, stepBird, collide } from './physics.js';
import { createPipes, buildMapStrip } from './pipes.js';
import { createScenery } from './scenery.js';
import { createBirdModel } from './bird.js';
import { createFx } from './fx.js';
import { hud } from './hud.js';
import { input, bindPointer } from './input.js';
import { sfx } from './audio.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const STEP = PHYS.STEP;
const DYING_TIME = 0.8; // the hit → the game-over card
const CARD_READY = 0.5; // the card takes input after this long (no accidental retries)
const CAM_LEAD = 5; // the camera looks this far ahead of the bird
const TITLE_LEAD = 9.5; // on the title the bird sits further left, clear of the logo
const CAM_Y = 6.3;
const CAM_Z = 24;
const FOV = 38;
const round2 = (v) => Math.round(v * 100) / 100;

// ─────────────────────────────────────────────────────────────── renderer / scene

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.5, 420);
camera.position.set(START.x + TITLE_LEAD, CAM_Y, CAM_Z);

const halfH = CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
let halfW = halfH * camera.aspect;

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  halfW = halfH * camera.aspect;
});

const scenery = createScenery(scene, renderer);
const pipes = createPipes(scene);
const birdModel = createBirdModel();
scene.add(birdModel.root);
const fx = createFx(scene);

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | playing | paused | dying | gameover | halted
  bird: createBird(),
  run: null, // { score, biome, medal, t, fromPipe, newBest }
  best: 0, // this session
  runs: 0,
  deaths: { pipe: 0, ground: 0, ceiling: 0 },
  lastCause: null,
  pendingFlap: false,
  dyingT: 0,
  landed: false,
  cardT: 0,
  cardReady: false,
  shake: 0,
  hintT: 0,
  halted: false,
};

const bot = params.autoplay ? createAutoplay({ skill: params.skill, seed: params.seed }) : null;

// ─────────────────────────────────────────────────────────────── runs

/** start a run at pipe 1, or (agent tool) just before pipe `fromPipe` */
function startRun(fromPipe = 1) {
  const s = game.state;
  if (s === 'playing' || s === 'paused') gd.levelFail(LEVEL_ID, { cause: 'restart' }); // only the agent tools can do this
  if (s === 'gameover' || s === 'dying') gd.track('retry', { after_s: Math.min(30, Math.floor(s === 'gameover' ? game.cardT : 0)) });

  const skip = fromPipe > 1;
  const score = skip ? fromPipe - 2 : 0;
  const prev = skip ? pipeAt(fromPipe - 1) : null;
  game.bird = skip ? createBird(prev.x - PIPE_W / 2 - 2.2, prev.y) : createBird();
  game.run = { score, biome: biomeOfScore(score), medal: medalFor(score), t: 0, fromPipe, newBest: false };
  game.runs++;
  game.state = 'playing';
  game.pendingFlap = true; // the press that starts a run is its first flap
  game.landed = false;
  game.hintT = 0;

  // GLITCHLESS-DEMO: pipes that are never recycled. A retry only resets the bird (above) and rewinds the
  // pipe index; every earlier run's pipe meshes stay in the scene (see createPipes in pipes.js).
  pipes.rewind(skip ? Math.max(1, fromPipe - 3) : 1);
  scenery.setBiome(game.run.biome, true);
  birdModel.reset();
  input.clear();
  hud.screen(null);
  hud.show(true);
  hud.score(score);
  hud.biome(game.run.biome);
  hud.best(game.best);
  if (s === 'gameover' || s === 'dying') {
    hud.flash(0.55, 260);
    sfx.swoosh();
  }
  gd.levelStart(LEVEL_ID);
  bot?.onRunStart();
}

function scored() {
  const run = game.run;
  const b = game.bird;
  run.score++;
  hud.score(run.score, true);
  sfx.point();
  fx.sparkle(b.x - 0.4, b.y + 0.4);
  const medal = MEDALS.find((m) => m.at === run.score);
  if (medal) {
    run.medal = medal.kind;
    gd.track('medal', { kind: medal.kind });
    sfx.medal();
    fx.burst(b.x, b.y, { bronze: 0xe0995a, silver: 0xeef2f6, gold: 0xffd84a, platinum: 0xb8f4ff }[medal.kind]);
  }
  const biome = biomeOfScore(run.score);
  const newBiome = biome !== run.biome;
  if (newBiome) {
    run.biome = biome;
    gd.track('biome', { name: biome });
    scenery.setBiome(biome);
    hud.biome(biome);
    sfx.biome();
  }
  if (medal) hud.toast(`${medal.kind.toUpperCase()} MEDAL`, newBiome ? `on to the ${BIOME_NAMES[biome]}` : '', MEDAL_COLORS[medal.kind], 1900);
  else if (newBiome) hud.toast(BIOME_NAMES[biome].toUpperCase(), 'a new sky', '#ffffff', 1600);
}

const MEDAL_COLORS = { bronze: '#f0b07a', silver: '#eef2f6', gold: '#ffd84a', platinum: '#b8f4ff' };

function die(cause) {
  const b = game.bird;
  const run = game.run;
  game.state = 'dying';
  game.dyingT = 0;
  game.landed = false;
  game.lastCause = cause;
  game.deaths[cause]++;
  run.newBest = game.runs > 1 && run.score > game.best; // beats this session's best so far
  gd.death({ x: round2(b.x), y: round2(b.y), z: 0, cause });
  gd.levelFail(LEVEL_ID, { cause });
  gd.track('run_end', { score: run.score, cause, biome: run.biome });
  if (run.newBest) gd.track('best_score', {});
  game.best = Math.max(game.best, run.score);
  b.vy = cause === 'ground' ? 0 : cause === 'ceiling' ? -2 : 4; // a little bonk upwards off a pipe
  birdModel.die();
  fx.feathers(b.x, b.y);
  sfx.hit();
  if (cause !== 'ground') sfx.fall();
  game.shake = 1;
  hud.flash(0.7, 300);
  bot?.onDeath({ score: run.score, cause });
}

function stepDying(dt) {
  const b = game.bird;
  game.dyingT += dt;
  if (!game.landed) {
    b.vy = Math.max(-PHYS.MAX_FALL, b.vy - PHYS.GRAVITY * dt);
    b.y += b.vy * dt;
    if (b.y - PHYS.RADIUS * 0.8 <= GROUND_Y) {
      b.y = GROUND_Y + PHYS.RADIUS * 0.8;
      b.vy = 0;
      game.landed = true;
      fx.dust(b.x, GROUND_Y + 0.1);
      game.shake = Math.max(game.shake, 0.4);
    }
  }
  if (game.dyingT >= DYING_TIME && game.state === 'dying') showGameOver();
}

function showGameOver() {
  const run = game.run;
  game.state = 'gameover';
  game.cardT = 0;
  game.cardReady = false;
  hud.show(false);
  hud.gameover({ score: run.score, best: game.best, newBest: run.newBest, medal: run.medal, cause: game.lastCause, pipe: run.score + 1, biome: run.biome });
  hud.screen('gameover');
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  hud.screen('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  input.clear();
  hud.screen(null);
}

function halt(ribbon, title, text) {
  game.halted = true;
  game.state = 'halted';
  hud.show(false);
  hud.halted(ribbon, title, text);
  hud.screen('halted');
  window.flapjack.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  setTimeout(() => endSession(), 1000);
}

function botQuits() {
  const medal = medalFor(game.best);
  halt('AUTOPLAY', 'Session over', `The bot played ${game.runs} ${game.runs === 1 ? 'run' : 'runs'} (best ${game.best}${medal ? `, a ${medal} medal` : ''}) and closed the tab.`);
}

// ─────────────────────────────────────────────────────────────── simulation

function fixedStep(dt) {
  const run = game.run;
  const b = game.bird;
  run.t += dt;
  let flap = game.pendingFlap;
  game.pendingFlap = false;
  if (bot) flap = bot.step(game, dt) || flap;
  else if (input.consume('flap')) flap = true;
  stepBird(b, flap, dt);
  if (flap) {
    birdModel.flap();
    fx.puff(b.x, b.y);
    sfx.flap();
  }
  const cause = collide(b);
  if (cause) return die(cause);
  const passed = pipesPassed(b.x);
  while (run.score < passed) scored();
}

// ─────────────────────────────────────────────────────────────── per-frame

let clock = 0;
let camX = START.x + TITLE_LEAD;
let camLead = TITLE_LEAD;

function handleMenus(dt) {
  if (input.consume('mute')) hud.toast(sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', '#ffffff', 900);
  const s = game.state;
  if (s === 'title') {
    if (input.consume('flap') || input.consume('confirm') || bot?.menu('title', dt) === 'press') startRun();
  } else if (s === 'playing') {
    if (input.consume('pause')) pause();
  } else if (s === 'paused') {
    if (input.consume('pause') || input.consume('confirm') || input.consume('flap')) resume();
  } else if (s === 'gameover') {
    game.cardT += dt;
    if (!game.cardReady && game.cardT >= CARD_READY) {
      game.cardReady = true;
      hud.retryReady(true);
    }
    if (bot) {
      const act = bot.menu('gameover', dt, game.cardReady);
      if (act === 'press') startRun();
      else if (act === 'quit') botQuits();
    } else if (!game.cardReady) input.clear(); // mashing after the hit doesn't skip the card
    else if (input.consume('flap') || input.consume('confirm')) startRun();
  } else input.consume('pause');
}

function updateVisuals(dt) {
  const b = game.bird;
  if (game.state === 'title' || game.state === 'boot') {
    birdModel.update(dt, { x: START.x, y: START.y + Math.sin(clock * 2.4) * 0.35, vy: 0, clock, idle: true });
    camLead = TITLE_LEAD;
  } else {
    birdModel.update(dt, { x: b.x, y: b.y, vy: b.vy, clock });
    camLead += (CAM_LEAD - camLead) * Math.min(1, dt * 2.5); // glide from the title framing into play
  }
  camX = (game.state === 'title' || game.state === 'boot' ? START.x : b.x) + camLead;
  game.shake = Math.max(0, game.shake - dt * 2.6);
  const sh = game.shake * game.shake * 0.35;
  camera.position.set(camX + (Math.random() - 0.5) * sh, CAM_Y + (Math.random() - 0.5) * sh, CAM_Z);

  pipes.update(camX, halfW);
  scenery.update(dt, camX);
  fx.update(dt);

  if (game.state === 'playing') {
    game.hintT += dt;
    hud.hint(!bot && game.runs === 1 && game.hintT < 6);
  } else hud.hint(false);
}

let worldCalls = 0;

function render() {
  renderer.render(scene, camera);
  worldCalls = renderer.info.render.calls;
}

let last = 0;
let acc = 0;

function frame(now) {
  if (game.halted) return;
  // keep the loop alive no matter what happens below
  requestAnimationFrame(frame);

  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(raw, 0.1);
  clock += dt;
  bot?.tick(Math.min(raw, 1));

  handleMenus(dt);
  if (game.state === 'playing') {
    acc = Math.min(acc + raw, 0.25);
    while (acc >= STEP) {
      acc -= STEP;
      fixedStep(STEP);
      if (game.state !== 'playing') break;
    }
  } else acc = 0;
  if (game.state === 'dying') stepDying(dt);

  updateVisuals(dt);
  gd.setPosition(birdModel.root.position);
  gd.setContext({ pipes: pipes.count, particles: fx.count });
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !bot) pause();
});

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

const nextFrames = (n) =>
  new Promise((resolve) => {
    let k = 0;
    const tick = () => (++k >= n || game.halted ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
    setTimeout(resolve, 2000); // a hidden tab gets no frames
  });

function rendererStats() {
  const i = renderer.info;
  return { draw_calls: worldCalls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? null };
}

const agentApi = {
  getState() {
    const b = game.bird;
    const run = game.run;
    const next = run ? pipeAt(run.score + 1) : pipeAt(1);
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      level: LEVEL_ID,
      run: run ? { score: run.score, next_pipe: run.score + 1, biome: run.biome, medal: run.medal, time_s: +run.t.toFixed(2), started_at_pipe: run.fromPipe } : null,
      bird: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), vy: +b.vy.toFixed(2) },
      next_pipe: { n: next.n, x: next.x, gap_centre: next.y, gap: next.gap, biome: next.biome },
      session: { runs: game.runs, best: game.best, deaths: { ...game.deaths }, last_cause: game.lastCause },
      pipes: { in_scene: pipes.count, on_screen: pipes.visible, spawn_index: pipes.course.next },
      particles: fx.count,
      renderer: rendererStats(),
      autoplay: bot ? { skill: params.skill, seed: params.seed, runs: bot.runs, max_runs: bot.maxRuns, quit_at_s: Math.round(bot.quitAt), elapsed_s: Math.round(bot.elapsed), halted: game.halted } : null,
    };
  },
  startRun() {
    if (game.halted) return { ok: false, error: 'the session is over (halted)' };
    startRun(1);
    return { ok: true, state: game.state, run: { score: game.run.score, biome: game.run.biome }, pipes_in_scene: pipes.count };
  },
  skipToPipe(n) {
    if (game.halted) return { ok: false, error: 'the session is over (halted)' };
    startRun(n);
    const b = game.bird;
    return { ok: true, state: game.state, score: game.run.score, bird: { x: +b.x.toFixed(2), y: +b.y.toFixed(2) }, next_pipe: pipeAt(game.run.score + 1), target_pipe: pipeAt(n) };
  },
  async spawnPipes(count) {
    if (game.halted) return { ok: false, error: 'the session is over (halted)' };
    const first = pipeNear(camX - halfW);
    const lastOn = pipeNear(camX + halfW);
    const span = Math.max(1, lastOn - first + 1);
    const before = { pipes: pipes.count, ...rendererStats() };
    for (let k = 0; k < count; k++) pipes.spawnPipe(first + (k % span));
    await nextFrames(3);
    const after = { pipes: pipes.count, ...rendererStats() };
    return {
      ok: true,
      spawned: count,
      at_pipes: [first, first + span - 1],
      pipes_in_scene: { before: before.pipes, after: after.pipes },
      geometries: { before: before.geometries, after: after.geometries },
      draw_calls: { before: before.draw_calls, after: after.draw_calls },
      note: 'new pipe pairs are never removed or disposed; every one on screen is drawn again, plus its shadow',
    };
  },
  setPaused(paused) {
    if (paused) pause();
    else resume();
    return { ok: true, state: game.state, paused: game.state === 'paused' };
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.flapjack = {
  version: GAME_VERSION,
  game,
  renderer,
  scene,
  camera,
  bot,
  api: agentApi,
  halted: false,
  get state() {
    return game.state;
  },
  get info() {
    const i = renderer.info;
    return { calls: worldCalls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, pipes: pipes.count, pipes_on_screen: pipes.visible, particles: fx.count };
  },
};

/** the heatmap background: the first 45 pipes and the ground, captured once, then thrown away */
function captureCourseMap() {
  const strip = buildMapStrip();
  scene.add(strip.group);
  gd.captureMap(LEVEL_ID, { axis: 'xy', bounds: mapBounds(), exclude: [scenery.root, birdModel.root, fx.mesh, ...pipes.course.pipes.map((p) => p.group)] });
  strip.dispose();
}

/** compile every material up front (all three biomes, the map strip; canvas and render target) */
async function warmUp() {
  const strip = buildMapStrip();
  scene.add(strip.group);
  scenery.showAll(true);
  const rt = new THREE.WebGLRenderTarget(4, 4);
  for (const target of [null, rt]) {
    renderer.setRenderTarget(target);
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      renderer.compile(scene, camera);
    }
  }
  renderer.setRenderTarget(null);
  rt.dispose();
  scenery.showAll(false);
  strip.dispose();
}

async function boot() {
  bindPointer(canvas);
  hud.footer(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  hud.biome('meadow');
  const fonts = Promise.race([document.fonts?.load('64px "Lilita One"'), new Promise((r) => setTimeout(r, 900))]).catch(() => {});
  await Promise.all([fonts, initTelemetry({ renderer, scene, camera, THREE }), warmUp()]);
  if (gd.enabled) registerAgentTools(gd, agentApi);
  else document.getElementById('hint-gd')?.remove();
  hud.footer(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  captureCourseMap();
  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
