/*
 * Ghostly Echoes - main.js
 * Browser entry point. Exposes the pure fixed-timestep helper
 * advanceAccumulator (Requirements 1.7, 1.8) and the browser bootstrap:
 * sprite loading, Game + Stage 1, input, audio, renderer and the
 * requestAnimationFrame loop. The bootstrap only runs when `document`
 * exists, so this file also loads in Node.
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

  /*
   * Browser bootstrap (task 10.1). Guarded so this file still loads in
   * Node with only constants as a dependency. Modules are read from
   * globalThis.GhostlyEchoes, filled in by the earlier classic scripts.
   */
  function bootstrap(root) {
    var ns = root.GhostlyEchoes || {};
    var gameApi = ns.game;
    var inputApi = ns.input;
    var audioApi = ns.audio;
    var rendererApi = ns.renderer;
    if (!gameApi || !inputApi || !audioApi || !rendererApi) {
      console.error('[GhostlyEchoes] missing modules, check the script order in index.html');
      return;
    }

    var canvas = document.getElementById('game');
    var ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) {
      console.error('[GhostlyEchoes] canvas #game or its 2D context is not available');
      return;
    }

    // Sprite: ready flag flipped in onload; onerror keeps the fallback (11.3, 11.5).
    var sprite = { img: null, ready: false };
    try {
      var img = new root.Image();
      img.onload = function () { sprite.ready = true; };
      img.onerror = function () { sprite.ready = false; };
      sprite.img = img;
      img.src = 'assets/ghosty.png';
    } catch (e) {
      sprite.img = null;
      sprite.ready = false;
    }

    // Fresh Game on every page load, no persistence (11.4).
    var game = gameApi.loadStage(gameApi.createGame({}), 1);

    var input = inputApi.createInputHandler(root, canvas, function () {
      return gameApi.isAcceptingFlaps(game);
    });
    var audio = audioApi.createAudio();
    var renderer = rendererApi.createRenderer(ctx, sprite);

    // Unlock audio on the first user gesture, once.
    var gestureTargets = [
      { el: root, type: 'keydown' },
      { el: canvas, type: 'mousedown' },
      { el: canvas, type: 'touchstart' }
    ];
    function onFirstGesture() {
      for (var i = 0; i < gestureTargets.length; i++) {
        gestureTargets[i].el.removeEventListener(gestureTargets[i].type, onFirstGesture);
      }
      audio.unlock();
    }
    for (var g = 0; g < gestureTargets.length; g++) {
      gestureTargets[g].el.addEventListener(gestureTargets[g].type, onFirstGesture);
    }

    var lastTime = root.performance.now();
    var accMs = 0;

    // Hidden tab: do not catch up on return (1.8).
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        lastTime = root.performance.now();
        accMs = 0;
      }
    });

    function frame(now) {
      try {
        var t = typeof now === 'number' ? now : root.performance.now();
        var step = advanceAccumulator(accMs, t - lastTime);
        lastTime = t;
        accMs = step.accMs;
        // Input is drained once per Tick; with 0 Ticks flaps stay queued.
        for (var i = 0; i < step.ticks; i++) {
          var res = gameApi.fixedStep(game, input.drain());
          game = res.game;
          if (res.events.flapped) audio.play('jump'); // 7.5
          if (res.events.died) audio.play('gameOver'); // 7.4
        }
        renderer.draw(game);
      } catch (e) {
        console.error('[GhostlyEchoes] frame error', e);
      }
      root.requestAnimationFrame(frame);
    }

    renderer.draw(game);
    root.requestAnimationFrame(frame);
  }

  if (typeof document !== 'undefined') {
    var host = typeof globalThis !== 'undefined' ? globalThis : this;
    var start = function () {
      try {
        bootstrap(host);
      } catch (e) {
        console.error('[GhostlyEchoes] startup failed', e);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  return {
    TICK_MS: TICK_MS,
    EPS: EPS,
    advanceAccumulator: advanceAccumulator
  };
});
