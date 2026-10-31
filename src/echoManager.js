/*
 * Ghostly Echoes - echoManager.js
 * Pure, bounded FIFO of stored Echoes (at most MAX_ECHOES, oldest first).
 * Entry shape: { log, tintIndex, seq }
 *   log       - frozen Input_Log, kept by reference (5.8)
 *   tintIndex - smallest index in {0, 1, 2} unused by the retained entries (4.8)
 *   seq       - last entry's seq + 1 (first stored Echo gets 1)
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.echoManager)
 * and through require() in Node (module.exports). No DOM access.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var deps =
    typeof module === 'object' && module.exports
      ? { constants: require('./constants.js') }
      : { constants: ns.constants };
  var api = factory(deps);
  ns.echoManager = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var MAX_ECHOES = deps.constants.MAX_ECHOES;

  // A new Stage starts with no Echoes (5.7).
  function emptyEchoes() {
    return Object.freeze([]);
  }

  // Returns a new list; the input list is never mutated (5.1 to 5.4).
  function storeEcho(echoes, log) {
    if (!Array.isArray(echoes)) {
      throw new TypeError('storeEcho: echoes must be an array');
    }
    if (log === null || log === undefined) {
      throw new TypeError('storeEcho: log must be non-null');
    }

    var lastSeq = echoes.length > 0 ? echoes[echoes.length - 1].seq : 0;

    // Drop the oldest Echo when the limit is reached (5.3).
    var retained = echoes.length >= MAX_ECHOES
      ? echoes.slice(echoes.length - MAX_ECHOES + 1)
      : echoes.slice();

    // Smallest tint index not used by the retained entries (4.8).
    var tintIndex = 0;
    while (retained.some(function (e) { return e.tintIndex === tintIndex; })) {
      tintIndex += 1;
    }

    retained.push(Object.freeze({ log: log, tintIndex: tintIndex, seq: lastSeq + 1 }));
    return Object.freeze(retained);
  }

  return { emptyEchoes: emptyEchoes, storeEcho: storeEcho };
});
