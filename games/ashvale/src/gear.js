// Gear: what drops, what it does, and whether it beats what the hero is wearing (pure).

export const RARITIES = ['common', 'magic', 'rare', 'legendary'];
export const SLOTS = ['weapon', 'armor', 'ring'];

// Colours for drop beams, toasts and the HUD's slots: every rarity has one.
export const RARITY_COLOR = { common: '#d9d3c7', magic: '#5aa8ff', rare: '#ffd84a', legendary: '#ff8a1e' };

const BASE = { weapon: { damage: 7 }, armor: { armor: 9 }, ring: { crit: 0.05, mana: 12 } };

// GLITCHLESS-DEMO: the legendary crash (an error in one item type). The balance table was written back when
// there were three rarities. Legendaries came later (the drop table in rules.js, the colours above, the Ash
// Lord's guaranteed drop) and nobody added a row here, so compare() reads RARITY_STATS.legendary.mult.
const RARITY_STATS = {
  common: { mult: 1 },
  magic: { mult: 1.35 },
  rare: { mult: 1.8 },
};

const NAMES = {
  weapon: ['Blade', 'Cleaver', 'Longsword', 'Falchion', 'Edge', 'Hacker'],
  armor: ['Jerkin', 'Hauberk', 'Brigandine', 'Cuirass', 'Coat'],
  ring: ['Band', 'Loop', 'Signet', 'Ring', 'Coil'],
};
const PREFIX = {
  common: ['Worn', 'Plain', 'Dented', 'Old'],
  magic: ['Fine', 'Keen', 'Warded', 'Bright'],
  rare: ['Gleaming', 'Cinder', 'Duskforged', 'Grim'],
};
const LEGENDARY = { weapon: 'Emberwake', armor: "The Ash Lord's Mantle", ring: 'Ring of the Last Coal' };

export const STARTER_WEAPON = { id: 0, kind: 'gear', slot: 'weapon', rarity: 'common', ilvl: 0, name: 'Rusty Blade' };

let nextId = 1;

/** A new item. Naming doesn't need its numbers: those are worked out when it's compared. */
export function makeItem(rng, { slot, rarity, ilvl }) {
  const name = rarity === 'legendary' ? LEGENDARY[slot] : `${rng.pick(PREFIX[rarity])} ${rng.pick(NAMES[slot])}`;
  return { id: nextId++, kind: 'gear', slot, rarity, ilvl, name };
}

function powerOf(item) {
  return RARITY_STATS[item.rarity].mult * (1 + 0.3 * item.ilvl);
}

/** What an item adds to the hero. */
export function statsOf(item) {
  if (!item) return {};
  const p = powerOf(item);
  if (item.slot === 'weapon') return { damage: Math.round(BASE.weapon.damage * p) };
  if (item.slot === 'armor') return { armor: Math.min(50, Math.round(BASE.armor.armor * p)) };
  return { crit: Math.round(BASE.ring.crit * p * 100) / 100, mana: Math.round(BASE.ring.mana * p) };
}

/** Is `item` better than what's in its slot? { better, gain (fraction), stats, was } */
export function compare(item, current) {
  // GLITCHLESS-DEMO: the legendary crash. RARITY_STATS.legendary is undefined, so this line throws
  // "TypeError: Cannot read properties of undefined (reading 'mult')" for every legendary.
  const next = RARITY_STATS[item.rarity].mult * (1 + 0.3 * item.ilvl);
  const now = current ? RARITY_STATS[current.rarity].mult * (1 + 0.3 * current.ilvl) : 0;
  return { better: next > now + 1e-9, gain: now ? next / now - 1 : 1, stats: statsOf(item), was: current ? statsOf(current) : null };
}

/** The hero's totals from what it wears. */
export function gearTotals(gear) {
  const out = { damage: 0, armor: 0, crit: 0, mana: 0 };
  for (const slot of SLOTS) {
    const s = statsOf(gear[slot]);
    for (const k of Object.keys(s)) out[k] += s[k];
  }
  return out;
}

/** One-line summary of an item's stats, e.g. "+14 damage". */
export function describe(stats) {
  if (!stats) return '';
  if (stats.damage != null) return `+${stats.damage} damage`;
  if (stats.armor != null) return `${stats.armor}% armor`;
  return `+${Math.round((stats.crit || 0) * 100)}% crit · +${stats.mana || 0} mana`;
}
