// The castle: 10 rooms in one world space (x right, y up, everything on the z = 0 plane).
// Plain data, no imports, so Node can load it: import { ROOMS } from './games/undervault/src/rooms.js'.
//
// Solids are { x, y, w, h }: x = left edge, y = TOP surface, h = thickness below the top.
// Hazards are rects { x0, y0, x1, y1, cause }. Rows: floors at y 0 (upper Catacombs), -15 and -30;
// the Keep sits higher, floor y 8.

export const LEVEL_ID = 'undervault';

export const AREAS = {
  catacombs: { name: 'Catacombs', stone: 0x6b7a90, dark: 0x2b3442, trim: 0x7d8ca2, back: 0x232b37, fog: 0x0e131b, light: 0xffb067, accent: '#8fb3d9' },
  foundry: { name: 'Foundry', stone: 0x8a5a3e, dark: 0x3b2318, trim: 0x8e5f3e, back: 0x2e1a12, fog: 0x160b06, light: 0xff8a3d, accent: '#ff9a4d' },
  keep: { name: 'Keep', stone: 0x6f5a96, dark: 0x2f2445, trim: 0x7d69a6, back: 0x241b36, fog: 0x0f0a18, light: 0xc58cff, accent: '#c39bff' },
};

// ── builders ────────────────────────────────────────────────────────────────────────────────────
const block = (x0, y0, x1, y1, kind = 'stone') => ({ x: x0, y: y1, w: x1 - x0, h: y1 - y0, kind });
const ledge = (x0, x1, y) => ({ x: x0, y, w: x1 - x0, h: 0.35, oneWay: true, kind: 'ledge' });
// spikes: `base` is the surface they grow from; tips are 0.75 away. The hazard stops short of the tips.
const spikesUp = (x0, x1, base) => ({ kind: 'spikes', dir: 1, base, x0, x1, y0: base - 0.5, y1: base + 0.6, cause: 'spikes' });
const spikesDown = (x0, x1, base) => ({ kind: 'spikes', dir: -1, base, x0, x1, y0: base - 0.6, y1: base + 0.5, cause: 'spikes' });
const lava = (x0, x1, surface) => ({ kind: 'lava', surface, x0, x1, y0: surface - 3, y1: surface, cause: 'lava' });

/** a vertical wall from y0 to y1 with door gaps [[a, b], ...] cut out */
function wall(x0, x1, y0, y1, gaps = []) {
  const out = [];
  let y = y0;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > y) out.push(block(x0, y, x1, a, 'wall'));
    y = Math.max(y, b);
  }
  if (y < y1) out.push(block(x0, y, x1, y1, 'wall'));
  return out;
}

