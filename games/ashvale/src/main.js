// Ashvale — a small top-down action RPG in Three.js (a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { FLOORS, FLOOR_IDS, tileCenter } from './floors.js';
import { STEP, HERO, XP_LEVELS, DEATHS_PER_FLOOR } from './rules.js';
import { createSim } from './sim.js';
import { createWorld } from './world.js';
import { createHero, animateHero, createEnemyView, animateEnemy, animateDeath, createLootView, animateLoot, createProjectileView } from './models.js';
import { createFx } from './fx.js';
import { spawnNumber, updateNumbers, numberNodes, numberStats } from './numbers.js';
import { RARITIES, SLOTS } from './gear.js';
import { hud, formatTime } from './hud.js';
import { keyboard, bindMouse, mouse } from './input.js';
import { sfx } from './audio.js';
import { createRng } from './rng.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const DEAD_TIME = 2.4;
const INTERMISSION_TIME = 3.5;
const END_CARD_TIME = 2.6;
const BOT_GIVE_UP = 200; // s of play before the bot gives up
const CAM_OFFSET = new THREE.Vector3(0, 17.5, 11.5);
const round2 = (v) => Math.round(v * 100) / 100;

// ─────────────────────────────────────────────────────────────── renderer / scene

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060a);
scene.fog = new THREE.Fog(0x07060a, 30, 52);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 200);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const world = createWorld(scene);
const fx = createFx(scene);
const heroView = createHero();
scene.add(heroView.root);
const heroLight = new THREE.PointLight(0xffb070, 22, 13, 1.5);
scene.add(heroLight);
const enemyGroup = new THREE.Group();
enemyGroup.name = 'enemies';
const lootGroup = new THREE.Group();
lootGroup.name = 'loot';
const projGroup = new THREE.Group();
projGroup.name = 'projectiles';
scene.add(enemyGroup, lootGroup, projGroup);

const views = { enemies: new Map(), dying: [], loot: new Map(), proj: new Map() };

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | playing | paused | dead | intermission | win | gameover
  startFloor: params.level - 1,
  timer: 0,
  runTime: 0,
  shake: 0,
  hintT: 0,
  halted: false,
  mapsCaptured: new Set(),
  lastCause: null,
  dustT: 0,
};

const bot = params.autoplay ? createAutoplay({ skill: params.skill, seed: params.seed }) : null;

