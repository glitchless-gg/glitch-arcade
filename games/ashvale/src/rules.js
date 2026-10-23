// Numbers that make Ashvale play the way it does (plain data).

export const STEP = 1 / 60;

export const HERO = {
  radius: 0.42,
  speed: 6.6,
  hp: 100,
  mana: 60,
  manaRegen: 6, // per second
  potionsStart: 2,
  potionsMax: 5,
  potionHeal: 0.55, // of max health
  potionCooldown: 0.8,
  damage: 8, // + 1.5 per level + the weapon
  damagePerLevel: 1.5,
  crit: 0.05,
  critMult: 1.75,
  swing: { cooldown: 0.48, anim: 0.22, range: 2.5, arc: (125 * Math.PI) / 180, slow: 0.55 },
  dodge: { time: 0.3, speed: 14, iframes: 0.34, cooldown: 0.85 },
  nova: { cost: 24, cooldown: 3.2, radius: 5, damage: 14, burnTicks: 8, burnEvery: 0.25, burnDamage: 3 },
  levelHp: 14,
  levelMana: 6,
};

// Cumulative XP for level 2, 3, 4, …
export const XP_LEVELS = [50, 130, 250, 400, 600, 850, 1150, 1500];

export function levelForXp(xp) {
  let level = 1;
  for (const need of XP_LEVELS) if (xp >= need) level++;
  return level;
}

export const FOES = {
  skeleton: { hp: 52, radius: 0.5, speed: 3.4, damage: 14, windup: 0.5, range: 1.9, arc: (100 * Math.PI) / 180, recover: 0.8, aggro: 10, xp: 14 },
  slime: { hp: 36, radius: 0.62, speed: 2.6, damage: 11, windup: 0.5, lunge: 3.6, lungeTime: 0.32, recover: 0.95, aggro: 9, xp: 8 },
  slime_small: { hp: 14, radius: 0.38, speed: 3.5, damage: 6, windup: 0.4, lunge: 2.8, lungeTime: 0.26, recover: 0.8, aggro: 9, xp: 3 },
  archer: { hp: 30, radius: 0.45, speed: 3.0, damage: 8, draw: 0.7, reload: 2.2, arrowSpeed: 11, range: 13, keepMin: 5.5, keepMax: 10, lead: 0.4, aggro: 12, xp: 16 },
  ash_lord: {
    hp: 800,
    radius: 1.3,
    speed: 2.6,
    xp: 150,
    cleave: { range: 3.4, arc: (140 * Math.PI) / 180, windup: 0.5, damage: 34, recover: 0.6 },
    slam: { maxRange: 11, windup: 0.8, radius: 3.4, damage: 44, recover: 0.7, cooldown: 3.6 },
    bolts: { windup: 0.5, count: 7, spread: 0.32, speed: 13, damage: 19, recover: 0.5, cooldown: 2.6 },
    summonAt: [0.66, 0.33],
    enrageAt: 0.3,
  },
};

/** Enemies get tougher floor by floor (the boss has its own numbers). */
export function floorScale(floorIndex) {
  return { hp: 1 + 0.45 * floorIndex, damage: 1 + 0.3 * floorIndex, xp: 1 + 0.3 * floorIndex };
}

export const DROPS = {
  gold: 0.5,
  potion: 0.07,
  gear: 0.16,
  smallGold: 0.3, // small slimes drop nothing but a little gold
  // weights
  rarity: [
    ['legendary', 3.5],
    ['rare', 12],
    ['magic', 32],
    ['common', 52.5],
  ],
  slot: [
    ['weapon', 40],
    ['armor', 35],
    ['ring', 25],
  ],
};

export const BOSS_ROOM = 'ash_throne';
export const DEATHS_PER_FLOOR = 3;