// ── the rooms ───────────────────────────────────────────────────────────────────────────────────
export const ROOMS = [
  {
    id: 'gate',
    name: 'The Gate',
    area: 'catacombs',
    bounds: { x0: 0, x1: 24, y0: -1.5, y1: 13.5 },
    solids: [block(0, -1.5, 24, 0), ...wall(0, 1, 0, 12.5), ...wall(23, 24, 0, 12.5, [[0, 4]]), block(0, 12.5, 24, 13.5, 'wall'), block(10, 0, 13, 1.2), block(15, 0, 18.5, 2.2)],
    hazards: [],
    enemies: [{ kind: 'crawler', x: 21, y: 0, x0: 19.2, x1: 22.4 }],
    save: { x: 6.5, y: 0 },
    spawn: { x: 3, y: 0 },
    torches: [
      [3.5, 4.6],
      [13.2, 5.6],
      [20.8, 5.2],
    ],
    decor: ['portcullis', 'coffins'],
  },
  {
    id: 'ossuary',
    name: 'The Ossuary',
    area: 'catacombs',
    bounds: { x0: 24, x1: 52, y0: -1.5, y1: 13.5 },
    solids: [block(24, -1.5, 52, 0), ...wall(24, 25, 0, 12.5, [[0, 4]]), ...wall(51, 52, 0, 12.5, [[0, 4]]), block(24, 12.5, 52, 13.5, 'wall'), block(28.5, 0, 31.5, 1.5), block(42.5, 0, 46, 1.8)],
    hazards: [],
    enemies: [
      { kind: 'bat', x: 36.5, y: 4.6 },
      { kind: 'crawler', x: 38, y: 0, x0: 33, x1: 41.6 },
      { kind: 'bat', x: 47.5, y: 5.2 },
    ],
    torches: [
      [27.2, 5.2],
      [39.5, 6.6],
      [48.8, 5.2],
    ],
    decor: ['skulls'],
  },
  {
    id: 'long_shaft',
    name: 'The Long Shaft',
    area: 'catacombs',
    bounds: { x0: 52, x1: 68, y0: -31.5, y1: 21.5 },
    solids: [
      block(52, -31.5, 68, -30),
      ...wall(52, 53, -30, 20.5, [
        [-30, -26],
        [-15, -11],
        [0, 4],
      ]),
      ...wall(67, 68, -30, 20.5, [[8, 12]]),
      block(52, 20.5, 68, 21.5, 'wall'),
      block(53, -1.5, 58, 0), // ledge in from the Ossuary
      block(53, -16.5, 58, -15), // ledge in from the Boot Shrine
      // one-way ledges: drop through the middle column, climb back up only with the double jump
      ledge(62, 67, -10.5),
      ledge(53, 58, -6),
      ledge(62, 67, -1.25),
      ledge(58.5, 61.5, 3.5),
      ledge(62, 67, 8), // the way up to the Keep, visible from the top
    ],
    hazards: [],
    enemies: [
      { kind: 'bat', x: 60.5, y: -23 },
      { kind: 'crawler', x: 63, y: -30, x0: 54, x1: 66 },
      { kind: 'bat', x: 56, y: -26.5 },
    ],
    torches: [
      [55.2, 7.4],
      [64.8, 15],
      [64.8, -4.2],
      [55.2, -9.5],
      [64.8, -19.5],
      [55.2, -24.5],
    ],
    decor: ['chains'],
  },
  {
    id: 'furnace',
    name: 'The Furnace',
    area: 'foundry',
    bounds: { x0: 30, x1: 52, y0: -31.5, y1: -16.5 },
    solids: [
      block(30, -31.5, 33.5, -30),
      block(37, -31.5, 41.5, -30),
      block(45, -31.5, 52, -30),
      ...wall(30, 31, -30, -17.5, [[-30, -26]]),
      ...wall(51, 52, -30, -17.5, [[-30, -26]]),
      block(30, -17.5, 52, -16.5, 'wall'),
    ],
    hazards: [lava(33.5, 37, -30.8), lava(41.5, 45, -30.8)],
    enemies: [{ kind: 'crawler', x: 39.5, y: -30, x0: 37.2, x1: 41.3 }],
    save: { x: 48.5, y: -30 },
    torches: [
      [33.2, -24.2],
      [48.8, -24.2],
    ],
    decor: ['furnace'],
  },
  {
    id: 'gear_hall',
    name: 'Gear Hall',
    area: 'foundry',
    bounds: { x0: 4, x1: 30, y0: -31.5, y1: -16.5 },
    solids: [
      block(4, -31.5, 11, -30),
      block(21, -31.5, 30, -30),
      ...wall(4, 5, -30, -16.5, [[-30, -26]]),
      ...wall(29, 30, -30, -17.5, [[-30, -26]]),
      block(9, -17.5, 14, -16.5, 'wall'),
      block(21, -17.5, 29, -16.5, 'wall'),
    ],
    hazards: [lava(11, 21, -30.8)],
    movers: [
      { id: 'gear_a', x0: 11.2, y0: -29.4, w: 2.4, h: 0.5, axis: 'x', range: 2.2, period: 3.4, phase: 0, kind: 'gear' },
      { id: 'gear_b', x0: 16.4, y0: -29.4, w: 2.4, h: 0.5, axis: 'x', range: 2.2, period: 3.4, phase: Math.PI, kind: 'gear' },
      // the lift up to the Collapsed Bridge: one-way, so you can jump up through it
      { id: 'lift', x0: 5.4, y0: -27.6, w: 3.2, h: 0.4, axis: 'y', range: 12.8, period: 7, phase: -Math.PI / 2, oneWay: true, kind: 'lift' },
    ],
    enemies: [
      { kind: 'crawler', x: 25.5, y: -30, x0: 21.6, x1: 28.4 },
      { kind: 'crawler', x: 9.5, y: -30, x0: 5.6, x1: 10.6 },
    ],
    torches: [
      [16, -21.6],
      [26.4, -23.5],
    ],
    decor: ['gears'],
  },
  {
    id: 'dash_shrine',
    name: 'Dash Shrine',
    area: 'foundry',
    bounds: { x0: -16, x1: 4, y0: -31.5, y1: -16.5 },
    solids: [block(-16, -31.5, 4, -30), ...wall(-16, -15, -30, -17.5), ...wall(3, 4, -30, -17.5, [[-30, -26]]), block(-16, -17.5, 4, -16.5, 'wall')],
    hazards: [],
    enemies: [],
    pickup: { ability: 'dash', x: -10.5, y: -30 },
    torches: [
      [-13.4, -24],
      [-7.6, -24],
      [0.6, -24.6],
    ],
    decor: ['shrine'],
  },
  {
    id: 'collapsed_bridge',
    name: 'Collapsed Bridge',
    area: 'foundry',
    bounds: { x0: 4, x1: 30, y0: -16.5, y1: -1.5 },
    solids: [block(9, -16.5, 14, -15), block(21, -16.5, 30, -15), ...wall(4, 5, -16.5, -2.5), ...wall(29, 30, -15, -2.5, [[-15, -11]]), block(4, -2.5, 30, -1.5, 'wall')],
    hazards: [],
    enemies: [{ kind: 'bat', x: 25.5, y: -10.8 }],
    torches: [
      [7.2, -9.4],
      [26.6, -9.4],
    ],
    decor: ['bridge'],
  },
  {
    id: 'boot_shrine',
    name: 'Boot Shrine',
    area: 'catacombs',
    bounds: { x0: 30, x1: 52, y0: -16.5, y1: -1.5 },
    solids: [block(30, -16.5, 52, -15), ...wall(30, 31, -15, -2.5, [[-15, -11]]), ...wall(51, 52, -15, -2.5, [[-15, -11]]), block(30, -2.5, 52, -1.5, 'wall')],
    hazards: [],
    enemies: [],
    pickup: { ability: 'double_jump', x: 36.5, y: -15 },
    save: { x: 44, y: -15 },
    torches: [
      [33.4, -10.2],
      [40.2, -8.6],
      [48.6, -10.2],
    ],
    decor: ['shrine'],
  },
  {
    id: 'spike_gallery',
    name: 'Spike Gallery',
    area: 'keep',
    bounds: { x0: 68, x1: 94, y0: 4.6, y1: 21.5 },
    solids: [
      block(68, 4, 74, 8),
      block(74, 4, 80.2, 5), // pit floor (spikes on it)
      block(80.2, 4, 85, 10), // the landing, 2 units above the start
      block(85, 4, 87, 8),
      block(87, 4, 89.5, 5),
      block(89.5, 4, 94, 8),
      // GLITCHLESS-DEMO: difficulty spike — the low spiked ceiling over the pit (see hazards below)
      block(72.5, 10.55, 79, 20.5),
      ...wall(68, 69, 8, 20.5, [[8, 12]]),
      ...wall(93, 94, 8, 20.5, [[8, 12]]),
      block(68, 20.5, 94, 21.5, 'wall'),
    ],
    // GLITCHLESS-DEMO: difficulty spike — The Spike Gallery. The landing (x 80.2) is 2 units higher than
    // the ledge and the ceiling above the pit is spiked down to head height, so the only way across is
    // to drop off the edge, air-dash, then double jump in a ~50 ms window (6 steps at 120 Hz) right as
    // your head clears the ceiling (x 79): too early and you hit the ceiling spikes, too late and you
    // can't climb the landing and fall into the pit. The nearest save statue is two rooms back (Boot
    // Shrine), so every miss means the long climb up the Long Shaft again.
    hazards: [spikesUp(74, 80.2, 5), spikesDown(72.5, 79, 10.55), spikesUp(87, 89.5, 5)],
    enemies: [],
    torches: [
      [70.6, 13.6],
      [84.2, 14.6],
      [91.4, 13.6],
    ],
    decor: ['banners'],
  },
  {
    id: 'warden_hall',
    name: 'Warden Hall',
    area: 'keep',
    bounds: { x0: 94, x1: 122, y0: 6.3, y1: 21.5 },
    solids: [block(94, 6.3, 122, 8), ...wall(94, 95, 8, 20.5, [[8, 12]]), ...wall(121, 122, 8, 20.5), block(94, 20.5, 122, 21.5, 'wall')],
    hazards: [],
    enemies: [],
    save: { x: 97.2, y: 8 },
    boss: { x: 115, y: 8, arena: { x0: 101, x1: 121 }, gateX: 100.3, triggerX: 102.6 },
    torches: [
      [98.4, 13.4],
      [109, 16.2],
      [119.4, 13.4],
    ],
    decor: ['throne'],
  },
];

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