// The sim's hooks: telemetry and everything you see and hear happen here, at the moment the sim says so.
const hooks = {
  hit: (e, amount, kind, crit) => showHit(e, amount, kind, crit),
  heroHurt(amount, cause) {
    const hr = sim.hero;
    spawnNumber(hr.x, hr.y + 2.3, hr.z, `-${amount}`, 'hurt');
    hud.hurt(amount, hr.maxHp);
    game.shake = Math.max(game.shake, Math.min(0.7, amount / 25));
    fx.sparks(hr.x, hr.y + 1.1, hr.z, 0xff3a3a, 10, 3.5);
    sfx.hurt();
  },
  evade() {
    const hr = sim.hero;
    spawnNumber(hr.x, hr.y + 2.1, hr.z, 'dodged', 'dodge');
  },
  kill(e) {
    gd.track('kill', { enemy: e.kind });
    const v = views.enemies.get(e.id);
    if (v) {
      views.enemies.delete(e.id);
      views.dying.push(v);
    }
    const color = e.kind === 'slime' ? 0x6aff7a : e.kind === 'ash_lord' ? 0xff7a2a : 0xe9dfc6;
    if (e.kind === 'ash_lord') {
      fx.emit(e.x, 2, e.z, 0xff7a2a, { count: 160, speed: 9, life: 1.4, size: 0.5, gravity: 2, up: 1.2, drag: 1.2, spread: 1.5 });
      fx.ring(e.x, 0, e.z, 0xff9a40, 8, 0.9);
      game.shake = 1.2;
    } else if (e.kind === 'slime') fx.emit(e.x, 0.6, e.z, color, { count: e.small ? 14 : 26, speed: 4, life: 0.6, size: 0.35, gravity: 10, up: 1 });
    else fx.dust(e.x, 0.8, e.z, 0xcfc6b0, 18);
    sfx.kill();
  },
  xp(amount, e) {
    spawnNumber(e.x + 0.5, e.y + (e.kind === 'ash_lord' ? 3.5 : 1.6), e.z, `+${amount} XP`, 'xp');
  },
  levelUp(level) {
    gd.track('level_up', { level });
    const hr = sim.hero;
    hud.toast(`LEVEL UP · ${level}`, 'level', 1900);
    hud.levelFlash();
    fx.levelUp(hr.x, hr.y, hr.z);
    sfx.levelUp();
  },
  loot(it) {
    const gear = it.kind === 'gear';
    gd.track('loot', { rarity: gear ? it.rarity : 'none', slot: gear ? it.slot : it.kind });
    const hr = sim.hero;
    if (it.kind === 'gold') {
      spawnNumber(it.x, it.y + 1, it.z, `+${it.amount}`, 'gold');
      fx.sparks(it.x, 0.3, it.z, 0xffd36a, 8, 2.5);
      sfx.coin();
    } else if (it.kind === 'potion') {
      spawnNumber(it.x, it.y + 1, it.z, '+1 potion', 'heal');
      sfx.coin();
    } else fx.sparks(hr.x, 0.6, hr.z, 0xffffff, 10, 3);
  },
  equip(it, old, verdict) {
    gd.track('equip', { slot: it.slot, rarity: it.rarity });
    hud.lootToast(it, verdict, true);
    const hr = sim.hero;
    fx.ring(hr.x, hr.y, hr.z, 0xffffff, 2, 0.4);
    sfx.equip();
  },
  salvage(it, gold, verdict) {
    hud.lootToast(it, verdict, false, gold);
    spawnNumber(it.x, it.y + 1, it.z, `+${gold}`, 'gold');
    sfx.coin();
  },
  potion(healed) {
    gd.track('potion', {});
    const hr = sim.hero;
    spawnNumber(hr.x, hr.y + 2.3, hr.z, `+${healed}`, 'heal');
    fx.emit(hr.x, hr.y + 0.8, hr.z, 0x6aff8a, { count: 26, speed: 1.6, life: 0.9, size: 0.3, gravity: -2.5, up: 1, drag: 1.5, spread: 0.8 });
    sfx.potion();
  },
  skill(name) {
    gd.track('skill', { name });
    if (name === 'dodge') {
      const hr = sim.hero;
      fx.dust(hr.x, hr.y + 0.2, hr.z, 0x8a8278, 10);
      sfx.dodge();
    }
  },
  swing(a) {
    const hr = sim.hero;
    fx.slash(hr.x, hr.y, hr.z, a, HERO.swing.arc);
    sfx.swing();
  },
  nova() {
    const hr = sim.hero;
    fx.nova(hr.x, hr.y, hr.z, HERO.nova.radius);
    game.shake = Math.max(game.shake, 0.35);
    sfx.nova();
  },
  roomClear(room) {
    gd.track('room_clear', { room: room.id, swings: room.swings });
  },
  stairsOpen() {
    world.setStairsOpen(true);
    const s = tileCenter(sim.floor.stairs[0], sim.floor.stairs[1]);
    fx.stairs(s.x, s.z);
    hud.toast(sim.floorIndex === FLOORS.length - 1 ? 'The way out is open' : 'The stairs are open', '', 1900);
    sfx.stairs();
  },
  boss(result) {
    gd.track('boss', { result });
    if (result === 'start') {
      hud.toast('The Ash Lord wakes', 'warn', 2200);
      sfx.roar();
      game.shake = 0.6;
    } else if (result === 'win') hud.toast('The Ash Lord falls', 'level', 2600);
  },
  bossPhase(phase) {
    if (phase === 'summon') hud.toast('He calls his guard', 'warn', 1600);
    else hud.toast('The Ash Lord is enraged', 'warn', 1800);
  },
  death: (cause, p) => playerDie(cause, p),
  floorComplete: () => completeFloor(),
  drop(it) {
    if (it.kind === 'gear') {
      sfx.drop(it.rarity);
      if (it.rarity === 'legendary') hud.toast('A legendary drops', 'level', 2000);
    }
  },
  shoot(p) {
    if (p.kind === 'arrow') sfx.arrow();
  },
  split(e) {
    fx.emit(e.x, 0.5, e.z, 0x6aff7a, { count: 16, speed: 3, life: 0.5, size: 0.3, gravity: 8, up: 1 });
  },
  strike(e, kind) {
    if (kind === 'slam') {
      fx.ring(e.tx, 0, e.tz, 0xff6a2a, e.def.slam.radius + 0.4, 0.45);
      fx.dust(e.tx, 0.2, e.tz, 0x6a5a50, 30);
      fx.emit(e.tx, 0.2, e.tz, 0xff7a2a, { count: 40, speed: 6, life: 0.6, size: 0.35, gravity: 6, up: 0.8 });
      game.shake = Math.max(game.shake, 0.9);
      sfx.slam();
    } else if (kind === 'cleave') {
      fx.slash(e.x, e.y + 0.6, e.z, e.face, e.def.cleave.arc, 0xff6a3a);
      game.shake = Math.max(game.shake, 0.4);
    } else if (kind === 'swing') fx.slash(e.x, e.y - 0.2, e.z, e.face, e.def.arc, 0xffb0a0);
  },
  windup(e, kind) {
    if (e.kind === 'ash_lord' || kind === 'swing') sfx.windup();
  },
};

