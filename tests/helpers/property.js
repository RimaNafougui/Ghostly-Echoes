/*
 * Ghostly Echoes - tests/helpers/property.js
 * Dependency-free, seeded property-test harness plus input/course generators.
 *
 *   forAll(name, { cases = 500, baseSeed }, gen, predicate)
 *     Case i uses caseSeed = deriveSeed(baseSeed, i) and rng = createRng(caseSeed).
 *     gen(rng) builds the input; predicate(input) must return true/undefined or
 *     throw. Returning false also counts as a failure.
 *
 * Environment variables (12.3, 12.4):
 *   GE_BASE_SEED  override the base seed (decimal or 0x-hex)
 *   GE_SEED       run exactly one case with this case seed
 *   GE_CASE       run exactly one case by index (with the current base seed)
 *
 * The base seed is printed once per process (node --test runs each test file
 * in its own process, so once per property file).
 */
'use strict';

const assert = require('node:assert/strict');
const { AssertionError } = assert;
const core = require('./load.js');

const { deriveSeed, createRng } = core.rng;
const C = core.constants;

const DEFAULT_BASE_SEED = 0x5eed1e55;
const DEFAULT_CASES = 500;
const MAX_LOG_TICKS = 3600;
const MAX_FLAP_PER_MILLE = 300;

function hex(u32) {
  return '0x' + (u32 >>> 0).toString(16).padStart(8, '0');
}

function parseSeedEnv(varName) {
  const raw = process.env[varName];
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error('[property] ' + varName + '="' + raw + '" is not an integer in 0..2^32-1');
  }
  return n >>> 0;
}

function parseCaseEnv() {
  const raw = process.env.GE_CASE;
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('[property] GE_CASE="' + raw + '" is not a non-negative integer');
  }
  return n;
}

// Effective base seed: GE_BASE_SEED wins over the per-call option.
function resolveBaseSeed(optBaseSeed) {
  const env = parseSeedEnv('GE_BASE_SEED');
  if (env !== null) return env;
  if (optBaseSeed !== undefined) return optBaseSeed >>> 0;
  return DEFAULT_BASE_SEED;
}

const reported = new Set();
function reportBaseSeed(baseSeed) {
  const b = baseSeed === undefined ? resolveBaseSeed() : baseSeed >>> 0;
  if (reported.has(b)) return;
  reported.add(b);
  console.log(
    '[ghostly-echoes] property base seed ' + hex(b) + ' (' + b + '); ' +
      'override with GE_BASE_SEED, rerun one case with GE_SEED or GE_CASE'
  );
}

// Print the default/env base seed as soon as a property file loads the harness.
reportBaseSeed();

function forAll(name, opts, gen, predicate) {
  const options = opts || {};
  const cases = options.cases === undefined ? DEFAULT_CASES : options.cases;
  const baseSeed = resolveBaseSeed(options.baseSeed);
  reportBaseSeed(baseSeed);

  const onlySeed = parseSeedEnv('GE_SEED');
  const onlyCase = parseCaseEnv();

  // List of { index, seed } to run.
  let plan;
  if (onlySeed !== null) {
    plan = [{ index: onlyCase === null ? 'GE_SEED' : onlyCase, seed: onlySeed }];
  } else if (onlyCase !== null) {
    plan = [{ index: onlyCase, seed: deriveSeed(baseSeed, onlyCase) }];
  } else {
    plan = [];
    for (let i = 0; i < cases; i++) plan.push({ index: i, seed: deriveSeed(baseSeed, i) });
  }

  for (const { index, seed } of plan) {
    let failure = null;
    try {
      const input = gen(createRng(seed));
      const result = predicate(input);
      if (result === false) failure = new Error('predicate returned false');
    } catch (err) {
      failure = err;
    }
    if (failure) {
      const detail = failure && failure.message ? failure.message : String(failure);
      const message =
        'Property "' + name + '" failed at case ' + index +
        ' (case seed ' + hex(seed) + ' = ' + seed + ', base seed ' + hex(baseSeed) + ').\n' +
        'Rerun with GE_SEED=' + seed + '\n' +
        'Cause: ' + detail;
      const error = new AssertionError({ message: message });
      error.cause = failure;
      error.propertyName = name;
      error.caseIndex = index;
      error.caseSeed = seed;
      error.baseSeed = baseSeed;
      throw error;
    }
  }
  return plan.length;
}

// ---------------------------------------------------------------------------
// Input generators
// ---------------------------------------------------------------------------

