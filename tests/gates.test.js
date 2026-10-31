/*
 * Ghostly Echoes - tests/gates.test.js
 * Rune_Gate timing properties and examples.
 *   Property 5: Gate timing        (task 2.3)
 *   Property 9: Crossing coverage  (task 2.4, appended below)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/load.js');
const { forAll, genRuneGatePair } = require('./helpers/property.js');

const C = core.constants;
const { updateGates, isGateOpen } = core.gates;
const { hitbox, rectsIntersect } = core.physics;

const FP = C.FP;
const HOLD = C.GATE_HOLD_TICKS;
const MAX_TICKS = 3600;

// ---------------------------------------------------------------------------
// Shared helpers (also usable by Property 9)
// ---------------------------------------------------------------------------

// Initial gate state at Tick 0: no Echo overlap yet.
function initialGates(count) {
  const gates = [];
  for (let k = 0; k < count; k++) gates.push({ lastEchoOverlapTick: null, open: false });
  return gates;
}

// Center of a rect in FP units (integer-rounded).
function centerOf(r) {
  return { x: Math.round((r.l + r.r) / 2), y: Math.round((r.t + r.b) / 2) };
}

// Ghost (top-left x/y) whose hitbox center is at (cx, cy).
function ghostAtCenter(cx, cy) {
  return { x: cx - (C.PLAYER_W * FP) / 2, y: cy - (C.PLAYER_H * FP) / 2, vy: 0 };
}

/*
 * Drives the gate state Tick by Tick, as the Simulation does: on Tick t the
 * Echoes still present (t < positions.length) contribute their hitboxes. The
 * Player position is part of the world state for that Tick but, per the
 * per-Tick order, is never passed to updateGates (6.13).
 * Returns the gate state after each Tick: states[t] = gates after Tick t.
 */
function runGates(runes, echoSeqs, playerSeq, ticks) {
  let gates = initialGates(runes.length);
  const states = new Array(ticks);
  for (let t = 0; t < ticks; t++) {
    const echoHitboxes = [];
    for (const seq of echoSeqs) {
      if (t < seq.length) echoHitboxes.push(hitbox(seq[t]));
    }
    // The Player exists on this Tick, but only Echo hitboxes reach the gates.
    void (playerSeq && playerSeq[t]);
    gates = updateGates(gates, runes, echoHitboxes, t);
    states[t] = gates;
  }
  return states;
}

/*
 * Random walk of Ghost positions that hovers around the Runes, so a
 * meaningful fraction of Ticks intersect a Rune. Each Tick moves by a small
 * step; occasionally the walk jumps near a (random) Rune or far away.
 */
function genGhostSeq(rng, runes, length) {
  const seq = new Array(length);
  const near = (r) => {
    const c = centerOf(r);
    return {
      x: c.x + rng.nextInt(-60, 60) * FP,
      y: c.y + rng.nextInt(-60, 60) * FP
    };
  };
  let p = runes.length > 0 ? near(runes[rng.nextInt(0, runes.length - 1)]) : { x: 0, y: 0 };
  for (let t = 0; t < length; t++) {
    const roll = rng.nextInt(0, 999);
    if (roll < 20 && runes.length > 0) {
      p = near(runes[rng.nextInt(0, runes.length - 1)]);
    } else if (roll < 30) {
      p = { x: rng.nextInt(0, 4000) * FP, y: rng.nextInt(-100, 600) * FP };
    } else {
      p = { x: p.x + rng.nextInt(-6, 6) * FP, y: p.y + rng.nextInt(-6, 6) * FP };
    }
    seq[t] = ghostAtCenter(p.x, p.y);
  }
  return seq;
}

// 1..3 Rune/Rune_Gate pairs laid out left to right.
function genRunes(rng) {
  const count = rng.nextInt(1, 3);
  const runes = [];
  let gateLeft = (C.PLAYER_START_X + 200) * FP;
  for (let k = 0; k < count; k++) {
    gateLeft += rng.nextInt(0, 300) * FP;
    const pair = genRuneGatePair(rng, { gateLeft: gateLeft, styleIndex: k });
    runes.push(pair.rune);
    gateLeft = pair.gate.rect.r + (C.RUNE_W + C.RUNE_GAP_MAX) * FP;
  }
  return runes;
}

// ---------------------------------------------------------------------------
// Property 5: Gate timing
// ---------------------------------------------------------------------------