const sim = createSim({ rng: createRng((params.seed ^ 0x5bd1e995) >>> 0), hooks });

/** Every damage number goes through here: hits, crits and burn ticks (the agent tool uses it too). */
function showHit(e, amount, kind, crit) {
  const y = e.y + (e.kind === 'ash_lord' ? 4.3 : e.kind === 'slime' ? (e.small ? 1.0 : 1.5) : 2.1);
  spawnNumber(e.x, y, e.z, crit ? `${amount}!` : String(amount), kind === 'burn' ? 'burn' : crit ? 'crit' : 'hit');
  if (kind === 'burn') fx.embers(e.x, e.y + 1, e.z, 3, 0.22);
  else {
    const color = e.kind === 'slime' ? 0x7aff8a : e.kind === 'ash_lord' ? 0xffa050 : 0xfff0d0;
    fx.sparks(e.x, e.y + (e.kind === 'ash_lord' ? 2.2 : 1), e.z, color, crit ? 20 : 10, crit ? 6 : 4);
    if (kind === 'swing') game.shake = Math.max(game.shake, crit ? 0.3 : 0.12);
    sfx.hit(crit);
  }
}

// ─────────────────────────────────────────────────────────────── floors and the run

function resetViews() {
  for (const v of views.enemies.values()) enemyGroup.remove(v.root);
  for (const v of views.dying) enemyGroup.remove(v.root);
  for (const v of views.loot.values()) lootGroup.remove(v);
  for (const v of views.proj.values()) projGroup.remove(v);
  views.enemies.clear();
  views.dying.length = 0;
  views.loot.clear();
  views.proj.clear();
  fx.reset();
}

function loadFloor(index) {
  sim.loadFloor(index);
  world.build(sim.grid, sim.floor);
  world.setStairsOpen(false);
  resetViews();
  syncViews(0, 0);
  hud.floor(index + 1, sim.floor.name);
  const id = sim.floor.id;
  if (!game.mapsCaptured.has(id)) {
    game.mapsCaptured.add(id);
    // the floor seen from straight above, without the hero, enemies, loot or effects, for the heatmap
    gd.captureMap(id, { axis: 'xz', bounds: { min: [0, 0], max: [sim.grid.w, sim.grid.h] }, exclude: [heroView.root, enemyGroup, lootGroup, projGroup, fx.group] });
  }
}

function beginFloor() {
  game.state = 'playing';
  keyboard.clearPresses();
  hud.screen(null);
  hud.show(true);
  hud.clearFx();
  gd.levelStart(sim.floor.id);
  hud.toast(`Floor ${sim.floorIndex + 1} · ${sim.floor.name}`, '', 1900);
  bot?.onFloor();
}

function startRun(index = 0) {
  sim.newRun();
  game.runTime = 0;
  game.hintT = 0;
  loadFloor(index);
  beginFloor();
}

function respawn() {
  sim.resetFloor();
  world.setStairsOpen(false);
  resetViews();
  syncViews(0, 0);
  beginFloor();
}

function playerDie(cause, p) {
  game.state = 'dead';
  game.timer = DEAD_TIME;
  game.lastCause = cause;
  gd.death({ x: round2(p.x), y: round2(p.y), z: round2(p.z), cause });
  gd.levelFail(sim.floor.id, { cause });
  keyboard.release();
  hud.dead(cause, DEATHS_PER_FLOOR - sim.deathsOnFloor);
  hud.screen('dead');
  sfx.death();
}

function afterDeath() {
  if (!sim.outOfLives()) return respawn();
  game.state = 'gameover';
  hud.gameover(runTotals(), { num: sim.floorIndex + 1, name: sim.floor.name });
  hud.screen('gameover');
  hud.show(false);
  game.timer = END_CARD_TIME;
}

