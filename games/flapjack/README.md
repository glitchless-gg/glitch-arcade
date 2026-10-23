# Flapjack

A small one-button flappy game in vanilla Three.js, and one of the Glitchless genre demos. Flapjack, a round,
buttery bird, flaps through the gaps between pipes on an endless side-scrolling course with parallax hills,
clouds and a ground strip. Every 10 pipes the sky changes (Meadow → Canyon → Night City) and you earn a medal
(bronze 10, silver 20, gold 30, platinum 40). A run lasts 10 to 60 seconds; a session is a handful of runs.
The course is the same every run (the pipe heights come from a fixed seed), so x is distance along the course and
a heatmap of where birds die means something. It has **two deliberate, realistic problems** for Glitchless to find
(listed below). **Don't fix them**: the demo depends on them.

## Run it

From the root of this repo:

```bash
npm install
npm run dev -w flapjack        # http://localhost:5181
npm run build -w flapjack      # → games/flapjack/dist (relative base './', deployable anywhere)
```

Telemetry goes to a Glitchless server at `http://localhost:7777` by default: run one from the
[Glitchless repo](https://github.com/glitchless-gg/glitchless) with `npm run server`. To send it to Glitchless Cloud
instead, add `?intake=https://api.glitchless.gg&token=gl_pub_…` with your project's client token. Without a server the
game still runs.

## Controls

| Input | Action |
| --- | --- |
| `Space` / `W` / `↑`, a click or a tap | flap (and start a run from the title or the game-over card) |
| `Esc` / `P` | pause; again (or a click) to resume |
| `M` | mute |
| `` ` `` | toggle the Glitchless overlay (bottom right) |

A flap sets the bird's vertical speed (a ~1.3 unit hop); gravity does the rest, and the bird tilts with its
speed. Touching a pipe or the ground, or flying off the top of the sky, ends the run. The game-over card shows the
score, this session's best, the medal and "fly again" (it takes input after half a second, so mashing doesn't skip
it).

## Query params

| Param | Default | Meaning |
| --- | --- | --- |
| `autoplay=1` | off | the bot plays (always muted, sessions tagged `synthetic`) |
| `skill=0..1` | `0.7` | bot skill: reaction time, timing noise, how well it judges a gap, how far ahead it looks, slips |
| `seed=N` | random | bot RNG seed (the course itself is always the same) |
| `env=` | `dev` | Glitchless env |
| `token=` | `gl_pub_dev` | Glitchless client token (public, write-only); `VITE_GLITCHLESS_TOKEN` at build time |
| `intake=` / `dashboard=` | `http://localhost:7777` | Glitchless API base URL / `dashboardUrl` |
| `nogd=1` | off | no Glitchless at all |
| `mute=1` | off (autoplay is always muted) | no sound |

### The bot (`src/autoplay.js`)

The bot presses the same single button a person does. Every fixed step (120 Hz) it predicts where the bird will be
when a flap it starts now would land, and flaps when that is half a hop under its target: the centre of the next gap
as it judges it, heading for the gap after next once it is close enough (and staying inside the current gap while
going through it). Its flap lands after a reaction delay plus Gaussian timing noise; its judgement of each gap's
centre is off by a little; it slips now and then (a double tap or a moment of hesitation), more often as a run goes
on. Low skill reacts later, allows for less of its own delay, misjudges more, slips more and looks less far ahead,
so the squeeze at pipe 12 comes as a surprise. Between runs it looks at the game-over card for 0.7 to 3 s (sometimes
much longer, and after a pipe-12 death often straight back in), then retries. It quits at a game-over card once it
has played for 60 to 120 s or reached its run limit (4 to 12 runs, more at low skill): a halted card,
`window.flapjack.halted`, `window.__GLITCHLESS_PLAYTEST_DONE__`, and about a second later `endSession()`.
Deterministic per seed.

Five headless Chrome sessions against a local server (the Mac was busy compiling at the time, so their frame times
say nothing; see problem 2):

| skill (seed) | runs: score of each | session |
| --- | --- | --- |
| 0.3 (5001) | 8: 4 · 11 · 3 · 0 · 6 · 8 · 11 · 10 | 126 s |
| 0.6 (21) | 4: 11 · 11 · 6 · 39 | 115 s |
| 0.7 (5005) | 6: 11 · 11 · 11 · 11 · 1 · 11 | 107 s |
| 0.8 (5010) | 7: 11 · 8 · 11 · 11 · 11 · 7 · 4 | 121 s |
| 0.95 (7) | 2: 20 · 26 | 74 s |

The same bot on the same course in Node (40 seeds per skill, `src/course.js` + `src/physics.js` + `src/autoplay.js`):
sessions take 65-162 s (skill 0.7: 67-135 s) with 4-7 runs at the median (fewer at high skill). Of the runs that reach
pipe 12, about 2% get past it at skill 0.3, 7% at 0.5, 13% at 0.7, 28% at 0.8 and 77% at 0.95; at 0.9-0.95 the best
run of a session is 32 pipes at the median (up to ~60). 43% of all deaths are at pipe 12.

## Events

The game only calls the `gd` facade (`src/telemetry.js`). Every call is in `src/main.js`.

| Event | Attributes | When |
| --- | --- | --- |
| `levelStart('sky')` | | a run starts (every retry is a new run) |
| `levelFail('sky', …)` | `cause`: `pipe` · `ground` · `ceiling` (`restart` only from the `flapjack_start_run` / `flapjack_skip_to_pipe` tools mid-run) | the run ends (a flappy game has no win, so there is no `levelComplete`) |
| `death` | `x` (distance along the course), `y` (height), `z: 0`, `cause`: `pipe` · `ground` · `ceiling` | the bird hits something |
| `run_end` | `score` (pipes passed), `cause`, `biome`: `meadow` · `canyon` · `city` | right after the death |
| `medal` | `kind`: `bronze` · `silver` · `gold` · `platinum` | a run reaches 10, 20, 30, 40 pipes |
| `best_score` | | a run ends above this session's best so far (not the session's first run) |
| `biome` | `name`: `canyon` · `city` · `meadow` | a run passes pipe 10, 20, 30… and the sky changes |
| `retry` | `after_s`: whole seconds on the game-over card, capped at 30 | a new run starts from the game-over card |
| `setPosition` | the bird | every frame |
| `setContext` | `pipes` (pipe pairs in the scene), `particles` (live pooled particles) | every frame |
| `captureMap('sky', { axis: 'xy', bounds })` | bounds `[-4, -2] → [225.2, 14]`: the first 45 pipes, ground to sky | once per session, at boot (a strip with the first 45 pipes in their biome colours, built for the shot and disposed) |

