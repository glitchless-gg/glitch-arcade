// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw — they return { ok: false, error } instead.
import { ROOMS } from './rooms.js';

const ROOM_IDS = ROOMS.map((r) => r.id);

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
 * api = { getState(), teleport(room), grantAbility(ability), setPaused(bool), reenterRoom(room, killOne) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'undervault_get_state',
    'Undervault state: current room and area, player position/velocity, hearts, abilities (dash, double_jump), deaths and last death cause, kills, save room, visited rooms, enemies in the room (alive, freed null slots), the Warden boss (state, hp, enraged, attempts), particle count, renderer stats and UI state.',
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'undervault_teleport',
    'Put the knight at the entrance of a room (goes through the normal room-enter path). Route: gate → ossuary → long_shaft → furnace → gear_hall → dash_shrine → gear_hall → collapsed_bridge → boot_shrine → long_shaft → spike_gallery (the difficulty spike) → warden_hall (boss).',
    { type: 'object', properties: { room: { type: 'string', enum: ROOM_IDS } }, required: ['room'] },
    safe(({ room }) => {
      if (!ROOM_IDS.includes(room)) return { ok: false, error: `room must be one of ${ROOM_IDS.join(', ')}` };
      return api.teleport(room);
    }),
  );
  gd.registerTool(
    'undervault_grant_ability',
    'Give the knight a relic through the real pickup path: dash (the Dash Cloak) or double_jump (the Winged Boots). The Spike Gallery needs both.',
    { type: 'object', properties: { ability: { type: 'string', enum: ['dash', 'double_jump'] } }, required: ['ability'] },
    safe(({ ability }) => api.grantAbility(ability)),
  );
  gd.registerTool(
    'undervault_set_paused',
    'Pause or resume the game.',
    { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] },
    safe(({ paused }) => api.setPaused(!!paused)),
  );
  gd.registerTool(
    'undervault_reenter_room',
    'Reproduce backtracking: put the knight in a room, kill one of its enemies through the real killEnemy() path (kill_one, default true), then leave and come back through the real enterRoom() path inside the game loop. In rooms with a freed enemy slot this throws the backtracking TypeError (reported to Glitchless). Rooms with enemies: ossuary, long_shaft, furnace, gear_hall, collapsed_bridge.',
    { type: 'object', properties: { room: { type: 'string', enum: ROOM_IDS }, kill_one: { type: 'boolean' } }, required: ['room'] },
    safe(({ room, kill_one }) => {
      if (!ROOM_IDS.includes(room)) return { ok: false, error: `room must be one of ${ROOM_IDS.join(', ')}` };
      return api.reenterRoom(room, kill_one !== false);
    }),
  );
}
