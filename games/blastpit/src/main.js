// Blastpit! — a small first-person arena shooter in Three.js (a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { ROUNDS, TRIES_PER_ROUND } from './rounds.js';
import { buildArena, PLAYER_START, GATES } from './arena.js';
import { createPlayer, stepPlayer, PLAYER } from './player.js';
import { createEnemies } from './enemies.js';
import { createWeapons, WEAPONS, WEAPON_ORDER, AMMO_START, AMMO_MAX } from './weapons.js';
import { createViewmodel } from './viewmodel.js';
import { createFx } from './fx.js';
import { createPickups, PICKUP } from './pickups.js';
import { resolveCircle } from './collide.js';
import { hud } from './hud.js';
import { keyboard, bindMouse } from './input.js';
import { sfx } from './audio.js';
import { createRng } from './rng.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const STEP = 1 / 120;
const TELEGRAPH = 0.9;
const SWARM_TELEGRAPH = 1.4;
const DEAD_TIME = 2.4;
const INTERMISSION_TIME = 4.2;
const END_CARD_TIME = 2.6;
const CORPSE_SWEEP = 2; // s between clean-ups of dead bodies
const CORPSE_MIN = 1.2; // a body stays at least this long

// ─────────────────────────────────────────────────────────────── renderer / scene

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';

const arena = buildArena(scene);
const fx = createFx(scene);
const vm = createViewmodel();
const pickups = createPickups(scene);
const rng = createRng((params.seed ^ 0x5bd1e995) >>> 0); // the game's own randomness (spread, AI)
const foes = createEnemies(scene, rng);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  vm.resize(camera.aspect);
});

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | playing | paused | dead | intermission | win | gameover
  roundIndex: params.level - 1,
  round: null,
  roundTime: 0,
  player: createPlayer(PLAYER_START),
  boxes: arena.boxes,
  enemies: [],
  corpses: [],
  weapon: 'pistol',
  ammo: { ...AMMO_START },
  cooldown: 0,
  switchT: 0,
  waves: [],
  pending: [],
  kills: 0,
  tries: TRIES_PER_ROUND,
  stats: { shots: 0, hits: 0 },
  totals: { kills: 0, shots: 0, hits: 0, deaths: 0, time: 0 },
  damageTaken: { grunt: 0, gunner: 0, swarmer: 0, own_rocket: 0 }, // whole session, by cause
  lastCause: null,
  timer: 0,
  shake: 0,
  sweepT: 0,
  hintT: 0,
  halted: false,
  mapsCaptured: new Set(),
  pickups: pickups.items, // read by the bot
};

const bot = params.autoplay ? createAutoplay({ skill: params.skill, seed: params.seed }) : null;

const weapons = createWeapons({
  game,
  scene,
  fx,
  vm,
  sfx,
  hud,
  rng,
  gd,
  killEnemy,
  damagePlayer,
  shake: (s) => (game.shake = Math.max(game.shake, s)),
});

// ─────────────────────────────────────────────────────────────── round flow

function clearArena() {
  for (const e of game.enemies) foes.dispose(e);
  for (const e of game.corpses) foes.dispose(e);
  game.enemies.length = 0;
  game.corpses.length = 0;
  foes.clearOrbs();
  weapons.clearRockets();
  fx.reset();
  arena.resetFx();
  pickups.reset();
}

function loadRound(index, fresh) {
  clearArena();
  const round = ROUNDS[index];
  game.roundIndex = index;
  game.round = round;
  game.player = createPlayer(PLAYER_START);
  game.weapon = 'pistol';
  vm.set('pistol');
  game.ammo = { ...AMMO_START };
  game.cooldown = 0;
  game.switchT = 0;
  game.waves = round.waves.map((w) => ({ ...w, fired: false }));
  game.pending = [];
  game.roundTime = 0;
  game.kills = 0;
  game.stats = { shots: 0, hits: 0 };
  if (fresh) game.tries = TRIES_PER_ROUND;
  hud.round(index + 1, round.name);
  hud.clearDamage();
  if (!game.mapsCaptured.has(round.id)) {
    game.mapsCaptured.add(round.id);
    // the arena is the same every round; each round gets its own map so its heatmap has a background
    gd.captureMap(round.id, { axis: 'xz', bounds: { min: [-21, -21], max: [21, 21] }, exclude: [arena.sky, vm.scene] });
  }
}

