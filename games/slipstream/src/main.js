// Slipstream — a small Three.js arcade racer (and a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { TRACKS } from './tracks.js';
import { buildTrackGeom } from './track-geom.js';
import { THEMES, CAR_COLORS } from './theme.js';
import { createEnvironment, buildTrack, unloadTrack } from './world.js';
import { createCarMesh, animateCar, REAR_WHEELS } from './car.js';
import { CAR, STEP, createCar, speedOf } from './physics.js';
import { createRace, POINTS } from './race.js';
import { createDriver } from './driver.js';
import { createSkids } from './skids.js';
import { createFx } from './fx.js';
import { createCameraRig } from './camera.js';
import { hud, ordinal } from './hud.js';
import { keyboard } from './input.js';
import { sfx } from './audio.js';
import { createRng } from './rng.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const COUNT_STEP = 0.6; // 3 · 2 · 1 · GO!
const FINISH_BANNER = 1.3;
const OVERTAKE_HOLD = 0.5; // a position must hold this long to count

const RIVALS = [
  { id: 'nova', name: 'NOVA', skill: 0.9, power: 0.985 },
  { id: 'verde', name: 'VERDE', skill: 0.75, power: 0.965 },
  { id: 'mako', name: 'MAKO', skill: 0.6, power: 0.95 },
];

// ─────────────────────────────────────────────────────────────── renderer / scene

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 1500);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const env = createEnvironment(scene);
const skids = createSkids(scene);
const fx = createFx(scene);
const rig = createCameraRig(camera);

// cars live for the whole session; races reuse them
const cars = [
  ...RIVALS.map((r) => createCar(r.id, { name: r.name, color: CAR_COLORS[r.id], power: r.power })),
  createCar('you', { name: 'YOU', color: CAR_COLORS.you, isPlayer: true }),
];
const player = cars[cars.length - 1];
const carMeshes = cars.map((car) => {
  const mesh = createCarMesh(car.color);
  mesh.name = `car:${car.id}`;
  scene.add(mesh);
  return mesh;
});
const playerMesh = carMeshes[carMeshes.length - 1];

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | loading | title | countdown | racing | finished | results | champion | paused
  pausedFrom: null,
  trackIndex: params.level - 1,
  track: null,
  geom: null,
  world: null,
  race: null,
  cars,
  player,
  drivers: [],
  cooldown: null, // drives the player's car after the finish line
  countT: 0,
  countShown: -1,
  finishT: 0,
  raceSerial: 0,
  results: null,
  points: Object.fromEntries(cars.map((c) => [c.id, [null, null, null]])),
  reportedPos: cars.length,
  posBetterT: 0,
  posWorseT: 0,
  hintT: 0,
  resetCool: 0,
  halted: false,
  mapsCaptured: new Set(),
};

const geoms = new Map();
function geomFor(def) {
  if (!geoms.has(def.id)) geoms.set(def.id, buildTrackGeom(def));
  return geoms.get(def.id);
}

const bot = params.autoplay
  ? createAutoplay({
      skill: params.skill,
      seed: params.seed,
      onRageQuit: () => {
        gd.levelFail(game.track.id, { cause: 'quit' });
        halt('RAGE QUIT', 'Nope. Done.', `The bot wrecked ${player.wrecks}× on ${game.track.name} and closed the tab.`);
      },
      onFinished: () => {
        const standing = championship();
        const pos = standing.findIndex((r) => r.me) + 1;
        halt('AUTOPLAY', 'Run over', `The bot raced all three tracks and finished ${pos}${ordinal(pos)} in the championship with ${standing[pos - 1].total} pts, then closed the tab.`);
      },
    })
  : null;

// ─────────────────────────────────────────────────────────────── race flow

/**
 * Swap to a track. The meshes are built right away; shaders compile in the background (no frame
 * stalls on a new track's materials), then `then()` runs: countdown, title…
 */
