// One race on one track (pure, no THREE): grid, fixed-step driving, barriers, wrecks and respawns,
// boost pads, car-to-car contact, laps, positions. Game moments come out through onEvent(type, data)
// so the game (telemetry, effects, HUD) and the headless tuning sims share the exact same rules.
import { CAR, stepCar, trackContact, boostPads, collideCars, placeCar, speedOf } from './physics.js';

const RESPAWN_SPEED = 12;

export function createRace(geom, cars, { laps = 3, onEvent = () => {} } = {}) {
  const race = { geom, cars, laps, t: 0, started: false, over: false, finishOrder: [], positions: [] };

  // 2 × 2 staggered grid behind the line; cars[0] gets pole
  cars.forEach((car, k) => {
    car.idx = 0;
    car.dist = 0;
    const back = Math.round((8 + k * 7) / geom.ds);
    placeCar(car, geom, (geom.N - back) % geom.N, k % 2 ? -3 : 3);
    Object.assign(car, { lapsDone: 0, lapStartT: 0, lastLap: 0, bestLap: 0, wreckT: 0, ghostT: 0, finished: false, finishT: 0, wrecks: 0, stuckT: 0, boostT: 0, padCooldown: 0 });
  });

  const sectionAt = (i) => geom.sections[geom.sectionOf[i]].id;
  race.sectionAt = sectionAt;
  race.sectionOf = (car) => sectionAt(car.idx);

  function wreck(car, cause) {
    car.wreckT = CAR.WRECK_TIME;
    car.wrecks++;
    // the tumble slides along the road, not through the barrier
    const tx = geom.tx[car.idx];
    const tz = geom.tz[car.idx];
    const along = car.vx * tx + car.vz * tz;
    car.wreckInfo = { x: car.x, z: car.z, vx: tx * along, vz: tz * along, h: car.h, cause, section: sectionAt(car.idx) };
    onEvent('wreck', { car, cause, section: car.wreckInfo.section });
  }
  race.wreck = wreck;

  function respawn(car) {
    // the last checkpoint is the start of the section the car was in
    const sec = geom.sections[geom.sectionOf[car.idx]];
    placeCar(car, geom, (sec.start + 2) % geom.N, 0);
    // a rolling restart, like most arcade racers
    car.vx = Math.sin(car.h) * RESPAWN_SPEED;
    car.vz = Math.cos(car.h) * RESPAWN_SPEED;
    car.ghostT = CAR.GHOST_TIME;
    car.stuckT = 0;
    onEvent('respawn', { car, section: sec.id });
  }

  /** R: back onto the centerline where the car is */
  race.reset = (car) => {
    if (car.wreckT > 0) return false;
    const section = sectionAt(car.idx);
    placeCar(car, geom, car.idx, 0);
    car.ghostT = CAR.GHOST_TIME;
    car.stuckT = 0;
    onEvent('reset', { car, section });
    return true;
  };

  race.step = (inputs, dt) => {
    if (!race.started) return;
    race.t += dt;
    const L = geom.length;
    for (let k = 0; k < cars.length; k++) {
      const car = cars[k];
      if (car.wreckT > 0) {
        car.wreckT -= dt;
        if (car.wreckT <= 0) respawn(car);
        continue;
      }
      stepCar(car, inputs[k], dt);
      const c = trackContact(car, geom);
      if (c?.kind === 'wreck') {
        wreck(car, 'wall');
        continue;
      }
      if (c) onEvent('hit', { car, ...c });
      const pad = boostPads(car, geom);
      if (pad) onEvent('boost', { car, pad, section: sectionAt(car.idx) });

      // laps
      if (!car.finished && car.dist >= (car.lapsDone + 1) * L) {
        car.lapsDone++;
        const lapTime = race.t - car.lapStartT;
        car.lastLap = lapTime;
        car.bestLap = car.bestLap ? Math.min(car.bestLap, lapTime) : lapTime;
        car.lapStartT = race.t;
        onEvent('lap', { car, lap: car.lapsDone, time: lapTime });
        if (car.lapsDone >= race.laps) {
          car.finished = true;
          car.finishT = race.t;
          race.finishOrder.push(car);
          onEvent('finish', { car, position: race.finishOrder.length, time: race.t });
        }
      }

      // AI cars that are stuck put themselves back on the road
      if (!car.isPlayer || car.finished) {
        car.stuckT = speedOf(car) < 2 ? car.stuckT + dt : 0;
        if (car.stuckT > 2.5) race.reset(car);
      }
    }

    for (const hit of collideCars(cars)) {
      if (hit.wreck) wreck(hit.wreck, 'rival');
      else onEvent('bump', hit);
    }
    race.positions = race.order();
  };

  /** current order: finished cars by finish time, then everyone else by distance */
  race.order = () =>
    [...cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishT - b.finishT;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });

  race.positionOf = (car) => race.order().indexOf(car) + 1;

  /** final classification when the player crosses the line: unfinished cars get an estimated time */
  race.results = () =>
    race.order().map((car, i) => {
      let time = car.finishT;
      let estimated = false;
      if (!car.finished) {
        const total = race.laps * geom.length;
        const avg = Math.max(8, car.dist / Math.max(1, race.t));
        time = race.t + Math.max(0, total - car.dist) / avg;
        estimated = true;
      }
      return { car, position: i + 1, time, estimated, bestLap: car.bestLap };
    }).sort((a, b) => a.time - b.time).map((r, i) => ({ ...r, position: i + 1 }));

  race.positions = race.order();
  return race;
}

export const POINTS = [10, 6, 4, 2];