function beginRound() {
  game.state = 'playing';
  keyboard.clearPresses();
  hud.screen(null);
  hud.show(true);
  gd.levelStart(game.round.id);
  hud.toast(`Round ${game.roundIndex + 1} · ${game.round.name}`, '', 1700);
  bot?.onRoundStart(game);
}

function startRun(index = 0) {
  game.totals = { kills: 0, shots: 0, hits: 0, deaths: 0, time: 0 };
  game.hintT = 0;
  loadRound(index, true);
  beginRound();
}

function restartRound(cause) {
  gd.levelFail(game.round.id, { cause });
  loadRound(game.roundIndex, false);
  beginRound();
}

function completeRound() {
  const durationS = Math.round(game.roundTime * 100) / 100;
  gd.levelComplete(game.round.id, { durationS, score: game.kills });
  addTotals();
  sfx.clear();
  keyboard.releaseFire();
  const last = game.roundIndex >= ROUNDS.length - 1;
  if (last) {
    game.state = 'win';
    hud.win(game.totals);
    hud.screen('win');
    hud.show(false);
    game.timer = END_CARD_TIME;
    return;
  }
  const next = ROUNDS[game.roundIndex + 1];
  hud.intermission(
    { num: game.roundIndex + 1, name: game.round.name },
    { kills: game.kills, time: game.roundTime, shots: game.stats.shots, hits: game.stats.hits, hp: game.player.hp },
    { num: game.roundIndex + 2, name: next.name, blurb: next.blurb },
  );
  hud.screen('intermission');
  game.state = 'intermission';
  game.timer = INTERMISSION_TIME;
}

function addTotals() {
  game.totals.kills += game.kills;
  game.totals.shots += game.stats.shots;
  game.totals.hits += game.stats.hits;
}

function nextRound() {
  loadRound(game.roundIndex + 1, true);
  beginRound();
}

function playerDie(cause) {
  const p = game.player;
  game.state = 'dead';
  game.timer = DEAD_TIME;
  game.tries--;
  game.totals.deaths++;
  game.lastCause = cause;
  addTotals();
  gd.death({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), cause });
  gd.levelFail(game.round.id, { cause });
  keyboard.releaseFire();
  hud.dead(cause, game.tries);
  hud.screen('dead');
  sfx.death();
  bot?.onDeath(cause, game);
}

function afterDeath() {
  if (game.tries > 0) {
    const tries = game.tries;
    loadRound(game.roundIndex, false);
    game.tries = tries;
    beginRound();
    return;
  }
  game.state = 'gameover';
  hud.gameover(game.totals, { num: game.roundIndex + 1, name: game.round.name });
  hud.screen('gameover');
  hud.show(false);
  game.timer = END_CARD_TIME;
}

function quitRun() {
  gd.levelFail(game.round.id, { cause: 'quit' });
  if (bot) {
    halt('RAGE QUIT', 'Nope. Done.', `The bot quit in the middle of ${game.round.name} and closed the tab.`);
    return;
  }
  loadRound(0, true);
  game.state = 'title';
  hud.show(false);
  hud.screen('title');
}

function halt(ribbon, title, text) {
  game.halted = true;
  hud.show(false);
  hud.halted(ribbon, title, text);
  hud.screen('halted');
  window.blastpit.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  setTimeout(() => endSession(), 1000);
}

// ─────────────────────────────────────────────────────────────── combat glue

function killEnemy(index, weapon) {
  const e = game.enemies[index];
  game.enemies.splice(index, 1);
  game.kills++;
  gd.track('kill', { weapon, enemy: e.type });
  e.deadT = 0;
  game.corpses.push(e);
  const color = e.type === 'swarmer' ? 0xc070ff : e.type === 'gunner' ? 0xffa040 : 0xff4058;
  fx.sparks(e.x, e.def.height * 0.6, e.z, color, e.type === 'swarmer' ? 10 : 22, 5, 0.55);
  hud.hitmark(true);
  sfx.kill();
}

