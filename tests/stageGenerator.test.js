/*
 * Ghostly Echoes - tests/stageGenerator.test.js
 * Stage_Generator unit and property tests.
 *   Difficulty table and steering examples   (task 6.6)
 *   Property 7: Solvability                  (task 6.8, appended below)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/load.js');

const C = core.constants;
const SG = core.stageGenerator;
const { difficulty, steer, generateStage } = SG;
const { stepGhost, hitbox, outOfCourse } = core.physics;

const FP = C.FP;
const LIMIT_STAGE = 20; // difficulty index reaches its limit here (k = 19)
const MAX_CHECKED_STAGE = 100;

// ---------------------------------------------------------------------------
// Shared helpers (also usable by later appended tests)
// ---------------------------------------------------------------------------

// Tick-0 Ghost state (FP units).
function startGhost() {
  return { x: C.PLAYER_START_X * FP, y: C.PLAYER_START_Y * FP, vy: 0 };
}

// Passage-target clamp range (px) for a gap, as in the design:
// [gapPx/2 + 16, COURSE_H - gapPx/2 - 16].
function clampRange(gapPx) {
  const half = Math.ceil(gapPx / 2);
  return { lo: half + 16, hi: C.COURSE_H - half - 16 };
}

// ---------------------------------------------------------------------------
// Difficulty table (9.7, 9.11)
// ---------------------------------------------------------------------------

test('difficulty: gap and spacing non-increasing, Hazard rate and gate count non-decreasing', () => {
  let prev = difficulty(1);
  for (let s = 2; s <= MAX_CHECKED_STAGE; s++) {
    const d = difficulty(s);
    assert.ok(d.gapPx <= prev.gapPx, 'gapPx increases at Stage ' + s);
    assert.ok(d.spacingPx <= prev.spacingPx, 'spacingPx increases at Stage ' + s);
    assert.ok(d.hazardPerMille >= prev.hazardPerMille, 'hazardPerMille decreases at Stage ' + s);
    assert.ok(d.gateCount >= prev.gateCount, 'gateCount decreases at Stage ' + s);
    prev = d;
  }
});

test('difficulty: Stage 1 and Stage 20 values match the design table', () => {
  assert.deepEqual({ ...difficulty(1) }, { gapPx: 200, spacingPx: 520, hazardPerMille: 0, gateCount: 1 });
  assert.deepEqual({ ...difficulty(LIMIT_STAGE) }, { gapPx: 120, spacingPx: 380, hazardPerMille: 600, gateCount: 3 });
});

test('difficulty: fixed from Stage 20 on', () => {
  const limit = difficulty(LIMIT_STAGE);
  for (let s = LIMIT_STAGE; s <= MAX_CHECKED_STAGE; s++) {
    assert.deepEqual({ ...difficulty(s) }, { ...limit }, 'difficulty changes at Stage ' + s);
  }
  assert.deepEqual({ ...difficulty(10000) }, { ...limit });
});

test('difficulty: gap never below 2 x PLAYER_H and gate count within 1..3', () => {
  for (let s = 1; s <= MAX_CHECKED_STAGE; s++) {
    const d = difficulty(s);
    assert.ok(d.gapPx >= 2 * C.PLAYER_H, 'gapPx below 2 x PLAYER_H at Stage ' + s);
    assert.ok(d.gateCount >= 1 && d.gateCount <= 3, 'gateCount outside 1..3 at Stage ' + s);
  }
});

test('Stage 1 has exactly 1 gate', () => {
  assert.equal(difficulty(1).gateCount, 1);
  const course = generateStage(1);
  assert.equal(course.gates.length, 1);
  assert.equal(course.runes.length, 1);
});

// ---------------------------------------------------------------------------
// Steering controller hover band (design step 4)
// ---------------------------------------------------------------------------

const SETTLE_TICKS = 300;
const WINDOW_TICKS = 600;
const BAND_LO_PX = -30;
const BAND_HI_PX = 26;

test('steer: steady-state hitbox center stays within -30..+26 px of a flat target', () => {
  // Widest clamp range comes from the smallest gap (Stage 20+): 76..404 px.
  const range = clampRange(difficulty(LIMIT_STAGE).gapPx);
  assert.deepEqual(range, { lo: 76, hi: 404 });

  for (let target = range.lo; target <= range.hi; target++) {
    let g = startGhost();
    let minOff = Infinity;
    let maxOff = -Infinity;
    for (let t = 0; t < SETTLE_TICKS + WINDOW_TICKS; t++) {
      g = stepGhost(g, steer(g, target));
      assert.ok(!outOfCourse(hitbox(g)), 'target ' + target + ': Ghost leaves the Course at Tick ' + t);
      if (t >= SETTLE_TICKS) {
        // Offset of the hitbox center from the target, in px (exact rational).
        const off = (g.y + (C.PLAYER_H * FP) / 2) / FP - target;
        if (off < minOff) minOff = off;
        if (off > maxOff) maxOff = off;
      }
    }
    assert.ok(
      minOff >= BAND_LO_PX && maxOff <= BAND_HI_PX,
      'target ' + target + ': hover band ' + minOff + '..' + maxOff + ' px outside ' + BAND_LO_PX + '..' + BAND_HI_PX
    );
  }
});

// ---------------------------------------------------------------------------
// Property 7: Solvability (task 6.8)
// ---------------------------------------------------------------------------

// Feature: ghostly-echoes, Property 7: Solvability
// **Validates: Requirements 9.10, 9.9, 9.8, 1.5**
// Exhaustive over Stages 1-50 (no random cases): the Solution_Witness clears
// each generated Stage, every Echo witness survives through its last Tick
// with the earlier Echoes present, and witness replays are deterministic.
const { replayHeadless } = core.simulation;
const SOLVABILITY_STAGES = 50;

test('Property 7: Solvability - witness replays clear Stages 1-50 with no death', () => {
  for (let stage = 1; stage <= SOLVABILITY_STAGES; stage++) {
    const where = 'Stage ' + stage;
    const course = generateStage(stage);
    const { player, echoes } = course.witness;

    // 9.8: 1-3 Echo witness logs (one per Rune_Gate).
    assert.ok(Array.isArray(echoes) && echoes.length >= 1 && echoes.length <= 3, where + ': Echo witness count ' + echoes.length);
    assert.equal(echoes.length, course.gates.length, where + ': Echo witness count differs from gate count');
    assert.ok(player.length > 0, where + ': empty Player witness log');

    // 9.10: Player witness with all Echo witnesses clears with no death.
    const res = replayHeadless(course, player, echoes, { maxTicks: player.length });
    assert.equal(res.deathTick, null, where + ': Player witness dies at Tick ' + res.deathTick);
    assert.equal(res.outcome, 'cleared', where + ': Player witness outcome ' + res.outcome);
    assert.equal(typeof res.clearTick, 'number', where + ': no clear Tick');

    // Each Echo log is no longer than the Ticks to the Finish_Line.
    const ticksToFinish = res.clearTick + 1;
    echoes.forEach((log, k) => {
      assert.ok(log.length > 0, where + ': Echo witness ' + k + ' is empty');
      assert.ok(
        log.length <= ticksToFinish,
        where + ': Echo witness ' + k + ' has ' + log.length + ' Ticks, Finish needs ' + ticksToFinish
      );
    });

    // 9.9: Echo k played as the Player with Echoes 0..k-1 survives all its Ticks.
    echoes.forEach((log, k) => {
      const r = replayHeadless(course, log, echoes.slice(0, k), { maxTicks: log.length });
      assert.equal(r.deathTick, null, where + ': Echo witness ' + k + ' as Player dies at Tick ' + r.deathTick);
      assert.equal(r.states.length, log.length, where + ': Echo witness ' + k + ' stopped after ' + r.states.length + ' of ' + log.length + ' Ticks');
      assert.ok(r.states[r.states.length - 1].player.alive, where + ': Echo witness ' + k + ' not alive at its last Tick');
    });

    // 1.5: a second replay on independent copies is deep-equal at every Tick.
    const again = replayHeadless(structuredClone(course), structuredClone(player), structuredClone(echoes), {
      maxTicks: player.length
    });
    assert.deepEqual(again.initialState, res.initialState, where + ': initial states differ');
    assert.equal(again.states.length, res.states.length, where + ': state sequence lengths differ');
    for (let i = 0; i < res.states.length; i++) {
      assert.deepEqual(again.states[i], res.states[i], where + ': states differ at Tick ' + i);
    }
    assert.equal(again.outcome, res.outcome, where + ': outcomes differ');
    assert.equal(again.deathTick, res.deathTick, where + ': death Ticks differ');
    assert.equal(again.clearTick, res.clearTick, where + ': clear Ticks differ');
  }
});
