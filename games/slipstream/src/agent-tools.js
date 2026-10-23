// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw — they return { ok: false, error } instead.
import { TRACK_IDS } from './tracks.js';

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
 * api = { getState(), loadTrack(id), teleport(section), spawnSkids(count), setPaused(bool) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'slipstream_get_state',
    'Slipstream race state: track, sections, lap, race position, race and best lap time, player position/speed/section/wrecks, rivals, live skid-mark mesh count, particles, renderer draw calls and geometries, UI state (title/countdown/racing/finished/results/champion/paused).',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'slipstream_load_track',
    'Load a track and start a race on it (3-2-1 countdown, counts as a normal level start). Tracks: harbor (easy), canyon (has the cliff_hairpin), neon (chicanes).',
    { type: 'object', properties: { track: { type: 'string', enum: TRACK_IDS } }, required: ['track'] },
    safe(({ track }) => {
      if (!TRACK_IDS.includes(track)) return { ok: false, error: `track must be one of ${TRACK_IDS.join(', ')}` };
      return api.loadTrack(track);
    }),
  );
  gd.registerTool(
    'slipstream_teleport',
    'Put the player car, stopped, on the centerline at the start of a section of the current track (see sections in slipstream_get_state). On canyon, long_descent ends with the boost pad right before cliff_hairpin.',
    { type: 'object', properties: { section: { type: 'string', description: 'section id, e.g. long_descent' } }, required: ['section'] },
    safe(({ section }) => {
      if (typeof section !== 'string' || !section) return { ok: false, error: 'section must be a section id string' };
      return api.teleport(section);
    }),
  );
  gd.registerTool(
    'slipstream_spawn_skids',
    "Lay skid marks on the road behind the player through the game's real addSkidMark() path (the one cars use when braking hard or drifting), to reproduce the skid-mark cost on demand. Returns the live skid-mark count and renderer stats.",
    { type: 'object', properties: { count: { type: 'number', description: 'how many marks (1–5000)' } }, required: ['count'] },
    safe(({ count }) => {
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return { ok: false, error: 'count must be a number ≥ 1' };
      return api.spawnSkids(count);
    }),
  );
  gd.registerTool(
    'slipstream_set_paused',
    'Pause or resume the race.',
    { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] },
    safe(({ paused }) => api.setPaused(!!paused)),
  );
}