function runTotals() {
  return { kills: sim.totals.kills, time: game.runTime, level: sim.hero.level, deaths: sim.totals.deaths };
}

function completeFloor() {
  gd.levelComplete(sim.floor.id, { durationS: round2(sim.floorTime), score: sim.kills });
  keyboard.release();
  const last = sim.floorIndex >= FLOORS.length - 1;
  if (last) {
    game.state = 'win';
    hud.win(runTotals());
    hud.screen('win');
    hud.show(false);
    game.timer = END_CARD_TIME;
    return;
  }
  const next = FLOORS[sim.floorIndex + 1];
  hud.intermission({ num: sim.floorIndex + 1, name: sim.floor.name }, { kills: sim.kills, time: sim.floorTime, level: sim.hero.level, gold: sim.hero.gold }, { num: sim.floorIndex + 2, name: next.name, blurb: next.blurb });
  hud.screen('intermission');
  game.state = 'intermission';
  game.timer = INTERMISSION_TIME;
}

function quitRun(why = 'quit') {
  if (sim.state === 'playing') gd.levelFail(sim.floor.id, { cause: 'quit' });
  if (bot) {
    if (why === 'timeout') halt('AUTOPLAY', 'Out of time', `The bot gave up after ${formatTime(game.runTime)} on ${sim.floor.name} and closed the tab.`, true);
    else halt('RAGE QUIT', sim.floorIndex === 1 ? 'Not the gallery again.' : 'Nope. Done.', `The bot died ${sim.deathsOnFloor}× on ${sim.floor.name}, lost its nerve on its last life and closed the tab.`, true);
    return;
  }
  sim.state = 'idle';
  loadFloor(game.startFloor);
  game.state = 'title';
  hud.show(false);
  hud.screen('title');
}

function halt(ribbon, title, text, red = false) {
  if (game.halted) return;
  game.halted = true;
  hud.show(false);
  hud.halted(ribbon, title, text, red);
  hud.screen('halted');
  window.ashvale.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  setTimeout(() => endSession(), 1000);
}

// ─────────────────────────────────────────────────────────────── input → aim

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();
const aim = { x: 0, z: 0 };

