// Gatekeep — a small Three.js tower defense (a Glitchless genre demo).
import * as THREE from 'three';
import { params } from './params.js';
import { GAME_VERSION } from './version.js';
import { createSim, STEP } from './sim.js';
import { TOWERS, TOWER_TYPES, ENEMIES, WAVE_COUNT, EARLY_GOLD_PER_S, waveId, towerStats } from './rules.js';
import { tileX, tileZ, tileAt, GATE } from './map.js';
import { createWorld } from './world.js';
import { createTower, setTowerTier, animateTower, kickTower, createEnemy, animateEnemy } from './units.js';
import { createHealthBar, drawHealthBar, updateHealthBars, removeHealthBar, healthBars } from './healthbars.js';
import { createFx } from './fx.js';
import { hud } from './hud.js';
import { input, mouse, attachMouse } from './input.js';
import { sfx } from './audio.js';
import { gd, initTelemetry, endSession } from './telemetry.js';
import { createAutoplay } from './autoplay.js';
import { registerAgentTools } from './agent-tools.js';

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
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 200);
const CAM_TARGET = new THREE.Vector3(-0.1, -0.6, 0.9);
const CAM_OFFSET = new THREE.Vector3(0, 19.6, 13.4);

function frameCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  // keep the whole plateau in view on narrow windows
  const k = Math.max(1, 1.78 / aspect);
  camera.position.copy(CAM_TARGET).addScaledVector(CAM_OFFSET, k);
  camera.lookAt(CAM_TARGET);
  camera.updateProjectionMatrix();
}
frameCamera();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  frameCamera();
});

const world = createWorld(scene, renderer);
const fx = createFx(scene, camera, document.getElementById('floaters'));
attachMouse(canvas);
hud.init();

// ─────────────────────────────────────────────────────────────── game state

const game = {
  state: 'boot', // boot | title | playing | paused | over
  sim: createSim({ seed: params.seed, firstWave: params.level }),
  run: 0,
  fast: false,
  selected: null, // tower id
  menu: null, // { col, row } while the build menu is open
  menuHover: null, // tower type hovered in the build menu
  armed: null, // tower type picked from the palette, placed on the next click
  hover: null, // tile under the mouse
  shake: 0,
  playT: 0,
  halted: false,
};
const views = { enemies: new Map(), towers: new Map() };

const bot = params.autoplay ? createAutoplay({ skill: params.skill, seed: params.seed }) : null;

// ─────────────────────────────────────────────────────────────── views of sim objects

const BAR = {
  runner: { w: 0.6, y: 0.86 },
  grunt: { w: 0.72, y: 0.94 },
  brute: { w: 0.96, y: 1.32 },
  swarmling: { w: 0.44, y: 0.52 },
};

function addEnemyView(e) {
  const parts = createEnemy(e.type);
  scene.add(parts.group);
  const bar = createHealthBar(BAR[e.type].w); // (see GLITCHLESS-DEMO note in healthbars.js)
  scene.add(bar.sprite);
  const v = { parts, bar };
  views.enemies.set(e.id, v);
  syncEnemy(e, v, 0);
}

function syncEnemy(e, v, dt) {
  animateEnemy(v.parts, e, dt);
  v.bar.sprite.position.set(e.x, BAR[e.type].y, e.z);
}

function removeEnemyView(e) {
  const v = views.enemies.get(e.id);
  if (!v) return;
  views.enemies.delete(e.id);
  v.parts.group.removeFromParent();
  removeHealthBar(v.bar); // (see GLITCHLESS-DEMO note in healthbars.js)
}

function addTowerView(t) {
  const parts = createTower(t.type);
  parts.group.position.set(t.x, 0, t.z);
  scene.add(parts.group);
  setTowerTier(parts, t.tier);
  views.towers.set(t.id, parts);
}

function removeTowerView(t) {
  const parts = views.towers.get(t.id);
  if (!parts) return;
  views.towers.delete(t.id);
  parts.group.removeFromParent();
}

function clearViews() {
  for (const [id, v] of views.enemies) removeEnemyView({ id, ...v });
  for (const [, parts] of views.towers) parts.group.removeFromParent();
  views.towers.clear();
  fx.clearProjectiles();
}

