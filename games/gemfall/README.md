# Gemfall

A small match-3 puzzle game in vanilla Three.js, and one of the Glitchless genre demos. Eight puzzles on a
tilted board of chunky faceted gems (six colours, and each colour has its own cut, so the board reads without
colour too): swap two neighbours to line up three or more, watch the cascades chain, and beat each level's goal
before the moves run out. A good run of all eight levels takes two to three minutes. It has **three deliberate,
realistic problems** for Glitchless to find (listed below). **Don't fix them**: the demo depends on them.

## Run it

From the root of this repo:

```bash
npm install
npm run dev -w gemfall        # http://localhost:5180
npm run build -w gemfall      # → games/gemfall/dist (relative base './', deployable anywhere)
```

Telemetry goes to a Glitchless server at `http://localhost:7777` by default: run one from the
[Glitchless repo](https://github.com/glitchless-gg/glitchless) with `npm run server`. To send it to Glitchless Cloud
instead, add `?intake=https://api.glitchless.gg&token=gl_pub_…` with your project's client token. Without a server the
game still runs.

## Controls

| Input | Action |
| --- | --- |
| click a gem, then a neighbour | swap them (click the selected gem again to let go) |
| drag a gem onto a neighbour | swap them |
| `←` `→` `↑` `↓` | move the cursor; with a gem selected, swap it that way |
| `Space` / `Enter` | select the gem under the cursor (start, and skip a card) |
| `H` / the hammer button | arm the hammer, then click a gem to smash it (no move used) |
| `S` / the shuffle button | shuffle the board (no move used) |
| `Esc` / `P` | pause (then `R` restart the level, `Q` quit, `Esc` resume) |
| `M` | mute |
| `` ` `` | Glitchless overlay (bottom-right) |

A swap that makes no match swaps back and costs nothing. Four in a line makes a **striped** gem (it clears its row,
or its column if the line was vertical), an L or a T makes a **bomb** (3x3), and five in a line makes a **prism**
(swap it with any gem to clear every gem of that colour). Swapping two specials together sets off a combo: striped +
striped clears a cross, striped + bomb three rows and three columns, bomb + bomb 5x5, prism + striped or bomb turns
every gem of that colour into one and fires them all, prism + prism clears the board. Each level gives you one
hammer and one shuffle. If no move is left, the board reshuffles itself. After 5 s without a move a hint glows.
Moves left when the goal is met are worth 250 points each, and the score sets the stars (1 for the goal, 2 and 3
for the thresholds on the score meter). Out of moves fails the level; you get 3 tries per level, then the run ends (restarting from the pause menu doesn't cost a try).

## Query params

| Param | Default | Meaning |
| --- | --- | --- |
| `level=1..8` | `1` | start at a level |
| `autoplay=1` | off | the bot plays (always muted, sessions tagged `synthetic`) |
| `skill=0..1` | `0.7` | bot skill: how many moves it notices, how well it weighs them, thinking time, mistakes |
| `seed=N` | random | RNG seed for the bot and the game (boards, refills, shuffles) |
| `env=` | `dev` | Glitchless env |
| `token=` | `gl_pub_dev` | Glitchless client token (public, write-only); `VITE_GLITCHLESS_TOKEN` at build time |
| `intake=` / `dashboard=` | `http://localhost:7777` | Glitchless API base URL / `dashboardUrl` |
| `nogd=1` | off | no Glitchless at all |
| `mute=1` | off | no sound |

## The bot (`src/autoplay.js`)

The bot clicks through the same input path as the mouse: it dispatches real pointer events on the canvas (a click
on one gem then its neighbour, or a drag), clicks the booster buttons, and presses `Esc` then `R` or `Q` to restart
or quit. Its brain (`createBrain`) is pure, so the Node balancing sim runs the same decisions against the real rules.

- **Seeing moves:** it notices each available move with probability 0.35 + 0.65·skill. With probability
  0.12 + 0.88·skill^1.3 it weighs the moves it noticed (match size, specials and combos first, how many goal cells a
  move hits, and, scaled by skill, how low on the board it is, because low moves cascade more). Otherwise it takes
  the first match its eye lands on, scanning from a random row, often among the goal's gems.
- **Mistakes:** a swap that doesn't match (2% + 14%·(1−skill) of turns), misjudged moves, and longer thinking
  (0.04 + 0.25·(1−skill) s plus jitter). Now and then it zones out for 5.6-7 s (7%·(1−skill)² of turns),
  long enough for the 5 s idle hint; below skill 0.7 it usually takes the hint when one shows.
- **Boosters:** from 0.55 up it hammers a stone, a goal-colour gem or the gem under a crown when one or two short at
  the end, and shuffles when no move helps the goal; below 0.55 it uses them at random moments.
- **Giving up:** below 0.65 it sometimes restarts a hopeless level (pause, `R`; at most once per level). Below 0.5
  it can rage quit on its last try at level 6 (pause, `Q`). After 200 s in a run it closes the tab.

When the run ends (won, out of tries, quit, out of patience) it shows a halted card, sets `window.gemfall.halted` and
`window.__GLITCHLESS_PLAYTEST_DONE__`, and a second later calls `endSession()`.

Every seed replays the same run: the brain only draws random numbers when it decides, and a Node replay of the
same seed gives the same levels, fails and goal counts as the browser run.

18 headless Chrome sessions against a local server (2 at a time, on a busy machine). The bot's timings were trimmed
twice during the session, so the lengths below are from the final timings unless marked:

| skill | runs | how they ended | session length |
| --- | --- | --- | --- |
| 0.3-0.35 | 3 | out of tries on level 6 · out of patience on level 6 · out of tries on level 3 (one seed that missed by one stone three times) | 140-214 s (earlier timings) |
| 0.45 | 2 | rage quit on level 6 · out of tries on level 4 (older restart rule, since changed) | 115-206 s (earlier timings) |
| 0.6 | 2 | out of tries on level 6 · all eight cleared | 179-187 s (earlier timings) |
| 0.7 | 7 | out of tries on level 6 in 6 of 7 runs; one cleared all eight | **137 s and 141 s** with the final timings (146-187 s with the earlier ones) |
| 0.8 | 1 | out of tries on level 6 | 155 s (earlier timings) |
| 0.95 | 2 | out of tries on level 6 (38, 39 and 39 of 40 stones) | 95 s and 119 s |

The Node balancing sim (`createBrain` on the real rules, 30 runs per skill) agrees: level 6 stops about 29 in 30 runs
at skill 0.3-0.45, 7 to 8 in 10 at 0.6-0.7, and about a third at 0.95.

## Events

The game only calls the `gd` facade (`src/telemetry.js`). Every call is in `src/main.js`.

| Event | Attributes | When |
| --- | --- | --- |
| `levelStart('level-N')` | | a level starts (again after every fail or restart) |
| `levelComplete('level-N', …)` | `durationS`, `score` (including the move bonus) | the goal is met and the board has settled |
| `levelFail('level-N', …)` | `cause`: `out_of_moves`, `restart` (pause menu, or the bot giving up on a level), `quit` (pause menu, or the bot closing the tab) | the level ends without its goal |
| `swap` | `result`: `match` · `invalid` (no match, it swaps back, no move used) | every swap |
| `match` | `size` (3, 4, 5 = five or more), `shape` (`line` · `L` · `T`), `cascade` (0 = the player's own swap, then 1, 2… capped at 5) | every match group, as it clears |
| `special_created` | `kind`: `striped` · `bomb` · `prism` | a match of 4, an L/T or 5 makes a special |
| `special_used` | `kind`: `striped` · `bomb` · `prism` | a special fires (matched, swapped into a combo, hit by another special or the hammer) |
| `booster` | `kind`: `hammer` · `shuffle` | a booster is used |
| `reshuffle` | `reason`: `no_moves` | the board had no move left and shuffled itself |
| `hint_shown` | | the idle hint glows (when findHint() doesn't throw, see problem 3) |
| `level_result` | `stars` (0-3), `moves_left` (integer) | every level end: complete (moves left when the goal was met), out of moves (0), restart or quit (what was left) |

Every frame: `setContext({ gems, particles, popups })`: `gems` = gem meshes on the board, `particles` = shard
meshes in the scene (problem 2: it never goes down), `popups` = live score popups. A puzzle board has no avatar and
no world to walk, so there is no `setPosition`, `death` or `captureMap`.

## Levels

| Level | Goal | Moves | Board | Notes |
| --- | --- | --- | --- | --- |
| `level-1` First Facets | score 2,000 | 15 | open 8x8, 5 colours | a warm-up: most players are done in 4-7 moves |
| `level-2` Ruby Rush | collect 10 rubies | 16 | hourglass (a gap in the middle), 6 colours | the shaped board runs out of moves now and then, so it reshuffles |
| `level-3` Stonebreak | break 10 stone tiles | 16 | open, 5 colours | stones in two rows across the middle |
| `level-4` Crown Drop | bring 2 crowns down | 18 | notched top corners, 5 colours | crowns start three rows up and are collected on the bottom row |
| `level-5` Quarry | break 15 stone tiles | 22 | open, 5 colours | a ring of stones in the middle |
| `level-6` The Vault | break 40 stone tiles | 16 | open, **6 colours** | **the wall** (problem 1): every cell of five full rows across the middle has a stone |
| `level-7` Sapphire Storm | collect 16 sapphires | 18 | pillars (scattered gaps), 5 colours | reshuffles now and then |
| `level-8` Crown Jewels | bring 2 crowns down | 20 | crown-shaped, 5 colours | crowns start at the top; stones in the bottom corners |

Stars: 1 for the goal, then 2 and 3 for the score thresholds on the meter (`stars` in `src/levels.js`). The levels
are plain data in `src/levels.js`, and the board logic (`src/board.js`, `src/play.js`) is pure, so Node can play
them: the bot's brain was balanced against the real rules there before any browser ran.

## Agent tools (WebMCP, `src/agent-tools.js`)

| Tool | Input | Does |
| --- | --- | --- |
| `gemfall_get_state` | none | level, goal progress, moves left, score, stars so far, tries, the board as text rows, stones left, boosters, moves available, the hint and whether its timer is armed, renderer draw calls / geometries / programs, shard count |
| `gemfall_load_level` | `{ level: 'level-1'…'level-8' }` | start a level (a normal `levelStart`, fresh tries) |
| `gemfall_make_special` | `{ kind: 'striped'\|'striped_row'\|'striped_col'\|'bomb'\|'prism', row, col }` | put a special on the board, replacing the gem there |
| `gemfall_cascade` | none | the biggest combo available through the real swap and clear path (it builds a prism + striped pair of the commonest colour if there's nothing big on the board), then reports gems cleared, shards spawned, geometries before/after and the worst frame in the next 1.2 s (reproduces problem 2) |
| `gemfall_force_hint` | `{ via_timer?: boolean }` | run findHint() now and report the hint or the error it throws; with `via_timer: true`, run the real idle-hint path so the error is unhandled and reaches Glitchless (reproduces problem 3) |

The same handlers are on `window.gemfall.api`; `window.gemfall.info` has draw calls, geometries, programs and shards.

## The planted problems

Search for `GLITCHLESS-DEMO`.

| # | Problem | Where | What happens | What Glitchless shows (16 bot sessions on a local server) |
| --- | --- | --- | --- | --- |
| 1 | **Level 6 is a wall** (a difficulty spike with no deaths) | `src/levels.js:74-86` | Level 5 asks for 15 stones in 22 moves with five colours. Level 6 asks for 40 stones (five full rows) in 16 moves with six colours, so far fewer cascades. It reads as "the next quarry level" and plays as a brick wall: even the 0.95 bot ran out of moves at 38-39 of 40. | The level funnel: `level-6` completion **16.7%** (2 of 12 sessions) with **31 fails in 33 attempts**, against 92-100% on every other level. **10 of the 12 rage quits** (a session ending right after a `levelFail`) are on level 6. `level_result` has `stars: 0` with `moves_left: 0` as its most common value (42 of 121). There are no deaths, so its ranked design finding comes from the completion rate: *level-6 is a wall*. |
| 2 | **Cascade particles never cleaned up** (stutter plus a leak) | `src/fx.js:129-159` (`burst()`: new geometry at 140, new material at 143, added at 150, the glint at 153); `src/fx.js:228` (shards only hidden) and `src/fx.js:237` (glints only faded); the `particles` gauge at `src/main.js:721` | Every cleared gem spawns 12 shard meshes, each with its own geometry and material, plus a glint. A combo that clears 40-60 gems in one step makes 500-900 meshes in one frame (`gemfall_cascade`: 58 gems → 876 shards, geometries 25 → 902). Nothing is ever removed or disposed: shards are hidden when they fade, glints are faded to opacity 0 and keep drawing. | A **high "Geometry leak in 1.0.0: +1178 geometries per level load"** finding (median 26 → 9,807 geometries per session). Draw calls climb level by level, from 128 on level-1 to 862 on level-8 (max 1,351). The `particles` gauge reaches ~10,000. Hitches attributed to `geometry_upload` (4 so far). The size of the cascade hitch is **unmeasured: machine busy** (the bots ran while other apps were compiling, so frame times are not representative). |
| 3 | **The hint throws at the right edge** (a silent error) | `src/board.js:220-226` (`findHint`, throws at 226), called from the idle-hint timer at `src/main.js:199-202` | `findHint()` reads the right-hand neighbour without a `c + 1 < COLS` check. When no move is found before the scan reaches the end of row 0 (no move touches the top row), `grid[0][8]` is undefined: `TypeError: Cannot read properties of undefined (reading 'kind')` from a timer callback. The hint never shows, the player gets no help, and the game keeps going. Shaped boards make it more likely. | A **high stability finding**: `TypeError: Cannot read properties of undefined (reading 'kind')` at `findHint (board.js:226)`, 15 times in **9 of 16 sessions (56%)**, on levels 2-7, with `swap → match → swap` breadcrumbs. Only 16 `hint_shown` events came out of all the idle pauses. |

Also expected in the data (game design, not bugs): level 4 (crowns) is where low-skill bots restart, and shaped
boards (levels 2, 4, 7, 8) are where `reshuffle` happens (10 in 9 sessions).

## Files

```
index.html            HUD (level, goal, moves, tries, score + star meter, boosters) and screens
src/main.js           renderer, game state machine, the phase player, input handling, telemetry calls, agent API
src/levels.js         the eight levels (plain data; problem 1)
src/board.js          the grid: matches, specials, clearing, gravity, moves, the hint (problem 3), shuffles (pure)
src/play.js           one level being played: moves, combos, cascades, goals, stars, boosters (pure)
src/timing.js         how long each step of a move takes on screen (shared with the balancing sim)
src/view.js           the tilted board, tiles, stones, gem animation
src/gems.js           the six cuts, specials, prism and crown (shared geometry and materials, pooled)
src/fx.js             shard bursts (problem 2), beams, shockwaves, dust, selection / hint / cursor markers
src/hud.js, input.js, audio.js, rng.js, params.js, version.js
src/telemetry.js      Glitchless facade + init; src/glitchless-sdk.js holds the SDK imports
src/agent-tools.js    WebMCP tools
src/autoplay.js       the bot (a pure brain the balancing sim also runs, and a driver that clicks)
```

## Dashboard

Designed with the `dashboard` skill and saved with `glitchless_set_dashboard`; the spec is
[`glitchless.dashboard.json`](glitchless.dashboard.json) (send it to the tool to recreate it). A puzzle has no avatar,
no deaths and no world to map, so there are no heatmaps or deaths panels: a wall shows as completion, fails and stars.

| Page | What it answers |
| --- | --- |
| **Overview** | players, three-star finishes, runs given up, error-free sessions; the findings; *Levels: tries, clears and fails*; stars per level played; moves left at the end |
| **Matches and specials** | matches, the share of specials made that get used, swaps that don't match, boards with no moves left; match sizes; how deep cascades go; specials made; match shapes |
| **Help and boosters** | hints shown, boosters used, average session, errors; which booster; where boosters are used; what breaks |
| **Frame time**, **Errors**, **Sessions**, **Events** | built-in views |

What Glitchless found in 20 bot sessions (`npm run bots -- --game http://localhost:5180/`, on a quiet M3 Max):

- **high, memory:** *Geometry leak in 1.0.0: +1240 geometries per level load*: from 26 to about 9,900 per session, "never
  comes back down". The cascade shards; the finding also names the `particles` gauge, which keeps climbing with it (0 to
  about 9,850 a session). Draw calls climb with it, 136 on level 1 to 951 on level 8; on an M3 Max frame time still
  holds at 16.8 ms, so here the leak shows as memory and draw calls, not stutter.
- **high, design:** *level-6 is a wall: 36.8% of the sessions that reach it get through*: 7 of the 19 runs that reach it,
  after 42 failed tries, with every other level at 86–100%; 12 of the 20 runs end there. A puzzle has no deaths, so this
  finding comes from completion rather than from where players die.
- **high, stability:** *TypeError: Cannot read properties of undefined (reading 'kind')* at `findHint (board.js:226)`,
  14 times in 7 of 20 sessions (35%), on six different levels: the idle hint looking past the board's right edge. The
  game carries on after it, so no session counts as crashed.

![The Gemfall dashboard](../../assets/screenshots/gemfall-dashboard.png)
