// Game-specific tools for coding agents (exposed by the Glitchless SDK over WebMCP).
// Handlers never throw — they return { ok: false, error } instead.

const FLOOR_IDS = ['floor-1', 'floor-2', 'floor-3'];
const RARITIES = ['common', 'magic', 'rare', 'legendary'];
const SLOTS = ['weapon', 'armor', 'ring', 'gold', 'potion'];

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
 * api = { getState(), loadFloor(id), spawnHits(count), dropLoot(rarity, slot), setPaused(bool) }
 */
export function registerAgentTools(gd, api) {
  gd.registerTool(
    'ashvale_get_state',
    "Ashvale game state: floor and room, rooms cleared (with swings per room), stairs, deaths and lives left on this floor, the hero (position, health, mana, level, XP, potions, gold, damage, armor), equipped gear and rarity, enemies by type, the Ash Lord's health and phase, projectiles in flight, loot on the floor, damage-number DOM nodes (created, still visible, in the DOM), renderer draw calls/geometries/programs, and UI state.",
    { type: 'object', properties: {} },
    safe(() => api.getState()),
  );
  gd.registerTool(
    'ashvale_load_floor',
    "Start a floor directly (a normal level start). floor-1 The Ash Cellars, floor-2 Archers' Gallery (archers on ledges in a long hall), floor-3 The Ash Lord's Hall (the boss).",
    { type: 'object', properties: { floor: { type: 'string', enum: FLOOR_IDS } }, required: ['floor'] },
    safe(({ floor }) => {
      if (!FLOOR_IDS.includes(floor)) return { ok: false, error: `floor must be one of ${FLOOR_IDS.join(', ')}` };
      return api.loadFloor(floor);
    }),
  );
  gd.registerTool(
    'ashvale_spawn_hits',
    'Show `count` damage numbers over the enemies right now, through the same path real hits use (showHit → spawnNumber), to reproduce the slowdown that builds up over a session. Returns the damage-number DOM node count before and after. Measure frame time before and after.',
    { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 5000, description: 'how many hits (a full run makes about 500)' } }, required: ['count'] },
    safe(({ count }) => {
      const n = Math.floor(Number(count));
      if (!Number.isFinite(n) || n < 1 || n > 5000) return { ok: false, error: 'count must be an integer from 1 to 5000' };
      return api.spawnHits(n);
    }),
  );
  gd.registerTool(
    'ashvale_drop_loot',
    "Drop an item at the hero's feet; the hero steps onto it on the next step, through the normal pickup path (loot event, compare, equip or salvage). Use slot gold or potion for those (rarity is ignored). Returns whether it was picked up or equipped and whether picking it up raised an error.",
    {
      type: 'object',
      properties: { rarity: { type: 'string', enum: RARITIES }, slot: { type: 'string', enum: SLOTS } },
      required: ['slot'],
    },
    safe(({ rarity = 'common', slot }) => {
      if (!SLOTS.includes(slot)) return { ok: false, error: `slot must be one of ${SLOTS.join(', ')}` };
      if (!RARITIES.includes(rarity)) return { ok: false, error: `rarity must be one of ${RARITIES.join(', ')}` };
      return api.dropLoot(rarity, slot);
    }),
  );
  gd.registerTool(
    'ashvale_set_paused',
    'Pause or resume the game.',
    { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] },
    safe(({ paused }) => api.setPaused(!!paused)),
  );
}
