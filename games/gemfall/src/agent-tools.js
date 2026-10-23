// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw: they return { ok: false, error } instead.
import { LEVELS } from './levels.js';
import { ROWS, COLS } from './board.js';

const LEVEL_IDS = LEVELS.map((l) => l.id);
const SPECIALS = ['striped', 'striped_row', 'striped_col', 'bomb', 'prism'];

function safe(fn) {
  return async (args = {}) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };
}

const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

/**
 * api = { getState(), loadLevel(id), makeSpecial(kind, row, col), cascade(), forceHint({ viaTimer }) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'gemfall_get_state',
    'Gemfall state: level and goal progress, moves left, score and stars so far, tries left, the board as text rows (R O Y G B P gems, lower case = striped, * bomb, @ prism, W crown, space = gap), stones left, boosters, how many moves exist, the hint on screen and whether the hint timer is armed, renderer draw calls / geometries / programs, and the shard count (every shard ever spawned: they are never removed).',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'gemfall_load_level',
    `Start a level directly (a normal levelStart, with fresh tries). ${LEVELS.map((l) => `${l.id} ${l.name}: ${l.blurb} in ${l.moves} moves`).join('; ')}.`,
    { type: 'object', properties: { level: { type: 'string', enum: LEVEL_IDS } }, required: ['level'] },
    safe(({ level }) => {
      if (!LEVEL_IDS.includes(level)) return { ok: false, error: `level must be one of ${LEVEL_IDS.join(', ')}` };
      return api.loadLevel(level);
    }),
  );
  gd.registerTool(
    'gemfall_make_special',
    'Put a special gem on the board at (row, col), replacing the gem there (row 0 is the top). striped / striped_row clears its row when it fires, striped_col its column, bomb a 3x3 square, prism every gem of the colour it is swapped with. Swap two specials together (or a prism with anything) for a combo.',
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: SPECIALS },
        row: { type: 'integer', minimum: 0, maximum: ROWS - 1 },
        col: { type: 'integer', minimum: 0, maximum: COLS - 1 },
      },
      required: ['kind', 'row', 'col'],
    },
    safe(({ kind, row, col }) => {
      if (!SPECIALS.includes(kind)) return { ok: false, error: `kind must be one of ${SPECIALS.join(', ')}` };
      const r = int(row);
      const c = int(col);
      if (!(r >= 0 && r < ROWS && c >= 0 && c < COLS)) return { ok: false, error: `row and col must be integers from 0 to ${ROWS - 1}` };
      return api.makeSpecial(kind === 'striped' ? 'striped_row' : kind, r, c);
    }),
  );
  gd.registerTool(
    'gemfall_cascade',
    'Trigger the biggest combo available, through the same swap and clear path a player move takes (it uses a move): the best special combo on the board, or, if there is none worth it, a prism placed next to a striped gem of the commonest colour and swapped with it. Every cleared gem spawns its shard burst in the same frame, which reproduces the cascade stutter. Returns gems cleared, shards spawned, renderer geometries before/after and the worst frame time in the next 1.2 s.',
    { type: 'object', properties: {} },
    safe(() => api.cascade()),
  );
  gd.registerTool(
    'gemfall_force_hint',
    'Run the idle hint now instead of waiting 5 s. By default it calls findHint() on the current board and reports what it found or the error it threw (it throws when no move touches the top row: the scan runs off the right edge). With via_timer: true it runs the real idle-hint path (showHint on a timer), so an error is unhandled and reaches Glitchless like the real one.',
    { type: 'object', properties: { via_timer: { type: 'boolean' } } },
    safe(({ via_timer }) => api.forceHint({ viaTimer: !!via_timer })),
  );
}
