// The three floors of Ashvale, as plain data (no imports, so Node can load it).
//
// Everything is in tiles of TILE metres: a rect is [col, row, width, height]; the world position of a tile's
// centre is ((col + 0.5) * TILE, (row + 0.5) * TILE) on the xz plane (x right, z down the map). Rooms and halls
// are carved out of solid rock; walls are added around them. Rooms hold the enemies: a room wakes when the hero
// walks in, and it is cleared when every enemy that started in it (and every slime that split off one) is dead.
// Clearing all of a floor's rooms opens its stairs.

export const TILE = 2;

/** Enemy types: 'skeleton' (melee), 'slime' (splits once), 'archer' (keeps its distance), 'ash_lord' (the boss). */
export const FLOORS = [
  {
    id: 'floor-1',
    name: 'The Ash Cellars',
    blurb: 'Skeletons, slimes and a couple of archers. Learn the swing, the roll and the nova.',
    size: [42, 26],
    start: [4, 11],
    stairs: [38, 20],
    tint: 0xff8a3a,
    rooms: [
      { id: 'ash_steps', rect: [1, 8, 7, 7], enemies: [] },
      {
        id: 'bone_pit',
        rect: [12, 5, 11, 11],
        enemies: [
          ['skeleton', 15, 7],
          ['skeleton', 20, 9],
          ['skeleton', 17, 13],
          ['slime', 21, 13],
        ],
      },
      {
        id: 'slime_cistern',
        rect: [27, 3, 10, 10],
        enemies: [
          ['slime', 30, 5],
          ['slime', 33, 8],
          ['skeleton', 34, 10],
          ['archer', 35, 4],
        ],
      },
      {
        id: 'ember_vault',
        rect: [25, 17, 15, 7],
        enemies: [
          ['skeleton', 29, 19],
          ['skeleton', 33, 21],
          ['slime', 35, 18],
          ['archer', 37, 22],
        ],
      },
    ],
    halls: [
      [8, 10, 4, 3],
      [23, 9, 4, 3],
      [31, 13, 3, 4],
    ],
    ledges: [],
    pillars: [
      [14, 10],
      [20, 12],
      [31, 6],
      [28, 19],
      [34, 22],
    ],
    decor: { barrels: 9, bones: 12, rubble: 16 },
  },
  {
    id: 'floor-2',
    name: "Archers' Gallery",
    blurb: 'A guard room, then the long gallery. Archers hold the ledges on both sides.',
    size: [57, 19],
    start: [4, 10],
    stairs: [53, 7],
    tint: 0xffb347,
    rooms: [
      { id: 'gallery_steps', rect: [1, 8, 7, 6], enemies: [] },
      {
        id: 'guard_room',
        rect: [11, 6, 9, 10],
        enemies: [
          ['skeleton', 14, 8],
          ['skeleton', 17, 12],
          ['archer', 18, 7],
          ['slime', 13, 13],
        ],
      },
      {
        // GLITCHLESS-DEMO: the Archers' Gallery (difficulty spike). Six archers on the ledges along both long
        // walls, with arrows more than twice as fast as anywhere else, a much shorter draw and reload, and the
        // range of the whole room. The middle of the gallery has one broken pillar for cover. It was tuned once,
        // with god mode on, and never again.
        id: 'long_gallery',
        rect: [23, 5, 20, 10],
        enemies: [
          ['archer', 29, 5],
          ['archer', 33, 6],
          ['archer', 37, 5],
          ['archer', 31, 14],
          ['archer', 35, 13],
          ['archer', 39, 14],
          ['skeleton', 30, 9],
          ['skeleton', 36, 11],
        ],
        archer: { hp: 40, arrowSpeed: 28, draw: 0.32, reload: 0.9, range: 22, damage: 17, lead: 0.8 },
      },
      {
        id: 'quiver_hall',
        rect: [46, 6, 9, 9],
        enemies: [
          ['slime', 49, 8],
          ['slime', 50, 12],
          ['skeleton', 52, 10],
        ],
      },
    ],
    halls: [
      [8, 10, 3, 2],
      [20, 9, 3, 4],
      [43, 9, 3, 2],
    ],
    // raised walkway tiles along the gallery's long walls: the archers stay on them
    ledges: [
      [23, 5, 20, 2],
      [23, 13, 20, 2],
    ],
    pillars: [
      [15, 10],
      [33, 9],
    ],
    decor: { barrels: 8, bones: 10, rubble: 14 },
  },
  {
    id: 'floor-3',
    name: "The Ash Lord's Hall",
    blurb: 'One more antechamber, then the throne room. The Ash Lord does not like visitors.',
    size: [34, 30],
    start: [21, 26],
    stairs: [21, 2],
    tint: 0xff5a2a,
    rooms: [
      { id: 'throne_steps', rect: [18, 24, 7, 5], enemies: [] },
      {
        id: 'ash_antechamber',
        rect: [13, 14, 17, 7],
        enemies: [
          ['skeleton', 16, 16],
          ['skeleton', 26, 16],
          ['archer', 15, 19],
          ['slime', 24, 18],
          ['archer', 28, 19],
        ],
      },
      {
        id: 'ash_throne',
        rect: [10, 1, 23, 10],
        boss: true,
        enemies: [['ash_lord', 21, 4]],
      },
    ],
    halls: [
      [20, 21, 3, 3],
      [20, 11, 3, 3],
    ],
    ledges: [],
    pillars: [
      [20, 15],
      [23, 19],
      [13, 3],
      [29, 3],
      [13, 8],
      [29, 8],
    ],
    decor: { barrels: 6, bones: 16, rubble: 18 },
  },
];

export const FLOOR_IDS = FLOORS.map((f) => f.id);

/** Tile centre → world. */
export function tileCenter(c, r) {
  return { x: (c + 0.5) * TILE, z: (r + 0.5) * TILE };
}