let loadSerial = 0;
function loadTrack(index, then) {
  // the old track's meshes go; the cars stay
  // GLITCHLESS-DEMO: skid-mark leak — unloadTrack() frees the track group only; the skid marks were
  // added to the scene root (see addSkidMark() in skids.js), so they survive every restart and race
  if (game.world) unloadTrack(game.world, scene);
  const def = TRACKS[index];
  const g = geomFor(def);
  const theme = THEMES[def.theme];
  game.trackIndex = index;
  game.track = def;
  game.geom = g;
  env.applyTheme(theme, renderer);
  game.world = buildTrack(scene, g, theme);
  game.raceSerial++;
  game.race = createRace(g, cars, { laps: def.laps, onEvent });
  game.drivers = RIVALS.map((r, k) => createDriver({ skill: r.skill, rng: createRng((params.seed * 31 + game.raceSerial * 7 + k * 101) >>> 0) }));
  game.cooldown = createDriver({ skill: 0.85, rng: createRng(game.raceSerial) });
  for (const car of cars) skids.cut(car);
  game.results = null;
  game.reportedPos = cars.length;
  game.posBetterT = game.posWorseT = 0;
  hud.track(index + 1, TRACKS.length, def.name, def.laps);
  hud.mapTrack(g);
  for (let k = 0; k < cars.length; k++) animateCar(carMeshes[k], cars[k], 0, 0);
  rig.snap(player);
  env.follow(player.x, player.z);

  game.state = 'loading';
  const serial = ++loadSerial;
  return new Promise((resolve) => {
    const ready = () => {
      if (serial !== loadSerial) return resolve(false); // another load started meanwhile
      if (!game.mapsCaptured.has(def.id)) {
        game.mapsCaptured.add(def.id);
        const e = g.extent;
        const m = 24;
        gd.captureMap(def.id, {
          axis: 'xz',
          bounds: { min: [Math.floor(e.minX - m), Math.floor(e.minZ - m)], max: [Math.ceil(e.maxX + m), Math.ceil(e.maxZ + m)] },
          exclude: [...carMeshes, env.sky, ...game.world.roofs],
        });
      }
      then?.();
      resolve(true);
    };
    renderer.compileAsync(scene, camera).then(ready, ready);
  });
}

function toTitle() {
  game.state = 'title';
  hud.show(false);
  hud.screen('title');
}

function startCountdown() {
  game.state = 'countdown';
  game.countT = 0;
  game.countShown = -1;
  game.hintT = 0;
  keyboard.clearPresses();
  hud.screen(null);
  hud.show(true);
  gd.levelStart(game.track.id);
  bot?.onRaceStart();
}

function restartRace() {
  gd.levelFail(game.track.id, { cause: 'restart' });
  hud.screen(null);
  loadTrack(game.trackIndex, startCountdown);
  hud.toast('RESTART', '', 900);
}

function quitRace() {
  gd.levelFail(game.track.id, { cause: 'quit' });
  hud.screen(null);
  loadTrack(game.trackIndex, toTitle);
}

function playerFinished(position) {
  const race = game.race;
  gd.track('race_finish', { position });
  gd.levelComplete(game.track.id, { durationS: Math.round(race.t * 100) / 100, score: POINTS[position - 1] });
  const results = race.results();
  const raceIdx = game.trackIndex;
  for (const r of results) game.points[r.car.id][raceIdx] = POINTS[r.position - 1];
  game.results = results;
  game.state = 'finished';
  game.finishT = 0;
  game.cooldown.reset();
  hud.toast(position === 1 ? 'YOU WIN!' : `FINISHED ${position}${ordinal(position)}`, position === 1 ? 'gold' : 'coral', 1800);
  sfx.finish();
}

function showResults() {
  game.state = 'results';
  const results = game.results;
  const me = results.find((r) => r.car.isPlayer);
  const last = game.trackIndex >= TRACKS.length - 1;
  hud.results({
    raceNum: game.trackIndex + 1,
    trackName: game.track.name,
    title: me.position === 1 ? 'You win!' : `${me.position}${ordinal(me.position)} place`,
    rows: results.map((r) => ({
      position: r.position,
      name: r.car.name,
      color: r.car.color,
      me: r.car.isPlayer,
      time: r.estimated ? r.time - me.time : r.time,
      estimated: r.estimated,
      bestLap: r.bestLap,
      points: POINTS[r.position - 1],
    })),
    next: last ? 'Press <kbd>Space</kbd> for the championship standings' : `Press <kbd>Space</kbd> for race ${game.trackIndex + 2}: ${TRACKS[game.trackIndex + 1].name}`,
  });
  hud.screen('results');
  hud.show(false);
  bot?.resetMenu();
}

