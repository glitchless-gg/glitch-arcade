# Blastpit!

A small first-person arena shooter in vanilla Three.js, and one of the Glitchless genre demos. You hold a
neon-lit 40 x 40 m pit for three rounds against grunts, gunners and a swarm, with a pistol, a shotgun and a
rocket launcher. It has **two deliberate, realistic bugs** for Glitchless to find (listed below). **Don't fix
them**: the demo depends on them.

## Run it

From the root of this repo:

```bash
npm install
npm run dev -w blastpit        # http://localhost:5176
npm run build -w blastpit      # → games/blastpit/dist (relative base './', deployable anywhere)
```

Telemetry goes to a Glitchless server at `http://localhost:7777` by default: run one from the
[Glitchless repo](https://github.com/glitchless-gg/glitchless) with `npm run server`. To send it to Glitchless Cloud
instead, add `?intake=https://api.glitchless.gg&token=gl_pub_…` with your project's client token. Without a server the
game still runs.

## Controls

| Key | Action |
| --- | --- |
| click the canvas | start / capture the mouse (pointer lock) |
| mouse | look (`←` `→` also turn) |
| left click (hold) / `F` | fire |
| `W` `A` `S` `D` | move |
| `1` `2` `3` / mouse wheel | pistol / shotgun / launcher |
| `Space` | jump |
| `Esc` / `P` | pause (then click to resume, `R` restart the round, `Q` quit) |
| `R` | restart the round (reported as `levelFail{cause:'restart'}`) |
| `M` | mute |
| `` ` `` | Glitchless overlay (bottom-right) |

## Query params

| Param | Default | Meaning |
| --- | --- | --- |
| `level=1..3` | `1` | start at a round |
| `autoplay=1` | off | the bot plays (always muted, sessions tagged `synthetic`) |
| `skill=0..1` | `0.7` | bot skill: reaction time, turn rate, aim noise, field of view, weapon sense |
| `seed=N` | random | RNG seed for the bot and the game (spread, spawn offsets, AI) |
| `env=` | `dev` | Glitchless env |
| `token=` | `gl_pub_dev` | Glitchless client token (public, write-only); `VITE_GLITCHLESS_TOKEN` at build time |
| `intake=` / `dashboard=` | `http://localhost:7777` | Glitchless API base URL / `dashboardUrl` |
| `nogd=1` | off | no Glitchless at all |
| `mute=1` | off | no sound |

## Events

| Event | Attributes | When |
| --- | --- | --- |
| `levelStart('round-N')` | | a round starts (again after every death or restart) |
| `levelComplete('round-N', …)` | `durationS`, `score` (kills this attempt) | the last enemy of the round dies |
| `levelFail('round-N', …)` | `cause`: `grunt` `gunner` `swarmer` `own_rocket` (what killed you), `restart`, `quit` | death, `R`, or quitting mid-round |
| `death` | `x`, `y`, `z`, `cause` (`grunt` `gunner` `swarmer` `own_rocket`) | health reaches 0 |
| `shot` | `weapon`: `pistol` `shotgun` `launcher` | every trigger pull (a shotgun blast is one shot) |
| `hit` | `weapon`, `enemy` (first enemy type hit) | a trigger pull that hit at least one enemy (rockets: when it explodes) |
| `kill` | `weapon`, `enemy` | an enemy dies |
| `weapon_switch` | `to`: `pistol` `shotgun` `launcher` | a weapon change (not the reset to the pistol at a round start) |
| `pickup` | `kind`: `health` `shells` `rockets` | a pickup is taken |

Every frame: `setPosition(player feet)` and `setContext({ enemies, projectiles, lights })` (`projectiles` =
rockets + gunner orbs in flight, `lights` = visible THREE lights in the scene). `hit / shot` per weapon is that
weapon's accuracy. `captureMap('round-N', { axis: 'xz', bounds: [-21,-21]→[21,21], exclude: [sky, viewmodel] })`
runs at each round's first load in a session (same arena, one map per round so each heatmap has a background).

## Levels

| Round | Enemies | Notes |
| --- | --- | --- |
| `round-1` Warmup | 4 grunts from the north gates, then 4 from the south | ~15 s for a good player |
| `round-2` Crossfire | 2 gunners on the flanks + 4 grunts, then 2 more gunners + 5 grunts | ~20 s |
| `round-3` Swarm | 3 gunners + 2 grunts, then at 10 s a burst of **30 swarmers** from all 8 gates at once | ~20 s; where people die |

Health 100. Pickups on fixed pads respawn: health +25 (2 pads), shells +8 (2), rockets +3 (centre). Ammo resets
to 24 shells / 8 rockets at every round start. 3 tries per round; dying restarts the round; the run ends after
round 3 or on the third death in a round (game over). Grunts (60 HP) chase and punch for 10 every 0.8 s, gunners
(80 HP) keep 10-14 m away and lob orbs for 12, swarmers (20 HP) are fast and bite for 6. Rocket splash: 100 at
the centre falling to 0 at 3.5 m, and it hurts you too.

## Agent tools (WebMCP, `src/agent-tools.js`)

| Tool | Input | Does |
| --- | --- | --- |
| `blastpit_get_state` | none | round, round time, tries, player pos/yaw/hp, weapon + ammo, enemies by type, projectiles, `lights`, kills, damage taken by cause, draw calls + shader programs, UI state |
| `blastpit_load_level` | `{ level: 'round-1'\|'round-2'\|'round-3' }` | start a round (a normal `levelStart`) |
| `blastpit_spawn_swarm` | `{ count: 1..60 }` | spawn swarmers at the gates through the real `spawnSwarmer()` (reproduces bug 2; returns lights before/after) |
| `blastpit_teleport` | `{ x, z }` | put the player on the floor at (x, z), pushed out of cover |
| `blastpit_set_paused` | `{ paused }` | pause or resume |

The same handlers are on `window.blastpit.api`; `window.blastpit.info` has draw calls, programs and lights.

## The planted problems

Search for `GLITCHLESS-DEMO`.

| # | Problem | Where | What happens | What Glitchless should show |
| --- | --- | --- | --- | --- |
| 1 | **Shotgun stale index** (an error in one weapon) | `src/weapons.js:112-152` (`fireShotgun`; throws at line 141), the splice in `src/main.js:266-268` (`killEnemy`) | The blast first stores each pellet's target as an index into `game.enemies`, then applies damage pellet by pellet. A pellet that kills calls `killEnemy`, which splices the array, so later pellets aimed at that slot or after it point one enemy on (silently hurting the wrong enemy) or past the end: `TypeError: Cannot read properties of undefined (reading 'hp')`. It happens on most close-range kills where spare pellets were aimed at the last enemy in the array. The throw skips the rest of the blast, including its `hit` event and any later kill; the first `kill` is already tracked. The loop calls `requestAnimationFrame` first, so the game keeps going. | The top error issue (`fireShotgun`, weapons.js:141) in nearly every session and on every round, with `shot → kill` breadcrumbs; the shotgun's `hit/shot` (≈55%) reads below the pistol's (≈62%) although it is fired at point blank and gets the most kills |
| 2 | **Swarm spawn stutter** (lights per enemy) | `src/enemies.js:110-146` (`spawnSwarmer`: material clone at 116, three `PointLight`s at 132-142); corpses are cleared in batches in `src/main.js:500-510` | Every swarmer brings two eye lights and an underglow light, and its own material. 30 at once take the scene from 8 lights to 98. three.js recompiles every material's shader for the new light count (the frame of the spawn), and again every time a batch of dead swarmers is cleared away. Meanwhile every lit pixel loops over 95 point lights, so round 3 runs at 20-30 fps on an M3 Max at 1280x720 until the swarm thins out. Uncached shader compiles at 60-98 lights take 0.5-2.5 s (a frozen frame); once Chrome/Metal have them cached, 50-170 ms. | A critical/high "frame-time spikes on round-3" finding: p95 ~49-65 ms vs 16.8 on rounds 1-2, ~16-22% of round-3 frames over budget, hitches with cause `shader_compile`, and `lights` as the correlated gauge (median 80-86 during hitches vs 8 otherwise) |

Also expected in the data (game design, not bugs): round 3 is where low-skill players die (70-75% completion
for the bots, almost all deaths `swarmer`; Glitchless calls it a wall), and `own_rocket` deaths from rockets fired at
close range.

## The bot (`src/autoplay.js`)

The bot produces the same input the keyboard and mouse do (`{ move, strafe, yawDelta, pitchDelta, fire, weapon }`)
every fixed step. It targets the nearest enemy it can see (in its field of view, or close enough to hear), turns
with a skill-scaled rate and a wandering aim error, and fires once the crosshair is within a tolerance. Shotgun
under ~6 m, launcher into clusters of 3+ at 6-15 m, pistol otherwise. It strafes, backs off from melee, goes for
health when low and for ammo when short. Low skill reacts later, aims and tracks worse, stands still while
shooting, sees less around it, and reaches for the launcher at close range (own-rocket deaths). Below 0.6 it sometimes
restarts a bad round (`R`), below 0.5 it sometimes rage quits on its last try. Deterministic per seed.

20 headless sessions (Chrome, M3 Max, 4 in parallel):

| skill | finished | deaths per run | session length |
| --- | --- | --- | --- |
| 0.3-0.55 | 3 of 9 (the rest: game over on Swarm) | 2-4 | 108-143 s |
| 0.6-0.95 | 11 of 11 | 0-1 | 61-96 s (0.7: ~70 s) |

Run bots for this game one at a time (`npm run bots -- --game http://localhost:5176/ --parallel 1`): a
round-3 shader compile in one tab stalls the GPU for the others, which adds hitches to their rounds 1-2.

## Files

```
index.html            HUD + screens (bottom-right left free for the Glitchless overlay)
src/main.js           renderer, game state machine, fixed-step loop, rounds, waves, pickups, agent API
src/arena.js          the pit: floor, walls, cover, gates, pads, skyline, lights
src/player.js         first-person movement and collision (pure)
src/collide.js        boxes, rays, line of sight (pure)
src/enemies.js        grunt, gunner, swarmer (bug 2), steering, orbs
src/weapons.js        pistol, shotgun (bug 1), launcher, rockets, splash
src/viewmodel.js      first-person guns drawn in their own pass
src/fx.js             tracers, sparks, explosions, flash light (pooled)
src/pickups.js        health / shells / rockets
src/rounds.js         round data (plain data)
src/hud.js, input.js, audio.js, rng.js, params.js, version.js
src/telemetry.js      Glitchless facade + init; src/glitchless-sdk.js holds the SDK imports
src/agent-tools.js    WebMCP tools
src/autoplay.js       the bot
```

## Dashboard

Designed with the `dashboard` skill and saved with `glitchless_set_dashboard`; the spec is
[`glitchless.dashboard.json`](glitchless.dashboard.json) (send it to the tool to recreate it).

| Page | What it answers |
| --- | --- |
| **Overview** | players, kills, frame time p95 in a fight, error-free sessions; the findings; *Rounds: attempts, clears and deaths*; which weapon does the killing; what kills players, per round; does it hold 60 fps; what breaks |
| **Weapons** | accuracy per weapon (`hit:weapon=X` per `shot:weapon=X`), shots fired; what players fire; kills by weapon; shots over time by weapon; what they switch to; pickups taken; weapon errors |
| **Rounds** | deaths, rage quits, hitches per minute, average session; which round is too hard; deaths by cause; kills per round; enemies killed; frame time across rounds |
| **Kill feed** | the built-in live view, showing only `kill`, `death`, `level_complete` and `level_fail` as they arrive |
| **Frame time**, **Arena heatmap**, **Errors**, **Sessions** | built-in views |

What Glitchless found in 12 bot sessions (`npm run bots -- --game http://localhost:5176/ --parallel 1`; sessions run on
a busy or battery-throttled machine were left out, since they turn every round's frame time into noise):

- **high, stability:** *TypeError: Cannot read properties of undefined (reading 'hp')*, 100 times in 12 of 12 sessions,
  on all three rounds, "start at `fireShotgun (weapons.js:141)`", breadcrumbs `hit → weapon_switch → shot → kill`. On
  the Weapons page the shotgun's accuracy reads 56.6% against the pistol's 59.9%, although it's the close-range
  weapon: blasts that throw never send their `hit`. The round plays on through it, so every session still counts as
  crash-free.
- **high, performance:** *Frame-time spikes on round-3: p95 49.42ms vs 16.7ms budget*: 16% of round 3's frames over
  budget and 22 hitches a minute, rounds 1 and 2 at 16.78 ms. "Hitches coincide with high `lights` (median 89 during
  hitches vs 8 otherwise)", and the advice is to keep the number of lights constant (a light pool, or emissive glow
  instead of a light per enemy). The hitches' causes: `shader_compile` 81, `render` 74, `script` 77.
- **high, design:** *round-3 is a wall: 63.6% of the sessions that reach it get through*: 7 of 11, after 100% on round 1
  and 92% on round 2. Its 13 deaths (11 to swarmers) are spread across the arena rather than at one spot, and 4 of the 5
  rage quits are on round 3.
- **medium, performance:** *Hitches on round-1: 2.81 a minute, most with no recorded cause*: round 1's p95 holds at
  16.78 ms, but 10 frames stalled in 12 sessions, stutters a percentile hides. Only three of them carry a cause, one
  each `gc`, `render` and `script`, too few to name one.

![The Blastpit dashboard](../../assets/screenshots/blastpit-dashboard.png)
