// How long each step of a move takes on screen (s). Shared by the game and the Node balancing sim.
export const T = {
  swap: 0.1,
  pop: 0.13, // a plain clear
  popFx: 0.24, // a clear that fired a special (beams, shockwaves)
  fallBase: 0.05,
  fallPerCell: 0.023,
  collect: 0.4,
  reshuffle: 0.7,
  hammer: 0.26,
  intro: 0.8, // the level banner before the first move
  complete: 1.25, // the results card
  fail: 1.05, // "out of moves"
  final: 2.6, // the win / game over card before the bot closes the tab
};

export function phaseDuration(ph) {
  switch (ph.type) {
    case 'swap':
    case 'swapback':
      return T.swap;
    case 'clear':
      return ph.fx.length ? T.popFx : T.pop;
    case 'fall': {
      let far = 0;
      for (const m of ph.moves) far = Math.max(far, m.r - m.from);
      for (const s of ph.spawns) far = Math.max(far, s.r - s.from);
      return T.fallBase + far * T.fallPerCell;
    }
    case 'collect':
      return T.collect;
    case 'reshuffle':
      return T.reshuffle;
    case 'hammer':
      return T.hammer;
    default:
      return 0;
  }
}