// ─────────────────────────────────────────────────────────────── sim events → visuals, sound, telemetry

function drainEvents() {
  const sim = game.sim;
  for (const e of sim.events) {
    switch (e.type) {
      case 'wave_start':
        gd.levelStart(waveId(e.wave));
        hud.banner(`WAVE ${e.wave}`, e.wave === WAVE_COUNT ? 'Final wave' : '', 1300);
        sfx.wave();
        break;
      case 'wave_clear':
        gd.levelComplete(waveId(e.wave), { durationS: e.durationS, score: e.gold });
        if (e.wave < WAVE_COUNT) hud.toast(`Wave ${e.wave} cleared · +${e.bonus}g`, 'gold', 1600);
        sfx.clear();
        break;
      case 'won':
        gd.track('run_end', { result: 'win', wave: e.wave });
        endRun(true);
        break;
      case 'gate_fallen':
        gd.levelFail(waveId(e.wave), { cause: e.cause });
        gd.track('run_end', { result: 'lose', wave: e.wave });
        endRun(false, e);
        break;
      case 'early_call':
        gd.track('early_call', {});
        if (e.bonus > 0) hud.toast(`Called early · +${e.bonus}g`, 'gold', 1200);
        break;
      case 'spawn':
        addEnemyView(e.enemy);
        break;
      case 'hit': {
        const v = views.enemies.get(e.enemy.id);
        if (v) drawHealthBar(v.bar, e.enemy.hp / e.enemy.maxHp); // (see GLITCHLESS-DEMO note in healthbars.js)
        break;
      }
      case 'kill': {
        const en = e.enemy;
        gd.track('kill', { tower: e.tower, enemy: en.type });
        fx.puff(en.x, 0.25, en.z, en.type === 'brute' ? 0xc9ced6 : 0xffffff, en.type === 'swarmling' ? 0.12 : 0.22);
        if (en.type !== 'swarmling' || en.id % 5 === 0) fx.floater(`+${ENEMIES[en.type].gold}`, en.x, 0.7, en.z);
        removeEnemyView(en);
        break;
      }
      case 'leak':
        gd.track('leak', { enemy: e.enemy.type });
        removeEnemyView(e.enemy);
        world.hitGate();
        game.shake = Math.min(0.5, game.shake + 0.18);
        fx.floater(`-${e.cost}`, tileX(GATE.col), 1.4, tileZ(GATE.row), 'bad');
        sfx.leak();
        break;
      case 'despawn':
        removeEnemyView(e.enemy);
        break;
      case 'fire': {
        fx.fire(e.projectile);
        const parts = views.towers.get(e.tower.id);
        if (parts) kickTower(parts);
        if (e.projectile.kind === 'arrow') sfx.arrow();
        else sfx.cannon();
        break;
      }
      case 'projectile_end':
        fx.endProjectile(e.projectile);
        break;
      case 'explode':
        fx.explode(e.x, e.z, e.radius);
        break;
      case 'pulse': {
        fx.pulse(e.tower.x, e.tower.z, e.range);
        const parts = views.towers.get(e.tower.id);
        if (parts) kickTower(parts);
        sfx.frost();
        break;
      }
      case 'built':
        gd.track('tower_built', { type: e.tower.type, zone: e.tower.zone });
        gd.track('gold_spent', { on: 'build', type: e.tower.type, gold: e.cost });
        addTowerView(e.tower);
        fx.puff(e.tower.x, 0.2, e.tower.z, 0xe8dcc4, 0.25);
        sfx.build();
        break;
      case 'upgraded': {
        gd.track('tower_upgraded', { type: e.tower.type, tier: e.tower.tier });
        gd.track('gold_spent', { on: 'upgrade', type: e.tower.type, gold: e.cost });
        const parts = views.towers.get(e.tower.id);
        if (parts) setTowerTier(parts, e.tower.tier);
        fx.puff(e.tower.x, 0.6, e.tower.z, 0xffc83d, 0.22);
        sfx.upgrade();
        break;
      }
      case 'sold':
        gd.track('tower_sold', { type: e.tower.type });
        removeTowerView(e.tower);
        fx.puff(e.tower.x, 0.2, e.tower.z, 0xe8dcc4, 0.25);
        fx.floater(`+${e.refund}`, e.tower.x, 0.9, e.tower.z);
        if (game.selected === e.tower.id) game.selected = null;
        sfx.sell();
        break;
    }
  }
  sim.events.length = 0;
}

