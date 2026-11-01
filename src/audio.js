/*
 * Ghostly Echoes - audio.js
 * Browser shell: safe playback of the jump and game-over sounds
 * (Requirements 7.4, 7.5, 7.9). Audio failures never throw and never feed
 * back into the Game or Simulation. The Audio constructor is only touched
 * inside createAudio, so this file loads in Node without DOM globals.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(root);
  ns.audio = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /** Default sound sources, relative to index.html. */
  var DEFAULT_SRCS = Object.freeze({
    jump: 'assets/jump.wav',
    gameOver: 'assets/game_over.wav'
  });

  function noop() {}

  /** Attach a no-op rejection handler if `p` is a thenable. Never throws. */
  function swallow(p) {
    try {
      if (p && typeof p.then === 'function') p.then(noop, noop);
    } catch (e) { /* ignore */ }
    return p;
  }

  /**
   * Create the audio player.
   * @param {Object<string,string>} [srcs] map of sound name -> relative URL
   * @param {{ AudioCtor?: Function }} [opts] inject an Audio constructor (tests)
   * @returns {{ unlock: Function, play: Function, isAvailable: Function }}
   */
  function createAudio(srcs, opts) {
    var sources = srcs || DEFAULT_SRCS;
    var AudioCtor = opts && opts.AudioCtor !== undefined
      ? opts.AudioCtor
      : root.Audio;
    var sounds = {}; // name -> { el, available, playedSinceUnlock }
    var unlocked = false;

    if (typeof AudioCtor === 'function') {
      Object.keys(sources).forEach(function (name) {
        var entry = { el: null, available: false, playedSinceUnlock: false };
        try {
          var el = new AudioCtor(sources[name]);
          entry.el = el;
          entry.available = true;
          var markUnavailable = function () { entry.available = false; };
          if (typeof el.addEventListener === 'function') {
            el.addEventListener('error', markUnavailable);
          } else {
            el.onerror = markUnavailable;
          }
          try { el.preload = 'auto'; } catch (e) { /* ignore */ }
        } catch (e) {
          entry.el = null;
          entry.available = false;
        }
        sounds[name] = entry;
      });
    }

    /**
     * Prime every element with a muted play/pause during the first user
     * gesture so later playback is allowed by autoplay policy. Runs once.
     */
    function unlock() {
      if (unlocked) return;
      unlocked = true;
      Object.keys(sounds).forEach(function (name) {
        var s = sounds[name];
        if (!s.available || !s.el) return;
        var el = s.el;
        s.playedSinceUnlock = false;
        var restore = function () {
          try {
            if (!s.playedSinceUnlock) {
              el.pause();
              el.currentTime = 0;
            }
            el.muted = false;
          } catch (e) { /* ignore */ }
        };
        try {
          el.muted = true;
          var p = el.play();
          if (p && typeof p.then === 'function') {
            p.then(restore, restore);
          } else {
            restore();
          }
        } catch (e) {
          try { el.muted = false; } catch (e2) { /* ignore */ }
        }
      });
    }

    /** Play a sound from the start. Unknown or unavailable names are no-ops. */
    function play(name) {
      var s = Object.prototype.hasOwnProperty.call(sounds, name) ? sounds[name] : null;
      if (!s || !s.available || !s.el) return;
      try {
        s.playedSinceUnlock = true;
        s.el.muted = false;
        s.el.currentTime = 0;
        swallow(s.el.play());
      } catch (e) { /* ignore: audio never affects the Game (7.9) */ }
    }

    function isAvailable(name) {
      var s = Object.prototype.hasOwnProperty.call(sounds, name) ? sounds[name] : null;
      return !!(s && s.available && s.el);
    }

    return { unlock: unlock, play: play, isAvailable: isAvailable };
  }

  return { DEFAULT_SRCS: DEFAULT_SRCS, createAudio: createAudio };
});
