// Undervault — a small 2.5D Three.js metroidvania (a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { ROOMS, ROOM_BY_ID, AREAS, LEVEL_ID, MAP_BOUNDS, ENTRY, roomAt, inRoom } from './rooms.js';
import { PHYS, createBody } from './physics.js';
import { createPlay, stepPlay, setGate } from './sim.js';
import { createWorld } from './world.js';
import { createKnight, animateKnight } from './knight.js';
import { Enemy } from './enemies.js';
import { Warden, WARDEN_HP } from './warden.js';
import { createFx } from './fx.js';
import { createCameraRig } from './camera.js';
import { hud, formatTime } from './hud.js';
import { keyboard } from './input.js';
import { sfx } from './audio.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

const MAX_HEARTS = 5;
const INVULN_TIME = 0.65;
const DEATH_TIME = 1.3; // death → respawn (the screen fades out and back in)
const ATTACK_TIME = 0.2;
const ATTACK_COOLDOWN = 0.32;
const BOSS_ROOM = 'warden_hall';
const round2 = (v) => Math.round(v * 100) / 100;

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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const world = createWorld(scene);
const knight = createKnight();
scene.add(knight);
const fx = createFx(scene);
const rig = createCameraRig(camera);
const bossSpec = ROOM_BY_ID[BOSS_ROOM].boss;
const warden = new Warden(bossSpec, scene);
world.rooms.get(BOSS_ROOM).group.add(warden.mesh);

// live room state: the data plus its enemies (killed ones get freed — see killEnemy)
const rooms = new Map(ROOMS.map((def) => [def.id, { id: def.id, def, enemies: [] }]));

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | playing | dying | paused | win
  room: null,
  rooms,
  warden,
  play: null, // { body, solids, hazards, movers, abilities, t } — what the physics steps
  abilities: null,
  hearts: MAX_HEARTS,
  deaths: 0,
  kills: 0,
  time: 0,
  visited: new Set(),
  save: null,
  inStatue: null,
  lastCause: null,
  invuln: 0,
  attackT: 0,
  attackCd: 0,
  attackWasDown: false,
  attackHit: new Set(),
  dyingT: 0,
  faded: false,
  deathAnim: null,
  kick: 0,
  trailT: 0,
  prevRoomT: 0,
  boss: { active: false, attempts: 0 },
  won: false,
  winT: 0,
  hintT: 0,
  pendingReenter: null,
  halted: false,
};

const bot = params.autoplay
  ? createAutoplay({
      skill: params.skill,
      seed: params.seed,
      onQuit: (reason, info) => {
        if (reason === 'ragequit' && info.where === 'warden_hall') halt('RAGE QUIT', 'Not today, Warden.', `The Warden flattened the bot ${info.bossDeaths}× and it closed the tab.`, { red: true, fail: true });
        else if (reason === 'ragequit') halt('RAGE QUIT', 'Nope. Not again.', `The bot died ${info.deaths}× in the Spike Gallery, climbed back up from the Boot Shrine each time, and closed the tab.`, { red: true, fail: true });
        else if (reason === 'timeout') halt('AUTOPLAY', 'Out of time', `The bot ran out of patience after ${formatTime(game.time)} (${game.deaths} deaths) and closed the tab.`, { fail: true });
        else halt('AUTOPLAY', 'The vault is cleared', `The bot beat the Warden in ${formatTime(game.time)} with ${game.deaths} deaths and closed the tab.`);
      },
    })
  : null;

// ─────────────────────────────────────────────────────────────── run flow

function buildEnemies() {
  for (const r of rooms.values()) {
    for (const e of r.enemies) if (e) e.mesh.parent?.remove(e.mesh);
    r.enemies = (r.def.enemies || []).map((spec) => {
      const e = new Enemy(spec, r.def);
      world.rooms.get(r.id).group.add(e.mesh);
      return e;
    });
  }
}

