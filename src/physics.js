/*
 * Ghostly Echoes - physics.js
 * Pure Ghost movement and collision helpers shared by the Player and Echoes.
 *   stepGhost       one Tick of movement: flap -> gravity -> position -> scroll
 *   hitbox          Ghost collision bounds as an inclusive Rect { l, t, r, b }
 *   rectsIntersect  inclusive overlap test (shared edges count as contact)
 *   outOfCourse     true if any part of the bounds is above the top edge or
 *                   below the bottom edge of the Course
 *
 * All values are integer fixed-point units (FP = 256 per px). Ghost x/y is
 * the top-left corner of its hitbox.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.physics)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? { constants: require('./constants.js') }
    : { constants: ns.constants };
  var api = factory(deps);
  ns.physics = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var FP = C.FP;
  var GRAVITY = C.GRAVITY;
  var FLAP_VY = C.FLAP_VY;
  var SCROLL_SPEED = C.SCROLL_SPEED;
  var PLAYER_W_FP = C.PLAYER_W * FP;
  var PLAYER_H_FP = C.PLAYER_H * FP;
  var COURSE_H_FP = C.COURSE_H * FP;

  // One Tick of Ghost movement, in exactly this order (2.3, 2.4, 2.5):
  //   1. a Flap replaces any current vertical velocity with FLAP_VY
  //   2. gravity is added to vy
  //   3. y moves by the new vy
  //   4. x moves by the constant scroll speed
  // Returns a new object; the input is never mutated.
  function stepGhost(g, flap) {
    var vy = flap ? FLAP_VY : g.vy;
    vy = vy + GRAVITY;
    var y = g.y + vy;
    var x = g.x + SCROLL_SPEED;
    return { x: x, y: y, vy: vy };
  }

  // Collision bounds of a Ghost. Edges are inclusive.
  function hitbox(g) {
    return { l: g.x, t: g.y, r: g.x + PLAYER_W_FP, b: g.y + PLAYER_H_FP };
  }

  // Inclusive intersection: rectangles that only share an edge or a corner
  // still count as contact (7.1, 7.2, 7.6).
  function rectsIntersect(a, b) {
    return a.l <= b.r && b.l <= a.r && a.t <= b.b && b.t <= a.b;
  }

  // Any part of the bounds above the top edge (y < 0) or below the bottom
  // edge (y > COURSE_H) of the Course (7.3).
  function outOfCourse(h) {
    return h.t < 0 || h.b > COURSE_H_FP;
  }

  return Object.freeze({
    stepGhost: stepGhost,
    hitbox: hitbox,
    rectsIntersect: rectsIntersect,
    outOfCourse: outOfCourse
  });
});
