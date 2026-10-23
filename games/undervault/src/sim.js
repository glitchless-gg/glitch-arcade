// One fixed simulation step of "the knight in the castle" (bodies, movers, hazards). Shared by the
// game loop and the autoplay bot's look-ahead, so the bot's predictions match what really happens.
// Pure: no THREE.
import { ROOMS } from './rooms.js';
import { createBody, stepBody, stepMover, touchesRect } from './physics.js';

/** fresh, mutable copies of everything the physics touches */
export function createPlay(spawn) {
  const movers = [];
  const solids = [];
  const hazards = [];
  for (const room of ROOMS) {
    for (const s of room.solids) solids.push({ ...s, room: room.id });
    for (const h of room.hazards) hazards.push({ ...h, room: room.id });
    for (const m of room.movers || []) {
      const mover = { ...m, x: m.x0, y: m.y0, dx: 0, dy: 0, room: room.id };
      movers.push(mover);
      solids.push(mover);
    }
  }
  const play = { body: createBody(spawn.x, spawn.y), movers, solids, hazards, gate: null, t: 0, abilities: { dash: false, doubleJump: false } };
  for (const m of movers) stepMover(m, 0);
  return play;
}

/** close / open the arena portcullis (a solid that comes and goes) */
export function setGate(play, closed, x) {
  if (closed && !play.gate) {
    play.gate = { x, y: 20.5, w: 0.7, h: 12.5, kind: 'gate', room: 'warden_hall' };
    play.solids.push(play.gate);
  } else if (!closed && play.gate) {
    play.solids.splice(play.solids.indexOf(play.gate), 1);
    play.gate = null;
  }
}

/** returns the body events + { hazard } (the hazard rect touched, if any) */
export function stepPlay(play, input, dt) {
  play.t += dt;
  for (const m of play.movers) stepMover(m, play.t);
  const b = play.body;
  // ride moving platforms
  if (b.grounded && b.ground && b.ground.axis) {
    b.x += b.ground.dx;
    b.y += b.ground.dy;
  }
  const ev = stepBody(b, input, play.solids, dt, play.abilities);
  ev.hazard = null;
  for (const h of play.hazards) {
    if (touchesRect(b, h)) {
      ev.hazard = h;
      break;
    }
  }
  return ev;
}

/** deep-enough copy for what-if simulation (body + movers; solids are shared except movers) */
export function clonePlay(p) {
  const movers = p.movers.map((m) => ({ ...m }));
  const map = new Map(p.movers.map((m, i) => [m, movers[i]]));
  return {
    body: { ...p.body, ground: map.get(p.body.ground) || p.body.ground },
    movers,
    solids: p.solids.map((s) => map.get(s) || s),
    hazards: p.hazards,
    gate: p.gate,
    t: p.t,
    abilities: { ...p.abilities },
  };
}
