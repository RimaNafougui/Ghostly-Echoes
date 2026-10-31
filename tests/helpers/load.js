/*
 * Ghostly Echoes - tests/helpers/load.js
 * Loads the core scripts from src/ in Node through require(), relying on the
 * guarded UMD-style export in each file. No DOM globals are defined here.
 *
 * Modules are exposed through lazy getters, so a test only requires the
 * modules it touches. Accessing a module whose file does not exist yet throws
 * a descriptive error instead of breaking every test that loads this helper.
 *
 * Usage:
 *   const core = require('./helpers/load.js');
 *   const { stepGhost } = core.physics;
 *   if (core.has('simulation')) { ... }
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');

// Namespace key -> file name, in the design's dependency order.
const MODULES = Object.freeze({
  constants: 'constants.js',
  rng: 'rng.js',
  physics: 'physics.js',
  gates: 'gates.js',
  recorder: 'recorder.js',
  echoManager: 'echoManager.js',
  simulation: 'simulation.js',
  stageGenerator: 'stageGenerator.js',
  game: 'game.js',
  hud: 'hud.js',
  main: 'main.js'
});

function modulePath(name) {
  if (!Object.prototype.hasOwnProperty.call(MODULES, name)) {
    throw new Error('[load] unknown core module "' + name + '"');
  }
  return path.join(SRC_DIR, MODULES[name]);
}

// True if the module's source file exists in src/.
function has(name) {
  return fs.existsSync(modulePath(name));
}

// Throws if browser globals leak into the Node test environment (12.2).
// (`navigator` is not checked: Node 21+ defines it natively.)
function assertNoDom() {
  ['window', 'document', 'HTMLCanvasElement', 'requestAnimationFrame'].forEach(function (g) {
    if (typeof globalThis[g] !== 'undefined') {
      throw new Error('[load] DOM global "' + g + '" is defined in the test environment');
    }
  });
}

const cache = Object.create(null);

function load(name) {
  if (name in cache) return cache[name];
  const file = modulePath(name);
  if (!fs.existsSync(file)) {
    throw new Error('[load] core module "' + name + '" not found at ' + file);
  }
  assertNoDom();
  const api = require(file);
  cache[name] = api;
  return api;
}

const core = { has: has, load: load, assertNoDom: assertNoDom, SRC_DIR: SRC_DIR, MODULES: MODULES };

Object.keys(MODULES).forEach(function (name) {
  Object.defineProperty(core, name, {
    enumerable: true,
    configurable: false,
    get: function () {
      return load(name);
    }
  });
});

module.exports = core;
