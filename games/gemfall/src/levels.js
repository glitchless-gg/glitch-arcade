// The eight puzzles (plain data, no imports, so Node can load it for balancing).
//
// goal:   { type: 'score', target } | { type: 'collect', kind, count } | { type: 'stone' } (every stone tile)
//         | { type: 'crown', count }
// layout: 8 rows of '.' (a cell), '#' (a cell with a stone tile under its gem: clearing that gem breaks it)
//         and ' ' (a gap: shaped boards have fewer moves, so they sometimes run out and reshuffle)
// crowns: [row, col] cells that start with a crown (crowns fall with the gems and are collected on the
//         lowest cell of their column)
// colors: how many gem colours fall (5 = more cascades, 6 = harder)
// stars:  score for 1, 2 and 3 stars (1 star = beating the goal)

export const TRIES_PER_LEVEL = 3;
export const MOVE_BONUS = 250; // points per move left when the goal is met

export const KIND_NAMES = ['ruby', 'amber', 'topaz', 'emerald', 'sapphire', 'amethyst'];
export const KIND_PLURALS = ['rubies', 'ambers', 'topazes', 'emeralds', 'sapphires', 'amethysts'];

export const LEVELS = [
  {
    id: 'level-1',
    name: 'First Facets',
    blurb: 'Score 2,000 points',
    moves: 15,
    colors: 5,
    goal: { type: 'score', target: 2000 },
    layout: ['........', '........', '........', '........', '........', '........', '........', '........'],
    stars: [2000, 4500, 6000],
  },
  {
    id: 'level-2',
    name: 'Ruby Rush',
    blurb: 'Collect 10 rubies',
    moves: 16,
    colors: 6,
    goal: { type: 'collect', kind: 0, count: 10 },
    layout: ['........', '........', '..    ..', '...  ...', '...  ...', '..    ..', '........', '........'],
    stars: [1, 5000, 7000],
  },
  {
    id: 'level-3',
    name: 'Stonebreak',
    blurb: 'Break 10 stone tiles',
    moves: 16,
    colors: 5,
    goal: { type: 'stone' },
    layout: ['........', '........', '........', '........', '..#####.', '.#####..', '........', '........'],
    stars: [1, 5500, 8000],
  },
  {
    id: 'level-4',
    name: 'Crown Drop',
    blurb: 'Bring 2 crowns down',
    moves: 18,
    colors: 5,
    goal: { type: 'crown', count: 2 },
    crowns: [
      [5, 2],
      [5, 5],
    ],
    layout: ['  ....  ', '  ....  ', '........', '........', '........', '........', '........', '........'],
    stars: [1, 5500, 8000],
  },
  {
    id: 'level-5',
    name: 'Quarry',
    blurb: 'Break 15 stone tiles',
    moves: 22,
    colors: 5,
    goal: { type: 'stone' },
    layout: ['........', '........', '...##...', '..####..', '.##..##.', '..####..', '...#....', '........'],
    stars: [1, 6500, 9000],
  },
  {
    // GLITCHLESS-DEMO: level 6 is a wall. Level 5 asked for 15 stones in 22 moves with five colours; this one
    // asks for 40 stones (every cell of five full rows) in 16 moves with six colours, so far fewer cascades.
    // It reads as "the next quarry level" on paper and plays as a brick wall: most players run out of moves
    // on it again and again, and the run ends here.
    id: 'level-6',
    name: 'The Vault',
    blurb: 'Break 40 stone tiles',
    moves: 16,
    colors: 6,
    goal: { type: 'stone' },
    layout: ['........', '........', '########', '########', '########', '########', '########', '........'],
    stars: [1, 9000, 12000],
  },
  {
    id: 'level-7',
    name: 'Sapphire Storm',
    blurb: 'Collect 16 sapphires',
    moves: 18,
    colors: 5,
    goal: { type: 'collect', kind: 4, count: 16 },
    layout: ['........', '. .. .. ', '........', '........', '........', '........', ' .. .. .', '........'],
    stars: [1, 6000, 8500],
  },
  {
    id: 'level-8',
    name: 'Crown Jewels',
    blurb: 'Bring 2 crowns down',
    moves: 20,
    colors: 5,
    goal: { type: 'crown', count: 2 },
    crowns: [
      [1, 2],
      [1, 5],
    ],
    layout: ['. .. . .', '........', '........', '........', '........', '........', ' ###### ', '  ####  '],
    stars: [1, 7000, 10000],
  },
];

export function levelIndex(id) {
  return LEVELS.findIndex((l) => l.id === id);
}
