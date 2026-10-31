/*
 * Ghostly Echoes - simulation.js
 * Pure, deterministic per-Tick Simulation shared by live play and headless
 * replay.
 *   createRunState  Tick-0 state: Player and every Echo at the start state,
 *                   all gates closed (lastEchoOverlapTick = null)
 *   stepSimulation  one Tick in the design's per-Tick order; returns
 *                   { state, events } with a new state object
 *   replayHeadless  steps a Player log (plus Echo logs) until clear, death or
 *                   a Tick limit
 *
 * Per-Tick order for Tick t with flap input f (2.4, 6.11, 9.1):
 *   1. Player steps (flap -> gravity -> y -> x) if alive, else stays frozen
 *   2. each active Echo steps with log[t] (missing entry = no flap, 1.9)
 *   3. updateGates from Echo hitboxes only (6.2 to 6.5, 6.13)
 *   4. Player death checks: walls, Hazards, closed gates, top/bottom edges
 *      (inclusive contact, 6.6, 7.1 to 7.3, 7.6)
 *   5. finish check, only if the Player is still alive (9.1)
 *   6. Echoes whose last recorded Tick is t are removed (4.4)
 *   7. tick += 1 (1.1)
 *
 * Echoes never collide with anything (4.5, 4.6, 6.10, 7.7).
 *
 * All numeric state is integer fixed-point (FP = 256 per px). Inputs are
 * never mutated.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.simulation)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? {
        constants: require('./constants.js'),
        physics: require('./physics.js'),
        gates: require('./gates.js')
      }
    : { constants: ns.constants, physics: ns.physics, gates: ns.gates };
  var api = factory(deps);
  ns.simulation = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var FP = C.FP;
  var START_X = C.PLAYER_START_X * FP;
  var START_Y = C.PLAYER_START_Y * FP;

  var stepGhost = deps.physics.stepGhost;
  var hitbox = deps.physics.hitbox;
  var rectsIntersect = deps.physics.rectsIntersect;
  var outOfCourse = deps.physics.outOfCourse;
  var updateGates = deps.gates.updateGates;

  // Accepts Echo_Manager entries ({ log, tintIndex }) or bare Input_Logs.
  // Bare logs get their list index as tintIndex.
  function normalizeEcho(entry, index) {
    if (Array.isArray(entry)) return { log: entry, tintIndex: index };
    return { log: entry.log, tintIndex: entry.tintIndex === undefined ? index : entry.tintIndex };
  }

  // Tick-0 state (4.1, 8.7). Empty or missing logs create no Echo (4.10).
  function createRunState(course, echoes) {
    var list = echoes || [];
    var active = [];
    for (var i = 0; i < list.length; i++) {
      var e = normalizeEcho(list[i], i);
      if (!e.log || e.log.length === 0) continue;
      active.push({ log: e.log, tintIndex: e.tintIndex, x: START_X, y: START_Y, vy: 0 });
    }
    var gateCount = course.gates ? course.gates.length : 0;
    var gates = new Array(gateCount);
    for (var k = 0; k < gateCount; k++) {
      gates[k] = { lastEchoOverlapTick: null, open: false };
    }
    return {
      tick: 0,
      player: { x: START_X, y: START_Y, vy: 0, alive: true },
      echoes: active,
      gates: gates,
      status: 'running',
      deathTick: null
    };
  }

  function hitsAny(box, rects) {
    if (!rects) return false;
    for (var i = 0; i < rects.length; i++) {
      if (rectsIntersect(box, rects[i])) return true;
    }
    return false;
  }

  // Player contact with any gate that is closed on this Tick (6.6, 7.6).
  // Contact with an open gate has no effect (6.7).
  function hitsClosedGate(box, courseGates, gateStates) {
    if (!courseGates) return false;
    for (var k = 0; k < courseGates.length; k++) {
      if (!gateStates[k].open && rectsIntersect(box, courseGates[k].rect)) return true;
    }
    return false;
  }

  // One Tick. Returns { state, events } where
  // events = { flapped, died, cleared } (7.4, 7.5, 9.1).
  function stepSimulation(course, state, flap) {
    var t = state.tick;
    var running = state.status === 'running';
    var events = { flapped: false, died: false, cleared: false };

    // 1. Player (frozen once dead, 7.8).
    var p = state.player;
    var player;
    if (p.alive) {
      var moved = stepGhost(p, flap === true);
      player = { x: moved.x, y: moved.y, vy: moved.vy, alive: true };
      events.flapped = flap === true;
    } else {
      player = { x: p.x, y: p.y, vy: p.vy, alive: false };
    }

    // 2. Echoes replay log[t]; no collision response of any kind.
    var stepped = new Array(state.echoes.length);
    var echoBoxes = new Array(state.echoes.length);
    for (var i = 0; i < state.echoes.length; i++) {
      var e = state.echoes[i];
      var g = stepGhost(e, e.log[t] === true);
      stepped[i] = { log: e.log, tintIndex: e.tintIndex, x: g.x, y: g.y, vy: g.vy };
      echoBoxes[i] = hitbox(stepped[i]);
    }

    // 3. Gate states from Echo-Rune intersections only (Player never passed).
    var gates = updateGates(state.gates, course.runes || [], echoBoxes, t);

    var status = state.status;
    var deathTick = state.deathTick;

    if (running && player.alive) {
      // 4. Death checks before the finish check.
      var box = hitbox(player);
      var dies =
        hitsAny(box, course.walls) ||
        hitsAny(box, course.hazards) ||
        hitsClosedGate(box, course.gates, gates) ||
        outOfCourse(box);
      if (dies) {
        player.alive = false;
        status = 'dead';
        deathTick = t;
        events.died = true; // at most once: status leaves 'running'
      } else if (player.x >= course.finishX) {
        // 5. Finish check (alive only).
        status = 'cleared';
        events.cleared = true;
      }
    }

    // 6. Remove Echoes after their last recorded Tick (4.4).
    var echoes = [];
    for (var j = 0; j < stepped.length; j++) {
      if (t < stepped[j].log.length - 1) echoes.push(stepped[j]);
    }

    // 7. Advance the Tick counter by exactly 1.
    return {
      state: {
        tick: t + 1,
        player: player,
        echoes: echoes,
        gates: gates,
        status: status,
        deathTick: deathTick
      },
      events: events
    };
  }

  /*
   * Headless replay.
   *   opts.maxTicks  Tick limit (default: playerLog.length)
   *   opts.untilEnd  if true and no maxTicks is given, keep stepping past the
   *                  end of the log (missing entries = no flap) until clear
   *                  or death
   * Returns {
   *   initialState,   the Tick-0 state before any Tick is simulated
   *   states,         states[i] = state after Tick i was simulated
   *   outcome,        'cleared' | 'dead' | 'running' (stopped by the limit)
   *   deathTick,      Tick index of death or null
   *   clearTick       Tick index of the clear or null
   * }
   */
  function replayHeadless(course, playerLog, echoLogs, opts) {
    var o = opts || {};
    var log = playerLog || [];
    var limit;
    if (o.maxTicks !== undefined && o.maxTicks !== null) limit = o.maxTicks;
    else if (o.untilEnd) limit = Infinity;
    else limit = log.length;

    var state = createRunState(course, echoLogs || []);
    var initialState = state;
    var states = [];
    var deathTick = null;
    var clearTick = null;

    while (state.tick < limit && state.status === 'running') {
      var t = state.tick;
      var res = stepSimulation(course, state, log[t] === true);
      state = res.state;
      states.push(state);
      if (res.events.died) deathTick = t;
      if (res.events.cleared) clearTick = t;
    }

    return {
      initialState: initialState,
      states: states,
      outcome: state.status,
      deathTick: deathTick,
      clearTick: clearTick
    };
  }

  return Object.freeze({
    createRunState: createRunState,
    stepSimulation: stepSimulation,
    replayHeadless: replayHeadless
  });
});
