/*
 * Ghostly Echoes - tests/generatorSmoke.test.js
 * Generator smoke test (task 6.10, not a requirement-level property):
 * Stages 1-300 generate and self-check without throwing, the Rune/Rune_Gate
 * placement invariants hold on the placed geometry, and gate count is 1..3.
 *
 * Requirements: 9.2, 9.11, 9.12
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/load.js');
const { runeGateViolations } = require('./helpers/property.js');

const C = core.constants;
const { generateStage, selfCheck, difficulty } = core.stageGenerator;

const FP = C.FP;
const FIRST_STAGE = 1;
const LAST_STAGE = 300;
const MIN_PASSAGE_FP = 2 * C.PLAYER_H * FP;

// Independent check of the placement invariants (does not use
// checkRunePlacement). Throws an AssertionError naming the Stage.
function assertPlacementInvariants(stage, course) {
  const where = 'Stage ' + stage + ': ';
  const runes = course.runes;
  const gates = course.gates;

  // Gate count 1..3 and equal to the difficulty table (9.11).
  const expected = difficulty(stage).gateCount;
  assert.ok(gates.length >= 1 && gates.length <= 3, where + 'gate count ' + gates.length + ' outside 1..3');
  assert.equal(gates.length, expected, where + 'gate count differs from difficulty(stage).gateCount');

  // 1:1 pairing (6.1, 9.12).
  assert.equal(runes.length, gates.length, where + 'Rune/Rune_Gate pairing is not 1:1');

  for (let k = 0; k < gates.length; k++) {
    const rune = runes[k];
    const gate = gates[k];
    const pair = where + 'pair ' + k + ': ';

    assert.equal(gate.styleIndex, k, pair + 'styleIndex must equal the pair index');

    // Explicit 6.1 checks.
    assert.ok(rune.r < gate.rect.l, pair + 'rune right must be < gate left');
    assert.ok(gate.rect.l - rune.r >= C.RUNE_GAP_MIN * FP, pair + 'gate left - rune right must be >= RUNE_GAP_MIN');
    assert.ok(
      gate.rect.r - rune.r <= C.GATE_HOLD_TICKS * course.scrollSpeed,
      pair + 'gate right - rune right must be <= 30 x scroll speed'
    );

    // Same rules plus the strict opposite-half rule via the shared helper.
    const violations = runeGateViolations(rune, gate, course.scrollSpeed);
    assert.deepEqual(violations, [], pair + violations.join('; '));

    // Passage height (9.11).
    assert.ok(
      gate.passage.b - gate.passage.t >= MIN_PASSAGE_FP,
      pair + 'gate passage shorter than 2 x PLAYER_H'
    );
  }
}

test('generator smoke: Stages 1-300 generate, self-check and satisfy placement invariants', () => {
  for (let stage = FIRST_STAGE; stage <= LAST_STAGE; stage++) {
    let course;
    try {
      course = generateStage(stage);
    } catch (err) {
      assert.fail('Stage ' + stage + ': generateStage threw: ' + (err && err.message));
    }
    try {
      selfCheck(course);
    } catch (err) {
      assert.fail('Stage ' + stage + ': selfCheck threw: ' + (err && err.message));
    }
    assert.equal(course.stage, stage, 'Stage ' + stage + ': course.stage mismatch');
    assertPlacementInvariants(stage, course);
  }
});