function damagePlayer(dmg, cause) {
  if (game.state !== 'playing' || dmg <= 0) return;
  const p = game.player;
  p.hp -= dmg;
  game.damageTaken[cause] = (game.damageTaken[cause] || 0) + dmg;
  hud.damage(dmg);
  sfx.hurt();
  game.shake = Math.max(game.shake, Math.min(0.6, dmg / 30));
  if (p.hp <= 0) playerDie(cause);
}

function switchWeapon(name) {
  if (name === game.weapon || !WEAPONS[name]) return;
  game.weapon = name;
  game.switchT = 0.3;
  vm.switchTo(name, 0.3);
  sfx.switch();
  gd.track('weapon_switch', { to: name });
}

function takePickup(it) {
  const p = game.player;
  const k = it.kind;
  if (k === 'health') {
    if (p.hp >= PLAYER.MAX_HP) return;
    p.hp = Math.min(PLAYER.MAX_HP, p.hp + PICKUP.health.amount);
  } else {
    if (game.ammo[k] >= AMMO_MAX[k]) return;
    game.ammo[k] = Math.min(AMMO_MAX[k], game.ammo[k] + PICKUP[k].amount);
  }
  pickups.take(it);
  gd.track('pickup', { kind: k });
  sfx.pickup();
  fx.sparks(it.x, 0.8, it.z, k === 'health' ? 0x4dff9a : k === 'shells' ? 0xffb020 : 0xff3caa, 14, 3, 0.5);
  hud.toast(k === 'health' ? `+${PICKUP.health.amount} health` : `+${PICKUP[k].amount} ${k}`, k === 'health' ? '' : 'amber', 900);
}

// ─────────────────────────────────────────────────────────────── waves + spawns

function spawnAt(type, gateId, k, n, swarm) {
  const g = GATES[gateId];
  const tx = g.nz; // along the wall
  const tz = g.nx;
  let along;
  let inward;
  if (swarm) {
    along = ((k % 2) - 0.5) * 0.85;
    inward = 0.3 + Math.floor(k / 2) * 0.8;
  } else {
    along = (k - (n - 1) / 2) * 1.0;
    inward = 0.4 + rng.range(0, 0.6);
  }
  const x = g.x + tx * along + g.nx * inward;
  const z = g.z + tz * along + g.nz * inward;
  const e = foes.spawn(type, x, z);
  game.enemies.push(e);
  fx.sparks(x, 1, z, type === 'swarmer' ? 0xc070ff : 0xff3caa, 8, 3, 0.4);
  return e;
}

function remainingHostiles() {
  let n = game.enemies.length + game.pending.length;
  for (const w of game.waves) if (!w.fired) for (const s of w.spawns) n += s.count;
  return n;
}

function stepWaves() {
  const t = game.roundTime;
  for (const w of game.waves) {
    if (w.fired) continue;
    const tele = w.swarm ? SWARM_TELEGRAPH : TELEGRAPH;
    const timed = w.at !== undefined;
    const ready = timed ? t >= w.at - tele : t >= (w.minT || 0) && game.pending.length === 0 && game.enemies.length <= w.alive;
    if (!ready) break; // waves go in order
    w.fired = true;
    const t0 = timed ? w.at : t + tele;
    if (w.swarm) {
      hud.toast('SWARM INCOMING', 'warn', 2000);
      sfx.swarm();
    } else sfx.spawn();
    for (const s of w.spawns) {
      arena.telegraph(s.gate, t0 - t + (w.swarm ? 0 : s.count * 0.35));
      for (let k = 0; k < s.count; k++) game.pending.push({ type: s.type, gate: s.gate, at: w.swarm ? t0 : t0 + k * 0.35, k, n: s.count, swarm: !!w.swarm });
    }
  }
  for (let i = 0; i < game.pending.length; i++) {
    const p = game.pending[i];
    if (t < p.at) continue;
    spawnAt(p.type, p.gate, p.k, p.n, p.swarm);
    game.pending.splice(i--, 1);
  }
}