function newRun() {
  const gate = ROOM_BY_ID.gate;
  game.play = createPlay(gate.spawn);
  game.abilities = game.play.abilities;
  Object.assign(game, {
    hearts: MAX_HEARTS,
    deaths: 0,
    kills: 0,
    hits: 0,
    time: 0,
    visited: new Set(),
    save: { room: 'gate', x: gate.save.x, y: gate.save.y },
    inStatue: null,
    lastCause: null,
    invuln: 0,
    attackT: 0,
    attackCd: 0,
    deathAnim: null,
    boss: { active: false, attempts: 0 },
    won: false,
    winT: 0,
    hintT: 0,
    prevRoomT: 0,
  });
  buildEnemies();
  bot?.prepare(game.play);
  warden.reset();
  world.resetRelics();
  world.setGate(false);
  game.room = rooms.get('gate');
  world.show(['gate']);
  world.focus('gate');
  rig.snap(gate, gate.spawn.x, gate.spawn.y + 1.8);
  hud.relics(game.abilities);
  hud.boss(false);
  hud.fade(false);
  knight.scale.setScalar(1);
}

function beginRun() {
  game.state = 'playing';
  keyboard.clearPresses();
  hud.screen(null);
  hud.show(true);
  gd.levelStart(LEVEL_ID);
  game.room = null;
  enterRoom(rooms.get('gate'), { snap: true });
  bot?.onRunStart();
}

function restartRun(cause) {
  gd.levelFail(LEVEL_ID, { cause });
  newRun();
  beginRun();
}

function quitToTitle() {
  gd.levelFail(LEVEL_ID, { cause: game.lastCause || 'quit' });
  newRun();
  game.state = 'title';
  hud.screen('title');
  hud.show(false);
}

function score() {
  const relics = (game.abilities.dash ? 1 : 0) + (game.abilities.doubleJump ? 1 : 0);
  return Math.max(0, 1000 + game.kills * 50 + relics * 250 - game.deaths * 75 + Math.max(0, 300 - Math.round(game.time)) * 3);
}

function winRun() {
  game.state = 'win';
  const s = score();
  gd.levelComplete(LEVEL_ID, { durationS: round2(game.time), score: s });
  hud.win({ time: game.time, deaths: game.deaths, kills: game.kills, score: s });
  hud.screen('win');
  hud.show(false);
  keyboard.clearPresses();
  bot?.resetMenu(2.2);
}

function halt(ribbon, title, text, { red = false, fail = false } = {}) {
  if (game.halted) return;
  if (fail) gd.levelFail(LEVEL_ID, { cause: game.lastCause || 'quit' });
  game.halted = true;
  hud.show(false);
  hud.fade(false);
  hud.halted(ribbon, title, text, red);
  hud.screen('halted');
  window.undervault.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  setTimeout(() => endSession(), 1000);
}

// ─────────────────────────────────────────────────────────────── rooms

function enterRoom(next, { snap = false } = {}) {
  const prev = game.room;
  game.room = next;
  const first = !game.visited.has(next.id);
  game.visited.add(next.id);
  const b = game.play.body;
  const pan = prev && prev !== next && !snap;
  world.show(pan ? [prev.id, next.id] : [next.id]);
  game.prevRoomT = pan ? 0.6 : 0;
  world.focus(next.id);
  if (pan) rig.enter();
  else rig.snap(next.def, b.x, b.y + 1.8);
  hud.room(next.def);
  if (first && prev && prev.def.area !== next.def.area) hud.toast(AREAS[next.def.area].name.toUpperCase(), next.def.name, 'small', 1600);
  gd.track('room_enter', { room: next.id, area: next.def.area, first });
  bot?.onRoom(next.id, first);
  // Rooms repopulate when you come back, like any metroidvania.
  // GLITCHLESS-DEMO: backtracking error — killEnemy() "frees" a dead enemy by nulling its slot
  // (room.enemies[i] = null), so coming back into a room where you killed something throws
  // "TypeError: Cannot read properties of null (reading 'reset')" right here. Only on backtracking
  // (first: false). The room change above is already done, so the game keeps going; the enemies
  // after the null slot just don't reset.
  for (const e of next.enemies) e.reset();
}

function killEnemy(room, i) {
  const e = room.enemies[i];
  game.kills++;
  gd.track('kill', { enemy: e.kind });
  fx.burst(e.x, e.y + (e.kind === 'bat' ? 0 : 0.35), e.kind === 'bat' ? 0xb07cff : 0xffd24a, 14, 5);
  fx.poof(e.x, e.y + 0.3, 0x6f6688, 8);
  sfx.kill();
  rig.shake(0.15);
  e.mesh.parent?.remove(e.mesh);
  // free the slot so the dead enemy can be garbage-collected (see GLITCHLESS-DEMO in enterRoom)
  room.enemies[i] = null;
}

// ─────────────────────────────────────────────────────────────── player events

