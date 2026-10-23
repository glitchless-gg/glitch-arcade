// Track data (plain data, no imports). Units are meters on the flat xz plane (y = 0).
//
// points:   control points [x, z] of a closed centripetal Catmull-Rom loop. The start/finish line is
//           at points[0]; the cars drive in the order of the points.
// sections: named stretches of the loop, each starting at a control point index (`from`). They are
//           the checkpoints too: a wrecked car respawns at the start of the section it was in.
// pads:     boost pads, placed `ds` meters along the track from control point `cp`, `lat` meters off
//           the centerline (positive = left of the driving direction; 'line' = on the racing line).
// scale:    multiplies every control point (lets a layout be sized for ~12–15 s laps).
// laps:     3 for every track.
export const TRACKS = [
  {
    id: 'harbor',
    name: 'Harbor Loop',
    difficulty: 'easy',
    theme: 'harbor',
    laps: 3,
    scale: 0.88,
    points: [
      [-40, 52],
      [20, 54],
      [66, 48],
      [98, 24],
      [104, -14],
      [84, -46],
      [44, -58],
      [0, -54],
      [-38, -64],
      [-76, -50],
      [-96, -18],
      [-92, 20],
      [-72, 46],
    ],
    sections: [
      { id: 'start_straight', from: 12 },
      { id: 'harbor_bend', from: 2 },
      { id: 'pier_run', from: 5 },
      { id: 'lighthouse_turn', from: 8 },
      { id: 'warehouse_sweep', from: 10 },
    ],
    pads: [
      { cp: 0, ds: 14, lat: 'line' },
      { cp: 6, ds: 0, lat: 'line' },
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon Run',
    difficulty: 'medium',
    theme: 'canyon',
    laps: 3,
    scale: 0.77,
    points: [
      [-20, 63],
      [18, 62],
      [52, 54],
      [66, 34],
      [64, 12],
      [80, -8],
      [86, -32],
      [70, -54],
      [36, -64],
      [0, -66],
      [-24, -66],
      [-40, -66],
      [-49, -62],
      [-53, -53],
      [-49, -44],
      [-40, -40],
      [-20, -38],
      [-4, -28],
      [2, -8],
      [-6, 12],
      [-28, 24],
      [-52, 30],
      [-66, 42],
      [-64, 56],
      [-46, 63],
    ],
    sections: [
      { id: 'start_straight', from: 24 },
      { id: 'mesa_esses', from: 2 },
      { id: 'long_descent', from: 7 },
      { id: 'cliff_hairpin', from: 10 },
      { id: 'tunnel', from: 16 },
      { id: 'finish_sweep', from: 19 },
    ],
    pads: [
      { cp: 1, ds: 0, lat: 'line' },
      // GLITCHLESS-DEMO: boost pad into the Cliff Hairpin. A "fun" boost at the bottom of the long
      // descent, placed on the racing line just before the cliff_hairpin turn-in: the car hits the
      // hairpin ~40% over its safe speed unless the driver brakes before the pad.
      { cp: 10, ds: -9, lat: 'line' },
    ],
    tunnel: { from: 16, to: 19 },
  },
  {
    id: 'neon',
    name: 'Neon Ring',
    difficulty: 'hard',
    theme: 'neon',
    laps: 3,
    scale: 0.82,
    points: [
      [-30, 60],
      [20, 60],
      [46, 54],
      [66, 66],
      [90, 58],
      [98, 30],
      [94, -8],
      [76, -32],
      [50, -40],
      [16, -68],
      [-18, -42],
      [-52, -66],
      [-80, -36],
      [-84, 10],
      [-66, 46],
    ],
    sections: [
      { id: 'start_straight', from: 14 },
      { id: 'pixel_chicane', from: 2 },
      { id: 'tower_sweep', from: 5 },
      { id: 'double_chicane', from: 7 },
      { id: 'skyline_bend', from: 12 },
    ],
    pads: [
      { cp: 0, ds: 12, lat: 'line' },
    ],
  },
];

export const TRACK_IDS = TRACKS.map((t) => t.id);
