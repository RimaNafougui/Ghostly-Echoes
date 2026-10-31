/*
 * Ghostly Echoes - tests/simulation.test.js
 * Simulation properties and examples.
 *   Property 1: Determinism (task 4.3)
 * Optional tests (P10 Int32 range, P2 frame-rate independence, examples)
 * can be appended below as separate test() blocks.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/load.js');
const { forAll, genCourse, genInputLog, genEchoLogs } = require('./helpers/property.js');

const { createRunState, stepSimulation } = core.simulation;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Comparable snapshot of a RunState. Echo logs are replaced by their length:
// they are inputs (checked for non-mutation separately) and comparing them
// in full on every Tick would make the test quadratic in the log length.
function snapshot(state) {
  return {
    tick: state.tick,
    player: { x: state.player.x, y: state.player.y, vy: state.player.vy, alive: state.player.alive },
    echoes: state.echoes.map(function (e) {
      return { tintIndex: e.tintIndex, x: e.x, y: e.y, vy: e.vy, logLength: e.log.length };
    }),
    gates: state.gates.map(function (g) {
      return { lastEchoOverlapTick: g.lastEchoOverlapTick, open: g.open };
    }),
    status: state.status,
    deathTick: state.deathTick
  };
}

// Steps the full Input_Log length (continuing after death or clear, so the
// frozen-Player path is exercised) and returns one serialized record per
// Tick plus the snapshots used for diagnostics. Asserts tick += 1 per step.
function runTrace(course, echoLogs, playerLog) {
  let state = createRunState(course, echoLogs);
  const trace = [JSON.stringify(snapshot(state))];
  for (let t = 0; t < playerLog.length; t++) {
    assert.equal(state.tick, t, 'tick before step ' + t);
    const res = stepSimulation(course, state, playerLog[t] === true);
    assert.equal(res.state.tick, state.tick + 1, 'tick must increase by exactly 1 at step ' + t);
    state = res.state;
    trace.push(JSON.stringify({ state: snapshot(state), events: res.events }));
  }
  return trace;
}

// Open course: no walls, Hazards or gates, so random Runs only die at the
// top/bottom edges and long Runs are exercised too.
function openCourse(course) {
  return Object.assign({}, course, { walls: [], hazards: [], runes: [], gates: [] });
}

// ---------------------------------------------------------------------------
// Property 1: Determinism
// ---------------------------------------------------------------------------

// Feature: ghostly-echoes, Property 1: Determinism
// **Validates: Requirements 1.5, 1.1, 1.3, 2.8**
test('Property 1: Determinism - identical inputs give identical state sequences', () => {
  forAll(
    'Property 1: Determinism',
    { cases: 500 },
    (rng) => {
      const base = genCourse(rng);
      const course = rng.nextInt(0, 3) === 0 ? openCourse(base) : base;
      return { course: course, echoLogs: genEchoLogs(rng), playerLog: genInputLog(rng) };
    },
    ({ course, echoLogs, playerLog }) => {
      // Run 2 uses independent deep copies, so shared references cannot
      // hide non-determinism.
      const courseCopy = structuredClone(course);
      const echoCopy = structuredClone(echoLogs);
      const logCopy = structuredClone(playerLog);

      const a = runTrace(course, echoLogs, playerLog);
      const b = runTrace(courseCopy, echoCopy, logCopy);

      assert.equal(a.length, playerLog.length + 1);
      assert.equal(b.length, a.length);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          assert.deepStrictEqual(JSON.parse(b[i]), JSON.parse(a[i]), 'runs diverge at trace index ' + i);
        }
      }

      // Inputs are never mutated by the Simulation.
      assert.deepStrictEqual(course, courseCopy);
      assert.deepStrictEqual(echoLogs, echoCopy);
      assert.deepStrictEqual(playerLog, logCopy);
    }
  );
});