Pipe `n` stands at `x = 10 + 4.8 (n - 1)`, so a death at x ≈ 62.8 is pipe 12. The score on `run_end` is the pipe
count passed, so a death at pipe 12 is `score: 11`.

## Levels

There is one level, `sky`: every run is an attempt at it, so `levelStart` / `levelFail` count runs and how they end.

| Pipes | Biome | Notes |
| --- | --- | --- |
| 1-10 | `meadow` | gaps 3.6 → 3.5 units, gentle steps; the bird is 0.84 across |
| 11 | `canyon` | right after the bronze medal |
| **12** | `canyon` | **the squeeze**: a 2.3 gap, 4.4 units above pipe 11's (planted problem 1) |
| 13-20 | `canyon` | back to normal |
| 21-30 | `city` | gaps shrink to ~3.25, the gap centres move further between pipes |
| 31-40, 41-… | `meadow`, `canyon`, `city`… | gaps 3.1 from pipe 41 on |

The course, the physics and the collisions are plain functions in `src/course.js` and `src/physics.js` (no three.js),
shared by the game, the bot and Node tests.

## Agent tools (WebMCP, `src/agent-tools.js`)

| Tool | Input | Does |
| --- | --- | --- |
| `flapjack_get_state` | none | UI state, the run (score, next pipe, biome, medal, time), the bird (x, y, vertical speed), the next pipe's gap, the session (runs, best, deaths by cause), pipe pairs in the scene vs on screen, particles, renderer stats (draw calls, triangles, geometries, textures, programs), the bot |
| `flapjack_start_run` | none | a new run from pipe 1 (a `retry` after a game over; mid-run, the run ends with `levelFail` cause `restart`) |
| `flapjack_skip_to_pipe` | `{ pipe: 1..200 }` | a run that starts in front of pipe N-1, at its height, with N-2 pipes scored, so it meets pipe N the way players do (`{ pipe: 12 }` for the squeeze) |
| `flapjack_spawn_pipes` | `{ count: 1..300 }` | builds `count` pipe pairs through the real `spawnPipe()` at the course positions on screen, which is what retries leave behind there (reproduces problem 2); returns pipe pairs, geometries and draw calls before and after |
| `flapjack_set_paused` | `{ paused }` | pause or resume |

The same handlers are on `window.flapjack.api`; `window.flapjack.info` has draw calls, geometries, pipes and particles.

## The planted problems

Each one is marked in the code with `// GLITCHLESS-DEMO:`.