// ─────────────────────────────────────────────────────────────── simulation

function fixedStep(dt) {
  bot?.tick(dt);
  if (game.halted || game.state !== 'playing') return;
  game.roundTime += dt;
  game.totals.time += dt;
  const input = bot ? bot.step(game, dt) : keyboard.state(game.weapon, WEAPON_ORDER, dt);
  if (input.quit) return quitRun();
  if (input.restart) return restartRound('restart');

  const p = game.player;
  stepPlayer(p, input, dt, game.boxes);
  if (input.weapon && input.weapon !== game.weapon) switchWeapon(input.weapon);
  game.cooldown -= dt;
  game.switchT -= dt;
  if (input.fire) weapons.fire();
  weapons.stepRockets(dt);
  if (game.state !== 'playing') return;

  stepWaves();
  const eye = { x: p.x, y: p.y + PLAYER.EYE, z: p.z };
  const ctx = { player: p, boxes: game.boxes, dt, eye, damagePlayer, fireOrb: foes.fireOrb };
  for (const e of game.enemies) foes.step(e, ctx);
  foes.separate(game.enemies, p);
  resolveCircle(p, PLAYER.RADIUS, p.y, game.boxes);
  for (const pop of foes.stepOrbs(dt, p, game.boxes, damagePlayer)) fx.sparks(pop.x, pop.y, pop.z, 0xffb040, pop.hitPlayer ? 14 : 8, 3, 0.35);
  if (game.state !== 'playing') return;

  for (const it of pickups.step(dt, p)) takePickup(it);
  if (game.waves.every((w) => w.fired) && game.pending.length === 0 && game.enemies.length === 0) completeRound();
}

// ─────────────────────────────────────────────────────────────── per-frame

let clock = 0;
let lastYaw = 0;
let lastPitch = 0;

function requestLock() {
  if (bot) return;
  try {
    const r = canvas.requestPointerLock?.();
    r?.catch?.(() => {});
  } catch {
    /* not allowed right now; the player can click again */
  }
}

document.addEventListener('pointerlockchange', () => {
  if (!bot && document.pointerLockElement !== canvas && game.state === 'playing') pause();
});

function pause() {
  game.state = 'paused';
  keyboard.releaseFire();
  hud.screen('pause');
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
}

function resume() {
  game.state = 'playing';
  hud.screen(null);
  keyboard.clearPresses();
  requestLock();
}

function handleMenus(dt) {
  if (keyboard.consume('mute')) hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', '', 900);
  const s = game.state;
  const confirm = () => keyboard.consume('jump') || keyboard.consume('confirm') || keyboard.consume('click');
  if (s === 'title') {
    if (confirm() || bot?.menu(s, dt)) {
      requestLock();
      startRun(game.roundIndex);
    }
  } else if (s === 'playing') {
    if (keyboard.consume('pause')) pause();
    else if (keyboard.consume('restart')) restartRound('restart');
    else if (keyboard.consume('click') && document.pointerLockElement !== canvas) requestLock();
  } else if (s === 'paused') {
    if (keyboard.consume('restart')) {
      restartRound('restart');
      requestLock();
    } else if (keyboard.consume('quit')) quitRun();
    else if (keyboard.consume('pause') || keyboard.consume('click') || keyboard.consume('confirm')) resume();
  } else if (s === 'dead') {
    game.timer -= dt;
    if (game.timer <= 0) afterDeath();
  } else if (s === 'intermission') {
    game.timer -= dt;
    if (game.timer <= 0 || (game.timer < INTERMISSION_TIME - 1 && confirm())) nextRound();
  } else if (s === 'win' || s === 'gameover') {
    game.timer -= dt;
    if (bot) {
      if (game.timer <= 0) {
        if (s === 'win') halt('AUTOPLAY', 'Pit cleared', `The bot cleared the pit with ${game.totals.deaths} ${game.totals.deaths === 1 ? 'death' : 'deaths'} and closed the tab.`);
        else halt('AUTOPLAY', 'Game over', `The bot ran out of tries on ${game.round.name} and closed the tab.`);
      }
    } else if (game.timer < END_CARD_TIME - 0.8 && confirm()) startRun(0);
  }
}