// Feature: ghostly-echoes, Property 5: Gate timing
// **Validates: Requirements 6.8, 6.2, 6.3, 6.4, 6.5, 6.13**
test('Property 5: Gate timing', () => {
  assert.equal(updateGates.length, 4, 'updateGates must take (gates, runes, echoHitboxes, tick) only');

  let overlapTicks = 0;
  let totalTicks = 0;

  forAll(
    'Property 5: Gate timing',
    { cases: 500 },
    (rng) => {
      const runes = genRunes(rng);
      const ticks = rng.nextInt(1, MAX_TICKS);
      const echoCount = rng.nextInt(0, C.MAX_ECHOES);
      const echoSeqs = [];
      for (let i = 0; i < echoCount; i++) {
        // Echoes may end before the Run does (removed after their last Tick).
        echoSeqs.push(genGhostSeq(rng, runes, rng.nextInt(0, ticks)));
      }
      const playerRandom = genGhostSeq(rng, runes, ticks);
      // A Player that sits on a Rune every Tick.
      const playerOnRune = new Array(ticks);
      for (let t = 0; t < ticks; t++) {
        const c = centerOf(runes[t % runes.length]);
        playerOnRune[t] = ghostAtCenter(c.x, c.y);
      }
      return { runes, ticks, echoSeqs, playerRandom, playerOnRune };
    },
    ({ runes, ticks, echoSeqs, playerRandom, playerOnRune }) => {
      // Independent oracle: per gate, prefix counts of Ticks with an Echo-Rune overlap.
      const prefix = runes.map((rune) => {
        const p = new Int32Array(ticks + 1);
        for (let t = 0; t < ticks; t++) {
          let hit = false;
          for (const seq of echoSeqs) {
            if (t < seq.length && rectsIntersect(hitbox(seq[t]), rune)) {
              hit = true;
              break;
            }
          }
          if (hit) overlapTicks++;
          p[t + 1] = p[t] + (hit ? 1 : 0);
        }
        totalTicks += ticks;
        return p;
      });

      const states = runGates(runes, echoSeqs, playerRandom, ticks);

      for (let n = 0; n < ticks; n++) {
        const from = Math.max(0, n - HOLD);
        for (let k = 0; k < runes.length; k++) {
          const expected = prefix[k][n + 1] - prefix[k][from] > 0;
          const gate = states[n][k];
          if (gate.open !== expected) {
            assert.fail(
              'gate ' + k + ' at Tick ' + n + ': open=' + gate.open + ', expected ' + expected +
                ' (lastEchoOverlapTick=' + gate.lastEchoOverlapTick + ')'
            );
          }
          if (isGateOpen(gate, n) !== expected) {
            assert.fail('isGateOpen disagrees with the oracle for gate ' + k + ' at Tick ' + n);
          }
        }
      }

      // Swapping the Player sequence (including one sitting on the Runes)
      // leaves the gate state sequence unchanged.
      assert.deepEqual(runGates(runes, echoSeqs, playerOnRune, ticks), states);
      assert.deepEqual(runGates(runes, echoSeqs, null, ticks), states);
      return true;
    }
  );

  // Sanity: the generator must actually exercise overlaps.
  const ratio = overlapTicks / totalTicks;
  assert.ok(ratio > 0.05, 'Echo-Rune overlap ratio too low: ' + ratio.toFixed(3));
});

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

test('Player alone over a Rune never opens the gate (6.13)', () => {
  const pair = genRuneGatePair(core.rng.createRng(1234));
  const runes = [pair.rune];
  const c = centerOf(pair.rune);
  const player = [];
  for (let t = 0; t < 300; t++) player.push(ghostAtCenter(c.x, c.y));
  assert.ok(rectsIntersect(hitbox(player[0]), pair.rune), 'Player must overlap the Rune');

  const states = runGates(runes, [], player, player.length);
  for (const gates of states) {
    assert.equal(gates[0].open, false);
    assert.equal(gates[0].lastEchoOverlapTick, null);
  }
});

test('gate stays open through last + 30 and closes at last + 31 (6.3)', () => {
  const pair = genRuneGatePair(core.rng.createRng(99));
  const c = centerOf(pair.rune);
  // Echo on the Rune for Ticks 0..4, then gone.
  const echo = [];
  for (let t = 0; t < 5; t++) echo.push(ghostAtCenter(c.x, c.y));
  const states = runGates([pair.rune], [echo], null, 40);
  assert.equal(states[0][0].open, true);
  assert.equal(states[4][0].lastEchoOverlapTick, 4);
  assert.equal(states[4 + HOLD][0].open, true);
  assert.equal(states[4 + HOLD + 1][0].open, false);
});