| # | Problem | Where | What happens | What Glitchless should show |
| --- | --- | --- | --- | --- |
| 1 | **The squeeze at pipe 12** (difficulty spike) | `src/course.js:80-89` (the override), constants at `src/course.js:25-27` | A "fun twist" right after the bronze medal: pipe 12's gap shrinks from ~3.5 to 2.3 units (0.73 of room above and below the bird) and sits 4.4 units above pipe 11's (3.86 → 8.26). The bird has to climb nearly all of it in one pipe spacing and stop dead. Low skill doesn't see it coming (it looks less far ahead) and arrives low; most runs that get there end there with 11 points | A design finding on `sky`: after four bot sessions, *"Difficulty spike on sky at x≈61.5: 45% of the level's deaths"* (9 of 20, x 58.8-63.1, all `pipe`); the heatmap's top hotspot at pipe 12's leading edge (pipe 12 is x = 62.8); `run_end` with `score: 11` in 8 of 20 runs and `cause: pipe` |
| 2 | **Pipes that are never recycled** (a leak, and frame time that worsens with every retry) | `src/pipes.js:99-122`: `spawnPipe()` at line 106 builds ~20 meshes per pair, each with its own new geometry and material, and never removes or disposes them; `update()` at line 121 hides pipes off screen and shows them again when they're back; `rewind()` at line 114, called from `src/main.js:101-103`, is all a retry does | Every run builds the course again on top of every earlier run's meshes, at exactly the same places (the course never changes), so nothing looks wrong. Each copy on screen is drawn again, plus its shadow. A low-skill session ends with ~100 pipe pairs (~2,000 geometries) in the scene, and the early course drawn 8 times over: 2,300+ draw calls where one run needs ~350 | A high memory finding: *"Geometry leak in 1.0.0: +322 geometries per level load"* (median 102 → 2,035 over 3 sessions). In a session's frame windows, `geometries` climbs from 102 to 2,061 and the `pipes` gauge from 5 to 106 over two minutes, with draw calls rising with each retry (252 → 2,325). Frame time late in sessions: unmeasured, the machine was busy compiling during these runs (the overlay held 16.8 ms p95 at 2,300 draw calls under vsync) |

Also in the data, by design: every flappy session ends a few seconds after a death. Glitchless sees that no run ever
completes a level, so it doesn't count those as rage quits.

## Files

```
index.html          HUD (score, best, biome), title, pause, game-over and halted cards
src/main.js         renderer, state machine, fixed-step loop, runs, scoring, medals, telemetry calls, agent API
src/course.js       the course: pipe positions and gaps (seeded), biomes, medals, heatmap bounds (pure; problem 1)
src/physics.js      bird physics and collisions (pure)
src/pipes.js        pipe pair meshes, the spawner (problem 2), the heatmap strip
src/scenery.js      sky, sun/moon, stars, parallax layers per biome, clouds, ground strip, lights
src/bird.js         the Flapjack model and its animation
src/fx.js           pooled particles (one InstancedMesh)
src/hud.js          DOM HUD + screens
src/input.js        Space / click / tap → one flap button, plus menu keys
src/autoplay.js     the bot
src/agent-tools.js  WebMCP tools
src/telemetry.js    Glitchless facade + init; src/glitchless-sdk.js holds the SDK imports
src/audio.js, params.js, rng.js, version.js
```

## Dashboard

Designed with the `dashboard` skill and saved with `glitchless_set_dashboard`; the spec is
[`glitchless.dashboard.json`](glitchless.dashboard.json) (send it to the tool to recreate it). An endless game has no
win, so there's no levels table (its one level would read 0% completion): the boards ask where runs end instead.

| Page | What it answers |
| --- | --- |
| **Overview** | players, runs, medals earned, frame time p95; the findings; *where runs end (score)*, every whole score a row; what ends a run; medals |
| **Runs** | runs followed by a retry, new bests, average session, sessions; biome reached; seconds on the game-over card before retrying; runs over time |
| **Course heatmap** | the built-in heatmap over the first 45 pipes of the course, captured in-game: where birds fly and where they die |
| **Frame time**, **Sessions** | built-in views |

What Glitchless found in 20 bot sessions (100 runs; `npm run bots -- --game http://localhost:5181/`, on a quiet M3 Max):

- **high, memory:** *Geometry leak in 1.0.0: +384 geometries per level load*, from about 100 to 1,850 a session: the
  pipes that are hidden instead of recycled. The finding also names the `pipes` gauge, which keeps climbing with it (5 to
  94 a session). Draw calls reach about 1,200; on an M3 Max frame time still holds at 16.8 ms.
- **medium, design:** *Difficulty spike on sky at x≈61.5: 48% of the level's deaths*, 48 of 100, all `pipe`: pipe 12.
  The board says it more plainly: 47 of the 100 runs end at a score of 11. No run ever completes a level, so Glitchless
  counts no rage quits and says instead that every run ends in a death, and more of them end here than anywhere else.

![The Flapjack dashboard](../../assets/screenshots/flapjack-dashboard.png)