function updateVisuals(dt) {
  const p = game.player;
  const playing = game.state === 'playing' || game.state === 'paused' || game.state === 'dead';

  if (game.state === 'title' || game.state === 'boot') {
    // slow orbit over the pit
    const a = clock * 0.08;
    camera.position.set(Math.sin(a) * 24, 9.5, Math.cos(a) * 24);
    camera.lookAt(0, 0.5, 0);
  } else {
    game.shake *= Math.exp(-dt * 7);
    const sh = game.shake * 0.06;
    const dead = game.state === 'dead' ? Math.min(1, (DEAD_TIME - game.timer) / 0.5) : 0;
    const bob = p.grounded ? Math.sin(p.bob * 2) * 0.035 * Math.min(1, Math.hypot(p.vx, p.vz) / 6) : 0;
    camera.position.set(p.x + (Math.random() - 0.5) * sh, p.y + PLAYER.EYE + bob - dead * 1.25 + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
    camera.rotation.set(p.pitch * (1 - dead) + dead * 0.2, p.yaw, dead * 0.5);
  }

  const yawRate = (p.yaw - lastYaw) / Math.max(dt, 1e-3);
  const pitchRate = (p.pitch - lastPitch) / Math.max(dt, 1e-3);
  lastYaw = p.yaw;
  lastPitch = p.pitch;
  vm.update(dt, { bob: p.bob, speed: Math.hypot(p.vx, p.vz), yawRate: Math.max(-6, Math.min(6, yawRate)), pitchRate: Math.max(-6, Math.min(6, pitchRate)), grounded: p.grounded });

  for (const e of game.enemies) foes.animate(e, dt, clock, p);
  for (const e of game.corpses) foes.animateDeath(e, dt);
  // clear the dead away in batches, every couple of seconds
  game.sweepT -= dt;
  if (game.sweepT <= 0) {
    game.sweepT = CORPSE_SWEEP;
    for (let i = game.corpses.length - 1; i >= 0; i--) {
      if (game.corpses[i].deadT < CORPSE_MIN) continue;
      foes.dispose(game.corpses[i]);
      game.corpses.splice(i, 1);
    }
  }
  pickups.animate(clock);
  arena.update(dt, clock);
  fx.update(dt);
  hud.updateDamage(dt);

  if (playing) {
    hud.timer(game.roundTime);
    hud.kills(game.kills);
    hud.hostiles(remainingHostiles());
    hud.tries(game.tries, TRIES_PER_ROUND);
    hud.health(p.hp);
    const w = WEAPONS[game.weapon];
    hud.weapon(game.weapon, w.name, w.ammo ? game.ammo[w.ammo] : null, game.ammo);
  }
  if (game.state === 'playing') {
    game.hintT += dt;
    hud.hint(!bot && game.roundIndex === 0 && game.hintT < 9);
  } else hud.hint(false);
}

function countLights() {
  let n = 0;
  scene.traverseVisible((o) => {
    if (o.isLight) n++;
  });
  return n;
}

let worldCalls = 0; // draw calls of the world pass (renderer.info resets on every render call)

function render() {
  renderer.clear();
  renderer.render(scene, camera);
  worldCalls = renderer.info.render.calls;
  if (game.state === 'playing' || game.state === 'paused') {
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
  }
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
  if (game.state === 'playing') {
    acc = Math.min(acc + raw, 0.25);
    while (acc >= STEP) {
      acc -= STEP;
      fixedStep(STEP);
      if (game.halted || game.state !== 'playing') break;
    }
  } else {
    acc = 0;
    if (bot && game.state !== 'title') bot.tick(dt);
  }

  updateVisuals(dt);
  const p = game.player;
  gd.setPosition({ x: p.x, y: p.y, z: p.z });
  gd.setContext({ enemies: game.enemies.length, projectiles: weapons.rockets.length + foes.orbs.length, lights: countLights() });
  render();
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

function counts() {
  const by = { grunt: 0, gunner: 0, swarmer: 0 };
  for (const e of game.enemies) by[e.type]++;
  return { total: game.enemies.length, ...by, pending: game.pending.length };
}

function ensurePlaying() {
  if (game.state === 'title') startRun(game.roundIndex);
  if (game.state === 'paused') resume();
  return game.state === 'playing';
}

const agentApi = {
  getState() {
    const p = game.player;
    const r = renderer.info;
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      paused: game.state === 'paused',
      round: game.round?.id,
      round_name: game.round?.name,
      round_time_s: +game.roundTime.toFixed(2),
      tries_left: game.tries,
      player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), hp: Math.ceil(p.hp) },
      weapon: game.weapon,
      ammo: { pistol: 'infinite', shells: game.ammo.shells, rockets: game.ammo.rockets },
      enemies: counts(),
      projectiles: { rockets: weapons.rockets.length, orbs: foes.orbs.length },
      lights: countLights(),
      kills: game.kills,
      deaths_total: game.totals.deaths,
      damage_taken: game.damageTaken,
      hostiles_left: remainingHostiles(),
      renderer: { draw_calls: worldCalls, programs: r.programs?.length ?? null, geometries: r.memory.geometries, textures: r.memory.textures },
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  loadLevel(id) {
    const index = ROUNDS.findIndex((r) => r.id === id);
    if (index < 0) return { ok: false, error: `unknown level ${id}` };
    if (game.state === 'title') game.totals = { kills: 0, shots: 0, hits: 0, deaths: 0, time: 0 };
    loadRound(index, true);
    beginRound();
    return { ok: true, level: game.round.id, state: game.state };
  },
  spawnSwarm(count) {
    if (!ensurePlaying()) return { ok: false, error: `can only spawn while playing (state: ${game.state})` };
    const before = countLights();
    const ids = Object.keys(GATES);
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const g = GATES[ids[i % ids.length]];
      const k = Math.floor(i / ids.length);
      const e = foes.spawnSwarmer(g.x + g.nz * ((k % 3) - 1) * 0.8 + g.nx * (0.4 + Math.floor(k / 3) * 0.8), g.z + g.nx * ((k % 3) - 1) * 0.8 + g.nz * (0.4 + Math.floor(k / 3) * 0.8));
      game.enemies.push(e);
    }
    return { ok: true, spawned: count, enemies: counts(), lights_before: before, lights_after: countLights(), spawn_ms: +(performance.now() - t0).toFixed(1), note: 'the cost lands on the next rendered frame (shader compile for the new light count)' };
  },
  teleport(x, z) {
    if (!ensurePlaying()) return { ok: false, error: `cannot teleport in state ${game.state}` };
    const p = game.player;
    p.x = x;
    p.z = z;
    p.y = 0;
    p.vx = p.vz = p.vy = 0;
    resolveCircle(p, PLAYER.RADIUS, 0, game.boxes);
    return { ok: true, x: +p.x.toFixed(2), z: +p.z.toFixed(2), round: game.round.id };
  },
  setPaused(paused) {
    if (paused && game.state === 'playing') pause();
    else if (!paused && game.state === 'paused') resume();
    return { ok: true, state: game.state, paused: game.state === 'paused' };
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.blastpit = {
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
  get level() {
    return game.round?.id;
  },
  get info() {
    const i = renderer.info;
    return { calls: worldCalls, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, lights: countLights() };
  },
};

async function boot() {
  bindMouse(canvas);
  document.getElementById('press').addEventListener('click', () => {
    if (game.state === 'title') {
      requestLock();
      startRun(game.roundIndex);
    }
  });
  hud.footer(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  try {
    await Promise.race([document.fonts?.load('700 64px "Chakra Petch"'), new Promise((r) => setTimeout(r, 900))]);
  } catch {
    /* fonts are optional */
  }
  await initTelemetry({ renderer, scene, camera, THREE });
  if (gd.enabled) registerAgentTools(gd, agentApi);
  else document.getElementById('hint-gd')?.remove();
  hud.footer(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  loadRound(game.roundIndex, true);
  vm.warm(renderer);
  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