function championship() {
  return cars
    .map((car) => {
      const perRace = game.points[car.id];
      return { name: car.name, color: car.color, me: car.isPlayer, perRace, total: perRace.reduce((a, b) => a + (b || 0), 0), last: perRace[2] || 0 };
    })
    .sort((a, b) => b.total - a.total || b.last - a.last);
}

function showChampion() {
  game.state = 'champion';
  const rows = championship();
  const me = rows.findIndex((r) => r.me) + 1;
  hud.champion(me === 1 ? 'Champion!' : `${me}${ordinal(me)} overall`, rows);
  hud.screen('champion');
  bot?.resetMenu(1.4);
}

function nextRace() {
  if (game.trackIndex >= TRACKS.length - 1) return showChampion();
  loadTrack(game.trackIndex + 1, startCountdown);
}

function newChampionship() {
  for (const id of Object.keys(game.points)) game.points[id] = [null, null, null];
  loadTrack(0, startCountdown);
}

function halt(ribbon, title, text) {
  if (game.halted) return;
  game.halted = true;
  sfx.engine(0, false);
  hud.show(false);
  hud.halted(ribbon, title, text);
  hud.screen('halted');
  window.slipstream.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  // "close the tab": let the SDK flush and send session_end
  setTimeout(endSession, 1000);
}

// ─────────────────────────────────────────────────────────────── race events → telemetry, fx, HUD

function onEvent(type, d) {
  const car = d.car;
  // the player's moments count until the finish line; the cool-down lap after it doesn't
  const me = car?.isPlayer && (!car.finished || type === 'finish');
  switch (type) {
    case 'wreck': {
      fx.wreck(car.x, car.z);
      skids.cut(car);
      if (!me) break;
      gd.death({ x: +car.x.toFixed(2), y: 0, z: +car.z.toFixed(2), cause: d.cause });
      gd.track('wreck', { section: d.section, cause: d.cause });
      hud.toast('WRECKED!', 'coral', 1300);
      sfx.wreck();
      rig.shake(1.1);
      bot?.onWreck(game);
      break;
    }
    case 'respawn':
    case 'reset':
      skids.cut(car);
      if (me) rig.snap(car);
      if (me && type === 'reset') {
        gd.track('reset', { section: d.section });
        game.resetCool = 1;
      }
      break;
    case 'hit': {
      const s = Math.sign(car.lat) || 1;
      const i = car.idx;
      fx.sparks(car.x + game.geom.nx[i] * s * 1.0, car.z + game.geom.nz[i] * s * 1.0, -game.geom.nx[i] * s, -game.geom.nz[i] * s, Math.min(24, 4 + Math.round(d.impact * 1.2)));
      if (me) {
        sfx.hit();
        rig.shake(Math.min(0.6, d.impact / 25));
        bot?.onHit(game, d);
      }
      break;
    }
    case 'bump':
      fx.sparks((d.a.x + d.b.x) / 2, (d.a.z + d.b.z) / 2, 0, 0, Math.min(12, Math.round(d.closing)));
      if (d.a.isPlayer || d.b.isPlayer) sfx.hit();
      break;
    case 'boost':
      if (me) {
        gd.track('boost', { section: d.section });
        sfx.boost();
        hud.toast('BOOST!', 'cyan', 800);
      }
      break;
    case 'lap':
      if (!me) break;
      gd.track('lap', { lap: d.lap, time_s: Math.round(d.time) });
      if (d.lap < game.race.laps) {
        sfx.lap();
        hud.toast(d.lap === game.race.laps - 1 ? 'FINAL LAP' : `LAP ${d.lap + 1}`, d.lap === game.race.laps - 1 ? 'gold' : '', 1300);
      }
      break;
    case 'finish':
      if (me) playerFinished(d.position);
      break;
  }
}