function aimPoint() {
  const hr = sim.hero;
  if (!mouse.moved) {
    aim.x = hr.x + Math.sin(hr.aim) * 3;
    aim.z = hr.z + Math.cos(hr.aim) * 3;
    return aim;
  }
  ndc.set((mouse.x / window.innerWidth) * 2 - 1, -(mouse.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  plane.constant = -(hr.y + 0.9);
  if (raycaster.ray.intersectPlane(plane, hitPoint)) {
    aim.x = hitPoint.x;
    aim.z = hitPoint.z;
  }
  return aim;
}

// ─────────────────────────────────────────────────────────────── simulation

function fixedStep(dt) {
  bot?.tick(dt);
  if (game.halted || game.state !== 'playing') return;
  game.runTime += dt;
  if (bot && game.runTime > BOT_GIVE_UP) return quitRun('timeout');
  const input = bot ? bot.step(sim, dt) : keyboard.state(aimPoint());
  if (input.quit) return quitRun();
  sim.step(input, dt);
}

function pause() {
  game.state = 'paused';
  keyboard.release();
  keyboard.clearPresses(); // clicks made while playing must not resume the game straight away
  hud.screen('pause');
}

function resume() {
  game.state = 'playing';
  hud.screen(null);
  keyboard.clearPresses();
}

function handleMenus(dt) {
  if (keyboard.consume('mute')) hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', '', 900);
  const s = game.state;
  const confirm = () => keyboard.consume('dodge') || keyboard.consume('confirm') || keyboard.consume('click');
  if (s === 'title') {
    if (confirm() || bot?.menu(s, dt)) {
      sfx.click();
      startRun(game.startFloor);
    }
  } else if (s === 'playing') {
    if (keyboard.consume('pause')) pause();
  } else if (s === 'paused') {
    if (keyboard.consume('nova')) quitRun();
    else if (keyboard.consume('pause') || keyboard.consume('click') || keyboard.consume('confirm')) resume();
  } else if (s === 'dead') {
    game.timer -= dt;
    if (game.timer <= 0) afterDeath();
  } else if (s === 'intermission') {
    game.timer -= dt;
    if (game.timer <= 0 || (game.timer < INTERMISSION_TIME - 1 && confirm())) {
      loadFloor(sim.floorIndex + 1);
      beginFloor();
    }
  } else if (s === 'win' || s === 'gameover') {
    game.timer -= dt;
    if (bot) {
      if (game.timer <= 0) {
        const t = runTotals();
        if (s === 'win') halt('AUTOPLAY', 'The Ash Lord falls', `The bot cleared Ashvale in ${formatTime(t.time)} at level ${t.level}, with ${t.deaths} ${t.deaths === 1 ? 'death' : 'deaths'}, and closed the tab.`);
        else halt('AUTOPLAY', 'Run over', `The bot ran out of lives on ${sim.floor.name} and closed the tab.`, true);
      }
    } else if (game.timer < END_CARD_TIME - 0.8 && confirm()) {
      game.state = 'title';
      startRun(0);
    }
  }
}

// ─────────────────────────────────────────────────────────────── views

const seen = new Set();

function syncViews(dt, clock) {
  // enemies
  seen.clear();
  for (const e of sim.enemies) {
    seen.add(e.id);
    let v = views.enemies.get(e.id);
    if (!v) {
      v = createEnemyView(e);
      enemyGroup.add(v.root);
      views.enemies.set(e.id, v);
      if (e.awake && dt > 0) fx.dust(e.x, 0.4, e.z, e.kind === 'slime' ? 0x6aff7a : 0x8a7a6a, 16);
    }
    animateEnemy(v, e, dt, clock);
    if (e.burn && Math.random() < dt * 14) fx.embers(e.x, e.y + 0.6 + Math.random() * (e.kind === 'ash_lord' ? 3 : 1.2), e.z, 1);
    if (e.kind === 'ash_lord' && Math.random() < dt * (e.enraged ? 30 : 10)) fx.embers(e.x + (Math.random() - 0.5) * 2, e.y + Math.random() * 3.5, e.z + (Math.random() - 0.5) * 2, 1, 0.25);
  }
  for (const [id, v] of views.enemies) {
    if (seen.has(id)) continue;
    views.enemies.delete(id);
    views.dying.push(v);
  }
  for (let i = views.dying.length - 1; i >= 0; i--) {
    if (animateDeath(views.dying[i], dt)) continue;
    enemyGroup.remove(views.dying[i].root);
    views.dying.splice(i, 1);
  }
  // loot
  seen.clear();
  for (const it of sim.loot) {
    seen.add(it.id);
    let v = views.loot.get(it.id);
    if (!v) {
      v = createLootView(it);
      lootGroup.add(v);
      views.loot.set(it.id, v);
    }
    animateLoot(v, it, clock);
  }
  for (const [id, v] of views.loot) {
    if (seen.has(id)) continue;
    lootGroup.remove(v);
    views.loot.delete(id);
  }
  // projectiles
  seen.clear();
  for (const p of sim.projectiles) {
    seen.add(p.id);
    let v = views.proj.get(p.id);
    if (!v) {
      v = createProjectileView(p);
      projGroup.add(v);
      views.proj.set(p.id, v);
    }
    v.position.set(p.x, p.y, p.z);
    v.rotation.y = Math.atan2(p.vx, p.vz);
    if (p.kind === 'bolt' && Math.random() < dt * 30) fx.embers(p.x, p.y, p.z, 1, 0.3);
  }
  for (const [id, v] of views.proj) {
    if (seen.has(id)) continue;
    projGroup.remove(v);
    views.proj.delete(id);
    const p = v.position;
    fx.sparks(p.x, p.y, p.z, 0xffc080, 5, 2, 0.25, 0.15);
  }
  fx.telegraphs(sim.enemies);
}

let clock = 0;
const camTarget = new THREE.Vector3();
const want = new THREE.Vector3();

function updateCamera(dt) {
  const hr = sim.hero;
  if (game.state === 'title' || game.state === 'boot') {
    const s = tileCenter(sim.floor.start[0], sim.floor.start[1]);
    want.set(s.x + 7 + Math.sin(clock * 0.12) * 5, 0, s.z - 1 + Math.cos(clock * 0.09) * 2);
    camTarget.lerp(want, 1 - Math.exp(-dt * 1.5));
  } else {
    // lead a little toward where the hero is aiming
    want.set(hr.x + Math.sin(hr.aim) * 1.2, hr.y, hr.z + Math.cos(hr.aim) * 0.9);
    camTarget.lerp(want, 1 - Math.exp(-dt * 7));
  }
  game.shake *= Math.exp(-dt * 8);
  const sh = game.shake * 0.25;
  camera.position.set(camTarget.x + CAM_OFFSET.x + (Math.random() - 0.5) * sh, camTarget.y + CAM_OFFSET.y + (Math.random() - 0.5) * sh, camTarget.z + CAM_OFFSET.z);
  camera.lookAt(camTarget.x, camTarget.y + 0.4, camTarget.z - 0.4);
}

function updateHud(dt) {
  const hr = sim.hero;
  hud.update(dt);
  if (!(game.state === 'playing' || game.state === 'paused' || game.state === 'dead')) return;
  hud.vitals(hr);
  const lo = hr.level >= 2 ? XP_LEVELS[hr.level - 2] : 0;
  const hi = XP_LEVELS[hr.level - 1] ?? lo + 1;
  hud.xp(hr.level, (hr.xp - lo) / (hi - lo));
  hud.skills({
    swing: Math.max(0, hr.swingCd) / HERO.swing.cooldown,
    dodge: Math.max(0, hr.dodgeCd) / HERO.dodge.cooldown,
    nova: Math.max(0, hr.novaCd) / HERO.nova.cooldown,
    potion: Math.max(0, hr.potionCd) / HERO.potionCooldown,
    potions: hr.potions,
    noMana: hr.mana < HERO.nova.cost,
  });
  hud.gold(hr.gold);
  hud.kills(sim.totals.kills);
  hud.timer(game.runTime);
  const fighting = sim.rooms.filter((r) => r.def.enemies.length);
  hud.rooms(fighting.filter((r) => r.cleared).length, fighting.length);
  hud.stairs(sim.stairsOpen);
  hud.lives(DEATHS_PER_FLOOR - sim.deathsOnFloor, DEATHS_PER_FLOOR);
  hud.gear(hr.gear);
  const b = sim.boss;
  hud.boss(!!(sim.bossStarted && b && !b.dead && game.state !== 'dead'), b ? b.hp / b.maxHp : 0, !!b?.enraged);
  if (game.state === 'playing') {
    game.hintT += dt;
    hud.hint(!bot && sim.floorIndex === 0 && game.hintT < 10);
  } else hud.hint(false);
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

  const hr = sim.hero;
  heroView.root.visible = game.state !== 'title' && game.state !== 'boot';
  animateHero(heroView, hr, dt, clock, HERO);
  if (game.state === 'playing' && Math.hypot(hr.vx, hr.vz) > 3 && hr.dodgeT <= 0) {
    game.dustT -= dt;
    if (game.dustT <= 0) {
      game.dustT = 0.22;
      fx.emit(hr.x, hr.y + 0.05, hr.z, 0x6a625a, { count: 2, speed: 0.6, life: 0.5, size: 0.3, gravity: -0.3, up: 0.3, drag: 3, spread: 0.3 });
    }
  }
  heroLight.position.set(hr.x, hr.y + 2.6, hr.z + 0.6);
  syncViews(dt, clock);
  updateCamera(dt);
  world.update(dt, clock, camTarget);
  fx.update(dt, camTarget);
  updateNumbers(camera, window.innerWidth, window.innerHeight);
  updateHud(dt);

  gd.setPosition({ x: hr.x, y: hr.y, z: hr.z });
  gd.setContext({ enemies: sim.enemies.length, projectiles: sim.projectiles.length, damage_numbers: numberNodes(), loot_on_floor: sim.loot.length });
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function ensurePlaying() {
  if (game.state === 'title') startRun(game.startFloor);
  if (game.state === 'paused') resume();
  return game.state === 'playing';
}

function enemyCounts() {
  const by = { skeleton: 0, slime: 0, archer: 0, ash_lord: 0 };
  let awake = 0;
  for (const e of sim.enemies) {
    by[e.kind]++;
    if (e.awake) awake++;
  }
  return { total: sim.enemies.length, awake, ...by };
}

const agentApi = {
  getState() {
    const hr = sim.hero;
    const r = renderer.info;
    const lootBy = {};
    for (const it of sim.loot) {
      const k = it.kind === 'gear' ? `${it.rarity}_${it.slot}` : it.kind;
      lootBy[k] = (lootBy[k] || 0) + 1;
    }
    const b = sim.boss;
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      paused: game.state === 'paused',
      floor: sim.floor?.id,
      floor_name: sim.floor?.name,
      floor_time_s: round2(sim.floorTime),
      room: sim.rooms[sim.roomIndexAt(hr.x, hr.z)]?.id || 'hall',
      rooms: sim.rooms.map((rm) => ({ id: rm.id, awake: rm.awake, cleared: rm.cleared, swings: rm.swings })),
      stairs_open: sim.stairsOpen,
      deaths_on_floor: sim.deathsOnFloor,
      lives_left: DEATHS_PER_FLOOR - sim.deathsOnFloor,
      hero: { x: round2(hr.x), z: round2(hr.z), hp: Math.ceil(hr.hp), max_hp: hr.maxHp, mana: Math.floor(hr.mana), level: hr.level, xp: hr.xp, potions: hr.potions, gold: hr.gold, damage: hr.damage, armor: hr.armor },
      gear: Object.fromEntries(SLOTS.map((s) => [s, hr.gear[s] ? { name: hr.gear[s].name, rarity: hr.gear[s].rarity } : null])),
      enemies: enemyCounts(),
      boss: b ? { hp: Math.max(0, b.hp), max_hp: b.maxHp, state: b.state, enraged: b.enraged, started: sim.bossStarted, dead: b.dead } : null,
      projectiles: sim.projectiles.length,
      loot_on_floor: lootBy,
      damage_numbers: numberStats(),
      kills: sim.totals.kills,
      run_time_s: round2(game.runTime),
      renderer: { draw_calls: r.render.calls, geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? null },
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  loadFloor(id) {
    const index = FLOOR_IDS.indexOf(id);
    if (index < 0) return { ok: false, error: `unknown floor ${id}` };
    if (game.state === 'title' || game.state === 'win' || game.state === 'gameover') {
      sim.newRun();
      game.runTime = 0;
    }
    loadFloor(index);
    beginFloor();
    return { ok: true, floor: sim.floor.id, name: sim.floor.name, state: game.state };
  },
  spawnHits(count) {
    if (!ensurePlaying()) return { ok: false, error: `can only spawn hits while playing (state: ${game.state})` };
    const before = numberNodes();
    const targets = sim.enemies.length ? sim.enemies : [{ x: sim.hero.x + 2, y: 0, z: sim.hero.z - 1, kind: 'skeleton' }];
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const e = targets[i % targets.length];
      const crit = i % 7 === 0;
      showHit(e, 10 + ((i * 37) % 60), i % 3 === 2 ? 'burn' : 'swing', crit);
    }
    return {
      ok: true,
      spawned: count,
      damage_number_nodes_before: before,
      damage_number_nodes_after: numberNodes(),
      spawn_ms: round2(performance.now() - t0),
      note: 'Each number stays in the DOM after it fades and is re-positioned every frame. Measure a few seconds now (glitchless_measure) and compare with before.',
    };
  },
  async dropLoot(rarity, slot) {
    if (!ensurePlaying()) return { ok: false, error: `can only drop loot while playing (state: ${game.state})` };
    const hr = sim.hero;
    const item = slot === 'gold' ? { kind: 'gold', amount: 10 } : slot === 'potion' ? { kind: 'potion' } : sim.makeItem(slot, rarity);
    const errorsBefore = window.__GLITCHLESS__?.stats?.errors ?? 0;
    const it = sim.dropAt(hr.x, hr.z, item, 0);
    for (let i = 0; i < 4; i++) await nextFrame();
    const errorsAfter = window.__GLITCHLESS__?.stats?.errors ?? 0;
    const g = hr.gear[slot];
    return {
      ok: true,
      dropped: it.kind === 'gear' ? { name: it.name, rarity: it.rarity, slot: it.slot } : { kind: it.kind },
      picked_up: !sim.loot.includes(it),
      equipped: !!g && g === it,
      still_on_floor: sim.loot.includes(it),
      new_errors: errorsAfter - errorsBefore,
      hint: errorsAfter > errorsBefore ? 'Picking it up threw: see glitchless_get_error for the stack and the events before it.' : undefined,
    };
  },
  setPaused(paused) {
    if (paused && game.state === 'playing') pause();
    else if (!paused && game.state === 'paused') resume();
    return { ok: true, state: game.state, paused: game.state === 'paused' };
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.ashvale = {
  version: GAME_VERSION,
  game,
  sim,
  renderer,
  scene,
  camera,
  bot,
  api: agentApi,
  halted: false,
  numbers: numberStats,
  get state() {
    return game.state;
  },
  get level() {
    return sim.floor?.id;
  },
  get info() {
    const i = renderer.info;
    return { calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, damage_numbers: numberNodes() };
  },
};

/** Draw one of everything once behind the title, so no shader compiles on the first spawn of each kind. */
function warmUp() {
  const temp = [];
  const kinds = [
    { id: -1, kind: 'skeleton', face: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, state: 'chase', flash: 0, hop: 0 },
    { id: -2, kind: 'archer', face: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, state: 'draw', flash: 0, hop: 0 },
    { id: -3, kind: 'slime', small: false, face: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, state: 'chase', flash: 0, hop: 0 },
    { id: -4, kind: 'ash_lord', face: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, state: 'chase', flash: 0, hop: 0 },
  ];
  const s = tileCenter(sim.floor.start[0], sim.floor.start[1]);
  for (const e of kinds) {
    const v = createEnemyView(e);
    v.root.position.set(s.x, 0, s.z);
    enemyGroup.add(v.root);
    temp.push([enemyGroup, v.root]);
  }
  for (const r of RARITIES) {
    for (const slot of SLOTS) {
      const v = createLootView({ kind: 'gear', rarity: r, slot, id: 0, t: 1 });
      v.position.set(s.x, 0, s.z);
      lootGroup.add(v);
      temp.push([lootGroup, v]);
    }
  }
  for (const k of ['gold', 'potion']) {
    const v = createLootView({ kind: k, id: 0, t: 1 });
    lootGroup.add(v);
    temp.push([lootGroup, v]);
  }
  for (const k of ['arrow', 'bolt']) {
    const v = createProjectileView({ kind: k });
    projGroup.add(v);
    temp.push([projGroup, v]);
  }
  const fakes = [
    { id: -10, x: s.x, z: s.z, y: 0, face: 0, tele: { kind: 'arc', range: 2.2, arc: 1.7, t: 0.2, total: 0.5 } },
    { id: -11, x: s.x, z: s.z, y: 0, face: 0, tele: { kind: 'arc', range: 3.7, arc: 2.44, t: 0.2, total: 0.5 } },
    { id: -12, x: s.x, z: s.z, y: 0, face: 0, tele: { kind: 'circle', x: s.x, z: s.z, r: 3.4, t: 0.2, total: 0.5 } },
    { id: -13, x: s.x, z: s.z, y: 0, face: 0, r: 0.62, tele: { kind: 'line', len: 4, width: 1.24, t: 0.2, total: 0.5 } },
    { id: -14, x: s.x, z: s.z, y: 0, face: 0, r: 0.38, tele: { kind: 'line', len: 3, width: 0.76, t: 0.2, total: 0.5 } },
    { id: -15, x: s.x, z: s.z, y: 0, face: 0, tele: { kind: 'aim', len: 8, t: 0.2, total: 0.5 } },
    { id: -16, x: s.x, z: s.z, y: 0, face: 0, tele: { kind: 'fan', len: 7, arc: 1.92, t: 0.2, total: 0.5 } },
  ];
  fx.telegraphs(fakes);
  fx.slash(s.x, 0, s.z, 0, HERO.swing.arc);
  fx.nova(s.x, 0, s.z, 3);
  fx.levelUp(s.x, 0, s.z);
  heroView.root.visible = true;
  camera.position.set(s.x, 18, s.z + 11);
  camera.lookAt(s.x, 0, s.z);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  for (const [g, o] of temp) g.remove(o);
  fx.reset();
}

async function boot() {
  bindMouse(canvas);
  document.getElementById('title').addEventListener('click', () => {
    if (game.state === 'title') {
      sfx.click();
      startRun(game.startFloor);
    }
  });
  hud.footer(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  try {
    await Promise.race([document.fonts?.load('800 64px "Grenze Gotisch"'), new Promise((r) => setTimeout(r, 900))]);
  } catch {
    /* fonts are optional */
  }
  await initTelemetry({ renderer, scene, camera, THREE });
  if (gd.enabled) registerAgentTools(gd, agentApi);
  else document.getElementById('hint-gd')?.remove();
  hud.footer(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  loadFloor(game.startFloor);
  sim.state = 'idle';
  warmUp();
  const s = tileCenter(sim.floor.start[0], sim.floor.start[1]);
  camTarget.set(s.x + 7, 0, s.z);
  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