// ─────────────────────────────────────────────────────────────── actions (mouse, keys, bot, agents)

function toggleSpeed() {
  game.fast = !game.fast;
  gd.track('fast_forward', { on: game.fast });
  hud.toast(game.fast ? 'Speed 2x' : 'Speed 1x', '', 800);
}

function applyCommand(cmd, source = 'player') {
  const sim = game.sim;
  let r;
  if (cmd.type === 'build') r = sim.build(cmd.tower, cmd.col, cmd.row);
  else if (cmd.type === 'upgrade') r = sim.upgrade(cmd.id);
  else if (cmd.type === 'sell') r = sim.sell(cmd.id);
  else if (cmd.type === 'call') r = sim.callWave();
  else if (cmd.type === 'speed') {
    toggleSpeed();
    r = { ok: true, fast: game.fast };
  } else r = { ok: false, error: `unknown command ${cmd.type}` };
  if (!r.ok && source === 'player') {
    hud.toast(r.error[0].toUpperCase() + r.error.slice(1), 'bad', 1100);
    sfx.nope();
  }
  drainEvents();
  return r;
}

const towerAt = (col, row) => game.sim.towers.find((t) => t.col === col && t.row === row) || null;
const selectedTower = () => (game.selected ? game.sim.towers.find((t) => t.id === game.selected) || null : null);

function closeMenus() {
  game.menu = null;
  game.menuHover = null;
  game.armed = null;
}

function buildAt(type, tile) {
  const r = applyCommand({ type: 'build', tower: type, col: tile.col, row: tile.row });
  if (r.ok) {
    game.menu = null;
    game.menuHover = null;
    if (game.armed && game.sim.gold < TOWERS[game.armed].cost) game.armed = null;
  }
  return r;
}

function handleClick(click) {
  const tile = pickTile(click.x, click.y);
  if (click.button === 2) {
    closeMenus();
    game.selected = null;
    return;
  }
  if (!tile) {
    closeMenus();
    game.selected = null;
    return;
  }
  const t = towerAt(tile.col, tile.row);
  if (t) {
    closeMenus();
    game.selected = t.id;
    return;
  }
  game.selected = null;
  if (!game.sim.canBuild(tile.col, tile.row)) {
    closeMenus();
    return;
  }
  if (game.armed) buildAt(game.armed, tile);
  else game.menu = { col: tile.col, row: tile.row };
}

function hotkeyBuild(type) {
  const tile = game.menu || game.hover;
  if (tile && game.sim.canBuild(tile.col, tile.row)) buildAt(type, tile);
  else {
    game.armed = game.armed === type ? null : type;
    game.menu = null;
    game.selected = null;
  }
}

hud.on('palette', (type) => {
  if (game.state !== 'playing') return;
  game.armed = game.armed === type ? null : type;
  game.menu = null;
  game.selected = null;
});
hud.on('menu', (type) => game.state === 'playing' && game.menu && buildAt(type, game.menu));
hud.on('menuHover', (type) => (game.menuHover = type));
hud.on('next', () => game.state === 'playing' && applyCommand({ type: 'call' }));
hud.on('speed', () => game.state === 'playing' && applyCommand({ type: 'speed' }));
hud.on('pause', () => (game.state === 'paused' ? resume() : game.state === 'playing' && pause()));
hud.on('upgrade', () => game.state === 'playing' && game.selected && applyCommand({ type: 'upgrade', id: game.selected }));
hud.on('sell', () => game.state === 'playing' && game.selected && applyCommand({ type: 'sell', id: game.selected }));
hud.on('start', () => game.state === 'title' && startRun());
hud.on('again', () => game.state === 'over' && game.overShown && !bot && startRun());

// ─────────────────────────────────────────────────────────────── picking

const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

function pickTile(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  return tileAt(hit.x, hit.z);
}

// ─────────────────────────────────────────────────────────────── run flow

