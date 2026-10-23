// The course: where every pipe stands, how wide its gap is and which biome it belongs to. Plain data and
// pure functions (no three.js), so the game, the bot and Node tests share one source of truth.
//
// World units: x is distance along the course (the bird starts at x = 0 and flies right), y is height
// (the ground strip's top is y = 0). Pipes are numbered from 1; the score is the number of pipes passed.
import { createRng } from './rng.js';

export const LEVEL_ID = 'sky';
export const COURSE_SEED = 20261022; // the same course every run, every session

export const GROUND_Y = 0; // top of the ground strip
export const CEILING_Y = 12.6; // the top of the sky: fly into it and you're out
export const START = { x: 0, y: 6.2 };
export const SPEED = 3.6; // forward speed, units/s
export const PIPE_W = 1.7;
export const SPACING = 4.8;
export const FIRST_X = 10; // pipe 1 (~2.8 s after the start)

const GAP_START = 3.6;
const GAP_END = 3.1; // reached at pipe 41
const LOW = 2.8; // lowest gap centre
const HIGH = 9.6; // highest gap centre
const MID = (LOW + HIGH) / 2;

export const SQUEEZE_PIPE = 12;
const SQUEEZE_GAP = 2.3;
const SQUEEZE_JUMP = 4.4;

export const BIOMES = ['meadow', 'canyon', 'city'];
export const BIOME_NAMES = { meadow: 'Meadow', canyon: 'Canyon', city: 'Night City' };
export const MEDALS = [
  { kind: 'bronze', at: 10 },
  { kind: 'silver', at: 20 },
  { kind: 'gold', at: 30 },
  { kind: 'platinum', at: 40 },
];

/** pipes on the heatmap: the first ~45 of the course */
export const MAP_PIPES = 45;

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function pipeX(n) {
  return FIRST_X + (n - 1) * SPACING;
}

/** the biome pipe n belongs to: pipes 1-10 meadow, 11-20 canyon, 21-30 city, 31-40 meadow again… */
export function biomeOfPipe(n) {
  return BIOMES[Math.floor((n - 1) / 10) % BIOMES.length];
}

/** the biome a run is in once it has passed `score` pipes (it changes as pipe 10, 20, 30… is passed) */
export function biomeOfScore(score) {
  return BIOMES[Math.floor(score / 10) % BIOMES.length];
}

/** the best medal for a score, or null */
export function medalFor(score) {
  let m = null;
  for (const x of MEDALS) if (score >= x.at) m = x.kind;
  return m;
}

// The course is generated once, lazily, as far as anyone asks: a seeded random walk of gap centres
// whose steps grow and gaps shrink a little over the first 40 pipes.
const pipes = [null];
const rng = createRng(COURSE_SEED);
let walkY = START.y;

function extend(n) {
  while (pipes.length <= n) {
    const k = pipes.length;
    const t = Math.min(1, (k - 1) / 40);
    let gap = GAP_START + (GAP_END - GAP_START) * t;
    const step = 1.3 + 1.3 * t; // how far a gap can sit from the previous one
    walkY = clamp(walkY + rng.range(-step, step), LOW, HIGH);
    if (k <= 3) walkY = clamp(walkY, 4.6, 7.6); // a gentle start
    let y = walkY;
    // GLITCHLESS-DEMO: the squeeze at pipe 12 (difficulty spike). A "fun twist" right after the first
    // medal: pipe 12's gap shrinks from ~3.5 to 2.3 units and jumps 4.4 units from pipe 11's, to the
    // other side of the sky. The bird has to climb almost the whole jump inside one pipe spacing, then
    // stop dead in a gap that leaves 0.73 units of room above and below the bird. Most runs end here (score 11).
    if (k === SQUEEZE_PIPE) {
      const prev = pipes[k - 1].y;
      gap = SQUEEZE_GAP;
      y = prev < MID ? prev + SQUEEZE_JUMP : prev - SQUEEZE_JUMP;
      walkY = y;
    }
    pipes.push({ n: k, x: pipeX(k), y: round2(y), gap: round2(gap), biome: biomeOfPipe(k) });
  }
}

/** pipe n (1-based): { n, x, y (gap centre), gap (height), biome } */
export function pipeAt(n) {
  if (n < 1) return null;
  if (n >= pipes.length) extend(n);
  return pipes[n];
}

/** the pipe whose x is nearest to x (≥ 1) */
export function pipeNear(x) {
  return Math.max(1, Math.round((x - FIRST_X) / SPACING) + 1);
}

/** the number of pipes whose trailing edge is behind x */
export function pipesPassed(x) {
  const k = Math.floor((x - FIRST_X - PIPE_W / 2) / SPACING) + 1;
  return Math.max(0, k);
}

/** the heatmap bounds: the first MAP_PIPES pipes, ground to ceiling */
export function mapBounds() {
  return { min: [START.x - 4, GROUND_Y - 2], max: [round2(pipeX(MAP_PIPES) + 4), CEILING_Y + 1.4] };
}