// ---------------------------------------------------------------------------
// Property 9: Crossing coverage
// ---------------------------------------------------------------------------

/*
 * Builds an Echo path with physics.stepGhost (random flaps) that crosses the
 * Rune and still intersects it on the last Tick its hitbox left edge is
 * <= rune right (horizontal exit Tick E). The log is truncated at the last
 * Rune-overlap Tick, so the Echo is present on Ticks 0..L only.
 *   E      random exit Tick in 0..300
 *   phase  sub-step offset so left(E) <= rune right < left(E + 1)
 *   dy     vertical offset of the Echo center vs the Rune center at E,
 *          within the inclusive contact range
 */
function genCrossingEcho(rng, rune) {
  const S = C.SCROLL_SPEED;
  const exitTick = rng.nextInt(0, 300);
  const phase = rng.nextInt(0, S - 1);
  const x0 = rune.r - exitTick * S - phase;
  const flapPerMille = rng.nextInt(0, 300);

  // Relative path (y0 = 0); shifted vertically afterwards.
  const raw = [];
  // Tick t's state = Ghost after stepping with flap[t], so path[t].x = x0 + t * S.
  let g = { x: x0 - S, y: 0, vy: 0 };
  for (let t = 0; t <= exitTick + 20; t++) {
    g = stepGhost(g, rng.chance(flapPerMille));
    raw.push(g);
  }

  const halfContact = ((C.PLAYER_H + C.RUNE_H) * FP) / 2;
  const dy = rng.nextInt(-halfContact, halfContact);
  const runeCy = (rune.t + rune.b) / 2;
  const echoCyAtE = raw[exitTick].y + (C.PLAYER_H * FP) / 2;
  const shift = Math.round(runeCy + dy - echoCyAtE);
  const path = raw.map((p) => ({ x: p.x, y: p.y + shift, vy: p.vy }));

  // Last Rune-overlap Tick, then truncate the log there.
  let last = -1;
  for (let t = 0; t < path.length; t++) {
    if (rectsIntersect(hitbox(path[t]), rune)) last = t;
  }
  return { x0: x0, exitTick: exitTick, path: last < 0 ? [] : path.slice(0, last + 1), last: last };
}

const { stepGhost } = core.physics;

// Feature: ghostly-echoes, Property 9: Crossing coverage
// **Validates: Requirements 12.7, 6.1, 6.3**
test('Property 9: Crossing coverage', () => {
  const { runeGateViolations } = require('./helpers/property.js');
  let checkedTicks = 0;

  forAll(
    'Property 9: Crossing coverage',
    { cases: 500 },
    (rng) => {
      const pair = genRuneGatePair(rng);
      const echo = genCrossingEcho(rng, pair.rune);
      return { pair, echo };
    },
    ({ pair, echo }) => {
      const { rune, gate } = pair;
      assert.deepEqual(runeGateViolations(rune, gate), [], 'pair must satisfy 6.1');

      // Preconditions: the Echo intersects the Rune and is still on it at its
      // horizontal exit Tick, and the log ends at the last overlap Tick.
      assert.ok(echo.path.length > 0, 'Echo path must intersect the Rune');
      const lastBox = hitbox(echo.path[echo.path.length - 1]);
      assert.ok(rectsIntersect(lastBox, rune));
      assert.ok(echo.last >= echo.exitTick, 'Echo must stay on the Rune until it leaves horizontally');

      // Run long enough for the Player to pass the gate completely.
      const S = C.SCROLL_SPEED;
      const ticks = Math.ceil((gate.rect.r - (echo.x0 - S)) / S) + 2;
      const states = runGates([rune], [echo.path], null, ticks);

      for (let t = 0; t < ticks; t++) {
        // Player at the same x as the Echo (same start x, same scroll speed),
        // vertically aligned with the gate passage.
        const px = echo.x0 + t * S;
        const playerBox = hitbox({ x: px, y: gate.passage.t, vy: 0 });
        if (!rectsIntersect(playerBox, gate.rect)) continue;
        checkedTicks++;
        if (!states[t][0].open) {
          assert.fail(
            'gate closed at Tick ' + t + ' while the Player overlaps it ' +
              '(lastEchoOverlapTick=' + states[t][0].lastEchoOverlapTick + ', echo last=' + echo.last + ')'
          );
        }
      }
      return true;
    }
  );

  assert.ok(checkedTicks > 0, 'no Player-gate overlap Ticks were checked');
});