function startRun() {
  if (game.run > 0 || game.sim.phase !== 'build' || game.sim.towers.length) {
    clearViews();
    game.sim = createSim({ seed: params.seed + game.run, firstWave: params.level });
  }
  game.run++;
  game.fast = false;
  game.selected = null;
  closeMenus();
  game.playT = 0;
  game.state = 'playing';
  input.clear();
  hud.screen(null);
  hud.show(true);
  hud.banner('BUILD!', `Wave ${game.sim.wave} in ${Math.ceil(game.sim.buildLeft)}s · click a tile`, 1800);
}

function pause() {
  game.state = 'paused';
  hud.screen('pause');
}
function resume() {
  game.state = 'playing';
  hud.screen(null);
  input.clear();
}

function endRun(win, e) {
  const sim = game.sim;
  game.state = 'over';
  closeMenus();
  game.selected = null;
  if (win) sfx.win();
  else sfx.lose();
  const stats = {
    wave: sim.wave,
    lives: sim.lives,
    kills: sim.stats.kills,
    towers: sim.towers.length,
    why: win ? `Gold left: ${sim.gold}` : `A ${ENEMIES[e.cause].name.toLowerCase()} broke through on wave ${e.wave}.`,
  };
  game.overShown = false;
  const run = game.run;
  setTimeout(() => {
    if (game.run !== run || game.state !== 'over') return;
    game.overShown = true;
    if (bot) {
      halt(
        'AUTOPLAY',
        win ? 'The gate holds!' : 'The gate has fallen',
        win
          ? `The bot (skill ${params.skill.toFixed(2)}) cleared all ${WAVE_COUNT} waves with ${sim.lives} lives left and closed the tab.`
          : `The bot (skill ${params.skill.toFixed(2)}) lost the gate to ${e.cause}s on wave ${e.wave} and closed the tab.`,
      );
      return;
    }
    hud.over(win, stats);
    hud.screen('over');
    hud.show(false);
  }, 1400);
}

function halt(ribbon, title, text) {
  game.halted = true;
  if (bot) bot.halted = true;
  hud.show(false);
  hud.halted(ribbon, title, text);
  hud.screen('halted');
  window.gatekeep.halted = true;
  window.__GLITCHLESS_PLAYTEST_DONE__ = true;
  // "close the tab": let the SDK flush and send session_end
  setTimeout(endSession, 1000);
}

// ─────────────────────────────────────────────────────────────── per-frame

function handleInput(dt) {
  if (input.consume('mute')) hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', '', 900);
  const s = game.state;
  if (s === 'title') {
    if (input.consume('call') || input.consume('confirm') || (bot && bot.menu(dt))) startRun();
    return;
  }
  if (s === 'over') {
    if (!bot && game.overShown && (input.consume('call') || input.consume('confirm'))) startRun();
    return;
  }
  if (s === 'paused') {
    if (input.consume('pause') || input.consume('confirm')) resume();
    return;
  }
  if (s !== 'playing') return;

  if (input.consume('pause')) {
    if (game.menu || game.armed || game.selected) {
      closeMenus();
      game.selected = null;
    } else pause();
    return;
  }
  // clicks first, so a key pressed right after selecting a tower applies to it
  game.hover = mouse.inside ? pickTile(mouse.x, mouse.y) : null;
  let click;
  while ((click = input.nextClick())) handleClick(click);

  if (input.consume('speed')) applyCommand({ type: 'speed' });
  if (input.consume('call')) applyCommand({ type: 'call' });
  TOWER_TYPES.forEach((type, i) => input.consume(`build${i + 1}`) && hotkeyBuild(type));
  if (input.consume('upgrade') && game.selected) applyCommand({ type: 'upgrade', id: game.selected });
  if (input.consume('sell') && game.selected) applyCommand({ type: 'sell', id: game.selected });
}

function fixedStep() {
  const sim = game.sim;
  if (bot) for (const c of bot.step(sim, { fast: game.fast })) applyCommand(c, 'bot');
  sim.step(STEP);
  drainEvents();
}

const tmp = new THREE.Vector3();
let clock = 0;

