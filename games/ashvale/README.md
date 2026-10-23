# Ashvale

A small top-down action RPG in vanilla Three.js, and one of the Glitchless genre demos: a tiny Diablo-like. A
hooded ranger-warrior goes down three floors of a burned-out keep, swinging at skeletons, slimes and archers,
picking up gear in four rarities, levelling up, and fighting the Ash Lord at the bottom. A good run takes about
two minutes. The game has **three deliberate, realistic problems** for Glitchless to find (listed below).
**Don't fix them**: the demo depends on them.

## Run it

From the root of this repo:

```bash
npm install
npm run dev -w ashvale        # http://localhost:5182
npm run build -w ashvale      # → games/ashvale/dist (relative base './', deployable anywhere)
```

Telemetry goes to a Glitchless server at `http://localhost:7777` by default: run one from the
[Glitchless repo](https://github.com/glitchless-gg/glitchless) with `npm run server`. To send it to Glitchless Cloud
instead, add `?intake=https://api.glitchless.gg&token=gl_pub_…` with your project's client token. Without a server the
game still runs.

## Controls

| Key | Action |
| --- | --- |
| click the canvas / `Space` | start |
| `W` `A` `S` `D` / arrows | move |
| mouse | aim (the hero swings toward the cursor) |
| left click (hold) / `F` | swing: a 125° arc in front of you that hits everything in it |
| `Space` / `Shift` | roll: a short dash you can't be hit during, 0.85 s cooldown |
| `Q` | fire nova: 24 mana, burns everything around you for 2 s |
| `E` | drink a potion (55% of your health) |
| `Esc` / `P` | pause (then click to resume, `Q` to quit to the title) |
| `M` | mute |
| `` ` `` | Glitchless overlay (bottom-right) |

Walking over loot picks it up. Gear is compared with what you wear: better gear is equipped (with a compare
toast), worse gear is salvaged for gold. Each floor gives you three lives; dying sends you back to the floor's
start with every enemy alive again, and the third death on a floor ends the run. Kills give XP; each level adds
health, mana and damage and refills both.

## Query params

| Param | Default | Meaning |
| --- | --- | --- |
| `level=1..3` | `1` | start on a floor |
| `autoplay=1` | off | the bot plays (always muted, sessions tagged `synthetic`) |
| `skill=0..1` | `0.7` | bot skill: reaction time, how many threats it notices, aim wobble, target choice, potion timing |
| `seed=N` | random | RNG seed for the bot and the game (drops, crits, AI) |
| `env=` | `dev` | Glitchless env |
| `token=` | `gl_pub_dev` | Glitchless client token (public, write-only); `VITE_GLITCHLESS_TOKEN` at build time |
| `intake=` / `dashboard=` | `http://localhost:7777` | Glitchless API base URL / `dashboardUrl` |
| `nogd=1` | off | no Glitchless at all |
| `mute=1` | off | no sound |

## The bot (`src/autoplay.js`)

The bot plays through the same input a person does: the movement keys (8 directions), an aim point on the floor
(where the mouse would be) and the buttons (swing held, roll, nova, potion), every fixed step. It walks toward the
nearest enemy (or the nearest loot it hasn't tried, or the open stairs) along the tile grid, keeps its aim on its
target with a wandering wobble, and swings when the target is in reach. It rolls away from arrows, bolts and
telegraphed attacks (the red arcs, lines and circles on the floor) that it notices in time, novas groups of two or
three and the Ash Lord, and drinks under 35% health. Skill sets its reaction time (0.1 s at 1, 0.6 s at 0.3), the
share of threats it reacts to at all (96% / 37%), how much its aim wobbles, how keen it is on archers, and how late
it drinks. Low skill doesn't roll out of the gallery's arrows and dies there; high skill goes for the archers first
and clears all three floors. Below skill 0.5, on its last life on a floor, hurt and out of potions, it may
**rage quit** (`levelFail` with cause `quit`). It gives up after 200 s of play. Each of these ends with a halted
card, `window.ashvale.halted`, `window.__GLITCHLESS_PLAYTEST_DONE__` and, a second later, `endSession()`.

The sim (`src/sim.js`) and the bot are pure, so Node can run them headless at full speed (that is how the
difficulty was tuned), and a seed replays the same run in the browser.

The same 20 bots `npm run bots -- --game http://localhost:5182/` starts (seeds 5000-5019, skills 0.3-0.95), played
headless by the Node sim (which replayed six real browser sessions move for move):

| skill | outcome | deaths | run length (play + screens) |
| --- | --- | --- | --- |
| 0.30-0.45 (4) | 3 rage quits (2 on floor 2, 1 at the Ash Lord), 1 out of lives in the gallery | 1.75 per run on floor 2, 0.5 on floor 3 | 85-172 s |
| 0.46-0.57 (5) | 4 cleared, 1 out of lives in the gallery | 1.0 per run on floor 2 | 105-142 s |
| 0.65-0.95 (11) | all cleared | 0 | 116-136 s (0.7: ~125 s) |

Over the batch: floor-1 100% completion, floor-2 52% (12 deaths, 11 to archers, all in the gallery), floor-3 83%
(2 deaths to the Ash Lord). Six real Chrome sessions (skills 0.30-0.70) took 87-174 s each, the skill-0.7 win 123 s.
Frame times from these runs are not in this README: the machine was busy (unmeasured).

## Events

The game only calls the `gd` facade (`src/telemetry.js`). Every call is in `src/main.js`, in the sim's hooks.

| Event | Attributes | When |
| --- | --- | --- |
| `levelStart('floor-N')` | | a floor starts (again after every death) |
| `levelComplete('floor-N', …)` | `durationS`, `score` (kills this attempt) | the hero steps onto the open stairs |
| `levelFail('floor-N', …)` | `cause`: `skeleton` `slime` `archer` `ash_lord` (what killed you), `quit` | death, quitting from the pause menu, the bot's rage quit or time-out |
| `death` | `x`, `y`, `z` (the floor plane is xz; `y` is 0.8 on a ledge), `cause` | health reaches 0 |
| `kill` | `enemy`: `skeleton` `slime` `archer` `ash_lord` | an enemy dies (split slimes count as `slime`) |
| `loot` | `rarity`: `common` `magic` `rare` `legendary` (gear) or `none`; `slot`: `weapon` `armor` `ring` `gold` `potion` | gold or a potion is picked up, or the hero steps onto gear (before it is compared) |
| `equip` | `slot`, `rarity` | gear better than what's worn is equipped |
| `level_up` | `level` (2, 3, …) | the hero levels up |
| `skill` | `name`: `dodge` `nova` | a roll or a nova (swings are counted per room instead, below) |
| `room_clear` | `room` (one of the 8 rooms with enemies), `swings` (swings while the room was awake) | the last enemy of a room dies |
| `potion` | | a potion is drunk |
| `boss` | `result`: `start` `win` `died` | the hero walks into the throne room; the Ash Lord falls; the hero dies in the fight |

Every frame: `setPosition(hero)` and `setContext({ enemies, projectiles, damage_numbers, loot_on_floor })`
(`damage_numbers` = every DOM node the damage numbers have created this session, `projectiles` = arrows and bolts in
flight). `captureMap('floor-N', { axis: 'xz', bounds: [0, 0] → [cols × 2, rows × 2], exclude: [hero, enemies, loot,
projectiles, effects] })` runs at each floor's first load in a session.

Swings are too frequent for an event each, so they are counted per room: `room_clear.swings` is the number of
swings made while that room was awake, which gives swings per room and kills per swing without an event per click.

## Levels

| Floor | Rooms (in order) | Enemies | Notes |
| --- | --- | --- | --- |
| `floor-1` The Ash Cellars | `ash_steps` (start) → `bone_pit` → `slime_cistern` → `ember_vault` (stairs) | 6 skeletons, 4 slimes, 2 archers | ~35 s for a good player |
| `floor-2` Archers' Gallery | `gallery_steps` (start) → `guard_room` → `long_gallery` → `quiver_hall` (stairs) | 5 skeletons, 3 slimes, 7 archers, six of them on the gallery ledges | ~40 s; where people die |
| `floor-3` The Ash Lord's Hall | `throne_steps` (start) → `ash_antechamber` → `ash_throne` (the boss, then the way out) | 2 skeletons, 1 slime, 2 archers, the Ash Lord (+ 2 skeletons and a slime at 66% and 33%) | ~45 s |

The floors are plain data in `src/floors.js` (tile rects, enemy spots, pillars, ledges; one tile is 2 m), and
the rules are numbers in `src/rules.js`. Enemies get 45% more health and 30% more damage per floor. Slimes split
once into two small slimes. The Ash Lord cleaves (an arc), slams (a circle where you stood), throws a fan of seven
ash bolts, calls in his guard twice and enrages under 30%; he always drops a legendary.

## Agent tools (WebMCP, `src/agent-tools.js`)

| Tool | Input | Does |
| --- | --- | --- |
| `ashvale_get_state` | none | floor, room, rooms cleared (with swings), stairs, lives, hero (position, health, mana, level, XP, potions, gold, damage, armor), gear, enemies by type, the Ash Lord, projectiles, loot on the floor, damage-number nodes (created / still visible / in the DOM), renderer counts, UI state |
| `ashvale_load_floor` | `{ floor: 'floor-1'\|'floor-2'\|'floor-3' }` | start a floor (a normal `levelStart`) |
| `ashvale_spawn_hits` | `{ count: 1..5000 }` | show that many damage numbers over the enemies through the real `showHit()` → `spawnNumber()` path (reproduces problem 1; returns the node count before and after) |
| `ashvale_drop_loot` | `{ rarity, slot }` | drop an item at the hero's feet and let the hero step onto it through the normal pickup path; returns whether it was picked up or equipped and whether that raised an error (a legendary reproduces problem 2) |
| `ashvale_set_paused` | `{ paused }` | pause or resume |

The same handlers are on `window.ashvale.api`; `window.ashvale.numbers()` and `window.ashvale.info` have the
damage-number and renderer counts.

## The planted problems

Search for `GLITCHLESS-DEMO`.

| # | Problem | Where | What happens | What Glitchless should show |
| --- | --- | --- | --- | --- |
| 1 | **Damage numbers that are never removed** (a DOM leak the GPU never sees) | `src/numbers.js:8-10` (the `numbers` list nothing is taken out of), `:27-31` (`animationend` only sets `opacity: 0`), `:36-46` (`updateNumbers`: every number ever made, every frame, `offsetWidth` read at :43 after the previous number's `style.transform` write at :45); called from `src/main.js:623`, numbers made by `showHit()` at `src/main.js:233` | Every hit, burn tick, XP gain, gold pickup and heal adds a `<div>` with a `<span>` per character (a run makes 400-550 numbers, 1,000-2,000 nodes). When the float-up animation ends the number is only hidden. Each frame the game still projects every one of them with `vector.project(camera)`, reads its `offsetWidth` and writes its `style.transform`, so style recalculation and layout run once per dead number. The cost grows all session and peaks in the boss fight, where novas and burn ticks pile on numbers. Draw calls, geometries and programs stay flat: the three.js counters see nothing | Frame time and hitches climbing floor by floor (worst on floor-3), the `damage_numbers` gauge climbing all session and high in the slow windows, hitch cause `script` (Long Animation Frames), flat draw calls. `ashvale_spawn_hits` reproduces it on demand. (unmeasured: machine busy; on the test run the gauge went 0 → 1,962 and floor-3 p95 read 33 ms vs 16.8 on floors 1-2) |
| 2 | **The legendary crash** (an error in one item type) | `src/gear.js:11-18` (`RARITY_STATS` has `common`, `magic`, `rare`, no `legendary`), throws at `src/gear.js:59` in `compare()`, called from `src/sim.js:942` (`pickUp`) right after the `loot` event at `src/sim.js:939` | Walking onto a legendary sends `loot {rarity: legendary}`, then `compare()` throws `TypeError: Cannot read properties of undefined (reading 'mult')`. The item stays on the floor (its orange beam keeps shining) and is never equipped; the rest of that frame is skipped and the loop carries on. Stepping onto it again throws again. Legendaries are 3.5% of gear drops (about 1 run in 5 finds one), and the Ash Lord always drops one | An unhandled error issue at `compare (gear.js:59)` in every session that beats the Ash Lord and a few others, on `floor-3` (and wherever a random legendary dropped), with `loot` as the breadcrumb right before it; `loot` with `rarity: legendary` but no `equip` with it. The scratch server showed 8 occurrences in 3 of 7 sessions, on floor-1 and floor-3, "typically right after: skill → skill → kill → loot" |
| 3 | **The Archers' Gallery** (difficulty spike on one floor) | `src/floors.js:90-106` (six ledge archers and the gallery's `archer` overrides at :106: 40 base health vs 30, arrows at 28 m/s vs 11, a 0.32 s draw vs 0.7, a 0.9 s reload vs 2.2, range 22 m, 17 damage), the ledges at `:124-127`, the one (broken) pillar at `:130` | Six archers on the raised ledges along both long walls fire into a 12 m-wide hall with one broken pillar for cover, faster than anywhere else in the game. Arrows from the far side arrive in about half a second, so only quick players roll out of them. Dying sends you back to the floor's start, through the guard room again | `floor-2` with the worst completion (scratch server: floor-1 100%, floor-2 50%, floor-3 60%; the simulated batch 100 / 52 / 83%), deaths clustered in the gallery on the floor-2 heatmap, `archer` as the top cause, rage quits ending there, and a design finding "Difficulty spike on floor-2 at x≈58.5: 40% of the level's deaths" |

## Files

```
index.html          HUD (orbs, skill bar, XP, gear, boss bar, toasts), damage-number layer, screens
src/main.js         renderer, state machine, fixed-step loop, the sim's hooks (telemetry, effects, sound), views, camera, agent API
src/sim.js          the rules: hero, enemies and their AI, projectiles, loot, XP, rooms, stairs (pure)
src/floors.js       the three floors as tile data (pure)
src/grid.js         tile grid: carving, circle collision, line of sight, distance fields (pure)
src/rules.js        hero, enemy, XP and drop numbers (pure)
src/gear.js         item names, stats and compare() (problem 2) (pure)
src/numbers.js      floating damage numbers in the DOM (problem 1)
src/world.js        floor meshes: slabs, walls, ledges, pillars, stairs, torches and the light pool, decor
src/models.js       the hero, skeletons, archers, slimes, the Ash Lord, loot and projectiles
src/fx.js           pooled particles, slashes, rings, telegraphs, drifting ash
src/hud.js, input.js, audio.js, rng.js, params.js, version.js
src/telemetry.js    Glitchless facade + init; src/glitchless-sdk.js holds the SDK imports
src/agent-tools.js  WebMCP tools
src/autoplay.js     the bot (pure)
```

## Dashboard

Designed with the `dashboard` skill and saved with `glitchless_set_dashboard`; the spec is
[`glitchless.dashboard.json`](glitchless.dashboard.json) (send it to the tool to recreate it).

| Page | What it answers |
| --- | --- |
| **Overview** | players, Ash Lord attempts won, frame time p95, error-free sessions; the findings; *Floors: tries, clears and deaths*; what kills the hero, per floor; what breaks |
| **Loot** | drops, legendaries dropped, legendaries equipped (these two should match), gear equipped; drops and equips by rarity and by slot |
| **Combat** | kills, potions, level-ups, Ash Lord attempts; what players kill; skills used; rooms cleared (with the average swings per room); Ash Lord attempts by result |
| **Floor heatmaps** | the built-in heatmaps, a top-down map of each floor captured in-game |
| **Frame time**, **Errors**, **Sessions** | built-in views |

What Glitchless found in 20 bot sessions (`npm run bots -- --game http://localhost:5182/`, on a quiet M3 Max):

- **high, stability:** *TypeError: Cannot read properties of undefined (reading 'mult')* at `compare (gear.js:59)`, 38
  times in 15 of 20 sessions, "typically right after: kill → skill → kill → loot". On the Loot page, 38 legendaries
  dropped and 0 were equipped.
- **medium, design:** *Difficulty spike on floor-2 at x≈59.1: 50% of the level's deaths*, mostly `archer`: the
  Archers' Gallery, with floor 2's completion 20 points below floor 1 and 4 runs given up there.
- **The damage-number leak shows in its gauge, not in the findings:** `damage_numbers` climbs to 1,400–1,960 nodes by
  the Ash Lord, and floor 3 runs 2.6% of frames over budget (one session 12%), with hitches named `script`. On an M3 Max
  that is too little for a frame-time finding; a slower machine would show it.

![The Ashvale dashboard](../../assets/screenshots/ashvale-dashboard.png)
