/*
 * Ghostly Echoes - gates.js
 * Pure Rune_Gate state logic. Gate k is linked to runes[k] (1:1).
 *   updateGates  records the latest Tick on which any Echo hitbox touched
 *                each gate's Rune, and derives the open flag for that Tick
 *   isGateOpen   open iff an Echo touched the Rune within the last
 *                GATE_HOLD_TICKS Ticks (inclusive span [last, last + 30])
 *
 * Only Echo hitboxes are passed in. The Player is never an argument, so the
 * Player can never open a gate (6.13).
 *
 * Gate state: { lastEchoOverlapTick: number | null, open: boolean }.
 * The initial null means no Echo overlap yet, so the gate is closed (6.2).
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.gates)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? { constants: require('./constants.js'), physics: require('./physics.js') }
    : { constants: ns.constants, physics: ns.physics };
  var api = factory(deps);
  ns.gates = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var GATE_HOLD_TICKS = deps.constants.GATE_HOLD_TICKS;
  var rectsIntersect = deps.physics.rectsIntersect;

  // Open iff some Echo overlapped the Rune on a Tick in [tick - 30, tick] (6.3, 6.8).
  function isGateOpen(gate, tick) {
    var last = gate.lastEchoOverlapTick;
    return last !== null && last !== undefined && tick - last <= GATE_HOLD_TICKS;
  }

  // Returns a new array of new gate objects; inputs are never mutated.
  // Any Echo hitbox intersecting runes[k] (inclusive edges) sets
  // lastEchoOverlapTick = tick, which restarts the open span (6.4, 6.5).
  function updateGates(gates, runes, echoHitboxes, tick) {
    var result = new Array(gates.length);
    for (var k = 0; k < gates.length; k++) {
      var gate = gates[k];
      var rune = runes[k];
      var last = gate.lastEchoOverlapTick === undefined ? null : gate.lastEchoOverlapTick;
      if (rune) {
        for (var i = 0; i < echoHitboxes.length; i++) {
          if (rectsIntersect(echoHitboxes[i], rune)) {
            last = tick;
            break;
          }
        }
      }
      var next = Object.assign({}, gate);
      next.lastEchoOverlapTick = last;
      next.open = isGateOpen(next, tick);
      result[k] = next;
    }
    return result;
  }

  return Object.freeze({
    updateGates: updateGates,
    isGateOpen: isGateOpen
  });
});