function hurt(damage, cause, fromX) {
  const b = game.play.body;
  game.hits++;
  game.hearts = Math.max(0, game.hearts - damage);
  game.invuln = INVULN_TIME;
  if (game.hearts <= 0) return die(cause);
  const dir = Math.sign(b.x - fromX) || -b.facing;
  b.vx = dir * 8;
  b.vy = 7;
  b.knockT = 0.24;
  b.dashT = 0;
  b.grounded = false;
  b.ground = null;
  sfx.hurt();
  rig.shake(0.35);
  fx.sparks(b.x, b.y + 0.8, 0xff6a6a, 10, 4);
  bot?.onHurt(cause);
}

function die(cause) {
  const b = game.play.body;
  game.state = 'dying';
  game.dyingT = DEATH_TIME;
  game.faded = false;
  game.deaths++;
  game.hearts = 0;
  game.lastCause = cause;
  gd.death({ x: round2(b.x), y: round2(b.y), z: 0, cause });
  if (game.boss.active) {
    game.boss.active = false;
    gd.track('boss', { result: 'died' });
  }
  bot?.onDeath(cause, b.x, b.y, game.room.id);
  sfx.death();
  rig.shake(0.55);
  fx.burst(b.x, b.y + 0.6, cause === 'lava' ? 0xff7a26 : cause === 'spikes' ? 0xdad6f0 : 0xe5484d, 22, 5.5);
  game.deathAnim = { t: 0, x: b.x, y: b.y, cause };
}

function respawn() {
  const s = game.save;
  const target = rooms.get(s.room);
  game.play.body = createBody(s.x + 0.9, s.y);
  game.hearts = MAX_HEARTS;
  game.invuln = 0.6;
  game.attackT = 0;
  game.state = 'playing';
  game.deathAnim = null;
  game.inStatue = s.room;
  knight.scale.setScalar(1);
  if (!game.won && warden.state !== 'dormant') {
    warden.reset();
    setGate(game.play, false);
    world.setGate(false);
    hud.boss(false);
  }
  hud.fade(false);
  bot?.onRespawn();
  if (target !== game.room) enterRoom(target, { snap: true }); // last: may throw (see enterRoom)
  else rig.snap(target.def, s.x, s.y + 1.8);
}

function activateStatue(def) {
  game.save = { room: def.id, x: def.save.x, y: def.save.y };
  game.hearts = MAX_HEARTS;
  game.inStatue = def.id;
  for (const r of ROOMS) if (r.save) world.setStatue(r.id, r.id === def.id);
  gd.track('save', { room: def.id });
  sfx.save();
  fx.sparks(def.save.x, def.save.y + 2.9, 0x6fd6ff, 14, 3);
  hud.toast('SAVED', 'Hearts restored. You wake up here when you fall.', 'cyan', 1500);
  bot?.onSave(def.id);
}

function collectRelic(def) {
  const ability = def.pickup.ability;
  if (ability === 'dash') game.abilities.dash = true;
  else game.abilities.doubleJump = true;
  world.takeRelic(def.id);
  gd.track('ability', { name: ability });
  sfx.relic();
  rig.shake(0.25);
  fx.burst(def.pickup.x, def.pickup.y + 1.85, ability === 'dash' ? 0xff8a3d : 0xffd36b, 26, 6);
  hud.relics(game.abilities);
  if (ability === 'dash') hud.toast('DASH CLOAK', 'Shift or K to dash, on the ground or in the air', '', 2600);
  else hud.toast('WINGED BOOTS', 'Jump again in mid-air', '', 2600);
}

function attackBox(b) {
  const x0 = b.facing > 0 ? b.x + 0.05 : b.x - 1.85;
  return { x0, x1: x0 + 1.8, y0: b.y - 0.15, y1: b.y + 1.55 };
}

function bodyBox(b) {
  return { x0: b.x - PHYS.HALF_W, x1: b.x + PHYS.HALF_W, y0: b.y, y1: b.y + PHYS.HEIGHT };
}

const overlap = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;

// ─────────────────────────────────────────────────────────────── the boss