// ─────────────────────────────────────────────────────────────── simulation

const inputs = cars.map(() => ({ throttle: 0, brake: 0, steer: 0, handbrake: false }));

function fixedStep(dt) {
  const race = game.race;
  if (!race.started || game.halted) return;
  const g = game.geom;

  for (let k = 0; k < cars.length - 1; k++) inputs[k] = game.drivers[k].step(cars[k], g, dt);
  let wantReset = false;
  if (game.state === 'racing' && !player.finished) {
    if (bot) {
      const b = bot.step(game);
      inputs[cars.length - 1] = b;
      wantReset = b.reset;
    } else inputs[cars.length - 1] = keyboard.state();
  } else {
    inputs[cars.length - 1] = game.cooldown.step(player, g, dt);
  }
  if (wantReset && game.resetCool <= 0) race.reset(player);
  game.resetCool = Math.max(0, game.resetCool - dt);

  race.step(inputs, dt);

  for (const car of cars) {
    skids.step(car);
    if (car.wreckT > 0) continue;
    if ((car.handbrake || Math.abs(car.vl) > 6) && Math.random() < 0.2) {
      const c = Math.cos(car.h);
      const s = Math.sin(car.h);
      const [lx, lz] = REAR_WHEELS[Math.random() < 0.5 ? 0 : 1];
      fx.smoke(car.x + lx * c + lz * s, car.z - lx * s + lz * c, 1);
    }
    if (car.boostT > 0 && Math.random() < 0.7) fx.boost(car.x - Math.sin(car.h) * 2.4, car.z - Math.cos(car.h) * 2.4, -Math.sin(car.h), -Math.cos(car.h));
  }

  // overtakes: a better position that holds for a moment
  if (game.state === 'racing' && !player.finished) {
    const pos = race.positionOf(player);
    if (pos < game.reportedPos) {
      game.posWorseT = 0;
      if ((game.posBetterT += dt) >= OVERTAKE_HOLD) {
        game.reportedPos = pos;
        game.posBetterT = 0;
        gd.track('overtake', { section: race.sectionOf(player) });
        sfx.overtake();
      }
    } else if (pos > game.reportedPos) {
      game.posBetterT = 0;
      if ((game.posWorseT += dt) >= OVERTAKE_HOLD) {
        game.reportedPos = pos;
        game.posWorseT = 0;
      }
    } else game.posBetterT = game.posWorseT = 0;
  }
}

// ─────────────────────────────────────────────────────────────── per-frame

let clock = 0;

