// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw — they return { ok: false, error } instead.

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
 * api = { getState(), startRun(), skipToPipe(pipe), spawnPipes(count), setPaused(bool) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'flapjack_get_state',
    'Flapjack state: UI state (title/playing/paused/dying/gameover), the run (score, next pipe, biome, medal, time), the bird (x = distance along the course, y = height, vertical speed), the session (runs, best, deaths by cause), pipe pairs in the scene vs on screen, particles, and renderer stats (draw calls, geometries, textures, programs).',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'flapjack_start_run',
    'Start a new run from pipe 1 (from the title, the game-over card or mid-run; a run in progress ends with levelFail cause "restart"). Counts as a normal level start of "sky" and, after a game over, a retry.',
    { type: 'object', properties: {} },
    safe(() => api.startRun()),
  );
  gd.registerTool(
    'flapjack_skip_to_pipe',
    'Start a run just before pipe N: the bird is placed in front of pipe N-1 at its height, with N-2 pipes already scored, so it meets pipe N the way players do. Pipe 12 is the squeeze (gap 2.3 vs ~3.5, 4.4 units above pipe 11). Medals and biome changes below the starting score are not tracked again.',
    { type: 'object', properties: { pipe: { type: 'integer', minimum: 1, maximum: 200, description: 'the pipe number (1-based), e.g. 12' } }, required: ['pipe'] },
    safe(({ pipe }) => {
      const n = Math.floor(Number(pipe));
      if (!Number.isFinite(n) || n < 1 || n > 200) return { ok: false, error: 'pipe must be an integer from 1 to 200' };
      return api.skipToPipe(n);
    }),
  );
  gd.registerTool(
    'flapjack_spawn_pipes',
    'Build `count` pipe pairs through the real spawnPipe(), at the course positions on screen right now: what count/6 retries leave behind there. Returns pipe pairs in the scene, geometries and draw calls before and after (measured on the next frames).',
    { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['count'] },
    safe(({ count }) => {
      const n = Math.floor(Number(count));
      if (!Number.isFinite(n) || n < 1 || n > 300) return { ok: false, error: 'count must be an integer from 1 to 300' };
      return api.spawnPipes(n);
    }),
  );
  gd.registerTool(
    'flapjack_set_paused',
    'Pause or resume a run.',
    { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] },
    safe(({ paused }) => api.setPaused(!!paused)),
  );
}