// Random Input_Log of 0..maxTicks booleans with a per-case flap density of
// 0..30 %. Length mix: ~10 % empty, ~20 % short (1..60), rest 0..maxTicks.
function genInputLog(rng, opts) {
  const maxTicks = opts && opts.maxTicks !== undefined ? opts.maxTicks : MAX_LOG_TICKS;
  const bucket = rng.nextInt(0, 9);
  let length;
  if (bucket === 0) length = 0;
  else if (bucket <= 2) length = rng.nextInt(1, Math.min(60, Math.max(1, maxTicks)));
  else length = rng.nextInt(0, maxTicks);
  if (maxTicks === 0) length = 0;
  const perMille = rng.nextInt(0, MAX_FLAP_PER_MILLE);
  const log = new Array(length);
  for (let i = 0; i < length; i++) log[i] = rng.chance(perMille);
  return log;
}

// 0..maxCount (default 3) independent Input_Logs.
function genEchoLogs(rng, opts) {
  const maxCount = opts && opts.maxCount !== undefined ? opts.maxCount : C.MAX_ECHOES;
  const count = rng.nextInt(0, maxCount);
  const logs = [];
  for (let i = 0; i < count; i++) logs.push(genInputLog(rng, opts));
  return logs;
}

// ---------------------------------------------------------------------------
// Rune / Rune_Gate pairs and Courses (all coordinates in FP units)
// ---------------------------------------------------------------------------

const FP = C.FP;
const H = C.COURSE_H * FP;
const MID = H / 2;

function rect(l, t, w, h) {
  return { l: l, t: t, r: l + w, b: t + h };
}

// Vertical center of a rect (may be a half unit).
function centerY(r) {
  return (r.t + r.b) / 2;
}

// 'upper' if strictly above the midline, 'lower' if strictly below, else 'mid'.
function halfOf(y) {
  if (y < MID) return 'upper';
  if (y > MID) return 'lower';
  return 'mid';
}

// Random center y in the given half for an object of height h (FP), kept
// inside the Course and at least 1 px away from the midline.
function centerInHalf(rng, half, h) {
  const halfH = h / 2;
  return half === 'upper'
    ? rng.nextInt(halfH, MID - FP)
    : rng.nextInt(MID + FP, H - halfH);
}

/*
 * Random Rune/Rune_Gate pair satisfying criterion 6.1:
 *   rune right < gate left
 *   gate left - rune right >= RUNE_GAP_MIN px
 *   gate right - rune right <= 30 x scroll speed
 *   Rune center in the opposite vertical half from the passage center
 * opts: { gateLeft (FP), styleIndex, scrollSpeed }
 */
function genRuneGatePair(rng, opts) {
  const o = opts || {};
  const scrollSpeed = o.scrollSpeed === undefined ? C.SCROLL_SPEED : o.scrollSpeed;
  const gateLeft =
    o.gateLeft === undefined
      ? rng.nextInt((C.PLAYER_START_X + 200) * FP, 3000 * FP)
      : o.gateLeft;

  // Passage (gate rect fills the gate column's passage).
  const passageH = rng.nextInt(2 * C.PLAYER_H, 200) * FP; // even FP value
  const gateHalf = rng.nextInt(0, 1) === 0 ? 'upper' : 'lower';
  const passageCy = centerInHalf(rng, gateHalf, passageH);
  const passageT = passageCy - passageH / 2;
  const gateRect = rect(gateLeft, passageT, C.GATE_W * FP, passageH);

  // Horizontal gap: gate right - rune right = gap + GATE_W <= 30 x scroll.
  const maxGap = Math.min(C.RUNE_GAP_MAX * FP, C.GATE_HOLD_TICKS * scrollSpeed - C.GATE_W * FP);
  const gap = rng.nextInt(C.RUNE_GAP_MIN * FP, maxGap);
  const runeRight = gateLeft - gap;

  // Rune in the opposite half.
  const runeH = C.RUNE_H * FP;
  const runeCy = centerInHalf(rng, gateHalf === 'upper' ? 'lower' : 'upper', runeH);
  const runeRect = rect(runeRight - C.RUNE_W * FP, runeCy - runeH / 2, C.RUNE_W * FP, runeH);

  return {
    rune: runeRect,
    gate: {
      rect: gateRect,
      passage: { t: gateRect.t, b: gateRect.b },
      styleIndex: o.styleIndex === undefined ? 0 : o.styleIndex
    }
  };
}