function bossStep(dt) {
  const b = game.play.body;
  if (warden.state === 'dormant' && !game.won && b.x > bossSpec.triggerX) {
    warden.wake();
    game.boss.active = true;
    game.boss.attempts++;
    setGate(game.play, true, bossSpec.gateX);
    world.setGate(true);
    gd.track('boss', { result: 'start' });
    sfx.gate();
    rig.shake(0.3);
    hud.toast('THE WARDEN', game.boss.attempts > 1 ? `Attempt ${game.boss.attempts}` : 'Jump the shockwave. Strike while it recovers.', 'red', 2000);
  }
  if (!warden.fighting && warden.state !== 'dying') return false;
  const events = warden.step(dt, { x: b.x, y: b.y, alive: game.state === 'playing' });
  for (const e of events) {
    if (e.type === 'telegraph') {
      sfx.telegraph();
      bot?.onTelegraph(e.attack, game);
    } else if (e.type === 'slam') {
      sfx.slam();
      rig.shake(0.7);
      fx.debris(warden.x + warden.facing * 1.2, warden.y, 0x6c6480, 10);
      fx.dust(warden.x, warden.y, 12, 2.2, 0x8a8098);
    } else if (e.type === 'wall') {
      sfx.slam();
      rig.shake(0.6);
      fx.debris(warden.x + warden.facing * 1.4, warden.y + 1.5, 0x6c6480, 8);
    } else if (e.type === 'charge') {
      fx.dust(warden.x, warden.y, 10, 1.6, 0x8a8098);
    } else if (e.type === 'hit' && game.invuln <= 0 && game.state === 'playing') {
      hurt(e.damage, 'warden', e.from);
      if (game.state !== 'playing') return true;
    }
  }
  if (game.attackT > 0 && warden.fighting && !game.attackHit.has(warden) && overlap(attackBox(b), warden.hitbox())) {
    game.attackHit.add(warden);
    const killed = warden.hurt();
    sfx.hit();
    fx.sparks(warden.x - warden.facing * 0.2, warden.y + 1.8, 0xffe2a8, 12, 6);
    rig.shake(0.2);
    if (killed) wardenFell();
  }
  return false;
}

function wardenFell() {
  game.won = true;
  game.boss.active = false;
  gd.track('boss', { result: 'win' });
  setGate(game.play, false);
  world.setGate(false);
  sfx.victory();
  rig.shake(1.0);
  fx.debris(warden.x, warden.y + 1, 0x6c6480, 24);
  fx.burst(warden.x, warden.y + 2, 0xff8a3d, 30, 8);
  game.winT = 2.6;
  hud.toast('THE WARDEN FALLS', '', '', 2400);
}

// ─────────────────────────────────────────────────────────────── simulation

function fixedStep(dt) {
  bot?.tick(dt, game);
  if (game.halted) return;
  const play = game.play;

  if (game.state === 'dying') {
    play.t += dt;
    game.dyingT -= dt;
    if (!game.faded && game.dyingT < DEATH_TIME - 0.5) {
      game.faded = true;
      hud.fade(true);
    }
    if (game.dyingT <= 0) respawn();
    return;
  }

  // an agent's undervault_reenter_room: leave and come back through the doors, inside the loop
  const p = game.pendingReenter;
  if (p) {
    game.pendingReenter = null;
    placeAt(p.away);
    enterRoom(rooms.get(p.away), { snap: true });
    placeAt(p.room);
    enterRoom(rooms.get(p.room), { snap: true });
  }

  game.time += dt;
  if (game.invuln > 0) game.invuln -= dt;
  const input = bot ? bot.step(game, dt) : keyboard.state();
  const b = play.body;

  // sword
  const attackPressed = input.attack && !game.attackWasDown;
  game.attackWasDown = !!input.attack;
  if (game.attackCd > 0) game.attackCd -= dt;
  if (game.attackT > 0) game.attackT -= dt;
  if (attackPressed && game.attackCd <= 0 && b.knockT <= 0) {
    game.attackT = ATTACK_TIME;
    game.attackCd = ATTACK_COOLDOWN;
    game.attackHit.clear();
    sfx.swing();
  }

  const ev = stepPlay(play, input, dt);
  if (ev.jumped) {
    game.kick -= 8;
    fx.dust(b.x, b.y, 4, 0.7);
    sfx.jump();
  }
  if (ev.airJumped) {
    game.kick -= 6;
    fx.sparks(b.x, b.y + 0.1, 0xffe08a, 8, 3);
    sfx.airJump();
  }
  if (ev.dashed) {
    sfx.dash();
    game.trailT = 0;
  }
  if (ev.landed) {
    const s = Math.min(1, -ev.landVy / 20);
    game.kick += 3 + 9 * s;
    if (s > 0.35) {
      fx.dust(b.x, b.y, 6, 0.6 + s * 0.6);
      sfx.land();
    }
  }
  if (ev.hazard) return die(ev.hazard.cause);

  // enemies in this room (freed slots are null — skip them)
  const room = game.room;
  const me = bodyBox(b);
  const atk = game.attackT > 0 ? attackBox(b) : null;
  for (let i = 0; i < room.enemies.length; i++) {
    const e = room.enemies[i];
    if (!e || !e.alive) continue;
    e.step(dt, { x: b.x, y: b.y, alive: true });
    const hb = e.hitbox();
    if (atk && overlap(atk, hb)) {
      killEnemy(room, i);
      continue;
    }
    if (game.invuln <= 0 && overlap(me, hb)) {
      hurt(e.damage, e.kind, e.x);
      if (game.state !== 'playing') return;
    }
  }

  if (room.id === BOSS_ROOM && bossStep(dt)) return;
  if (game.winT > 0 && (game.winT -= dt) <= 0) return winRun();

  // save statues and relics
  const def = room.def;
  if (def.save) {
    const s = def.save;
    const touching = Math.abs(b.x - s.x) < 0.95 && Math.abs(b.y - s.y) < 1.6;
    if (touching && game.inStatue !== def.id) activateStatue(def);
    else if (!touching && game.inStatue === def.id) game.inStatue = null;
  }
  if (def.pickup && !world.rooms.get(def.id).relic.taken) {
    const p = def.pickup;
    if (Math.abs(b.x - p.x) < 0.9 && b.y >= p.y - 0.2 && b.y - p.y < 2.4) collectRelic(def);
  }

  if (b.y < MAP_BOUNDS.min[1] - 4) return die('lava'); // fell out of the world (shouldn't happen)

  // room change last: enterRoom() can throw on backtracking (see GLITCHLESS-DEMO there)
  const cy = b.y + PHYS.HEIGHT / 2;
  if (!inRoom(room.def, b.x, cy, 0.35)) {
    const next = roomAt(b.x, cy);
    if (next) enterRoom(rooms.get(next.id));
  }
}

