/*
 * Ghostly Echoes - recorder.js
 * Records one boolean flap value per simulated Tick for the current Run.
 * Logs hold only flap booleans (no positions, velocities or timestamps, 3.5).
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.recorder)
 * and through require() in Node (module.exports). No DOM access.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var api = factory();
  ns.recorder = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createRecorder() {
    var log = null; // current Input_Log, or null while idle

    return {
      // Start a fresh, empty Input_Log for a new Run (3.1).
      begin: function () {
        log = [];
      },

      // Append exactly one flap value for the simulated Tick (3.2).
      // No-op before begin() or after finalize() (3.6).
      append: function (flag) {
        if (log === null) return;
        log.push(!!flag);
      },

      // Stop recording. Returns the frozen Input_Log (3.3, 3.4, 3.7), or null
      // for a zero-length log or when idle, so it never becomes an Echo (3.8, 4.10).
      finalize: function () {
        var finished = log;
        log = null;
        if (finished === null || finished.length === 0) return null;
        return Object.freeze(finished);
      },

      isRecording: function () {
        return log !== null;
      }
    };
  }

  return { createRecorder: createRecorder };
});
