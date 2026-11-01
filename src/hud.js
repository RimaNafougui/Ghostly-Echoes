/*
 * Ghostly Echoes - hud.js
 * HUD model (pure, core) and, later, HUD drawing (browser shell).
 *
 *   getHudModel(game) -> { lines: ['Stage: S', 'Attempt: N', 'Echoes: X/3'], hint }
 *     hint is the Stage 1 hint on Stage 1 and null on every other Stage
 *     (10.1-10.3, 10.7, 10.8). Produced in every mode, including both
 *     Countdowns and 'error' mode (where game.course is null); the
 *     Renderer decides what to draw. Read-only: the Game object is never
 *     written, frozen or otherwise changed (10.6).
 *
 * The pure part has no host-global access. Canvas drawing (drawHud) is added
 * separately and only touches the ctx argument it receives, so this file
 * still loads in Node.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.hud)
 * and through require() in Node (module.exports).
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? { constants: require('./constants.js') }
    : { constants: ns.constants };
  var api = factory(deps);
  ns.hud = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;

  // ---------------------------------------------------------------------
  // Pure HUD model (core, DOM-free)
  // ---------------------------------------------------------------------

  function getHudModel(game) {
    var g = game || {};
    var stage = g.stage;
    var attempt = g.attempt;
    var echoCount = Array.isArray(g.echoes) ? g.echoes.length : 0;
    return {
      lines: [
        'Stage: ' + stage,
        'Attempt: ' + attempt,
        'Echoes: ' + echoCount + '/' + C.MAX_ECHOES
      ],
      hint: stage === 1 ? C.STAGE1_HINT : null
    };
  }

  return Object.freeze({
    getHudModel: getHudModel
  });
});