/** the whole castle, for captureMap and the minimap */
export const MAP_BOUNDS = { min: [-16, -31.5], max: [122, 21.5] };

/** where agent teleports (and nothing else) put the knight in each room */
export const ENTRY = {
  gate: { x: 3, y: 0 },
  ossuary: { x: 26.5, y: 0 },
  long_shaft: { x: 55, y: 0 },
  furnace: { x: 49.8, y: -30 },
  gear_hall: { x: 27, y: -30 },
  dash_shrine: { x: 1.5, y: -30 },
  collapsed_bridge: { x: 11, y: -15 },
  boot_shrine: { x: 33, y: -15 },
  spike_gallery: { x: 70.5, y: 8 },
  warden_hall: { x: 98.6, y: 8 },
};

/** the designed route (for the bot and the README) */
export const ROUTE = ['gate', 'ossuary', 'long_shaft', 'furnace', 'gear_hall', 'dash_shrine', 'gear_hall', 'collapsed_bridge', 'boot_shrine', 'long_shaft', 'spike_gallery', 'warden_hall'];

export function inRoom(room, x, y, margin = 0) {
  const b = room.bounds;
  return x >= b.x0 - margin && x <= b.x1 + margin && y >= b.y0 - margin && y <= b.y1 + margin;
}

/** the room containing a point (the player's middle), or null */
export function roomAt(x, y) {
  for (const r of ROOMS) if (inRoom(r, x, y)) return r;
  return null;
}
