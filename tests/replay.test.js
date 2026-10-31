/*
 * Ghostly Echoes - tests/replay.test.js
 * Property 3: Replay round-trip.
 *
 * A Player Run is recorded on a random Course (walls, Hazards, gates) with a
 * live Recorder. The finalized log is stored through the Echo_Manager next to
 * up to 2 other random Echo logs (random store order) and replayed in a new Run
 * with a different Player input on the same Course.
 *
 * "Echo at Tick i" means the Echo in the RunState whose tick === i (the state
 * at the start of Tick i: initialState for i = 0, states[i - 1] otherwise).
 * For a log of length n (last Tick L = n - 1) the Echo must be present with
 * exactly the recorded Player's x, y, vy at Ticks 0..L and absent from every
 * state with tick > L (removed after its last recorded Tick, 4.4).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/load.js');
const { forAll, genCourse, genInputLog, genEchoLogs } = require('./helpers/property.js');

const { createRunState, stepSimulation } = core.simulation;
const { createRecorder } = core.recorder;
const { emptyEchoes, storeEcho } = core.echoManager;

const EXTRA_TICKS = 30; // keep stepping past the Echo's removal
const FP = core.constants.FP;

// Hover policy: flaps when the predicted hitbox center (8 Ticks ahead) is
// below a target y that changes every few hundred Ticks, plus random noise.
// Precomputes targets and noise from the case RNG, so it stays deterministic.
function genHoverInput(rng) {
  const limit = rng.nextInt(1, 3600);
  const targets = [];
  const noise = new Array(limit);
  const noisePerMille = rng.nextInt(0, 50);
  for (let t = 0; t < limit; t += rng.nextInt(60, 400)) targets.push({ from: t, y: rng.nextInt(60, 420) });
  for (let t = 0; t < limit; t++) noise[t] = rng.chance(noisePerMille);
  return {
    limit: limit,
    policy: (p, tick) => {
      let target = targets[0].y;
      for (const s of targets) if (s.from <= tick) target = s.y;
      return noise[tick] || p.y + 16 * FP + 8 * p.vy > target * FP;
    }
  };
}

// Records one Player Run: begin, append every simulated Tick's flap, stop at
// death, clear or the end of the input. Returns the finalized log and the
// Player's (x, y, vy) at the start of every Tick 0..n (snapshots[i] = state
// with tick === i).
// input is either an Input_Log (array) or a policy (player, tick) -> boolean
// with a Tick limit, used to make Runs that survive long enough to reach
// walls, Hazards and gates.
function recordRun(course, input) {
  const recorder = createRecorder();
  recorder.begin();
  let state = createRunState(course, emptyEchoes());
  const snapshots = [{ x: state.player.x, y: state.player.y, vy: state.player.vy }];
  const limit = Array.isArray(input) ? input.length : input.limit;
  while (state.status === 'running' && state.tick < limit) {
    const flap = Array.isArray(input)
      ? input[state.tick] === true
      : input.policy(state.player, state.tick);
    const res = stepSimulation(course, state, flap);
    recorder.append(flap);
    state = res.state;
    snapshots.push({ x: state.player.x, y: state.player.y, vy: state.player.vy });
  }
  return { log: recorder.finalize(), snapshots: snapshots, status: state.status };
}

// Feature: ghostly-echoes, Property 3: Replay round-trip
test('Property 3: Replay round-trip', () => {
  let total = 0;
  let recorded = 0;

  forAll(
    'Replay round-trip',
    { cases: 500 },
    (rng) => {
      const course = genCourse(rng);
      const recordInput = rng.nextInt(0, 1) === 0 ? genInputLog(rng) : genHoverInput(rng);
      const others = genEchoLogs(rng, { maxCount: 2 }).map((l) => Object.freeze(l));
      const insertAt = rng.nextInt(0, others.length);
      const replayInput = genInputLog(rng);
      return { course, recordInput, others, insertAt, replayInput };
    },
    ({ course, recordInput, others, insertAt, replayInput }) => {
      total += 1;
      const run = recordRun(course, recordInput);

      if (run.log === null) {
        // Zero-length Run: nothing to replay (3.8, 4.10).
        assert.equal(run.snapshots.length, 1, 'null log only for zero simulated Ticks');
        return true;
      }
      recorded += 1;

      const log = run.log;
      const last = log.length - 1;
      assert.ok(Object.isFrozen(log), 'finalized log is frozen');
      assert.equal(run.snapshots.length, log.length + 1, 'one log entry per simulated Tick');

      // Store the recorded log at a random position among the other Echoes.
      const order = others.slice();
      order.splice(insertAt, 0, log);
      let echoes = emptyEchoes();
      for (const l of order) echoes = storeEcho(echoes, l);
      const entry = echoes.find((e) => e.log === log);
      assert.ok(entry, 'recorded log is stored by reference');

      // Replay on the same Course with a different Player input. Step through
      // Player death or clear too: Echoes keep replaying regardless.
      let state = createRunState(course, echoes);
      const endTick = last + 1 + EXTRA_TICKS;
      for (;;) {
        const i = state.tick;
        const echo = state.echoes.find((e) => e.log === log);
        if (i <= last) {
          assert.ok(echo, 'Echo present at Tick ' + i + ' (last Tick ' + last + ')');
          const want = run.snapshots[i];
          if (echo.x !== want.x || echo.y !== want.y || echo.vy !== want.vy) {
            assert.fail(
              'Echo diverged at Tick ' + i + ': got ' + JSON.stringify({ x: echo.x, y: echo.y, vy: echo.vy }) +
                ', recorded ' + JSON.stringify(want)
            );
          }
          assert.equal(echo.tintIndex, entry.tintIndex, 'tint stays stable');
        } else {
          assert.equal(echo, undefined, 'Echo absent at Tick ' + i + ' (last Tick ' + last + ')');
        }
        if (i >= endTick) break;
        state = stepSimulation(course, state, replayInput[i] === true).state;
      }
      return true;
    }
  );

  // Guard against a generator that mostly produces zero-length Runs.
  if (total >= 100) {
    assert.ok(recorded / total >= 0.8, 'only ' + recorded + '/' + total + ' Runs produced a log');
  }
});
