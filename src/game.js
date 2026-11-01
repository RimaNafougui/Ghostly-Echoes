/*
 * Ghostly Echoes - game.js
 * Game state machine outside the Simulation: waiting for the first Flap,
 * running, the two 60-step Countdowns, Attempts, Stage progression and
 * generator recovery. DOM-free.
 *
 *   createGame({ generate })        new Game (mode 'waitingForFirstFlap',
 *                                   no course yet; call loadStage(game, 1))
 *   loadStage(game, stage)          -> game: generate the Course, attempt 1,
 *                                   0 Echoes, wait for the first Flap
 *   fixedStep(game, { flap, restart }) -> { game, events }
 *                                   one fixed step from the frame accumulator
 *   isAcceptingFlaps(game)          true only in 'waitingForFirstFlap' and
 *                                   'running' (with the Player alive)
 *
 * Game shape (read by the HUD and Renderer):
 *   {
 *     mode:      'waitingForFirstFlap' | 'running' | 'postDeathCountdown'
 *                | 'postClearCountdown' | 'error',
 *     stage:     Stage number (>= 1),
 *     attempt:   Attempt number on the current Stage (>= 1, A6),
 *     echoes:    Echo_Manager list, oldest first ({ log, tintIndex, seq }),
 *     course:    generated Course, or null in 'error' mode,
 *     run:       RunState | null. While waiting it is a Tick-0 preview
 *                (Player and every Echo at the start state). During a
 *                Countdown it is the final state of the Run that just ended.
 *     recorder:  Recorder for the current Run (stateful object),
 *     countdown: remaining Countdown steps (0 outside Countdowns),
 *     notice:    non-fatal message after generator recovery, error text in
 *                'error' mode, otherwise null
 *   }
 *
 * events (returned by fixedStep, forwarded for audio):
 *   { flapped, died, cleared } from the Simulation Tick simulated in that
 *   step, or all false when no Tick was simulated.
 *
 * Countdowns: the step whose Tick ends the Run sets countdown = 60. Each of
 * the next 60 fixedSteps decrements it, and the 60th performs the
 * transition (next Attempt, or loadStage(stage + 1)). So exactly 60 steps
 * are spent in Countdown mode, with no Ticks simulated and nothing
 * appended (8.1, 8.2, 8.10, 9.2, A16).
 *
 * Generator recovery: any error thrown by generate() (normally a
 * GeneratorError) is logged with console.error, then the same Stage is
 * regenerated with the Stage 1 difficulty parameters and seedSalt = 1
 * (gateCount still comes from the Stage). If that fails too, mode becomes
 * 'error' and every input is ignored. Nothing is thrown out of loadStage
 * or fixedStep.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.game)
 * and through require() in Node (module.exports). No host globals are used.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? {
        constants: require('./constants.js'),
        recorder: require('./recorder.js'),
        echoManager: require('./echoManager.js'),
        simulation: require('./simulation.js'),
        stageGenerator: require('./stageGenerator.js')
      }
    : {
        constants: ns.constants,
        recorder: ns.recorder,
        echoManager: ns.echoManager,
        simulation: ns.simulation,
        stageGenerator: ns.stageGenerator
      };
  var api = factory(deps);
  ns.game = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var createRecorder = deps.recorder.createRecorder;
  var emptyEchoes = deps.echoManager.emptyEchoes;
  var storeEcho = deps.echoManager.storeEcho;
  var createRunState = deps.simulation.createRunState;
  var stepSimulation = deps.simulation.stepSimulation;
  var generateStage = deps.stageGenerator.generateStage;
  var difficulty = deps.stageGenerator.difficulty;

  var MODE_WAITING = 'waitingForFirstFlap';
  var MODE_RUNNING = 'running';
  var MODE_DEATH = 'postDeathCountdown';
  var MODE_CLEAR = 'postClearCountdown';
  var MODE_ERROR = 'error';

  var RECOVERY_NOTICE = 'Stage generation failed, using a simpler layout.';
  var ERROR_NOTICE = 'Could not generate this Stage. Reload to try again.';

  function noEvents() {
    return { flapped: false, died: false, cleared: false };
  }

  function copyGame(game) {
    return {
      mode: game.mode,
      stage: game.stage,
      attempt: game.attempt,
      echoes: game.echoes,
      course: game.course,
      run: game.run,
      recorder: game.recorder,
      countdown: game.countdown,
      notice: game.notice,
      generate: game.generate
    };
  }

  function createGame(opts) {
    var o = opts || {};
    return {
      mode: MODE_WAITING,
      stage: 1,
      attempt: 1,
      echoes: emptyEchoes(),
      course: null,
      run: null,
      recorder: createRecorder(),
      countdown: 0,
      notice: null,
      generate: typeof o.generate === 'function' ? o.generate : generateStage
    };
  }

  function logGeneratorError(stage, err) {
    var seed = err && err.seed !== undefined ? err.seed : null;
    var reason = err && err.reason !== undefined ? err.reason : String(err && err.message);
    console.error('[GhostlyEchoes] stage', stage, 'seed', seed, reason);
  }

  // Generate the Course; on failure, retry once with Stage 1 params and
  // seedSalt = 1. Returns { course, notice } or null when both fail.
  function generateWithRecovery(generate, stage) {
    try {
      return { course: generate(stage, { seedSalt: 0 }), notice: null };
    } catch (err) {
      logGeneratorError(stage, err);
    }
    var easy = difficulty(1);
    try {
      var course = generate(stage, {
        seedSalt: 1,
        paramsOverride: {
          gapPx: easy.gapPx,
          spacingPx: easy.spacingPx,
          hazardPerMille: easy.hazardPerMille
        }
      });
      return { course: course, notice: RECOVERY_NOTICE };
    } catch (err2) {
      logGeneratorError(stage, err2);
      return null;
    }
  }

  // New Stage: attempt 1, 0 Echoes, wait for the first Flap (5.7, 9.3, 9.4).
  function loadStage(game, stage) {
    var next = copyGame(game);
    next.stage = stage;
    next.attempt = 1;
    next.echoes = emptyEchoes();
    next.countdown = 0;
    next.recorder = createRecorder();

    var result = generateWithRecovery(next.generate, stage);
    if (result === null) {
      next.mode = MODE_ERROR;
      next.course = null;
      next.run = null;
      next.notice = ERROR_NOTICE;
      return next;
    }
    next.course = result.course;
    next.notice = result.notice;
    next.mode = MODE_WAITING;
    next.run = createRunState(next.course, next.echoes);
    return next;
  }

  // Back to waiting for the next Attempt of the same Stage (8.6, 8.7).
  function startNextAttempt(next) {
    next.attempt += 1;
    next.mode = MODE_WAITING;
    next.countdown = 0;
    next.run = createRunState(next.course, next.echoes);
  }

  // Finalize the Run's log and store it as an Echo when non-empty (5.1, 3.8).
  function storeRun(next) {
    var log = next.recorder.finalize();
    if (log !== null) next.echoes = storeEcho(next.echoes, log);
  }

  // Simulate one Tick of the running Run, record it, handle death / clear.
  function simulateTick(next, flap) {
    var res = stepSimulation(next.course, next.run, flap);
    next.run = res.state;
    next.recorder.append(flap);
    if (res.events.died) {
      storeRun(next);
      next.mode = MODE_DEATH;
      next.countdown = C.COUNTDOWN_STEPS;
    } else if (res.events.cleared) {
      next.recorder.finalize(); // discarded, a clear is never an Echo (5.6)
      next.mode = MODE_CLEAR;
      next.countdown = C.COUNTDOWN_STEPS;
    }
    return res.events;
  }

  function fixedStep(game, input) {
    var inp = input || {};
    var flap = inp.flap === true;
    var restart = inp.restart === true;
    var next = copyGame(game);
    var events = noEvents();

    switch (next.mode) {
      case MODE_WAITING:
        // Only a Flap starts the Run; R is ignored (8.5, 8.8, 8.9).
        if (flap && next.course) {
          next.run = createRunState(next.course, next.echoes);
          next.recorder.begin();
          next.mode = MODE_RUNNING;
          events = simulateTick(next, true);
        }
        break;

      case MODE_RUNNING:
        if (restart) {
          // Manual restart before stepping: store, next Attempt, 0 delay (8.3).
          storeRun(next);
          startNextAttempt(next);
        } else {
          events = simulateTick(next, flap);
        }
        break;

      case MODE_DEATH:
        // Inputs ignored, no Tick simulated, nothing appended (8.2, 8.10).
        next.countdown -= 1;
        if (next.countdown <= 0) startNextAttempt(next);
        break;

      case MODE_CLEAR:
        next.countdown -= 1;
        if (next.countdown <= 0) return { game: loadStage(next, next.stage + 1), events: events };
        break;

      default:
        // 'error': ignore all input.
        break;
    }

    return { game: next, events: events };
  }

  // Flaps have an effect only while waiting or while the Player is alive in
  // a running Run (2.6).
  function isAcceptingFlaps(game) {
    if (!game) return false;
    if (game.mode === MODE_WAITING) return game.course !== null;
    if (game.mode === MODE_RUNNING) return !!(game.run && game.run.player.alive);
    return false;
  }

  return Object.freeze({
    MODES: Object.freeze({
      WAITING: MODE_WAITING,
      RUNNING: MODE_RUNNING,
      POST_DEATH: MODE_DEATH,
      POST_CLEAR: MODE_CLEAR,
      ERROR: MODE_ERROR
    }),
    createGame: createGame,
    loadStage: loadStage,
    fixedStep: fixedStep,
    isAcceptingFlaps: isAcceptingFlaps
  });
});
