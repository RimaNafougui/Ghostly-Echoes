/*
 * Ghostly Echoes - constants.js
 * All tunables for the deterministic core and the browser shell.
 * Units: FP = 256, so 1 px = 256 fixed-point units. Values named *_PX or
 * noted as px are in pixels; GRAVITY, FLAP_VY and SCROLL_SPEED are FP units.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.constants)
 * and through require() in Node (module.exports). No DOM access.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var api = factory();
  ns.constants = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Recursively freeze objects and arrays so no tunable can be mutated.
  function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.getOwnPropertyNames(value).forEach(function (key) {
        deepFreeze(value[key]);
      });
      Object.freeze(value);
    }
    return value;
  }

  var FP = 256;
  var PLAYER_W = 32;
  var PLAYER_H = 32;
  var GATE_W = 24;
  var GATE_HOLD_TICKS = 30;
  var SCROLL_SPEED = 768; // 3 px/Tick
  var SCROLL_PX = SCROLL_SPEED / FP; // 3

  return deepFreeze({
    // Fixed-point scale
    FP: FP,

    // Course / viewport (px)
    COURSE_W: 800,
    COURSE_H: 480,

    // Ghost hitbox and Tick-0 start state (px, vy = 0)
    PLAYER_W: PLAYER_W,
    PLAYER_H: PLAYER_H,
    PLAYER_START_X: 120,
    PLAYER_START_Y: 224,

    // Physics (FP units)
    GRAVITY: 64, // 0.25 px/Tick^2
    FLAP_VY: -1280, // -5 px/Tick
    SCROLL_SPEED: SCROLL_SPEED, // same for all Stages

    // Timing and limits
    GATE_HOLD_TICKS: GATE_HOLD_TICKS, // A4
    MAX_ECHOES: 3, // 5.2
    COUNTDOWN_STEPS: 60, // A16
    MAX_TICKS_PER_FRAME: 5, // 1.8

    // Seeding (9.5)
    BASE_SEED: 0x6e05c40d,

    // Geometry (px)
    RUNE_W: 32,
    RUNE_H: 32,
    GATE_W: GATE_W,
    WALL_W: 48,
    HAZARD_SIZE: 24,
    RUNE_GAP_MIN: PLAYER_W + 4, // 36: gate left - rune right (6.1)
    RUNE_GAP_MAX: GATE_HOLD_TICKS * SCROLL_PX - GATE_W, // 66: gate right - rune right <= 30 x scroll (6.1)
    STEER_BIAS: 57,
    MIDLINE_CLEARANCE_PX: 100,
    PASSAGE_PAD: 12,
    APPROACH_PX: 420,
    RUNWAY_PX: 400,
    FINISH_MARGIN_PX: 200,

    // Styles
    ECHO_ALPHA: 0.45, // within 30-60 % (4.7)
    ECHO_TINTS: ['#5ec8ff', '#ffb347', '#b78cff'],
    RUNE_STYLES: [
      { symbol: '\u25C6', color: '#ff5ea8' }, // ◆
      { symbol: '\u25B2', color: '#59e38c' }, // ▲
      { symbol: '\u25CF', color: '#ffd84d' } // ●
    ],
    STAGE1_HINT:
      "Fly through the rune, press R once you're past it, then let your echo open the gate."
  });
});