// ─────────────────────────────────────────────────────────────── per-frame

let clock = 0;

function handleMenus(dt) {
  if (keyboard.consume('mute')) hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', '', 'small', 900);
  const s = game.state;
  const confirm = () => keyboard.consume('jump') || keyboard.consume('confirm') || (bot ? bot.menu(s, dt) : false);
  if (s === 'title') {
    if (confirm()) beginRun();
  } else if (s === 'playing' || s === 'dying') {
    if (keyboard.consume('pause') && s === 'playing') {
      game.state = 'paused';
      hud.screen('pause');
    }
  } else if (s === 'paused') {
    if (keyboard.consume('pause') || keyboard.consume('confirm')) {
      game.state = 'playing';
      hud.screen(null);
    } else if (keyboard.consume('restart')) {
      hud.screen(null);
      restartRun('restart');
    } else if (keyboard.consume('quit')) quitToTitle();
  } else if (s === 'win') {
    if (confirm()) {
      newRun();
      beginRun();
    }
  }
}

function updateVisuals(dt) {
  const b = game.play.body;
  const room = game.room;

  if (game.state === 'dying' && game.deathAnim) {
    const d = game.deathAnim;
    d.t += dt;
    knight.position.set(d.x, d.y - (d.cause === 'lava' ? d.t * 1.6 : 0), 0);
    knight.scale.setScalar(Math.max(0.01, 1 - d.t * 2.6));
  } else {
    knight.position.set(b.x, b.y, 0);
  }
  animateKnight(
    knight,
    {
      vx: b.vx,
      vy: b.vy,
      grounded: b.grounded,
      facing: b.facing,
      attack: game.attackT > 0 ? 1 - game.attackT / ATTACK_TIME : -1,
      dashing: b.dashT > 0,
      kick: game.kick,
      hurt: game.invuln > 0.4,
      abilities: game.abilities,
    },
    dt,
  );
  game.kick = 0;
  knight.visible = game.state === 'title' || !(game.invuln > 0 && game.state === 'playing' && Math.floor(game.invuln * 16) % 2 === 0);
  if (b.dashT > 0 && (game.trailT -= dt) <= 0) {
    game.trailT = 0.025;
    fx.afterimage(b.x, b.y);
  }

  for (const e of room.enemies) if (e) e.animate(dt);
  warden.animate(dt, clock);
  world.animate(dt, clock, game.play.movers);
  for (const h of room.def.hazards) if (h.kind === 'lava' && Math.random() < dt * 6) fx.embers(h.x0, h.x1, h.surface, 1);
  fx.update(dt);

  if (game.prevRoomT > 0 && (game.prevRoomT -= dt) <= 0) world.show([room.id]);
  const focus = rig.update(dt, room.def, { x: b.x, y: b.y, facing: b.facing }, game.state === 'title' ? 'title' : 'play');
  world.follow(focus.x, focus.y);

  hud.timer(game.time);
  hud.hearts(game.hearts, MAX_HEARTS);
  hud.deaths(game.deaths);
  hud.map(game.visited.size ? game.visited : new Set([room.id]), room.id, b);
  const fighting = warden.fighting && room.id === BOSS_ROOM;
  hud.boss(fighting, warden.hp / WARDEN_HP, warden.enraged);
  if (game.state === 'playing') {
    game.hintT += dt;
    hud.hint(!bot && game.hintT < 10);
  } else if (game.state !== 'paused') hud.hint(false);
}

