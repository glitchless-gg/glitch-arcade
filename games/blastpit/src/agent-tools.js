// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw — they return { ok: false, error } instead.

const LEVEL_IDS = ['round-1', 'round-2', 'round-3'];

function safe(fn) {
  return async (args = {}) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };
}

/**
 * api = { getState(), loadLevel(id), spawnSwarm(count), teleport(x, z), setPaused(bool) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'blastpit_get_state',
    'Blastpit! game state: round, round time, tries left, player position/yaw/health, weapon and ammo, enemies by type, rockets and orbs in flight, number of lights in the scene, kills, hostiles left, renderer draw calls and shader programs, and UI state (title/playing/paused/dead/intermission/win/gameover).',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'blastpit_load_level',
    'Start a round directly (counts as a normal level start). round-1 Warmup (grunts), round-2 Crossfire (grunts + gunners), round-3 Swarm (gunners, then 30 swarmers at ~10 s).',
    { type: 'object', properties: { level: { type: 'string', enum: LEVEL_IDS } }, required: ['level'] },
    safe(({ level }) => {
      if (!LEVEL_IDS.includes(level)) return { ok: false, error: `level must be one of ${LEVEL_IDS.join(', ')}` };
      return api.loadLevel(level);
    }),
  );
  gd.registerTool(
    'blastpit_spawn_swarm',
    'Spawn `count` swarmers at the spawn gates right now, through the same spawnSwarmer() path round 3 uses, to reproduce the swarm stutter on demand. Returns the light count before and after.',
    { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 60, description: 'how many swarmers (round 3 spawns 30)' } }, required: ['count'] },
    safe(({ count }) => {
      const n = Math.floor(Number(count));
      if (!Number.isFinite(n) || n < 1 || n > 60) return { ok: false, error: 'count must be an integer from 1 to 60' };
      return api.spawnSwarm(n);
    }),
  );
  gd.registerTool(
    'blastpit_teleport',
    'Move the player to (x, z) on the arena floor. The arena spans -20..20 on both axes; the player starts at (0, 13); pillars stand at (±9, ±9).',
    { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'z'] },
    safe(({ x, z }) => {
      if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, error: 'x and z must be finite numbers' };
      if (Math.abs(x) > 20 || Math.abs(z) > 20) return { ok: false, error: 'x and z must be within -20..20' };
      return api.teleport(x, z);
    }),
  );
  gd.registerTool(
    'blastpit_set_paused',
    'Pause or resume the game.',
    { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] },
    safe(({ paused }) => api.setPaused(!!paused)),
  );
}
