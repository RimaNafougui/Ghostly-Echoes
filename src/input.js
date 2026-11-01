/*
 * Ghostly Echoes - input.js
 * Browser Input_Handler: turns keyboard / mouse / touch events into a
 * per-Tick flap flag and a restart flag (Requirements 2.1, 2.2, 2.6, 2.7,
 * 8.4, A12).
 *
 *   createInputHandler(target, canvas, isAcceptingFlaps) -> {
 *     drain()   -> { flap, restart }   one call per fixed step; clears both
 *     dispose() removes every listener registered by this handler
 *   }
 *
 * - target: page-level event target for keydown (normally window/document).
 * - canvas: element receiving mousedown / touchstart.
 * - isAcceptingFlaps: zero-arg callback; flaps are queued only while it
 *   returns true (2.6). Checked at event time.
 *
 * Flap sources (2.1): non-repeat keydown with code 'Space' or 'ArrowUp'
 * anywhere, mousedown with button === 0 on the canvas, touchstart on the
 * canvas. preventDefault() is called on every Space/ArrowUp keydown
 * (repeats included, so holding the key never scrolls the page) and on
 * every touchstart (no synthesized mouse flap) (2.7). Several flaps between
 * two drains deliver one flap (2.2, A12).
 *
 * Restart (8.4): non-repeat keydown with code 'KeyR' sets restart = true.
 *
 * Only the arguments are touched, never host globals, so the file loads in
 * Node. Loads as a classic <script> (GhostlyEchoes.input) and via require().
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var api = factory();
  ns.input = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createInputHandler(target, canvas, isAcceptingFlaps) {
    var accepting = typeof isAcceptingFlaps === 'function' ? isAcceptingFlaps : function () { return true; };
    var queue = 0;
    var restart = false;
    var listeners = [];

    function listen(el, type, fn, opts) {
      if (!el || typeof el.addEventListener !== 'function') return;
      el.addEventListener(type, fn, opts);
      listeners.push({ el: el, type: type, fn: fn, opts: opts });
    }

    function queueFlap() {
      if (accepting()) queue += 1;
    }

    function onKeyDown(e) {
      var code = e.code;
      if (code === 'Space' || code === 'ArrowUp') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (!e.repeat) queueFlap();
      } else if (code === 'KeyR') {
        if (!e.repeat) restart = true;
      }
    }

    function onMouseDown(e) {
      if (e.button === 0) queueFlap();
    }

    function onTouchStart(e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      queueFlap();
    }

    listen(target, 'keydown', onKeyDown);
    listen(canvas, 'mousedown', onMouseDown);
    listen(canvas, 'touchstart', onTouchStart, { passive: false });

    function drain() {
      var out = { flap: queue > 0, restart: restart };
      queue = 0;
      restart = false;
      return out;
    }

    function dispose() {
      for (var i = 0; i < listeners.length; i++) {
        var l = listeners[i];
        if (typeof l.el.removeEventListener === 'function') l.el.removeEventListener(l.type, l.fn, l.opts);
      }
      listeners = [];
      queue = 0;
      restart = false;
    }

    return { drain: drain, dispose: dispose };
  }

  return Object.freeze({ createInputHandler: createInputHandler });
});