function handleMenus(dt) {
  if (keyboard.consume('mute')) hud.toast(sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', 900);
  const s = game.state;
  const confirm = () => keyboard.consume('confirm') || (bot ? bot.menu(s, dt) : false);
  if (s === 'title') {
    if (confirm()) startCountdown();
  } else if (s === 'countdown' || s === 'racing') {
    if (keyboard.consume('pause')) {
      game.pausedFrom = s;
      game.state = 'paused';
      hud.screen('pause');
      sfx.engine(0, false);
      return;
    }
    if (s === 'racing' && keyboard.consume('reset') && game.resetCool <= 0 && !player.finished) game.race.reset(player);
    const want = bot?.wants(dt);
    if (want === 'restart') restartRace();
    else if (want === 'quit') bot.quit('ragequit');
  } else if (s === 'paused') {
    if (keyboard.consume('pause') || keyboard.consume('confirm')) {
      game.state = game.pausedFrom;
      hud.screen(null);
    } else if (keyboard.consume('reset')) {
      hud.screen(null);
      restartRace();
    } else if (keyboard.consume('quit')) quitRace();
  } else if (s === 'finished') {
    game.finishT += dt;
    if (game.finishT >= FINISH_BANNER) showResults();
  } else if (s === 'results') {
    if (confirm()) nextRace();
  } else if (s === 'champion') {
    if (confirm()) newChampionship();
  }
  // R and Q only mean something in some states, and Space is the handbrake while driving: drop
  // stray presses so they don't skip the next screen
  keyboard.consume('reset');
  keyboard.consume('quit');
  keyboard.consume('handbrake');
  if (['countdown', 'racing', 'finished'].includes(game.state)) keyboard.consume('confirm');
}

function updateCountdown(dt) {
  game.countT += dt;
  const step = Math.floor(game.countT / COUNT_STEP);
  if (step !== game.countShown && step <= 3) {
    game.countShown = step;
    hud.countdown(step < 3 ? String(3 - step) : 'GO!');
    if (step < 3) sfx.beep();
    else {
      sfx.go();
      game.race.started = true;
      game.state = 'racing';
    }
  }
}

function updateVisuals(dt) {
  const race = game.race;
  for (let k = 0; k < cars.length; k++) animateCar(carMeshes[k], cars[k], dt, clock);
  skids.update(dt);
  fx.update(dt);
  game.world.update(dt, clock);
  env.follow(player.x, player.z);

  const s = game.state === 'paused' ? game.pausedFrom : game.state;
  if (s === 'title') {
    const g = game.geom;
    rig.title(dt, g.x[g.N - 12], g.z[g.N - 12], clock);
  } else if (player.wreckT > 0) rig.update(dt, player, 'wreck', playerMesh.position);
  else if (s === 'countdown' || s === 'racing') rig.update(dt, player, 'chase');
  else rig.update(dt, player, 'orbit');

  if (s === 'countdown' || s === 'racing') {
    hud.times(Math.max(0, race.t - player.lapStartT), player.bestLap, player.lastLap);
    hud.position(race.positionOf(player));
    hud.lap(player.lapsDone + 1, race.laps);
    hud.speed(player.wreckT > 0 ? 0 : speedOf(player), player.boostT / CAR.BOOST_TIME);
    hud.mapCars(cars, player.id);
    game.hintT += dt;
    hud.hint(!bot && game.hintT < 10);
  } else hud.hint(false);
  sfx.engine(speedOf(player), game.state === 'racing' || game.state === 'countdown');
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

  handleMenus(dt);
  if (game.state === 'countdown') updateCountdown(dt);
  const running = ['racing', 'finished', 'results'].includes(game.state);
  if (running) {
    acc = Math.min(acc + raw, 0.25);
    while (acc >= STEP) {
      acc -= STEP;
      fixedStep(STEP);
      if (game.halted || !['racing', 'finished', 'results'].includes(game.state)) break;
    }
  } else acc = 0;
  if (game.halted) return;

  const loading = game.state === 'loading'; // a new track's shaders are compiling: keep the last frame up
  if (!loading) updateVisuals(dt);
  gd.setPosition(playerMesh.position);
  gd.setContext({ skid_marks: skids.count, rivals: cars.length - 1, particles: fx.count });
  if (!loading) renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

function rendererInfo() {
  const r = renderer.info;
  return { draw_calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
}

/** section ids in driving order from the start line */
function sectionIds() {
  const secs = game.geom.sections.map((s) => s.id);
  return game.geom.sections[0].start > 0 ? [secs[secs.length - 1], ...secs.slice(0, -1)] : secs;
}

const agentApi = {
  getState() {
    const race = game.race;
    const pos = race.positionOf(player);
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      paused: game.state === 'paused',
      track: game.track.id,
      track_name: game.track.name,
      sections: sectionIds(),
      lap: Math.min(player.lapsDone + 1, race.laps),
      laps: race.laps,
      position: pos,
      race_time_s: +race.t.toFixed(2),
      best_lap_s: player.bestLap ? +player.bestLap.toFixed(2) : null,
      player: {
        x: +player.x.toFixed(2),
        z: +player.z.toFixed(2),
        speed_kmh: Math.round(speedOf(player) * 3.6),
        heading_deg: Math.round((player.h * 180) / Math.PI) % 360,
        section: race.sectionOf(player),
        lateral_m: +player.lat.toFixed(2),
        boosting: player.boostT > 0,
        wrecked: player.wreckT > 0,
        wrecks: player.wrecks,
      },
      rivals: cars.filter((c) => !c.isPlayer).map((c) => ({ name: c.name, position: race.positionOf(c), lap: Math.min(c.lapsDone + 1, race.laps), section: race.sectionOf(c), wrecks: c.wrecks })),
      skid_marks: skids.count,
      particles: fx.count,
      renderer: rendererInfo(),
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  async loadTrack(id) {
    const index = TRACKS.findIndex((t) => t.id === id);
    if (index < 0) return { ok: false, error: `unknown track ${id}` };
    hud.screen(null);
    await loadTrack(index, startCountdown);
    return { ok: true, track: game.track.id, state: game.state };
  },
  teleport(sectionId) {
    const g = game.geom;
    const sec = g.sections.find((s) => s.id === sectionId);
    if (!sec) return { ok: false, error: `no section ${sectionId} on ${game.track.id}; sections: ${sectionIds().join(', ')}` };
    if (game.state === 'title') startCountdown();
    if (game.state === 'countdown') {
      game.race.started = true;
      game.state = 'racing';
    }
    if (game.state !== 'racing' && game.state !== 'paused') return { ok: false, error: `cannot teleport in state ${game.state}` };
    const i = (sec.start + 2) % g.N;
    const s = i * g.ds;
    player.wreckT = 0;
    player.idx = i;
    player.dist = player.lapsDone * g.length + s - (s > 0.75 * g.length ? g.length : 0);
    player.x = g.x[i];
    player.z = g.z[i];
    player.h = Math.atan2(g.tx[i], g.tz[i]);
    player.vx = player.vz = player.vf = player.vl = player.steer = player.boostT = 0;
    player.ghostT = 1;
    skids.cut(player);
    rig.snap(player);
    return { ok: true, track: game.track.id, section: sec.id, x: +player.x.toFixed(2), z: +player.z.toFixed(2), state: game.state };
  },
  spawnSkids(count) {
    const g = game.geom;
    const n = Math.max(1, Math.min(5000, Math.floor(count)));
    // lay them along the road behind the player, through the same addSkidMark() the cars use
    for (let k = 0; k < n; k++) {
      const i = (player.idx - Math.floor(k / 2) + g.N * 10) % g.N;
      const j = (i + 1) % g.N;
      const off = k % 2 ? 0.98 : -0.98;
      skids.addSkidMark(g.x[i] + g.nx[i] * off, g.z[i] + g.nz[i] * off, g.x[j] + g.nx[j] * off, g.z[j] + g.nz[j] * off);
    }
    return { ok: true, added: n, skid_marks: skids.count, renderer: rendererInfo() };
  },
  setPaused(paused) {
    if (paused && (game.state === 'racing' || game.state === 'countdown')) {
      game.pausedFrom = game.state;
      game.state = 'paused';
      hud.screen('pause');
    } else if (!paused && game.state === 'paused') {
      game.state = game.pausedFrom;
      hud.screen(null);
    }
    return { ok: true, state: game.state, paused: game.state === 'paused' };
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.slipstream = {
  version: GAME_VERSION,
  game,
  renderer,
  scene,
  bot,
  api: agentApi,
  halted: false,
  get state() {
    return game.state;
  },
  get track() {
    return game.track?.id;
  },
  get info() {
    return { ...rendererInfo(), programs: renderer.info.programs?.length, skid_marks: skids.count, particles: fx.count };
  },
};

async function boot() {
  hud.footer(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  try {
    await Promise.race([Promise.all([document.fonts?.load('400 64px "Russo One"'), document.fonts?.load('700 20px "Chakra Petch"')]), new Promise((r) => setTimeout(r, 900))]);
  } catch {
    /* fonts are optional */
  }
  await initTelemetry({ renderer, scene, camera, THREE });
  if (gd.enabled) registerAgentTools(gd, agentApi);
  hud.footer(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  loadTrack(game.trackIndex, toTitle);
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