function aliveEnemies() {
  let n = 0;
  for (const e of game.room.enemies) if (e && e.alive) n++;
  return n + (warden.fighting && game.room.id === BOSS_ROOM ? 1 : 0);
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
  if (game.state === 'playing' || game.state === 'dying') {
    acc = Math.min(acc + raw * params.turbo, 0.25 * params.turbo);
    while (acc >= PHYS.STEP) {
      acc -= PHYS.STEP;
      fixedStep(PHYS.STEP);
      if (game.halted || (game.state !== 'playing' && game.state !== 'dying')) break;
    }
  } else {
    acc = 0;
    if (bot && game.state !== 'title') bot.tick(dt, game);
  }

  updateVisuals(dt);
  gd.setPosition(knight.position);
  gd.setContext({ enemies: aliveEnemies(), particles: fx.count });
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

function ensurePlaying() {
  if (game.state === 'title' || game.state === 'win') {
    if (game.state === 'win') newRun();
    beginRun();
  }
  if (game.state === 'dying') respawn();
  return game.state === 'playing' || game.state === 'paused';
}

function placeAt(roomId) {
  const at = ENTRY[roomId];
  game.play.body = createBody(at.x, at.y);
  game.invuln = 0.5;
  game.inStatue = null;
  bot?.onRespawn();
}

const agentApi = {
  getState() {
    const b = game.play.body;
    const r = renderer.info;
    const room = game.room;
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      level: LEVEL_ID,
      room: room.id,
      room_name: room.def.name,
      area: room.def.area,
      time_s: +game.time.toFixed(2),
      player: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2), grounded: b.grounded, facing: b.facing, dashing: b.dashT > 0 },
      hearts: game.hearts,
      abilities: { dash: game.abilities.dash, double_jump: game.abilities.doubleJump },
      deaths: game.deaths,
      hits_taken: game.hits,
      last_death_cause: game.lastCause,
      kills: game.kills,
      save_room: game.save.room,
      visited: [...game.visited],
      enemies: { alive: room.enemies.filter((e) => e && e.alive).length, freed_slots: room.enemies.filter((e) => e === null).length, total_slots: room.enemies.length },
      boss: { state: warden.state, hp: warden.hp, max_hp: WARDEN_HP, enraged: warden.enraged, attempts: game.boss.attempts },
      particles: fx.count,
      renderer: { draw_calls: r.render.calls, geometries: r.memory.geometries, textures: r.memory.textures },
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  teleport(roomId) {
    if (!rooms.has(roomId)) return { ok: false, error: `unknown room ${roomId}` };
    if (!ensurePlaying()) return { ok: false, error: `cannot teleport in state ${game.state}` };
    placeAt(roomId);
    let threw = null;
    if (game.room.id !== roomId) {
      try {
        enterRoom(rooms.get(roomId), { snap: true });
      } catch (err) {
        threw = String(err?.message || err);
        setTimeout(() => {
          throw err; // still report it to window.onerror (Glitchless), like real play would
        });
      }
    }
    return { ok: true, room: game.room.id, x: game.play.body.x, y: game.play.body.y, state: game.state, ...(threw ? { enter_room_threw: threw } : {}) };
  },
  grantAbility(ability) {
    const def = ability === 'dash' ? ROOM_BY_ID.dash_shrine : ROOM_BY_ID.boot_shrine;
    if (ability !== 'dash' && ability !== 'double_jump') return { ok: false, error: 'ability must be dash or double_jump' };
    if (!ensurePlaying()) return { ok: false, error: `not playing (state ${game.state})` };
    const have = ability === 'dash' ? game.abilities.dash : game.abilities.doubleJump;
    if (!have) collectRelic(def);
    return { ok: true, abilities: { dash: game.abilities.dash, double_jump: game.abilities.doubleJump }, already_had: have };
  },
  setPaused(paused) {
    if (paused && game.state === 'playing') {
      game.state = 'paused';
      hud.screen('pause');
    } else if (!paused && game.state === 'paused') {
      game.state = 'playing';
      hud.screen(null);
    }
    return { ok: true, state: game.state, paused: game.state === 'paused' };
  },
  /** leave the room and come back through the real enterRoom() path (optionally killing one enemy first) */
  async reenterRoom(roomId, killOne = true) {
    if (!rooms.has(roomId)) return { ok: false, error: `unknown room ${roomId}` };
    if (!ensurePlaying()) return { ok: false, error: `not playing (state ${game.state})` };
    const room = rooms.get(roomId);
    const away = roomId === 'gate' ? 'ossuary' : 'gate';
    placeAt(roomId);
    if (game.room.id !== roomId) enterRoom(room, { snap: true });
    let killed = null;
    if (killOne) {
      const i = room.enemies.findIndex((e) => e && e.alive);
      if (i >= 0) {
        killed = room.enemies[i].kind;
        killEnemy(room, i);
      }
    }
    // the leave + come back happen inside the game loop, exactly like walking through the doors
    game.pendingReenter = { room: roomId, away };
    await new Promise((r) => setTimeout(r, 250));
    const freed = room.enemies.filter((e) => e === null).length;
    return {
      ok: true,
      room: game.room.id,
      killed_first: killed,
      freed_slots: freed,
      expect_error: freed > 0 ? "TypeError: Cannot read properties of null (reading 'reset') — thrown in enterRoom(), reported to window.onerror / Glitchless" : 'none: no freed enemy slots in this room',
      state: game.state,
    };
  },
};

