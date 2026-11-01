/*
 * Ghostly Echoes - stageGenerator.js
 * Construction-based, deterministic Stage generation (9.5 to 9.12, A7, A15).
 *   difficulty        per-Stage parameters, monotone, fixed from Stage 20 on
 *   GeneratorError    Error with { stage, seed, reason }
 *   generateStage     pipeline entry point: seed -> rng -> params -> skeleton
 *                     -> Player witness -> Echo witnesses -> placement ->
 *                     selfCheck
 *
 * Pipeline (design order, 9.8): witness inputs are chosen and simulated
 * before any geometry exists.
 *   1. resolveSetup         seed, rng, params                    (task 6.1)
 *   2. buildSkeleton        x-only columns, targets, finishX     (task 6.2)
 *   3. buildPlayerWitness   steering controller Player log       (task 6.2)
 *   4. buildEchoWitnesses   Echo logs, Rune placement, truncate  (task 6.3)
 *   5. placeGeometry        walls, gates, Hazards, Course object (task 6.4)
 *   6. selfCheck            replay + placement checks            (task 6.5)
 *      - gate count 1..3 and equal to params.gateCount
 *      - every gate and walled-column passage >= 2 x PLAYER_H
 *      - checkRunePlacement: 1:1 pairing, rune right < gate left,
 *        gate right - rune right <= 30 x scroll speed,
 *        gate left - rune right >= RUNE_GAP_MIN, opposite vertical halves
 *      - every witness log starts with a Flap on Tick 0 (8.9)
 *      - witness replay clears with no death
 *      - Echo k as the Player with Echoes 0..k-1 survives its whole log
 * selfCheck throws GeneratorError on failure. There is no candidate retry
 * loop; recovery lives in game.js.
 *
 * All randomness comes from the seeded rng (rng.js). Integer math only.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.stageGenerator)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? {
        constants: require('./constants.js'),
        rng: require('./rng.js'),
        physics: require('./physics.js'),
        simulation: require('./simulation.js')
      }
    : { constants: ns.constants, rng: ns.rng, physics: ns.physics, simulation: ns.simulation };
  var api = factory(deps);
  ns.stageGenerator = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var stageSeed = deps.rng.stageSeed;
  var createRng = deps.rng.createRng;

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------

  // Thrown by generation and selfCheck. game.js catches it and recovers.
  class GeneratorError extends Error {
    constructor(stage, seed, reason) {
      super('[GhostlyEchoes] stage ' + stage + ' seed ' + seed + ': ' + reason);
      this.name = 'GeneratorError';
      this.stage = stage;
      this.seed = seed;
      this.reason = reason;
    }
  }

  // ---------------------------------------------------------------------
  // Difficulty table (9.7, 9.11, A7)
  // ---------------------------------------------------------------------

  var DIFFICULTY_STEPS = 19; // k reaches its limit at Stage 20

  // Integer lerp: a + trunc((b - a) * k / 19). Truncation is toward zero,
  // so decreasing parameters round up toward a (never below the limit b).
  function lerp(a, b, k) {
    return a + Math.trunc(((b - a) * k) / DIFFICULTY_STEPS);
  }

  function difficultyIndex(stage) {
    return Math.min(stage - 1, DIFFICULTY_STEPS);
  }

  // Stage 1: gap 200, spacing 520, Hazards 0, 1 gate.
  // Stage 20+: gap 120 (>= 2 x PLAYER_H), spacing 380, Hazards 600, 3 gates.
  // gateCount: Stages 1-7 -> 1, 8-13 -> 2, 14+ -> 3.
  function difficulty(stage) {
    var k = difficultyIndex(stage);
    return Object.freeze({
      gapPx: lerp(200, 120, k),
      spacingPx: lerp(520, 380, k),
      hazardPerMille: lerp(0, 600, k),
      gateCount: Math.min(3, 1 + Math.trunc((2 * k) / 13))
    });
  }

  // ---------------------------------------------------------------------
  // Pipeline step 1: seed, rng, params (9.5)
  // ---------------------------------------------------------------------

  function isValidStage(stage) {
    return typeof stage === 'number' && Number.isInteger(stage) && stage >= 1;
  }

  // params = paramsOverride ?? difficulty(stage); gateCount always comes
  // from difficulty(stage), so recovery never drops Rune_Gates.
  // Fields missing from a partial override fall back to difficulty(stage).
  function resolveParams(stage, override) {
    var base = difficulty(stage);
    var src = override === undefined || override === null ? base : override;
    return Object.freeze({
      gapPx: src.gapPx === undefined ? base.gapPx : src.gapPx,
      spacingPx: src.spacingPx === undefined ? base.spacingPx : src.spacingPx,
      hazardPerMille: src.hazardPerMille === undefined ? base.hazardPerMille : src.hazardPerMille,
      gateCount: base.gateCount
    });
  }

  function resolveSetup(stage, opts) {
    var o = opts || {};
    var seedSalt = o.seedSalt === undefined || o.seedSalt === null ? 0 : o.seedSalt >>> 0;
    if (!isValidStage(stage)) {
      throw new GeneratorError(stage, null, 'invalid stage number');
    }
    var seed = stageSeed(C.BASE_SEED, stage, seedSalt);
    return {
      stage: stage,
      seed: seed,
      seedSalt: seedSalt,
      rng: createRng(seed),
      params: resolveParams(stage, o.paramsOverride)
    };
  }

  // ---------------------------------------------------------------------
  // Pipeline step 2: x-only skeleton and targets (task 6.2, design 2-3)
  // ---------------------------------------------------------------------

  var FP = C.FP;
  var H = C.COURSE_H;
  var MIDLINE = H / 2; // 240 px
  var HALF_PLAYER_H = C.PLAYER_H / 2; // 16 px
  var TARGET_EDGE_PAD = 16; // passage targets stay gapPx/2 + 16 px from the edges
  var RUNE_TARGET_UPPER = Object.freeze({ lo: 80, hi: 140 });
  var RUNE_TARGET_LOWER = Object.freeze({ lo: 340, hi: 400 });
  var REGULAR_PER_GATE = 2;
  var TRAILING_COLUMNS = 2;

  // Clamp range for passage targets cy (px): [gapPx/2 + 16, H - gapPx/2 - 16].
  function targetRange(gapPx) {
    var halfGap = Math.ceil(gapPx / 2);
    return { lo: halfGap + TARGET_EDGE_PAD, hi: H - halfGap - TARGET_EDGE_PAD };
  }

  // Gate cy range for a half: the clamp range intersected with
  // "at least MIDLINE_CLEARANCE_PX from the midline" on that side.
  // gapPx = 200 -> upper 116..140, lower 340..364.
  function gateTargetRange(range, half) {
    return half === 'upper'
      ? { lo: range.lo, hi: Math.min(range.hi, MIDLINE - C.MIDLINE_CLEARANCE_PX) }
      : { lo: Math.max(range.lo, MIDLINE + C.MIDLINE_CLEARANCE_PX), hi: range.hi };
  }

  function makeColumn(kind, leftPx, widthPx, targetPx, gateIndex) {
    return Object.freeze({
      kind: kind, // 'regular' | 'gate'
      leftPx: leftPx,
      rightPx: leftPx + widthPx,
      left: leftPx * FP,
      right: (leftPx + widthPx) * FP,
      targetPx: targetPx, // passage target cy (px)
      gateIndex: gateIndex // null for regular columns
    });
  }

  // Layout (px), spacingPx is the clear gap between consecutive columns:
  //   x0 = PLAYER_START_X + RUNWAY_PX
  //   per gate k: regular, spacing, regular, APPROACH_PX, gate column, spacing
  //   then 2 trailing regular columns; finishX = last right + FINISH_MARGIN_PX
  // RNG order, walking the columns left to right:
  //   regular column -> nextInt(cy range)
  //   gate column    -> nextInt(0, 1) half, nextInt(gate cy range), nextInt(Rune target range)
  function buildSkeleton(setup) {
    var rng = setup.rng;
    var params = setup.params;
    var range = targetRange(params.gapPx);
    var columns = [];
    var gates = [];
    var cursor = C.PLAYER_START_X + C.RUNWAY_PX;

    function addRegular() {
      var cy = rng.nextInt(range.lo, range.hi);
      columns.push(makeColumn('regular', cursor, C.WALL_W, cy, null));
      cursor += C.WALL_W + params.spacingPx;
    }

    for (var k = 0; k < params.gateCount; k++) {
      for (var i = 0; i < REGULAR_PER_GATE; i++) addRegular();
      // Undo the spacing after the last regular column: the approach zone
      // replaces it.
      cursor -= params.spacingPx;
      var lastRegularIndex = columns.length - 1;
      var approachLeftPx = cursor;
      var approachRightPx = cursor + C.APPROACH_PX;
      cursor = approachRightPx;

      var half = rng.nextInt(0, 1) === 0 ? 'upper' : 'lower';
      var gRange = gateTargetRange(range, half);
      var cy = rng.nextInt(gRange.lo, gRange.hi);
      var rRange = half === 'upper' ? RUNE_TARGET_LOWER : RUNE_TARGET_UPPER;
      var ry = rng.nextInt(rRange.lo, rRange.hi);

      var columnIndex = columns.length;
      columns.push(makeColumn('gate', cursor, C.GATE_W, cy, k));
      gates.push(
        Object.freeze({
          index: k,
          columnIndex: columnIndex,
          lastRegularColumnIndex: lastRegularIndex,
          half: half, // half of the gate passage target
          cyPx: cy,
          runeTargetPx: ry, // ry_k, opposite half
          approachLeft: approachLeftPx * FP,
          approachRight: approachRightPx * FP,
          gateLeft: cursor * FP,
          gateRight: (cursor + C.GATE_W) * FP
        })
      );
      cursor += C.GATE_W + params.spacingPx;
    }

    for (var j = 0; j < TRAILING_COLUMNS; j++) addRegular();
    cursor -= params.spacingPx;

    var finishXPx = cursor + C.FINISH_MARGIN_PX; // cursor = last column right
    return Object.freeze({
      columns: Object.freeze(columns),
      gates: Object.freeze(gates),
      approachZones: Object.freeze(
        gates.map(function (g) {
          return Object.freeze({ l: g.approachLeft, r: g.approachRight, gateIndex: g.index });
        })
      ),
      targetRange: Object.freeze(range),
      finishXPx: finishXPx,
      finishX: finishXPx * FP
    });
  }

  // ---------------------------------------------------------------------
  // Steering controller (design 4)
  // ---------------------------------------------------------------------

  // Flap iff the hitbox center predicted 8 Ticks ahead is below the target
  // plus STEER_BIAS. g in FP units, targetY in px.
  function steer(g, targetY) {
    return g.y + HALF_PLAYER_H * FP + 8 * g.vy > (targetY + C.STEER_BIAS) * FP;
  }

  // Index of the column whose target is active: the first column whose right
  // edge the hitbox left edge has not passed yet (the last column once all
  // are passed). `from` is a monotone cursor so lookups are O(1) amortized.
  function activeColumnIndex(columns, ghostX, from) {
    var i = from;
    while (i < columns.length - 1 && ghostX > columns[i].right) i++;
    return i;
  }

  // Runs the controller from state `start` at Tick `startTick` and records
  // flaps until x >= stopX. targetAt(ghost, tick) gives the target (px).
  // Returns { log, states } where states[t] is the Ghost after Tick t.
  function runController(start, stopX, targetAt) {
    var log = [];
    var states = [];
    var g = start;
    var t = 0;
    while (g.x < stopX) {
      var flap = steer(g, targetAt(g, t));
      g = deps.physics.stepGhost(g, flap);
      log.push(flap);
      states.push(Object.freeze(g));
      t++;
    }
    return { log: log, states: states };
  }

  // ---------------------------------------------------------------------
  // Pipeline step 3: Player witness (design 5)
  // ---------------------------------------------------------------------

  // The Player witness flaps on Tick 0, as every real Run does (8.9: the
  // first Flap starts the Run and is applied on Tick 0). From Tick 1 on it
  // steers to the cy of the next column ahead until x >= finishX. No
  // geometry exists yet.
  function buildPlayerWitness(setup, skeleton) {
    var columns = skeleton.columns;
    var cursor = 0;
    var start = Object.freeze({ x: C.PLAYER_START_X * FP, y: C.PLAYER_START_Y * FP, vy: 0 });
    var first = Object.freeze(deps.physics.stepGhost(start, true));
    var run = runController(first, skeleton.finishX, function (g) {
      cursor = activeColumnIndex(columns, g.x, cursor);
      return columns[cursor].targetPx;
    });
    return Object.freeze({
      log: Object.freeze([true].concat(run.log)),
      start: start,
      states: Object.freeze([first].concat(run.states)) // states[t] = Player Ghost after Tick t
    });
  }

  // ---------------------------------------------------------------------
  // Pipeline step 4: Echo witnesses (design 6, A15, A18)
  // ---------------------------------------------------------------------

  var PLAYER_W_FP = C.PLAYER_W * FP;
  var PLAYER_H_FP = C.PLAYER_H * FP;
  var RUNE_W_FP = C.RUNE_W * FP;
  var RUNE_H_FP = C.RUNE_H * FP;
  var COURSE_H_FP = H * FP;
  var MIDLINE_FP = MIDLINE * FP;
  // At the exit Tick the Rune center is moved to within this distance of the
  // Echo hitbox center (design: "at most 31 px from it"), so the two overlap
  // by at least 1 px vertically.
  var EXIT_SHIFT_MAX_FP = 31 * FP;

  function runeRect(leftFp, topFp) {
    return Object.freeze({ l: leftFp, t: topFp, r: leftFp + RUNE_W_FP, b: topFp + RUNE_H_FP });
  }

  // Ghost state just before Tick t (the state the controller sees at Tick t).
  function preTickState(witness, t) {
    return t === 0 ? witness.start : witness.states[t - 1];
  }

  // Divergence Tick D_k: the first Tick whose pre-Tick hitbox left edge has
  // passed (is strictly right of) the right edge of the last regular column
  // before gate k's approach zone. This is the same test activeColumnIndex
  // uses, so on [0, D_k) the Echo and Player controllers see identical
  // targets and the Echo log equals the Player log there.
  function divergenceTick(playerWitness, columnRight) {
    var n = playerWitness.log.length;
    for (var t = 0; t < n; t++) {
      if (preTickState(playerWitness, t).x > columnRight) return t;
    }
    return -1;
  }

  function verticalOverlap(a, b) {
    return a.t <= b.b && b.t <= a.b;
  }

  // Echo witness k:
  //   1. runeGap = rng.nextInt(RUNE_GAP_MIN, RUNE_GAP_MAX) (one draw per gate,
  //      in gate order; the only RNG use in this step)
  //   2. Echo = Player prefix on [0, D_k), then steer to ry_k until its
  //      hitbox left edge is past runeRight
  //   3. c_k: first Tick with Echo hitbox center x >= Rune center x; the Rune
  //      is centered vertically on the Echo hitbox center at c_k
  //   4. E_k: last Tick with Echo hitbox left <= runeRight; if the Echo does
  //      not vertically intersect the Rune there, move the Rune center to
  //      within 31 px of the Echo center (minimal shift toward it)
  //   5. L_k: last Tick the Echo hitbox intersects the placed Rune; the log
  //      and states are truncated to L_k + 1 entries ("press R once past")
  function buildEchoWitness(setup, skeleton, playerWitness, gate) {
    var physics = deps.physics;
    var fail = function (reason) {
      return new GeneratorError(setup.stage, setup.seed, 'echo ' + gate.index + ': ' + reason);
    };

    // 1. Rune x first.
    var runeGapPx = setup.rng.nextInt(C.RUNE_GAP_MIN, C.RUNE_GAP_MAX);
    var runeRight = gate.gateLeft - runeGapPx * FP;
    var runeLeft = runeRight - RUNE_W_FP;

    // 2. Simulate: shared prefix, then steer to ry_k.
    var lastRegular = skeleton.columns[gate.lastRegularColumnIndex];
    var D = divergenceTick(playerWitness, lastRegular.right);
    if (D < 0) throw fail('divergence Tick not found');
    // The shared prefix must include Tick 0, so the Echo log starts with the
    // Player witness's Tick-0 Flap (8.9).
    if (D < 1) throw fail('divergence Tick before Tick 1');
    if (preTickState(playerWitness, D).x > runeRight) throw fail('divergence after Rune');

    var ry = gate.runeTargetPx;
    var tail = runController(preTickState(playerWitness, D), runeRight + 1, function () {
      return ry;
    });
    var log = playerWitness.log.slice(0, D).concat(tail.log);
    var states = playerWitness.states.slice(0, D).concat(tail.states);

    // 3. Crossing Tick c_k: hitbox center x >= Rune center x, i.e. x >= runeLeft
    //    (both are PLAYER_W = RUNE_W wide).
    var c = -1;
    for (var t = D; t < states.length; t++) {
      if (states[t].x + PLAYER_W_FP / 2 >= runeLeft + RUNE_W_FP / 2) {
        c = t;
        break;
      }
    }
    if (c < 0) throw fail('crossing Tick not found');
    var echoCenterC = states[c].y + PLAYER_H_FP / 2;
    var runeTop = echoCenterC - RUNE_H_FP / 2;

    // 4. Exit Tick E_k and refinement. The simulation stops on the first
    //    state with x > runeRight, so E_k is the state before it.
    var E = states.length - 2;
    if (E < c || states[E].x > runeRight) throw fail('exit Tick not found');
    var echoAtE = physics.hitbox(states[E]);
    var rune = runeRect(runeLeft, runeTop);
    if (!verticalOverlap(echoAtE, rune)) {
      var echoCenterE = states[E].y + PLAYER_H_FP / 2;
      var runeCenter = runeTop + RUNE_H_FP / 2;
      runeCenter = runeCenter > echoCenterE
        ? echoCenterE + EXIT_SHIFT_MAX_FP
        : echoCenterE - EXIT_SHIFT_MAX_FP;
      runeTop = runeCenter - RUNE_H_FP / 2;
    }
    // Keep the Rune fully inside the Course vertically. The Echo is inside
    // the Course, so clamping only moves the Rune toward it.
    runeTop = Math.max(0, Math.min(COURSE_H_FP - RUNE_H_FP, runeTop));
    rune = runeRect(runeLeft, runeTop);
    if (!physics.rectsIntersect(echoAtE, rune)) throw fail('Echo misses Rune at exit Tick');

    // Opposite-half rule (6.1) against the gate passage target half.
    var runeCenterY = rune.t + RUNE_H_FP / 2;
    var opposite = gate.half === 'upper' ? runeCenterY > MIDLINE_FP : runeCenterY < MIDLINE_FP;
    if (!opposite) throw fail('Rune center not in the opposite half of the gate');

    // 5. Last Rune-overlap Tick L_k and truncation.
    var L = -1;
    for (var u = 0; u < states.length; u++) {
      if (physics.rectsIntersect(physics.hitbox(states[u]), rune)) L = u;
    }
    if (L < E) throw fail('last Rune overlap before exit Tick');
    for (var v = 0; v <= L; v++) {
      if (physics.outOfCourse(physics.hitbox(states[v]))) throw fail('Echo leaves the Course at Tick ' + v);
    }

    return Object.freeze({
      index: gate.index,
      log: Object.freeze(log.slice(0, L + 1)),
      states: Object.freeze(states.slice(0, L + 1)),
      D: D,
      c: c,
      E: E,
      L: L,
      runeGapPx: runeGapPx,
      rune: rune
    });
  }

  // Returns { echoes, runes } in gate order; runes[k] is linked to gate k.
  function buildEchoWitnesses(setup, skeleton, playerWitness) {
    var echoes = skeleton.gates.map(function (gate) {
      return buildEchoWitness(setup, skeleton, playerWitness, gate);
    });
    return Object.freeze({
      echoes: Object.freeze(echoes),
      runes: Object.freeze(
        echoes.map(function (e) {
          return e.rune;
        })
      )
    });
  }

  // ---------------------------------------------------------------------
  // Pipeline step 5: geometry placement (task 6.4, design 7)
  // ---------------------------------------------------------------------

  var PASSAGE_PAD_FP = C.PASSAGE_PAD * FP;
  var HAZARD_FP = C.HAZARD_SIZE * FP;
  var HAZARD_STEP_FP = 4 * FP; // y scan step
  var HAZARD_MIN_CLEARANCE_FP = 16 * FP;

  function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.getOwnPropertyNames(value).forEach(function (key) {
        deepFreeze(value[key]);
      });
      Object.freeze(value);
    }
    return value;
  }

  // Hitboxes of every alive witness Ghost after each simulated Tick: the
  // Player witness for its whole log, and each Echo witness for its kept
  // prefix [0, L_k] (it is removed after L_k). Collision checks happen on
  // post-step states, so these are exactly the boxes the Simulation tests.
  function aliveWitnessHitboxes(playerWitness, echoWitnesses) {
    var boxes = [];
    var hitbox = deps.physics.hitbox;
    var i;
    for (i = 0; i < playerWitness.states.length; i++) boxes.push(hitbox(playerWitness.states[i]));
    echoWitnesses.echoes.forEach(function (e) {
      for (var j = 0; j < e.states.length; j++) boxes.push(hitbox(e.states[j]));
    });
    return boxes;
  }

  // Inclusive horizontal overlap with the x-span [l, r].
  function boxesInXSpan(boxes, l, r) {
    return boxes.filter(function (h) {
      return h.l <= r && l <= h.r;
    });
  }

  // Passage { t, b } (FP) for a column: witness extents padded by
  // PASSAGE_PAD, widened symmetrically to >= gapPx, then shifted (not
  // shrunk) into [0, COURSE_H]. Walls are [0, t] above and [b, COURSE_H]
  // below; the PASSAGE_PAD margin keeps every witness hitbox at least
  // 12 px from them, so inclusive contact never happens.
  function columnPassage(column, boxes, gapFp) {
    var inSpan = boxesInXSpan(boxes, column.left, column.right);
    var t;
    var b;
    if (inSpan.length === 0) {
      // Unreachable for a Player witness that crosses every column; fall
      // back to the column target.
      t = column.targetPx * FP;
      b = t;
    } else {
      t = Infinity;
      b = -Infinity;
      inSpan.forEach(function (h) {
        if (h.t < t) t = h.t;
        if (h.b > b) b = h.b;
      });
      t -= PASSAGE_PAD_FP;
      b += PASSAGE_PAD_FP;
    }
    var height = b - t;
    if (height < gapFp) {
      var extra = gapFp - height;
      var up = Math.floor(extra / 2);
      t -= up;
      b += extra - up;
    }
    if (b - t >= COURSE_H_FP) return { t: 0, b: COURSE_H_FP };
    if (t < 0) {
      b -= t;
      t = 0;
    }
    if (b > COURSE_H_FP) {
      t -= b - COURSE_H_FP;
      b = COURSE_H_FP;
    }
    return { t: t, b: b };
  }

  // Wall rects above and below a passage; zero-height walls are omitted.
  function columnWalls(column, passage) {
    var walls = [];
    if (passage.t > 0) walls.push({ l: column.left, t: 0, r: column.right, b: passage.t });
    if (passage.b < COURSE_H_FP) walls.push({ l: column.left, t: passage.b, r: column.right, b: COURSE_H_FP });
    return walls;
  }

  // Vertical clearance (FP) of a Hazard at top y from the Course edges and
  // from every witness hitbox overlapping its x-span (negative = overlap).
  function hazardClearance(y, boxes) {
    var bottom = y + HAZARD_FP;
    var clearance = Math.min(y, COURSE_H_FP - bottom);
    for (var i = 0; i < boxes.length; i++) {
      var h = boxes[i];
      var d = Math.max(h.t - bottom, y - h.b);
      if (d < clearance) clearance = d;
    }
    return clearance;
  }

  // One Hazard in the gap between regular columns a and b, or null. The
  // chance draw happens for every such gap, left to right.
  function placeHazard(rng, params, a, b, boxes) {
    if (!rng.chance(params.hazardPerMille)) return null;
    var centerPx = Math.floor((a.rightPx + b.leftPx) / 2);
    var l = (centerPx - C.HAZARD_SIZE / 2) * FP;
    var r = l + HAZARD_FP;
    var inSpan = boxesInXSpan(boxes, l, r);
    var bestY = -1;
    var best = -Infinity;
    for (var y = 0; y + HAZARD_FP <= COURSE_H_FP; y += HAZARD_STEP_FP) {
      var c = hazardClearance(y, inSpan);
      if (c > best) {
        best = c;
        bestY = y;
      }
    }
    if (bestY < 0 || best < HAZARD_MIN_CLEARANCE_FP) return null;
    return { l: l, t: bestY, r: r, b: bestY + HAZARD_FP };
  }

  // Walls, gates and Hazards around the simulated witness paths, assembled
  // into the Course data model. RNG use: one chance draw per gap between
  // two consecutive regular columns (approach zones, the runway and gaps
  // next to a gate column are excluded), after the Echo witness draws.
  function placeGeometry(setup, skeleton, playerWitness, echoWitnesses) {
    var params = setup.params;
    var gapFp = params.gapPx * FP;
    var columns = skeleton.columns;
    var boxes = aliveWitnessHitboxes(playerWitness, echoWitnesses);

    var walls = [];
    var gates = new Array(skeleton.gates.length);
    columns.forEach(function (column) {
      var passage = columnPassage(column, boxes, gapFp);
      columnWalls(column, passage).forEach(function (w) {
        walls.push(w);
      });
      if (column.kind === 'gate') {
        var k = column.gateIndex;
        gates[k] = {
          rect: { l: column.left, t: passage.t, r: column.right, b: passage.b },
          passage: { t: passage.t, b: passage.b },
          styleIndex: k
        };
      }
    });

    var hazards = [];
    for (var i = 0; i + 1 < columns.length; i++) {
      if (columns[i].kind !== 'regular' || columns[i + 1].kind !== 'regular') continue;
      var hz = placeHazard(setup.rng, params, columns[i], columns[i + 1], boxes);
      if (hz) hazards.push(hz);
    }

    if (echoWitnesses.runes.length !== gates.length) {
      throw new GeneratorError(setup.stage, setup.seed, 'Rune/Rune_Gate count mismatch');
    }

    return deepFreeze({
      stage: setup.stage,
      seed: setup.seed,
      seedSalt: setup.seedSalt,
      params: params,
      scrollSpeed: C.SCROLL_SPEED,
      walls: walls,
      hazards: hazards,
      runes: echoWitnesses.runes.slice(), // runes[k] linked to gates[k]
      gates: gates,
      finishX: skeleton.finishX,
      witness: {
        player: playerWitness.log,
        echoes: echoWitnesses.echoes.map(function (e) {
          return e.log;
        })
      }
    });
  }

  // ---------------------------------------------------------------------
  // Pipeline step 6: selfCheck (task 6.5, design 8)
  // ---------------------------------------------------------------------

  var MIN_PASSAGE_FP = 2 * C.PLAYER_H * FP;

  function courseError(course, reason) {
    return new GeneratorError(course && course.stage, course && course.seed, reason);
  }

  // -1 strictly above the midline, +1 strictly below, 0 exactly on it.
  // Doubled values avoid halving odd sums: 2 * center vs 2 * MIDLINE.
  function sideOfMidline(twiceCenter) {
    var twiceMid = 2 * MIDLINE_FP;
    if (twiceCenter < twiceMid) return -1;
    if (twiceCenter > twiceMid) return 1;
    return 0;
  }

  // Rune/Rune_Gate placement rules on the placed geometry (6.1, 9.12):
  //   1:1 pairing (runes.length === gates.length)
  //   rune right < gate left
  //   gate right - rune right <= GATE_HOLD_TICKS x scrollSpeed
  //   gate left - rune right >= RUNE_GAP_MIN
  //   Rune center and gate passage center strictly in opposite halves
  // Throws GeneratorError on the first violation.
  function checkRunePlacement(course) {
    var runes = course.runes || [];
    var gates = course.gates || [];
    if (runes.length !== gates.length) {
      throw courseError(course, 'Rune/Rune_Gate pairing is not 1:1 (' + runes.length + ' Runes, ' + gates.length + ' gates)');
    }
    var maxReach = C.GATE_HOLD_TICKS * course.scrollSpeed;
    var minGap = C.RUNE_GAP_MIN * FP;
    for (var k = 0; k < gates.length; k++) {
      var rune = runes[k];
      var gate = gates[k];
      var prefix = 'pair ' + k + ': ';
      if (!(rune.r < gate.rect.l)) throw courseError(course, prefix + 'Rune right is not left of the gate');
      if (gate.rect.r - rune.r > maxReach) {
        throw courseError(course, prefix + 'gate right - Rune right exceeds ' + C.GATE_HOLD_TICKS + ' x scroll speed');
      }
      if (gate.rect.l - rune.r < minGap) {
        throw courseError(course, prefix + 'gate left - Rune right is below RUNE_GAP_MIN');
      }
      var runeSide = sideOfMidline(rune.t + rune.b);
      var passageSide = sideOfMidline(gate.passage.t + gate.passage.b);
      if (runeSide === 0 || passageSide === 0 || runeSide === passageSide) {
        throw courseError(course, prefix + 'Rune center is not in the opposite vertical half from the passage center');
      }
    }
  }

  // Clear vertical span of every walled column. Walls sharing an x-span
  // form one column: a wall touching the top bounds the passage top, one
  // touching the bottom bounds the passage bottom (missing = Course edge).
  function columnPassagesFromWalls(walls) {
    var byspan = {};
    var keys = [];
    walls.forEach(function (w) {
      var key = w.l + ':' + w.r;
      if (!byspan[key]) {
        byspan[key] = { t: 0, b: COURSE_H_FP };
        keys.push(key);
      }
      var p = byspan[key];
      if (w.t <= 0) p.t = Math.max(p.t, w.b);
      else p.b = Math.min(p.b, w.t);
    });
    return keys.map(function (key) {
      return { key: key, t: byspan[key].t, b: byspan[key].b };
    });
  }

  // Replays the Solution_Witness and checks the structural invariants
  // (9.9 to 9.12). Throws GeneratorError on the first failure.
  function selfCheck(course) {
    if (!course || typeof course !== 'object') throw courseError(course, 'missing Course');

    // Gate count (9.11).
    var gateCount = course.gates ? course.gates.length : 0;
    if (gateCount < 1 || gateCount > 3) throw courseError(course, 'gate count ' + gateCount + ' outside 1..3');
    if (!course.params || gateCount !== course.params.gateCount) {
      throw courseError(course, 'gate count ' + gateCount + ' does not match params.gateCount');
    }

    // Passage heights (9.11): gate passages and every walled column.
    course.gates.forEach(function (g, k) {
      if (g.passage.b - g.passage.t < MIN_PASSAGE_FP) {
        throw courseError(course, 'gate ' + k + ' passage shorter than 2 x PLAYER_H');
      }
    });
    columnPassagesFromWalls(course.walls || []).forEach(function (p) {
      if (p.b - p.t < MIN_PASSAGE_FP) {
        throw courseError(course, 'column ' + p.key + ' passage shorter than 2 x PLAYER_H');
      }
    });

    // Rune placement (6.1, 9.12).
    checkRunePlacement(course);

    // Witness shape (9.8).
    var witness = course.witness;
    if (!witness || !witness.player || !witness.echoes) throw courseError(course, 'missing Solution_Witness');
    var echoes = witness.echoes;
    if (echoes.length < 1 || echoes.length > 3) {
      throw courseError(course, 'witness has ' + echoes.length + ' Echo logs, expected 1..3');
    }

    // Every witness log starts with a Flap on Tick 0, so it can be recorded
    // through the Game, where the first Flap starts the Run (8.9).
    var startsWithFlap = function (log) {
      return log.length > 0 && log[0] === true;
    };
    if (!startsWithFlap(witness.player) || !echoes.every(startsWithFlap)) {
      throw courseError(course, 'witness log does not start with a Flap');
    }

    // Full witness replay clears with no death (9.10). The margin lets a
    // log that ends just before the Finish_Line still drift across it.
    var replayHeadless = deps.simulation.replayHeadless;
    var full = replayHeadless(course, witness.player, echoes, {
      maxTicks: witness.player.length + C.COUNTDOWN_STEPS
    });
    if (full.deathTick !== null || full.outcome !== 'cleared') {
      throw courseError(
        course,
        'witness replay did not clear (outcome ' + full.outcome + ', deathTick ' + full.deathTick + ')'
      );
    }

    // Each Echo k played as the Player with Echoes 1..k-1 stays alive
    // through its last Tick (9.9).
    for (var k = 0; k < echoes.length; k++) {
      var run = replayHeadless(course, echoes[k], echoes.slice(0, k), { maxTicks: echoes[k].length });
      if (run.deathTick !== null || run.outcome === 'dead') {
        throw courseError(course, 'Echo witness ' + k + ' dies at Tick ' + run.deathTick + ' when played as the Player');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------

  // opts: { seedSalt = 0, paramsOverride }
  function generateStage(stage, opts) {
    var setup = resolveSetup(stage, opts);
    var skeleton = buildSkeleton(setup);
    var playerWitness = buildPlayerWitness(setup, skeleton);
    var echoWitnesses = buildEchoWitnesses(setup, skeleton, playerWitness);
    var course = placeGeometry(setup, skeleton, playerWitness, echoWitnesses);
    selfCheck(course);
    return course;
  }

  return Object.freeze({
    difficulty: difficulty,
    steer: steer,
    // Pipeline steps exposed for tests and later generator tasks.
    _pipeline: Object.freeze({
      resolveSetup: resolveSetup,
      buildSkeleton: buildSkeleton,
      buildPlayerWitness: buildPlayerWitness,
      buildEchoWitnesses: buildEchoWitnesses,
      placeGeometry: placeGeometry
    }),
    generateStage: generateStage,
    selfCheck: selfCheck,
    checkRunePlacement: checkRunePlacement,
    GeneratorError: GeneratorError
  });
});