function updateVisuals(dt) {
  const sim = game.sim;
  for (const e of sim.enemies) {
    const v = views.enemies.get(e.id);
    if (v) syncEnemy(e, v, dt);
  }
  for (const t of sim.towers) {
    const parts = views.towers.get(t.id);
    if (parts) animateTower(parts, t, dt);
  }
  if (game.state === 'playing') updateHealthBars(dt * (game.fast ? 2 : 1)); // (see GLITCHLESS-DEMO note in healthbars.js)
  fx.syncProjectiles(sim.projectiles);
  fx.update(dt, clock);
  world.update(dt, clock);

  // cursor, range ring, build menu
  const playing = game.state === 'playing';
  const sel = selectedTower();
  const cursorTile = game.menu || game.hover;
  if (playing && cursorTile) {
    const t = towerAt(cursorTile.col, cursorTile.row);
    fx.showCursor(tileX(cursorTile.col), tileZ(cursorTile.row), !!t || sim.canBuild(cursorTile.col, cursorTile.row));
  } else fx.hideCursor();

  const placing = game.menu && game.menuHover ? { tile: game.menu, type: game.menuHover } : game.armed && game.hover && sim.canBuild(game.hover.col, game.hover.row) ? { tile: game.hover, type: game.armed } : null;
  if (playing && placing) {
    const ok = sim.gold >= TOWERS[placing.type].cost;
    fx.showRange(tileX(placing.tile.col), tileZ(placing.tile.row), towerStats(placing.type, 1).range, ok ? 0x7dffb0 : 0xff6b5e);
  } else if (playing && sel) fx.showRange(sel.x, sel.z, towerStats(sel.type, sel.tier).range, 0xffffff);
  else fx.hideRange();

  if (playing && game.menu) {
    tmp.set(tileX(game.menu.col), 0.2, tileZ(game.menu.row)).project(camera);
    hud.buildMenu(true, (tmp.x * 0.5 + 0.5) * window.innerWidth, (-tmp.y * 0.5 + 0.5) * window.innerHeight);
  } else hud.buildMenu(false);

  // camera (with a little shake when the gate is hit)
  game.shake = Math.max(0, game.shake - dt * 1.6);
  frameCamera();
  if (game.shake > 0) {
    const s = game.shake * game.shake * 0.5;
    camera.position.x += Math.sin(clock * 61) * s;
    camera.position.y += Math.sin(clock * 47) * s;
  }

  // HUD
  hud.wave(sim.wave, WAVE_COUNT);
  hud.lives(sim.lives);
  hud.gold(sim.gold);
  hud.nextWave({ phase: sim.phase, wave: sim.wave, left: sim.buildLeft, bonus: Math.max(0, Math.round(sim.buildLeft * EARLY_GOLD_PER_S)), enemies: sim.enemies.length + sim.queue.length });
  hud.speed(game.fast);
  hud.armed(game.armed);
  hud.towerPanel(playing ? sel : null, sim.gold);
  if (playing) {
    game.playT += dt;
    hud.hint(!bot && game.playT < 14);
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

  handleInput(dt);
  if (game.state === 'playing') {
    const speed = game.fast ? 2 : 1;
    acc = Math.min(acc + raw * speed, 0.25 * speed);
    while (acc >= STEP) {
      acc -= STEP;
      fixedStep();
      if (game.state !== 'playing') break;
    }
  } else acc = 0;

  updateVisuals(dt);
  gd.setContext({ enemies: game.sim.enemies.length, projectiles: game.sim.projectiles.length, towers: game.sim.towers.length, health_bars: healthBars.live });
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────── agent tools (WebMCP via Glitchless)

function ensurePlaying() {
  if (game.state === 'title' || game.state === 'over') startRun();
  if (game.state === 'paused') resume();
  return game.state === 'playing' ? null : `cannot act in state ${game.state}`;
}

const agentApi = {
  getState() {
    const sim = game.sim;
    const r = renderer.info;
    const byType = {};
    for (const e of sim.enemies) byType[e.type] = (byType[e.type] || 0) + 1;
    return {
      ok: true,
      version: GAME_VERSION,
      state: game.state,
      phase: sim.phase,
      wave: sim.wave,
      level: waveId(sim.wave),
      waves: WAVE_COUNT,
      build_time_left_s: sim.phase === 'build' ? +sim.buildLeft.toFixed(1) : 0,
      gold: sim.gold,
      lives: sim.lives,
      speed: game.fast ? 2 : 1,
      towers: sim.towers.map((t) => ({ id: t.id, type: t.type, tier: t.tier, col: t.col, row: t.row, zone: t.zone, kills: t.kills })),
      enemies: sim.enemies.length,
      enemies_by_type: byType,
      queued_spawns: sim.queue.length,
      projectiles: sim.projectiles.length,
      health_bars_live: healthBars.live,
      health_bars_created: healthBars.made,
      health_bar_redraws: healthBars.redraws,
      renderer: { draw_calls: r.render.calls, geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? null },
      autoplay: bot ? { skill: params.skill, seed: params.seed, halted: game.halted } : null,
    };
  },
  startWave(n) {
    const err = ensurePlaying();
    if (err) return { ok: false, error: err };
    game.sim.jumpToWave(n);
    drainEvents();
    return { ok: true, wave: game.sim.wave, level: waveId(game.sim.wave), state: game.state };
  },
  build(type, col, row) {
    const err = ensurePlaying();
    if (err) return { ok: false, error: err };
    const r = applyCommand({ type: 'build', tower: type, col, row }, 'agent');
    if (!r.ok) return r;
    const t = r.tower;
    return { ok: true, tower: { id: t.id, type: t.type, tier: t.tier, col: t.col, row: t.row, zone: t.zone }, gold: game.sim.gold };
  },
  addGold(amount) {
    return { ok: true, gold: game.sim.addGold(Math.round(amount)) };
  },
  spawnSwarm(count) {
    const err = ensurePlaying();
    if (err) return { ok: false, error: err };
    const before = renderer.info.memory.textures;
    game.sim.spawnPack('swarmling', count);
    drainEvents();
    return {
      ok: true,
      spawned: count,
      wave: game.sim.wave,
      enemies: game.sim.enemies.length,
      health_bars_live: healthBars.live,
      textures_before: before,
      note: 'each swarmling gets its own health-bar texture; they upload on the next rendered frame (call gatekeep_get_state to see renderer.textures)',
    };
  },
};

// ─────────────────────────────────────────────────────────────── boot

// Compile every shader the game will need before play starts (towers, enemies, effects, a sprite
// with a canvas-like texture), so the first build or the first enemy doesn't hitch on a compile.
function prewarm() {
  const g = new THREE.Group();
  TOWER_TYPES.forEach((type, i) => {
    const p = createTower(type);
    setTowerTier(p, 3);
    p.group.position.set(i * 1.2 - 2, 0, 3);
    g.add(p.group);
  });
  Object.keys(ENEMIES).forEach((type, i) => {
    const p = createEnemy(type);
    p.ice.visible = true;
    p.group.position.set(i - 2, 0, 4);
    g.add(p.group);
  });
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.position.set(0, 1, 4);
  g.add(sprite);
  const hidden = fx.warmables();
  hidden.forEach((o) => (o.visible = true));
  fx.fire({ id: -1, kind: 'arrow' });
  fx.fire({ id: -2, kind: 'ball' });
  scene.add(g);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  scene.remove(g);
  hidden.forEach((o) => (o.visible = false));
  fx.endProjectile({ id: -1 });
  fx.endProjectile({ id: -2 });
  sprite.material.dispose();
  tex.dispose();
}

window.gatekeep = {
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
  get wave() {
    return game.sim.wave;
  },
  get info() {
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, health_bars: healthBars.live, health_bars_created: healthBars.made, health_bar_redraws: healthBars.redraws };
  },
};

async function boot() {
  prewarm();
  hud.initTitle(`v${GAME_VERSION} · ${params.env}`);
  if (bot) hud.bot(`AUTOPLAY · skill <b>${params.skill.toFixed(2)}</b> · seed <b>${params.seed}</b>`);
  try {
    await Promise.race([document.fonts?.load('800 64px "Baloo 2"'), new Promise((r) => setTimeout(r, 900))]);
  } catch {
    /* fonts are optional */
  }
  await initTelemetry({ renderer, scene, camera, THREE });
  if (gd.enabled) registerAgentTools(gd, agentApi);
  else document.getElementById('hint-gd')?.remove();
  hud.initTitle(`v${GAME_VERSION} · ${params.env} · ${gd.enabled ? 'instrumented with Glitchless — press ` for the overlay' : 'telemetry off'}`);

  game.state = 'title';
  hud.screen('title');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