// ─────────────────────────────────────────────────────────────── boot

window.undervault = {
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
  get room() {
    return game.room?.id;
  },
  get info() {
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, particles: fx.count };
  },
};

function captureCastleMap() {
  // the whole castle, with the knight and effects hidden, as the heatmap background. Only the current
  // room has torch lights, so the other rooms get a brighter ambient light for the shot.
  world.showAll();
  world.follow((MAP_BOUNDS.min[0] + MAP_BOUNDS.max[0]) / 2, (MAP_BOUNDS.min[1] + MAP_BOUNDS.max[1]) / 2);
  const hemi = { i: world.hemi.intensity, c: world.hemi.color.getHex() };
  const keyI = world.key.intensity;
  world.hemi.intensity = 3;
  world.hemi.color.setHex(0xffffff);
  world.key.intensity = 2;
  gd.captureMap(LEVEL_ID, { axis: 'xy', bounds: { min: MAP_BOUNDS.min, max: MAP_BOUNDS.max }, exclude: [knight, ...warden.waveMeshes] });
  world.hemi.intensity = hemi.i;
  world.hemi.color.setHex(hemi.c);
  world.key.intensity = keyI;
  world.show([game.room.id]);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** compile every material up front (in parallel where the driver allows), so no room stalls on its first visit */
async function warmUp() {
  world.showAll();
  const extras = [...warden.waveMeshes, fx.sample];
  extras.forEach((o) => (o.visible = true));
  // twice: once for the canvas, once for an offscreen target (captureMap renders the castle into one,
  // and three.js builds different program variants for render targets)
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
  extras.forEach((o) => (o.visible = false));
  world.show([game.room.id]);
}

async function boot() {
  hud.initTitle(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  newRun();
  // fonts, the SDK and the shader warm-up load side by side; the heavy steps after that get a frame each
  const fonts = Promise.race([document.fonts?.load('900 64px Cinzel'), new Promise((r) => setTimeout(r, 900))]).catch(() => {});
  await Promise.all([fonts, initTelemetry({ renderer, scene, camera, THREE }), warmUp()]);
  if (gd.enabled) registerAgentTools(gd, agentApi);
  else document.getElementById('hint-gd')?.remove();
  hud.initTitle(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  await nextFrame();
  captureCastleMap();
  await nextFrame();
  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
