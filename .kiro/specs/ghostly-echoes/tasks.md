# Implementation Plan: Ghostly Echoes

## Overview

The implementation language is vanilla JavaScript (ES2015+, classic scripts), as specified in the design. Each core module in `src/` uses the guarded UMD-style export from the design. It attaches to `globalThis.GhostlyEchoes` in the browser and sets `module.exports` in Node, so the same file loads as a classic `<script>` and through `require` in tests. Tests run with `node --test` using only `node:test` and `node:assert/strict`. There is no `npm install`, no package dependencies and no third-party test or property-testing library.

The build order follows the design's module order: constants → rng → test harness → physics → gates → recorder → echoManager → simulation → stageGenerator → game → hud → input / audio / renderer → main → index.html. Property tests sit directly after the code they verify.

## Tasks

- [x] 1. Set up core foundations and test infrastructure
  - [x] 1.1 Create `src/constants.js` with all tunables
    - Use the UMD-style guarded export (namespace `GhostlyEchoes.constants`, plus `module.exports` in Node)
    - Define `FP = 256`, `COURSE_W/H`, `PLAYER_W/H`, `PLAYER_START_X/Y`, `GRAVITY = 64`, `FLAP_VY = -1280`, `SCROLL_SPEED = 768`, `GATE_HOLD_TICKS = 30`, `MAX_ECHOES = 3`, `COUNTDOWN_STEPS = 60`, `MAX_TICKS_PER_FRAME = 5`, `BASE_SEED = 0x6E05C40D`
    - Define geometry constants `RUNE_W/H`, `GATE_W`, `WALL_W`, `HAZARD_SIZE`, `RUNE_GAP_MIN = PLAYER_W + 4` (36 px), `RUNE_GAP_MAX = 30 × 3 − GATE_W` (66 px), `STEER_BIAS = 57`, `MIDLINE_CLEARANCE_PX = 100`, `PASSAGE_PAD`, `APPROACH_PX`, `RUNWAY_PX`, `FINISH_MARGIN_PX`
    - Define style constants `ECHO_ALPHA = 0.45`, `ECHO_TINTS`, `RUNE_STYLES` (3 unique symbol/color pairs), and the Stage 1 hint string
    - Freeze exported objects
    - _Requirements: 1.4, 2.4, 2.5, 4.7, 5.2, 6.1, 6.3, 6.9, 9.5, 9.11, 10.7, 11.8, A16_

  - [x] 1.2 Create `src/rng.js` with seeded randomness
    - Implement `fmix32` (MurmurHash3 finalizer), `deriveSeed(a, b)`, `stageSeed(base, stage, salt = 0)` and `createRng(seed)` (mulberry32 with `nextU32`, inclusive `nextInt(lo, hi)`, `chance(perMille)`)
    - Coerce seeds with `>>> 0` and use only `Math.imul`, `>>> 0` and `| 0` integer arithmetic
    - Use the UMD-style guarded export
    - _Requirements: 1.2, 9.5, 11.8_

  - [x] 1.3 Create the test harness in `tests/helpers/`
    - `tests/helpers/load.js`: `require` the core scripts from `src/` and return their APIs in Node without any DOM globals
    - `tests/helpers/property.js`: `forAll(name, { cases = 500, baseSeed }, gen, predicate)` with per-case `caseSeed = deriveSeed(baseSeed, i)` and `rng = createRng(caseSeed)`
    - Support env vars `GE_BASE_SEED` (override base seed), `GE_SEED` (rerun one case by seed) and `GE_CASE` (rerun one case by index), and print the base seed at the start of each property file
    - On failure throw an `AssertionError` whose message includes the property name, case index and case seed
    - Add generator helpers: random Input_Log of 0 to 3,600 Ticks with a per-case flap density of 0–30 % (empty and short logs included), and random Echo log sets of 0–3 logs
    - Add `genCourse(rng)`: a small hand-built random Course (same shape as the design's Course data model) with a few walls and Hazards and 0 to 2 Rune/Rune_Gate pairs that satisfy criterion 6.1, including the minimum clearance (Rune center in the opposite vertical half from the passage center, rune right < gate left, gate left − rune right ≥ `RUNE_GAP_MIN`, gate right − rune right ≤ 30 × scroll speed)
    - Add `genRuneGatePair(rng)`: a random Rune/Rune_Gate pair that satisfies criterion 6.1, including the minimum clearance, for the gate timing and crossing coverage tests
    - _Requirements: 6.1, 12.1, 12.2, 12.3, 12.4_

  - [ ]* 1.4 Write unit tests for `rng.js` in `tests/rng.test.js`
    - Same seed gives the same sequence, `>>> 0` seed coercion, `nextInt` stays inside inclusive bounds, `chance(0)` is always false
    - `stageSeed(BASE_SEED, n)` is pairwise distinct for Stages 1–50
    - _Requirements: 1.2, 9.5_

- [x] 2. Implement physics and gate logic
  - [x] 2.1 Create `src/physics.js`
    - `stepGhost(g, flap)`: if flap then `vy = FLAP_VY`; then `vy += GRAVITY`; `y += vy`; `x += SCROLL_SPEED`, in exactly that order
    - `hitbox(g)`, inclusive `rectsIntersect(a, b)` (shared edges count as contact) and `outOfCourse(h)`
    - Pure functions only, with the UMD-style guarded export
    - _Requirements: 2.3, 2.4, 2.5, 4.2, 7.1, 7.2, 7.3, 7.6_

  - [x] 2.2 Create `src/gates.js`
    - `updateGates(gates, runes, echoHitboxes, tick)` takes Echo hitboxes only (no Player argument) and sets `lastEchoOverlapTick = tick` on any Echo–Rune intersection
    - `isGateOpen(gate, tick)` returns `lastEchoOverlapTick !== null && tick − lastEchoOverlapTick <= GATE_HOLD_TICKS`, so the initial `null` state means closed at Tick 0
    - Return new gate objects (pure)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.8, 6.13_

  - [x] 2.3 Write property test for gate timing in `tests/gates.test.js`
    - **Property 5: Gate timing**
    - Random Rune layouts from `genRuneGatePair` (and/or `genCourse`), random Echo position sequences (up to 3,600 Ticks), oracle: open at N iff an Echo intersected the Rune on some Tick in `[max(0, N−30), N]`
    - Assert the gate state sequence is unchanged when the Player sequence is swapped for another one, including one that overlaps the Rune
    - Include an example: the Player alone over a Rune never opens the gate
    - **Validates: Requirements 6.8, 6.2, 6.3, 6.4, 6.5, 6.13**

  - [x] 2.4 Write property test for crossing coverage in `tests/gates.test.js`
    - **Property 9: Crossing coverage**
    - Seeded random Rune/Rune_Gate pairs from `genRuneGatePair` satisfying 6.1 (gate right − rune right ≤ 30 × scroll speed, gate left − rune right ≥ `RUNE_GAP_MIN`) and seeded Echo paths that intersect the Rune and are truncated at their last Rune-overlap Tick
    - Assert the gate is open on every Tick on which a Player hitbox at the same x intersects the gate's area
    - **Validates: Requirements 12.7, 6.1, 6.3**

- [x] 3. Implement recording and Echo storage
  - [x] 3.1 Create `src/recorder.js`
    - `createRecorder()` returning `begin()`, `append(flag)`, `finalize()` and `isRecording()`
    - `begin()` starts a fresh empty array, `append` pushes exactly one boolean per Tick and is a no-op while idle
    - `finalize()` stops recording and returns `Object.freeze(array)`, or `null` for a zero-length log
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.9, 4.10_

  - [ ]* 3.2 Write unit tests for the recorder in `tests/recorder.test.js`
    - One entry per simulated Tick, log length after death includes the death Tick, length after restart, frozen logs reject mutation, `null` for zero length, no appends before `begin` or after `finalize`, separate logs per Run
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 3.3 Create `src/echoManager.js`
    - Pure `emptyEchoes()` and `storeEcho(echoes, log)`: drop `echoes[0]` when 3 are held, then append `{ log, tintIndex, seq }`
    - `tintIndex` is the smallest index in `{0, 1, 2}` not used by the retained entries; logs are stored by reference (already frozen)
    - _Requirements: 4.8, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8_

  - [ ]* 3.4 Write property test for the Echo limit in `tests/echoManager.test.js`
    - **Property 4: Echo limit invariant**
    - Random sequences of stored Runs (logs up to 3,600 Ticks) interleaved with cleared Runs that are not stored; assert the manager holds exactly the most recent min(n, 3) logs in end order, identical to the recorded logs, with 0–3 entries and pairwise distinct `tintIndex`
    - **Validates: Requirements 5.5, 5.1, 5.2, 5.3, 5.4, 5.6, 5.8, 4.8**

  - [ ]* 3.5 Write unit tests for Echo_Manager examples in `tests/echoManager.test.js`
    - `emptyEchoes()` holds 0 entries (new Stage), eviction of the oldest keeps the order of the 2 retained Echoes
    - _Requirements: 5.3, 5.7_

- [x] 4. Implement the Simulation and frame accumulator
  - [x] 4.1 Create `src/simulation.js`
    - `createRunState(course, echoes)`: Player and every Echo at the Tick-0 start state, gates with `lastEchoOverlapTick = null`, `tick = 0`, `status = 'running'`
    - `stepSimulation(course, state, flap)` in the design's per-Tick order: Player step if alive → each active Echo steps with `log[t]` (missing entries = no flap) → `updateGates` from Echo hitboxes only → Player death checks (walls, Hazards, closed gates, top/bottom edges, inclusive) → finish check only if alive → remove Echoes whose `log.length − 1 === t` → `tick += 1`
    - Return a new state plus `events = { flapped, died, cleared }`, with `died` emitted at most once and the dead Player frozen
    - `replayHeadless(course, playerLog, echoLogs, opts)` that stops at clear, death or `opts.maxTicks` and returns `{ states, outcome, deathTick, clearTick }`
    - Echoes never collide with terrain, gates, edges or other Ghosts
    - _Requirements: 1.1, 1.3, 1.9, 2.3, 2.4, 2.5, 4.1, 4.2, 4.4, 4.5, 4.6, 6.6, 6.7, 6.10, 6.11, 6.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.7, 9.1_

  - [x] 4.2 Create `src/main.js` with the pure `advanceAccumulator(accMs, elapsedMs)` helper
    - `TICK_MS = 1000 / 60`, `EPS = 1e-6`, NaN or negative elapsed treated as 0
    - More than 5 Ticks accumulated → `{ ticks: 5, accMs: 0 }`; otherwise floor the Tick count and carry the remainder
    - Export it through the UMD-style guard; leave the browser bootstrap for task 10.1, guarded so the file loads in Node
    - _Requirements: 1.7, 1.8_

  - [x] 4.3 Write property test for determinism in `tests/simulation.test.js`
    - **Property 1: Determinism**
    - Random seeds, random test Courses from `genCourse`, 0–3 Echo logs and Input_Logs up to 3,600 Ticks; two runs from the same initial state are deep-equal at every Tick and `tick` increases by exactly 1 per step
    - **Validates: Requirements 1.5, 1.1, 1.3, 2.8**

  - [ ]* 4.4 Write property test for the Int32 range in `tests/simulation.test.js`
    - **Property 10: Int32 range**
    - Using the Property 1 generator, every numeric RunState field (`x`, `y`, `vy`, `tick`, `lastEchoOverlapTick`) is `Number.isInteger` and within −2,147,483,648..2,147,483,647 after every Tick, with no velocity clamping
    - **Validates: Requirements 1.4**

  - [ ]* 4.5 Write property test for frame-rate independence in `tests/simulation.test.js`
    - **Property 2: Frame-rate independence**
    - Frame rates 30–240 fps with ±20 % per-frame jitter driven through `advanceAccumulator` (excluding frame gaps over 5 Ticks), compared with direct Tick-by-Tick stepping of the same Input_Log
    - **Validates: Requirements 1.10, 1.7**

  - [x] 4.6 Write property test for the replay round-trip in `tests/replay.test.js`
    - **Property 3: Replay round-trip**
    - Record a random Player Run on a random Course with walls, Hazards and gates from `genCourse`, then replay the finalized log as an Echo alongside up to 2 other random Echoes; assert exact `x`, `y`, `vy` equality at every Tick 0..last and absence of the Echo on later Ticks
    - **Validates: Requirements 4.3, 4.1, 4.2, 4.4, 4.5, 4.6, 6.10, 7.7, 2.5**

  - [ ]* 4.7 Write example unit tests for the Simulation and accumulator in `tests/simulation.test.js`
    - Flap replaces any `vy` (positive, negative, large), update order flap → gravity → position, inclusive edge contact with walls, Hazards and closed gates, top/bottom edge deaths, open gate lets the Player pass unchanged, death beats finish on the same Tick, dead Player frozen with no `flapped` events, exactly one `died` event when several death conditions hit on one Tick, missing log entries treated as no flap
    - `advanceAccumulator` examples: remainder carry, exactly 5 Ticks, more than 5 discarded, NaN/negative elapsed
    - _Requirements: 1.7, 1.8, 1.9, 2.3, 2.4, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.6, 7.8, 9.1_

  - [ ]* 4.8 Write the core source scan test in `tests/sourceScan.test.js`
    - Read the core files (`constants`, `rng`, `physics`, `gates`, `recorder`, `echoManager`, `simulation`, `stageGenerator`, `game`, and the pure part of `hud`) and assert they do not reference `window`, `document`, `Math.random`, `Date` or `performance`
    - Assert each core file loads via `require` with no DOM globals defined
    - _Requirements: 1.2, 1.6, 11.7, 11.8, 12.2_

- [x] 5. Checkpoint - Core simulation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the Stage_Generator
  - [x] 6.1 Create `src/stageGenerator.js` with difficulty, seeds and error type
    - `difficulty(stage)` with `k = min(stage − 1, 19)` and integer `lerp`: `gapPx` 200 → 120, `spacingPx` 520 → 380, `hazardPerMille` 0 → 600, `gateCount = min(3, 1 + trunc(2k / 13))`
    - `GeneratorError extends Error` with `stage`, `seed` and `reason`
    - `generateStage(stage, opts)` entry point that computes `seed = stageSeed(BASE_SEED, stage, seedSalt)`, creates the RNG and resolves `params = paramsOverride ?? difficulty(stage)` with `gateCount` always from `difficulty(stage)`
    - _Requirements: 9.5, 9.7, 9.11, A7_

  - [x] 6.2 Implement the x skeleton, steering controller and Player witness
    - Build the x-only skeleton: runway, per gate 2 regular columns at `spacingPx`, an `APPROACH_PX` approach zone and a `GATE_W` gate column, then 2 trailing columns and `finishX = lastColumnRight + FINISH_MARGIN_PX`
    - Pick passage targets with the RNG: gate half chosen per gate, gate `cy` ≥ `MIDLINE_CLEARANCE_PX` (100 px) from the midline, Rune target `ry_k` in the opposite half (`[80, 140]` or `[340, 400]`)
    - `steer(g, targetY)`: flap iff `g.y + 16·FP + 8·g.vy > (targetY + STEER_BIAS)·FP`, switching to the next column's target once the hitbox left edge passes the previous column's right edge
    - Generate the Player witness log by running `steer` + `stepGhost` from Tick 0 until `x ≥ finishX`, before any wall or Hazard exists
    - _Requirements: 9.8, 9.9_

  - [x] 6.3 Implement Echo witnesses
    - Divergence Tick `D_k`: first Tick the witness hitbox left edge passes the last regular column before gate `k`'s approach zone; Echo `k` shares the Player log on `[0, D_k)` and then steers to `ry_k`
    - Rune x first: `runeGap = rng.nextInt(RUNE_GAP_MIN, RUNE_GAP_MAX)`, `runeRight = gateLeft − runeGap`, `runeLeft = runeRight − RUNE_W`
    - Simulate the Echo, find the crossing Tick `c_k` (Echo hitbox center x ≥ Rune center x) and center the Rune vertically on the Echo hitbox center at `c_k`
    - Exit-Tick refinement: at `E_k` (last Tick with Echo hitbox left ≤ `runeRight`), shift the Rune center the minimal amount toward the Echo center if they would not intersect
    - Truncate the Echo log to `L_k + 1` entries, where `L_k` is the last Tick the Echo hitbox intersects the placed Rune
    - _Requirements: 6.1, 9.8, 9.9, A15, A18_

  - [x] 6.4 Implement geometry placement
    - For each column, passage = `[minTop − PASSAGE_PAD, maxBottom + PASSAGE_PAD]` over all alive witness hitboxes overlapping the column's x-span (Player and untruncated Echo prefixes), widened symmetrically to ≥ `gapPx`, shifted (not shrunk) into `[0, COURSE_H]`; walls fill above and below
    - Gate rect fills the gate column's passage, with `styleIndex = k` and `runes[k]` linked 1:1
    - Hazards: for each gap between regular columns (not approach zones), `rng.chance(hazardPerMille)` places a 24×24 Hazard at the gap's x-center, y scanned in 4 px steps for maximum clearance from alive witness hitboxes and Course edges, skipped if clearance < 16 px
    - Assemble the `Course` object from the design's data model, including `witness: { player, echoes }`
    - _Requirements: 6.1, 9.9, 9.11_

  - [x] 6.5 Implement `selfCheck` and `checkRunePlacement`
    - `checkRunePlacement(course)`: rune right < gate left; gate right − rune right ≤ 30 × scroll speed; gate left − rune right ≥ `RUNE_GAP_MIN`; Rune center in the opposite vertical half from the passage center; throws `GeneratorError`
    - `selfCheck(course)`: witness replay clears with no death; each Echo `k` played as the Player with Echoes `1..k−1` stays alive through its last Tick; `checkRunePlacement`; `1 ≤ gateCount ≤ 3`; every passage ≥ 2 × `PLAYER_H`
    - Call `selfCheck` at the end of `generateStage`; no candidate retry loop
    - _Requirements: 6.1, 9.9, 9.10, 9.11, 9.12_

  - [x] 6.6 Write unit tests for difficulty and steering in `tests/stageGenerator.test.js`
    - Difficulty table is monotone (gap and spacing non-increasing, Hazard rate and gate count non-decreasing), fixed from Stage 20 on, gap limit ≥ 2 × `PLAYER_H`
    - Stage 1 has exactly 1 gate
    - Steering hover-band check: for flat targets in the clamp range, the steady-state hitbox center stays within −30..+26 px of the target
    - _Requirements: 9.7, 9.11_

  - [ ]* 6.7 Write property test for generation determinism in `tests/stageGenerator.test.js`
    - **Property 6: Generation determinism**
    - Stages 1–50 generated twice are deep-equal (walls, Hazards, Runes, gates, `finishX`, scroll speed, witness logs)
    - Compute a canonical fingerprint (hash of the serialized Course for Stages 1–50) and compare it with a checked-in golden value
    - **Validates: Requirements 9.6**

  - [x] 6.8 Write property test for solvability in `tests/stageGenerator.test.js`
    - **Property 7: Solvability**
    - For Stages 1–50, `replayHeadless` with the witness Echo logs as Echoes and the Player log as the Player clears with no death; each Echo witness `k` played as the Player with Echoes `1..k−1` stays alive through its last Tick; 1–3 Echo witness logs, each no longer than the Ticks to the Finish_Line
    - Also check determinism (Property 1) on generated Stages 1–50: two replays of the witness logs on each generated Course are deep-equal at every Tick
    - **Validates: Requirements 9.10, 9.9, 9.8, 1.5**

  - [ ]* 6.9 Write property test for Rune placement in `tests/stageGenerator.test.js`
    - **Property 8: Rune placement**
    - For Stages 1–50 and every pair: 1:1 pairing, rune right < gate left, gate right − rune right ≤ 30 × scroll speed, gate left − rune right ≥ `RUNE_GAP_MIN`, opposite vertical halves; `1 ≤ gateCount ≤ 3` (exactly 1 on Stage 1); every passage ≥ 2 × `PLAYER_H`
    - **Validates: Requirements 9.12, 6.1, 9.11**

  - [x] 6.10 Write the generator smoke test in `tests/generatorSmoke.test.js`
    - Stages 1–300: `generateStage` + `selfCheck` do not throw, placement invariants hold, gate count is 1–3
    - _Requirements: 9.2, 9.11, 9.12_

- [x] 7. Checkpoint - Stage generation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Game state machine and HUD model
  - [x] 8.1 Create `src/game.js`
    - `createGame({ generate = generateStage })`, `loadStage(game, stage)`, `fixedStep(game, { flap, restart })` and `isAcceptingFlaps(game)`, all DOM-free
    - `waitingForFirstFlap`: on flap create the RunState, `recorder.begin()`, simulate Tick 0 with the flap and append it; ignore R and other inputs
    - `running`: R (before stepping) finalizes the log, stores the Echo if non-null, `attempt += 1`, returns to waiting with 0 delay; otherwise step and append; on `died` store the Echo and start the 60-step post-death Countdown; on `cleared` discard the log and start the 60-step post-clear Countdown
    - Countdowns: ignore flap and R, do not step the Simulation or append; at 0 either `attempt += 1` and wait, or `loadStage(stage + 1)` (attempt 1, 0 Echoes)
    - `loadStage` recovery: catch `GeneratorError`, `console.error` stage, seed and reason, set a non-fatal `notice`, regenerate the same Stage with Stage 1 difficulty params (gap 200, spacing 520, Hazard 0) and `seedSalt = 1` while keeping the normal `gateCount`; if that also fails set `mode = 'error'` and ignore input
    - Forward Simulation `events` (`flapped`, `died`, `cleared`) for audio
    - _Requirements: 2.6, 5.1, 5.6, 5.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.2, 9.3, 9.4, 11.4, A6, A9, A16_

  - [x] 8.2 Create `src/hud.js` with the pure `getHudModel(game)`
    - Return `{ lines: ['Stage: S', 'Attempt: N', 'Echoes: X/3'], hint }` with the Stage 1 hint only on Stage 1, `null` otherwise, in every mode including Countdowns
    - Read-only access to Game state; UMD-style guarded export
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 10.8_

  - [ ]* 8.3 Write unit tests for the Game state machine in `tests/game.test.js`
    - No Ticks until the first flap and Tick 0 has the flap applied; R while running stores an Echo and starts the next Attempt immediately; R while waiting is ignored; R or death with zero Ticks stores nothing
    - Both Countdowns last 60 steps, ignore flap and R, do not advance the Tick or append to any log
    - Attempt counter starts at 1 and increments by 1; a clear is not stored as an Echo; after the post-clear Countdown Stage N+1 loads with attempt 1 and 0 Echoes; the Echo limit holds across many Attempts
    - _Requirements: 3.8, 5.6, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.2, 9.3, 9.4_

  - [ ]* 8.4 Write unit tests for generator recovery in `tests/game.test.js`
    - Inject a `generate` stub that throws `GeneratorError` once: the Game regenerates the same Stage with Stage 1 params and `seedSalt = 1`, keeps the normal `gateCount`, sets a `notice` and stays playable
    - Inject a stub that always throws: `mode` becomes `'error'`, input is ignored and nothing throws out of `fixedStep`
    - _Requirements: 9.10, 11.1_

  - [ ]* 8.5 Write unit tests for the HUD model in `tests/game.test.js`
    - Text formats for Stage, Attempt and Echoes in waiting, running and both Countdowns; values update right after changes; Stage 1 hint present only on Stage 1
    - HUD read-only: a Run's state sequence is identical whether or not `getHudModel` is called each step
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8_

- [x] 9. Implement the browser shell
  - [x] 9.1 Create `src/input.js`
    - `createInputHandler(target, canvas, isAcceptingFlaps)`: non-repeat `Space`/`ArrowUp` keydown anywhere, `mousedown` with `button === 0` on the canvas, `touchstart` on the canvas
    - `preventDefault()` on Space/ArrowUp keydown and touchstart; queue flaps only when `isAcceptingFlaps()` is true
    - Non-repeat `KeyR` keydown sets `restart = true`; `drain()` returns `{ flap: queue > 0, restart }` and clears both
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 8.4, A12_

  - [x] 9.2 Create `src/audio.js`
    - `createAudio(srcs)` with `Audio` elements for `assets/jump.wav` and `assets/game_over.wav`, `unlock()` on the first gesture, `play(name)` resetting `currentTime` inside try/catch with `.catch(() => {})` on the Promise
    - Load errors mark a sound unavailable and turn `play` into a no-op
    - _Requirements: 7.4, 7.5, 7.9_

  - [x] 9.3 Create `src/renderer.js`
    - `createRenderer(ctx, image)` with camera `camX = player.x − PLAYER_START_X`
    - Draw order: background, walls, Hazards, Runes and gates in `RUNE_STYLES[k]` (closed = solid bar, open = dashed outline at 25 % alpha), Echoes, Player, then HUD
    - Echo tints from per-tint offscreen canvases (sprite + `source-atop` fill) drawn at `ECHO_ALPHA`; Player via `drawImage` scaled to 32×32 when the image is ready
    - Fallback: filled 32×32 rect for the Player (and tinted rects for Echoes) when the image is not ready or failed; never call `getImageData`
    - Draw the error screen ("Reload to try again") in `'error'` mode and the non-fatal `notice` if set
    - _Requirements: 4.7, 4.8, 6.9, 6.12, 10.5, 11.3, 11.5_

  - [x] 9.4 Add `drawHud(ctx, model)` to `src/hud.js`
    - Stats top-left at 16 px with 12 px margins; hint word-wrapped to `COURSE_W − 24`, bottom-aligned 12 px above the canvas bottom and only drawn if it stays below the stats block
    - Keep all HUD text inside canvas bounds; keep `getHudModel` DOM-free and guard `drawHud` so the file still loads in Node
    - _Requirements: 10.4, 10.5, 10.7_

  - [ ]* 9.5 Write mock-based unit tests for input and audio in `tests/shell.test.js`
    - Fake event target and canvas: each flap source queues one flap, auto-repeat and non-primary buttons are ignored, `preventDefault` called for Space/ArrowUp/touchstart, several flaps in one Tick drain as one, flaps dropped while not accepting, R repeat ignored
    - Fake `Audio` whose `play()` rejects or throws: `play(name)` never throws
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 7.9, 8.4_

- [ ] 10. Wire everything together
  - [~] 10.1 Complete the browser bootstrap in `src/main.js`
    - Load `assets/ghosty.png` (`onload` sets ready, `onerror` keeps the fallback), create the Game and `loadStage(1)`, create input, audio and renderer
    - `requestAnimationFrame` loop: `advanceAccumulator`, run `fixedStep(game, input.drain())` once per Tick, play `jump.wav` on `flapped` and `game_over.wav` on `died`, then `renderer.draw(game)`
    - On `visibilitychange` to visible reset `lastTime = performance.now()` and `accMs = 0`
    - Keep the bootstrap guarded by `typeof document !== 'undefined'` so `advanceAccumulator` still loads in Node
    - _Requirements: 1.7, 1.8, 7.4, 7.5, 11.1, 11.3, 11.4, 11.5_

  - [~] 10.2 Create `index.html`
    - A canvas sized `COURSE_W × COURSE_H` and classic `<script src>` tags with relative paths in order: constants, rng, physics, gates, recorder, echoManager, simulation, stageGenerator, game, hud, input, audio, renderer, main
    - No `type="module"`, no external URLs, no storage APIs
    - _Requirements: 11.1, 11.2, 11.4, 11.6_

  - [ ]* 10.3 Write the packaging smoke test in `tests/packaging.test.js`
    - Parse `index.html`: classic scripts only, relative paths, the design's script order, every referenced file exists, no `http(s)://` references
    - Scan `src/` for `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `fetch(` and `XMLHttpRequest`
    - Assert there is no `package.json` dependency list (or no `package.json` at all)
    - _Requirements: 11.2, 11.4, 11.6, 12.1_

- [~] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass with `node --test`, ask the user if questions arise.

## Notes

- Required test tasks: 2.3 (P5), 2.4 (P9), 4.3 (P1), 4.6 (P3), 6.6 (difficulty and steering), 6.8 (P7, plus P1 on Stages 1–50) and 6.10 (Stages 1–300 smoke test). Tasks marked with `*` are optional and can be skipped for a faster MVP; they are only the remaining property, unit, example and smoke tests: 1.4, 3.2, 3.4 (P4), 3.5, 4.4 (P10), 4.5 (P2), 4.7, 4.8, 6.7 (P6), 6.9 (P8), 8.3, 8.4, 8.5, 9.5, 10.3.
- Each task references specific requirements for traceability. Each property test carries a tag comment `// Feature: ghostly-echoes, Property N: <title>`.
- Property tests use the `forAll` harness with about 500 seeded cases and Input_Logs up to 3,600 Ticks. Stage-level properties iterate Stages 1–50 exhaustively. Failures report the property name, case index and case seed (`GE_SEED` / `GE_CASE` rerun a single case).
- The source scan lives in its own file (`tests/sourceScan.test.js`) rather than inside `simulation.test.js`, so it can run in parallel with the simulation tests.
- The manual browser checklist from the design is not a coding task, so it is not in the task list. After task 11, check it by hand: open via `file://` and GitHub Pages, test all flap inputs, Echo tints and opacity, Rune/gate styling, the image and audio fallbacks, the Stage 1 hint flow, and that reloading resets progress.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "3.3"] },
    { "id": 2, "tasks": ["1.3", "2.2"] },
    { "id": 3, "tasks": ["1.4", "2.3", "3.2", "3.4", "4.1"] },
    { "id": 4, "tasks": ["2.4", "3.5", "4.2", "4.3", "4.6", "4.8", "6.1"] },
    { "id": 5, "tasks": ["4.4", "6.2"] },
    { "id": 6, "tasks": ["4.5", "6.3"] },
    { "id": 7, "tasks": ["4.7", "6.4"] },
    { "id": 8, "tasks": ["6.5"] },
    { "id": 9, "tasks": ["6.6", "6.10", "8.1"] },
    { "id": 10, "tasks": ["6.7", "8.2", "8.3", "9.1", "9.2", "9.3"] },
    { "id": 11, "tasks": ["6.8", "8.4", "9.4", "9.5"] },
    { "id": 12, "tasks": ["6.9", "8.5", "10.1"] },
    { "id": 13, "tasks": ["10.2"] },
    { "id": 14, "tasks": ["10.3"] }
  ]
}
```
