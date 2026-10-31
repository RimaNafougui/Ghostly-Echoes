/*
 * Ghostly Echoes - main.js
 * Browser entry point. Exposes the pure fixed-timestep helper
 * advanceAccumulator (Requirements 1.7, 1.8). The browser bootstrap
 * (rAF loop, wiring) is added in task 10.1 and is guarded so this file
 * also loads in Node.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? { constants: require('./constants.js') }
    : { constants: ns.constants };
  var api = factory(deps);
  ns.main = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var TICK_MS = 1000 / 60;
  var EPS = 1e-6;
  var MAX_TICKS_PER_FRAME = C.MAX_TICKS_PER_FRAME;

  /**
   * Consume real elapsed time into a whole number of fixed Ticks.
   * - NaN or negative elapsed time counts as 0.
   * - More than MAX_TICKS_PER_FRAME Ticks accumulated: run the max and
   *   discard the rest (1.8).
   * - Otherwise floor the Tick count and carry the remainder (1.7).
   * EPS absorbs float error at exact Tick boundaries.
   * @param {number} accMs carried-over milliseconds (>= 0)
   * @param {number} elapsedMs real time since the last frame
   * @returns {{ ticks: number, accMs: number }}
   */
  function advanceAccumulator(accMs, elapsedMs) {
    // NaN or negative -> 0 (NaN > 0 is false). +Infinity falls into the cap.
    var acc = typeof accMs === 'number' && accMs > 0 ? accMs : 0;
    var elapsed = typeof elapsedMs === 'number' && elapsedMs > 0 ? elapsedMs : 0;
    var total = acc + elapsed;
    if (total > MAX_TICKS_PER_FRAME * TICK_MS + EPS) {
      return { ticks: MAX_TICKS_PER_FRAME, accMs: 0 };
    }
    var ticks = Math.floor((total + EPS) / TICK_MS);
    return { ticks: ticks, accMs: Math.max(0, total - ticks * TICK_MS) };
  }

  if (typeof document !== 'undefined') {
    /* Browser bootstrap added in task 10.1. */
  }

  return {
    TICK_MS: TICK_MS,
    EPS: EPS,
    advanceAccumulator: advanceAccumulator
  };
});
