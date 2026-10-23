// Round data (plain data, no imports). A wave fires at `at` seconds into the round, or once no more than
// `alive` enemies are left (and at least `minT` seconds have passed). Gates are the spawn doors on the
// arena edges (see GATES in arena.js).

export const ROUNDS = [
  {
    id: 'round-1',
    name: 'Warmup',
    blurb: 'Eight grunts, two groups. Find your feet.',
    waves: [
      { at: 1.2, spawns: [{ type: 'grunt', gate: 'N1', count: 2 }, { type: 'grunt', gate: 'N2', count: 2 }] },
      { alive: 1, minT: 6, spawns: [{ type: 'grunt', gate: 'S1', count: 2 }, { type: 'grunt', gate: 'S2', count: 2 }] },
    ],
  },
  {
    id: 'round-2',
    name: 'Crossfire',
    blurb: 'Gunners hold the flanks. Grunts push the middle.',
    waves: [
      { at: 1.2, spawns: [{ type: 'gunner', gate: 'E1', count: 1 }, { type: 'gunner', gate: 'W2', count: 1 }, { type: 'grunt', gate: 'N1', count: 2 }, { type: 'grunt', gate: 'N2', count: 2 }] },
      { alive: 2, minT: 8, spawns: [{ type: 'gunner', gate: 'W1', count: 1 }, { type: 'gunner', gate: 'E2', count: 1 }, { type: 'grunt', gate: 'S1', count: 3 }, { type: 'grunt', gate: 'S2', count: 2 }] },
    ],
  },
  {
    id: 'round-3',
    name: 'Swarm',
    blurb: 'Gunners first. Then the swarm.',
    waves: [
      { at: 1.2, spawns: [{ type: 'gunner', gate: 'N1', count: 1 }, { type: 'gunner', gate: 'E2', count: 1 }, { type: 'gunner', gate: 'W1', count: 1 }, { type: 'grunt', gate: 'S2', count: 2 }] },
      // the burst: 30 swarmers from every gate in the same frame
      {
        at: 10,
        swarm: true,
        spawns: [
          { type: 'swarmer', gate: 'N1', count: 4 },
          { type: 'swarmer', gate: 'N2', count: 4 },
          { type: 'swarmer', gate: 'E1', count: 4 },
          { type: 'swarmer', gate: 'E2', count: 4 },
          { type: 'swarmer', gate: 'S1', count: 3 },
          { type: 'swarmer', gate: 'S2', count: 3 },
          { type: 'swarmer', gate: 'W1', count: 4 },
          { type: 'swarmer', gate: 'W2', count: 4 },
        ],
      },
    ],
  },
];

export const TRIES_PER_ROUND = 3;
