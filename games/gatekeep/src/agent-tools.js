// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw: they return { ok: false, error } instead.
import { TOWER_TYPES, WAVE_COUNT } from './rules.js';
import { COLS, ROWS } from './map.js';

function safe(fn) {
  return async (args = {}) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/**
 * api = { getState(), startWave(n), build(type, col, row), addGold(amount), spawnSwarm(count) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'gatekeep_get_state',
    'Gatekeep state: phase (build/wave/won/lost), wave, gold, gate lives, speed, every tower (type, tier, tile, zone, kills), enemies by type, projectiles, live health bars and the renderer counts (draw calls, geometries, textures).',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'gatekeep_start_wave',
    `Jump straight to a wave (1-${WAVE_COUNT}): clears the field and starts it now, keeping towers and gold (a normal levelStart for wave-N). Wave 7 is the armored brute wave, wave 9 the swarm.`,
    { type: 'object', properties: { wave: { type: 'integer', minimum: 1, maximum: WAVE_COUNT } }, required: ['wave'] },
    safe(({ wave }) => {
      if (!isInt(wave) || wave < 1 || wave > WAVE_COUNT) return { ok: false, error: `wave must be an integer from 1 to ${WAVE_COUNT}` };
      return api.startWave(wave);
    }),
  );
  gd.registerTool(
    'gatekeep_build',
    `Build a tower on a free grass tile (same path as a player click: costs gold, sends tower_built). col 0-${COLS - 1} left to right, row 0-${ROWS - 1} back to front.`,
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TOWER_TYPES },
        col: { type: 'integer', minimum: 0, maximum: COLS - 1 },
        row: { type: 'integer', minimum: 0, maximum: ROWS - 1 },
      },
      required: ['type', 'col', 'row'],
    },
    safe(({ type, col, row }) => {
      if (!TOWER_TYPES.includes(type)) return { ok: false, error: `type must be one of ${TOWER_TYPES.join(', ')}` };
      if (!isInt(col) || !isInt(row)) return { ok: false, error: 'col and row must be integers' };
      return api.build(type, col, row);
    }),
  );
  gd.registerTool(
    'gatekeep_add_gold',
    'Give the player gold (to set up a defense quickly before reproducing something).',
    { type: 'object', properties: { amount: { type: 'integer', minimum: 1, maximum: 100000 } }, required: ['amount'] },
    safe(({ amount }) => {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'amount must be a positive number' };
      return api.addGold(Math.min(100000, amount));
    }),
  );
  gd.registerTool(
    'gatekeep_spawn_swarm',
    'Spawn N swarmlings out of the cave at once through the real spawn path (each gets its own health bar, like wave 9), to reproduce the swarm stutter and watch renderer textures climb. Starts the next wave if none is running.',
    { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 500 } }, required: ['count'] },
    safe(({ count }) => {
      if (!isInt(count) || count < 1 || count > 500) return { ok: false, error: 'count must be an integer from 1 to 500' };
      return api.spawnSwarm(count);
    }),
  );
}