// Returns a list of 6.1 violations for one pair ([] if valid).
function runeGateViolations(rune, gate, scrollSpeed) {
  const s = scrollSpeed === undefined ? C.SCROLL_SPEED : scrollSpeed;
  const v = [];
  const g = gate.rect;
  if (!(rune.r < g.l)) v.push('rune right must be < gate left');
  if (!(g.l - rune.r >= C.RUNE_GAP_MIN * FP)) v.push('gate left - rune right must be >= RUNE_GAP_MIN');
  if (!(g.r - rune.r <= C.GATE_HOLD_TICKS * s)) v.push('gate right - rune right must be <= 30 x scroll speed');
  const runeHalf = halfOf(centerY(rune));
  const passHalf = halfOf((gate.passage.t + gate.passage.b) / 2);
  if (runeHalf === 'mid' || passHalf === 'mid' || runeHalf === passHalf) {
    v.push('rune center must be in the opposite vertical half from the passage center');
  }
  return v;
}

// Wall column with a gap: two rects above and below the gap.
function genWallColumn(rng, left) {
  const gapH = rng.nextInt(120, 240) * FP;
  const cy = rng.nextInt(gapH / 2, H - gapH / 2);
  const gapT = cy - gapH / 2;
  const gapB = gapT + gapH;
  const walls = [];
  const w = C.WALL_W * FP;
  if (gapT > 0) walls.push({ l: left, t: 0, r: left + w, b: gapT });
  if (gapB < H) walls.push({ l: left, t: gapB, r: left + w, b: H });
  return walls;
}

/*
 * Small hand-built random Course with the design's Course shape:
 * a few wall columns and Hazards, plus 0..2 Rune/Rune_Gate pairs satisfying
 * 6.1. Each gate column also gets walls above and below its passage.
 */
function genCourse(rng, opts) {
  const o = opts || {};
  const scrollSpeed = C.SCROLL_SPEED;
  const pairCount = o.pairCount === undefined ? rng.nextInt(0, 2) : o.pairCount;
  const wallColumns = rng.nextInt(0, 3);
  const hazardCount = rng.nextInt(0, 3);

  // Shuffle the element order along x.
  const slots = [];
  for (let i = 0; i < pairCount; i++) slots.push('pair');
  for (let i = 0; i < wallColumns; i++) slots.push('wall');
  for (let i = slots.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const t = slots[i];
    slots[i] = slots[j];
    slots[j] = t;
  }

  const walls = [];
  const runes = [];
  const gates = [];
  let cursor = (C.PLAYER_START_X + C.PLAYER_W + rng.nextInt(150, 400)) * FP;

  for (const kind of slots) {
    if (kind === 'wall') {
      walls.push.apply(walls, genWallColumn(rng, cursor));
      cursor += C.WALL_W * FP;
    } else {
      // Leave room for the Rune before the gate column.
      const gateLeft = cursor + (C.RUNE_W + C.RUNE_GAP_MAX) * FP;
      const pair = genRuneGatePair(rng, { gateLeft: gateLeft, styleIndex: gates.length, scrollSpeed: scrollSpeed });
      runes.push(pair.rune);
      gates.push(pair.gate);
      const g = pair.gate.rect;
      if (g.t > 0) walls.push({ l: g.l, t: 0, r: g.r, b: g.t - 1 });
      if (g.b < H) walls.push({ l: g.l, t: g.b + 1, r: g.r, b: H });
      cursor = g.r;
    }
    cursor += rng.nextInt(150, 500) * FP;
  }

  const finishX = cursor + rng.nextInt(100, 400) * FP;

  const hazards = [];
  const hs = C.HAZARD_SIZE * FP;
  for (let i = 0; i < hazardCount; i++) {
    const l = rng.nextInt((C.PLAYER_START_X + 100) * FP, Math.max((C.PLAYER_START_X + 100) * FP, finishX - hs));
    const t = rng.nextInt(0, H - hs);
    hazards.push(rect(l, t, hs, hs));
  }

  return {
    stage: rng.nextInt(1, 50),
    seed: rng.nextU32(),
    seedSalt: 0,
    params: {
      gapPx: rng.nextInt(120, 200),
      spacingPx: rng.nextInt(380, 520),
      hazardPerMille: rng.nextInt(0, 600),
      gateCount: pairCount
    },
    scrollSpeed: scrollSpeed,
    walls: walls,
    hazards: hazards,
    runes: runes,
    gates: gates,
    finishX: finishX,
    witness: { player: Object.freeze([]), echoes: Object.freeze([]) }
  };
}

module.exports = {
  DEFAULT_BASE_SEED: DEFAULT_BASE_SEED,
  DEFAULT_CASES: DEFAULT_CASES,
  MAX_LOG_TICKS: MAX_LOG_TICKS,
  forAll: forAll,
  resolveBaseSeed: resolveBaseSeed,
  reportBaseSeed: reportBaseSeed,
  genInputLog: genInputLog,
  genEchoLogs: genEchoLogs,
  genRuneGatePair: genRuneGatePair,
  genCourse: genCourse,
  runeGateViolations: runeGateViolations,
  halfOf: halfOf,
  centerY: centerY
};
