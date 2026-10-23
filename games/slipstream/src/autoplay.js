// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// Drives the player car with the same driver as the rivals (src/driver.js): pure pursuit on the
// racing line and a target speed from the curvature ahead, with skill-scaled mistakes. On top of
// that it behaves like a player: presses R when stuck or after a bad hit, sometimes restarts a race
// after its second wreck, and a low-skill bot can rage quit after a pile of wrecks. It races
// harbor → canyon → neon and then "closes the tab". Deterministic per seed (fixed-step sim).
import { createRng } from './rng.js';
import { createDriver } from './driver.js';
import { STEP, speedOf } from './physics.js';

export function createAutoplay({ skill, seed, onFinished, onRageQuit }) {
  const rng = createRng(seed);
  const driver = createDriver({ skill, rng: createRng((seed ^ 0x5bd1e995) >>> 0) });
  const out = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };

  const bot = {
    skill,
    seed,
    halted: false,
    reason: null,
    menuT: 0,
    menuWait: rng.range(0.5, 0.9),
    stuckT: 0,
    wrongT: 0,
    resetIn: -1,
    pending: null, // 'restart' | 'quit'
    pendingIn: 0,
    restartedTracks: new Set(),
    raceWrecks: 0,
  };

  /** one fixed step while racing: the input for the player car */
  bot.step = (game) => {
    const car = game.player;
    const g = game.geom;
    const inp = driver.step(car, g, STEP);
    out.throttle = inp.throttle;
    out.brake = inp.brake;
    out.steer = inp.steer;
    out.handbrake = inp.handbrake;
    out.reset = false;
    if (car.wreckT > 0 || car.ghostT > 0) {
      bot.stuckT = bot.wrongT = 0;
      return out;
    }

    // stuck against something, or pointing the wrong way: R
    const speed = speedOf(car);
    bot.stuckT = speed < 3 ? bot.stuckT + STEP : 0;
    const along = Math.sin(car.h) * g.tx[car.idx] + Math.cos(car.h) * g.tz[car.idx];
    bot.wrongT = along < -0.2 ? bot.wrongT + STEP : 0;
    if (bot.resetIn > 0 && (bot.resetIn -= STEP) <= 0) {
      bot.resetIn = -1;
      out.reset = true;
    }
    if (bot.stuckT > 1.4 + (1 - skill) * 1.2 || bot.wrongT > 1.6) {
      bot.stuckT = bot.wrongT = 0;
      out.reset = true;
    }
    if (out.reset) driver.reset();
    return out;
  };

  /** a hard knock that didn't wreck: a nervous player sometimes hits R instead of driving out of it */
  bot.onHit = (game, hit) => {
    if (bot.resetIn > 0 || hit.speed < 12 || hit.sinA < 0.3) return;
    if (rng.chance((1 - skill) * 0.5)) bot.resetIn = rng.range(0.35, 0.9);
  };

  bot.onRaceStart = () => {
    bot.raceWrecks = 0;
    bot.stuckT = bot.wrongT = 0;
    bot.resetIn = -1;
    bot.pending = null;
    driver.reset();
  };

  bot.onWreck = (game) => {
    bot.raceWrecks++;
    driver.reset();
    const id = game.track.id;
    const car = game.player;
    // a second wreck before the final lap: a frustrated player restarts the race (once per track)
    if (bot.raceWrecks === 2 && car.lapsDone < game.race.laps - 1 && !bot.restartedTracks.has(id) && rng.chance(Math.max(0, Math.min(0.55, (0.8 - skill) * 0.9)))) {
      bot.restartedTracks.add(id);
      bot.pending = 'restart';
      bot.pendingIn = rng.range(0.8, 1.6);
    } else if (bot.raceWrecks >= 3 && skill < 0.5 && rng.chance(0.3)) {
      // …or gives up on the whole thing
      bot.pending = 'quit';
      bot.pendingIn = rng.range(1.0, 2.0);
    }
  };

  /** checked every frame while racing: 'restart' | 'quit' | null (the bot "presses Esc, then R or Q") */
  bot.wants = (dt) => {
    if (!bot.pending || bot.halted) return null;
    bot.pendingIn -= dt;
    if (bot.pendingIn > 0) return null;
    const w = bot.pending;
    bot.pending = null;
    return w;
  };

  bot.quit = (reason) => {
    if (bot.halted) return;
    bot.halted = true;
    bot.reason = reason;
    if (reason === 'ragequit') onRageQuit?.();
    else onFinished?.();
  };

  /** menu screens: returns true when the bot "presses Space" */
  bot.menu = (state, dt) => {
    if (bot.halted) return false;
    bot.menuT += dt;
    if (bot.menuT < bot.menuWait) return false;
    bot.menuT = 0;
    if (state === 'champion') {
      bot.quit('finished');
      return false;
    }
    bot.menuWait = state === 'results' ? rng.range(0.8, 1.3) : rng.range(0.5, 0.8);
    return true;
  };
  bot.resetMenu = (wait) => {
    bot.menuT = 0;
    bot.menuWait = wait ?? rng.range(0.8, 1.3);
  };

  return bot;
}
