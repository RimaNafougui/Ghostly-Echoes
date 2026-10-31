/*
 * Ghostly Echoes - rng.js
 * Seeded, deterministic randomness for the Stage_Generator and tests.
 *   fmix32      MurmurHash3 32-bit finalizer (bijective on uint32)
 *   deriveSeed  mixes two 32-bit values into a new seed
 *   stageSeed   per-Stage seed from the base seed, Stage number and salt
 *   createRng   mulberry32 generator
 *
 * All arithmetic is exact 32-bit integer math (Math.imul, >>> 0, | 0), so the
 * output is identical in every JS engine. Seeds are coerced with >>> 0 into
 * the range 0..2^32-1.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.rng)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var api = factory();
  ns.rng = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // MurmurHash3 fmix32: each step is invertible, so the whole map is a
  // bijection on 32-bit unsigned integers.
  function fmix32(h) {
    h = h >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // For a fixed a, b -> deriveSeed(a, b) is a composition of bijections
  // (add constant mod 2^32, fmix32, xor a, fmix32), so distinct b values
  // always give distinct seeds.
  function deriveSeed(a, b) {
    var mixedB = fmix32(((b >>> 0) + 0x9e3779b9) >>> 0);
    return fmix32(((a >>> 0) ^ mixedB) >>> 0);
  }

  // Salt 0 is the normal Stage seed; a non-zero salt gives an alternative
  // seed for the same Stage (used by generator recovery).
  function stageSeed(base, stage, salt) {
    var s = salt === undefined ? 0 : salt >>> 0;
    var seed = deriveSeed(base, stage);
    return s === 0 ? seed : deriveSeed(seed, s);
  }

  // mulberry32: 32-bit state, full 2^32 period.
  function createRng(seed) {
    var state = seed >>> 0;

    function nextU32() {
      state = (state + 0x6d2b79f5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    }

    // Inclusive integer in [lo, hi].
    function nextInt(lo, hi) {
      return (nextU32() % (hi - lo + 1)) + lo;
    }

    // True with probability perMille / 1000.
    function chance(perMille) {
      return nextInt(0, 999) < perMille;
    }

    return { nextU32: nextU32, nextInt: nextInt, chance: chance };
  }

  return {
    fmix32: fmix32,
    deriveSeed: deriveSeed,
    stageSeed: stageSeed,
    createRng: createRng
  };
});
