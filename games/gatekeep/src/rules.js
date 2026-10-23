// Towers, enemies and waves (plain data). Ranges are in tiles, times in game seconds.

export const START_GOLD = 160;
export const START_LIVES = 20;
export const SELL_RATE = 0.6;
export const FIRST_BUILD_S = 10; // build time before wave 1
export const INTERMISSION_S = 4; // between waves
export const EARLY_GOLD_PER_S = 3; // calling a wave early pays for the time you skip
export const clearBonus = (wave) => 15 + wave * 3;

export const TOWERS = {
  arrow: {
    name: 'Arrow',
    key: '1',
    cost: 50,
    upgrades: [30, 50], // ~60% and 100% of the base cost
    blurb: 'Fast, single target',
    tiers: [
      { dmg: 7, rate: 0.37, range: 2.4 },
      { dmg: 10, rate: 0.33, range: 2.6 },
      { dmg: 14, rate: 0.28, range: 2.8 },
    ],
  },
  cannon: {
    name: 'Cannon',
    key: '2',
    cost: 90,
    upgrades: [54, 90],
    blurb: 'Slow, splash damage',
    tiers: [
      { dmg: 22, rate: 1.35, range: 2.3, splash: 0.9 },
      { dmg: 34, rate: 1.2, range: 2.5, splash: 1.0 },
      { dmg: 50, rate: 1.05, range: 2.7, splash: 1.15 },
    ],
  },
  frost: {
    name: 'Frost',
    key: '3',
    cost: 70,
    upgrades: [42, 70],
    blurb: 'Slows everything nearby',
    tiers: [
      { dmg: 2, rate: 1.2, range: 2.0, slow: 0.45, slowFor: 1.4 },
      { dmg: 3, rate: 1.1, range: 2.2, slow: 0.38, slowFor: 1.6 },
      { dmg: 5, rate: 1.0, range: 2.4, slow: 0.3, slowFor: 1.8 },
    ],
  },
};
export const TOWER_TYPES = Object.keys(TOWERS);

// lives: what a leak costs the gate. arrowMult: armor against arrows.
// GLITCHLESS-DEMO: wave 7 armor spike — brutes take 25% damage from arrows, the tower most players spam.
export const ENEMIES = {
  runner: { name: 'Runner', hp: 16, speed: 4.4, gold: 3, lives: 1, size: 0.26 },
  grunt: { name: 'Grunt', hp: 40, speed: 3.2, gold: 5, lives: 1, size: 0.32 },
  brute: { name: 'Brute', hp: 160, speed: 2.5, gold: 12, lives: 2, size: 0.42, arrowMult: 0.25 },
  swarmling: { name: 'Swarmling', hp: 16, speed: 2.9, gold: 1, lives: 1, size: 0.15 },
};
export const ENEMY_TYPES = Object.keys(ENEMIES);

// A wave is a list of groups: `count` enemies of `type`, the first at `at` seconds, then one every
// `every` seconds. `pack` spawns the whole group in the same step, spread `spread` tiles back into
// the cave so they pour out together.
export const WAVES = [
  [{ type: 'grunt', count: 6, at: 0, every: 0.6 }],
  [{ type: 'runner', count: 12, at: 0, every: 0.35 }],
  [
    { type: 'grunt', count: 7, at: 0, every: 0.5 },
    { type: 'runner', count: 5, at: 1, every: 0.45 },
  ],
  [{ type: 'grunt', count: 12, at: 0, every: 0.42 }],
  [
    { type: 'runner', count: 14, at: 0, every: 0.26 },
    { type: 'grunt', count: 6, at: 2, every: 0.4 },
  ],
  [
    { type: 'grunt', count: 16, at: 0, every: 0.34 },
    { type: 'runner', count: 8, at: 2.5, every: 0.3 },
  ],
  // GLITCHLESS-DEMO: wave 7 armor spike — twelve armored brutes, no warning, after six waves that
  // reward cheap arrow towers (arrows do 25% damage to brutes, see ENEMIES.brute.arrowMult).
  [{ type: 'brute', count: 12, at: 0, every: 0.55 }],
  [
    { type: 'grunt', count: 14, at: 0, every: 0.34 },
    { type: 'brute', count: 3, at: 1.2, every: 1.0 },
    { type: 'runner', count: 8, at: 3.5, every: 0.26 },
  ],
  // The swarm: 120 swarmlings pour out of the cave within about a second, then 120 more four seconds
  // later, each with its own health-bar texture (see the GLITCHLESS-DEMO notes in healthbars.js).
  [
    { type: 'swarmling', count: 40, at: 0, every: 0, pack: true, spread: 2.5 },
    { type: 'swarmling', count: 40, at: 0.4, every: 0, pack: true, spread: 2.5 },
    { type: 'swarmling', count: 40, at: 0.8, every: 0, pack: true, spread: 2.5 },
    { type: 'swarmling', count: 40, at: 4, every: 0, pack: true, spread: 2.5 },
    { type: 'swarmling', count: 40, at: 4.4, every: 0, pack: true, spread: 2.5 },
    { type: 'swarmling', count: 40, at: 4.8, every: 0, pack: true, spread: 2.5 },
  ],
  [
    { type: 'grunt', count: 16, at: 0, every: 0.3 },
    { type: 'brute', count: 5, at: 1, every: 0.8 },
    { type: 'runner', count: 12, at: 3.5, every: 0.22 },
  ],
];
export const WAVE_COUNT = WAVES.length;

export const waveId = (n) => `wave-${n}`;
export const sellValue = (tower) => Math.round(tower.invested * SELL_RATE);
export const upgradeCost = (tower) => (tower.tier < 3 ? TOWERS[tower.type].upgrades[tower.tier - 1] : null);
export const towerStats = (type, tier) => TOWERS[type].tiers[tier - 1];
