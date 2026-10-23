// Autoplay bot: ?autoplay=1&skill=0..1&seed=N
//
// Spends gold before and during each wave following a build plan: buildable tiles ranked by how much
// of the path each tower type reaches from them (precomputed below). It acts through the same
// commands as the mouse and keyboard (build at a tile, upgrade, sell, call the wave, toggle 2x).
//
// Low skill: ~80% arrow towers, sloppier tile picks, slow to react, rarely upgrades, never adapts,
// so the wave 7 brutes usually break it. High skill: frost at the chokepoint, cannons on the bends,
// upgrades, switches to cannons once it sees brutes, calls waves early and plays at 2x now and then.
// Deterministic per seed (it ticks on the sim's fixed step).
import { rankTiles } from './map.js';
import { TOWERS, upgradeCost } from './rules.js';
import { STEP } from './sim.js';
import { createRng } from './rng.js';

// The build plan: for each tower type, every buildable tile, best path coverage first.
export const PLAN = Object.fromEntries(Object.entries(TOWERS).map(([type, def]) => [type, rankTiles(def.tiers[0].range)]));
const coverOf = (t) => PLAN[t.type].find((x) => x.col === t.col && x.row === t.row)?.cover ?? 0;

export function createAutoplay({ skill, seed }) {
  const rng = createRng(seed);
  const planP = Math.pow(skill, 1.5); // how often a choice follows the plan instead of "arrows, probably"
  const pUpgrade = 0.03 + 0.5 * skill * skill;
  const adapts = skill >= 0.55;
  const pEarly = skill > 0.5 ? 0.1 + (skill - 0.5) : 0.03;
  const reaction = () => (0.25 + (1 - skill) * 1.1) * rng.range(0.7, 1.4);

  const bot = {
    skill,
    seed,
    halted: false,
    intent: null,
    cooldown: reaction() + 0.5,
    seenBrutes: false,
    adapted: false,
    lastWave: 0,
    lastBuild: 0,
    menuT: 0,
    menuWait: rng.range(0.6, 1.1),
    log: [],
  };

  const counts = (sim) => {
    const n = { arrow: 0, cannon: 0, frost: 0 };
    for (const t of sim.towers) n[t.type]++;
    return n;
  };

  function chooseType(sim) {
    const n = counts(sim);
    const total = sim.towers.length;
    if (bot.adapted) return n.frost === 0 || rng.chance(0.15) ? 'frost' : 'cannon';
    if (rng.chance(planP)) {
      if (total >= 2 && n.frost === 0) return 'frost';
      if (total >= 7 && n.frost < 2 && rng.chance(0.2)) return 'frost';
      if (n.cannon < Math.round(total * 0.4)) return 'cannon';
      return 'arrow';
    }
    const r = rng.next();
    return r < 0.8 ? 'arrow' : r < 0.92 ? 'cannon' : 'frost';
  }

  function chooseTile(sim, type) {
    const free = PLAN[type].filter((t) => sim.canBuild(t.col, t.row));
    if (!free.length) return null;
    // the chokepoint for a planned frost tower; otherwise skill decides how far down the list we land
    const k = Math.min(free.length - 1, Math.floor(Math.abs(rng.gauss()) * (1 - skill) * 9));
    return free[k];
  }

  function chooseUpgrade(sim) {
    const options = sim.towers.filter((t) => t.tier < 3);
    if (!options.length) return null;
    if (rng.chance(planP)) {
      const prio = bot.adapted ? { cannon: 3, frost: 2, arrow: 0 } : { cannon: 2, frost: 1.5, arrow: 1 };
      options.sort((a, b) => prio[b.type] - prio[a.type] || a.tier - b.tier || coverOf(b) - coverOf(a));
      return options[0];
    }
    return rng.pick(options);
  }

  function chooseIntent(sim) {
    if (sim.towers.length >= 3 && rng.chance(bot.adapted ? 0.45 : pUpgrade)) {
      const t = chooseUpgrade(sim);
      if (t) return { kind: 'upgrade', id: t.id };
    }
    const type = chooseType(sim);
    const tile = chooseTile(sim, type);
    return tile ? { kind: 'build', type, col: tile.col, row: tile.row } : null;
  }

  function cost(sim, intent) {
    if (intent.kind === 'build') return TOWERS[intent.type].cost;
    const t = sim.towers.find((t) => t.id === intent.id);
    return t ? upgradeCost(t) : null;
  }

  function sellWorst(sim, type, cmds) {
    const queued = new Set(cmds.filter((c) => c.type === 'sell').map((c) => c.id));
    const pool = sim.towers.filter((t) => (!type || t.type === type) && !queued.has(t.id));
    if (!pool.length) return;
    pool.sort((a, b) => coverOf(a) - coverOf(b));
    cmds.push({ type: 'sell', id: pool[0].id });
  }

  /** Called every fixed step while the run is live. Returns the commands to apply this step. */
  bot.step = (sim, { fast }) => {
    const cmds = [];
    if (bot.halted || sim.phase === 'won' || sim.phase === 'lost') return cmds;

    // once per wave: maybe play with the speed toggle
    if (sim.phase === 'wave' && sim.wave !== bot.lastWave) {
      bot.lastWave = sim.wave;
      if (!fast && sim.wave <= 6 && rng.chance(skill > 0.5 ? 0.35 : 0.07)) cmds.push({ type: 'speed' });
      else if (fast && (rng.chance(0.3) || (skill > 0.7 && sim.wave >= 7))) cmds.push({ type: 'speed' });
    }

    // the brutes show up (wave 7): good players change plans, sell weak arrows and buy cannons
    if (!bot.seenBrutes && sim.enemies.some((e) => e.type === 'brute' && e.d > 1)) {
      bot.seenBrutes = true;
      if (adapts) {
        bot.adapted = true;
        bot.intent = null;
        bot.cooldown = reaction();
        if (skill >= 0.7) {
          const arrows = sim.towers.filter((t) => t.type === 'arrow').length;
          for (let i = 0; i < Math.min(2, arrows - 2); i++) sellWorst(sim, 'arrow', cmds);
        }
      }
    }

    bot.cooldown -= STEP;
    if (bot.cooldown > 0) return cmds;
    bot.cooldown = reaction();

    // now and then, sell the tower that covers the least path and spend the gold elsewhere
    if (sim.phase === 'build' && sim.towers.length >= 4 && bot.soldIn !== sim.wave) {
      bot.soldIn = sim.wave;
      if (rng.chance(0.12)) {
        sellWorst(sim, null, cmds);
        return cmds;
      }
    }

    if (bot.intent) {
      // still valid? (tile taken, tower sold or maxed)
      const c = cost(sim, bot.intent);
      if (c === null || (bot.intent.kind === 'build' && !sim.canBuild(bot.intent.col, bot.intent.row))) bot.intent = null;
    }
    if (!bot.intent) bot.intent = chooseIntent(sim);
    const intent = bot.intent;
    if (intent && sim.gold >= cost(sim, intent)) {
      cmds.push(intent.kind === 'build' ? { type: 'build', tower: intent.type, col: intent.col, row: intent.row } : { type: 'upgrade', id: intent.id });
      bot.intent = null;
      return cmds;
    }
    // nothing affordable: call the next wave early?
    if (sim.phase === 'build' && sim.buildLeft > 1 && rng.chance(pEarly)) cmds.push({ type: 'call' });
    return cmds;
  };

  /** Title screen: returns true when the bot "presses Space". */
  bot.menu = (dt) => {
    if (bot.halted) return false;
    bot.menuT += dt;
    return bot.menuT >= bot.menuWait;
  };

  return bot;
}
