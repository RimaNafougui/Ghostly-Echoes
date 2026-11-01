/*
 * Ghostly Echoes - renderer.js
 * Browser shell: draws the Game onto a 2D canvas context. Read-only, it
 * never changes Game or Simulation state.
 *
 *   createRenderer(ctx, image, opts?) -> { draw(game) }
 *     ctx    CanvasRenderingContext2D (only this argument is drawn on)
 *     image  Ghosty sprite source, any of:
 *              null / undefined                -> fallback rectangles
 *              { img, ready }                  -> img used while ready is true
 *              an image with a boolean .ready  -> used while ready is true
 *              an HTMLImageElement             -> used once complete and
 *                                                 naturalWidth > 0
 *            Readiness is checked on every frame, so main.js can flip the
 *            flag in onload and the next frame picks up the sprite (11.3).
 *     opts.createCanvas(w, h)  factory for offscreen tint canvases. The
 *            default calls document.createElement('canvas') lazily, only
 *            when a tint is first needed, so this file loads in Node.
 *
 * Camera: camX (px) = player.x / FP - PLAYER_START_X, so the Player stays
 * at PLAYER_START_X on screen. Course coordinates are FP units.
 *
 * Draw order per frame (10.5):
 *   1. background, finish line, walls, Hazards
 *   2. Runes and Rune_Gates in RUNE_STYLES[styleIndex] (color + symbol, 6.9);
 *      closed gate = solid bar, open gate = dashed outline at 25 % alpha (6.12)
 *   3. Echoes: per-tint offscreen sprite (drawImage + 'source-atop' fill)
 *      at ECHO_ALPHA (4.7, 4.8); tinted rectangles if the sprite is not ready
 *   4. Player: sprite scaled to 32x32 when ready (11.3), else a filled
 *      32x32 rectangle (11.5)
 *   5. HUD via hud.drawHud(ctx, hud.getHudModel(game)) when drawHud exists
 *   6. non-fatal notice (if set)
 * In 'error' mode: background, error screen ("Reload to try again"), notice.
 *
 * Pixel data is never read back from any canvas.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.renderer)
 * and through require() in Node (module.exports). No host globals are
 * touched at load time.
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? {
        constants: require('./constants.js'),
        getHud: (function (hud) {
          return function () { return hud; };
        })(require('./hud.js'))
      }
    : {
        constants: ns.constants,
        // Looked up at draw time so a later drawHud is picked up.
        getHud: function () { return ns.hud; }
      };
  var api = factory(deps);
  ns.renderer = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;
  var getHud = deps.getHud;

  var FP = C.FP;
  var W = C.COURSE_W;
  var H = C.COURSE_H;
  var PW = C.PLAYER_W;
  var PH = C.PLAYER_H;

  var COLORS = Object.freeze({
    background: '#0d1026',
    wall: '#3a4170',
    wallEdge: '#58609a',
    hazard: '#ff4d4d',
    finish: '#ffffff',
    player: '#f2f2f2',
    text: '#ffffff',
    gateSymbol: '#0d1026',
    notice: '#ffd84d',
    errorTitle: '#ff7a7a'
  });

  var OPEN_GATE_ALPHA = 0.25; // 6.12
  var OPEN_GATE_SYMBOL_ALPHA = 0.6;
  var TINT_FILL_ALPHA = 0.65; // tint strength over the sprite silhouette
  var MARGIN = 12;

  // Returns a drawable image source when the sprite is ready, else null.
  function readySource(image) {
    if (!image) return null;
    if (image.img !== undefined) return image.ready === true && image.img ? image.img : null;
    if (typeof image.ready === 'boolean') return image.ready ? image : null;
    if (image.complete === true && image.naturalWidth > 0) return image;
    return null;
  }

  function defaultCreateCanvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function createRenderer(ctx, image, opts) {
    var o = opts || {};
    var createCanvas = typeof o.createCanvas === 'function' ? o.createCanvas : defaultCreateCanvas;

    // Per-tint offscreen canvases, rebuilt if the sprite source changes.
    var tintSource = null;
    var tintCache = [];

    function tintedSprite(src, tintIndex) {
      if (src !== tintSource) {
        tintSource = src;
        tintCache = [];
      }
      if (tintCache[tintIndex] !== undefined) return tintCache[tintIndex];
      var canvas = null;
      try {
        canvas = createCanvas(PW, PH);
        var octx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
        if (!octx) {
          canvas = null;
        } else {
          octx.clearRect(0, 0, PW, PH);
          octx.globalCompositeOperation = 'source-over';
          octx.drawImage(src, 0, 0, PW, PH);
          // source-atop paints only over existing sprite pixels (4.7).
          octx.globalCompositeOperation = 'source-atop';
          octx.globalAlpha = TINT_FILL_ALPHA;
          octx.fillStyle = C.ECHO_TINTS[tintIndex % C.ECHO_TINTS.length];
          octx.fillRect(0, 0, PW, PH);
          octx.globalAlpha = 1;
          octx.globalCompositeOperation = 'source-over';
        }
      } catch (e) {
        canvas = null; // fall back to tinted rectangles
      }
      tintCache[tintIndex] = canvas;
      return canvas;
    }

    // --- helpers -----------------------------------------------------

    function screenRect(r, camX) {
      return {
        x: r.l / FP - camX,
        y: r.t / FP,
        w: (r.r - r.l) / FP,
        h: (r.b - r.t) / FP
      };
    }

    function visible(s) {
      return s.x + s.w >= 0 && s.x <= W;
    }

    function drawBackground() {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    function drawSymbol(symbol, color, cx, cy, sizePx) {
      ctx.fillStyle = color;
      ctx.font = sizePx + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, cx, cy);
    }

    function drawFinish(course, camX) {
      if (typeof course.finishX !== 'number') return;
      var x = course.finishX / FP - camX;
      if (x < 0 || x > W) return;
      ctx.save();
      ctx.strokeStyle = COLORS.finish;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
    }

    function drawWalls(course, camX) {
      var walls = course.walls || [];
      ctx.save();
      for (var i = 0; i < walls.length; i++) {
        var s = screenRect(walls[i], camX);
        if (!visible(s)) continue;
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeStyle = COLORS.wallEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      }
      ctx.restore();
    }

    function drawHazards(course, camX) {
      var hazards = course.hazards || [];
      ctx.save();
      ctx.fillStyle = COLORS.hazard;
      for (var i = 0; i < hazards.length; i++) {
        var s = screenRect(hazards[i], camX);
        if (!visible(s)) continue;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
      ctx.restore();
    }

    function styleFor(course, k) {
      var gate = course.gates && course.gates[k];
      var idx = gate && typeof gate.styleIndex === 'number' ? gate.styleIndex : k;
      return C.RUNE_STYLES[idx % C.RUNE_STYLES.length];
    }

    function drawRunesAndGates(course, run, camX) {
      var runes = course.runes || [];
      var gates = course.gates || [];
      var gateStates = (run && run.gates) || [];
      var k, s, style;

      // Runes: translucent fill, outline and symbol in the pair's color.
      for (k = 0; k < runes.length; k++) {
        s = screenRect(runes[k], camX);
        if (!visible(s)) continue;
        style = styleFor(course, k);
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = style.color;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = style.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        drawSymbol(style.symbol, style.color, s.x + s.w / 2, s.y + s.h / 2, 20);
        ctx.restore();
      }

      // Gates: state from the RunState for the current Tick (6.12).
      for (k = 0; k < gates.length; k++) {
        if (!gates[k] || !gates[k].rect) continue;
        s = screenRect(gates[k].rect, camX);
        if (!visible(s)) continue;
        style = styleFor(course, k);
        var open = !!(gateStates[k] && gateStates[k].open);
        ctx.save();
        if (open) {
          ctx.globalAlpha = OPEN_GATE_ALPHA;
          ctx.strokeStyle = style.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(s.x, s.y, s.w, s.h);
          ctx.setLineDash([]);
          ctx.globalAlpha = OPEN_GATE_SYMBOL_ALPHA;
          drawSymbol(style.symbol, style.color, s.x + s.w / 2, s.y + s.h / 2, 18);
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.color;
          ctx.fillRect(s.x, s.y, s.w, s.h);
          drawSymbol(style.symbol, COLORS.gateSymbol, s.x + s.w / 2, s.y + s.h / 2, 18);
        }
        ctx.restore();
      }
    }

    function drawEchoes(run, camX, src) {
      var echoes = (run && run.echoes) || [];
      ctx.save();
      ctx.globalAlpha = C.ECHO_ALPHA; // 4.7
      for (var i = 0; i < echoes.length; i++) {
        var e = echoes[i];
        var x = e.x / FP - camX;
        var y = e.y / FP;
        var tintIndex = typeof e.tintIndex === 'number' ? e.tintIndex : i;
        var sprite = src ? tintedSprite(src, tintIndex) : null;
        if (sprite) {
          ctx.drawImage(sprite, x, y, PW, PH);
        } else {
          ctx.fillStyle = C.ECHO_TINTS[tintIndex % C.ECHO_TINTS.length];
          ctx.fillRect(x, y, PW, PH);
        }
      }
      ctx.restore();
    }

    function drawPlayer(run, camX, src) {
      if (!run || !run.player) return;
      var x = run.player.x / FP - camX;
      var y = run.player.y / FP;
      ctx.save();
      ctx.globalAlpha = 1;
      if (src) {
        ctx.drawImage(src, x, y, PW, PH); // 11.3
      } else {
        ctx.fillStyle = COLORS.player; // 11.5
        ctx.fillRect(x, y, PW, PH);
      }
      ctx.restore();
    }

    function drawHudLayer(game) {
      var hud = getHud();
      if (!hud || typeof hud.drawHud !== 'function' || typeof hud.getHudModel !== 'function') return;
      ctx.save();
      hud.drawHud(ctx, hud.getHudModel(game));
      ctx.restore();
    }

    function drawNotice(text, y) {
      if (typeof text !== 'string' || text === '') return;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.notice;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      // maxWidth keeps the text inside the canvas.
      ctx.fillText(text, W - MARGIN, y, W - 2 * MARGIN);
      ctx.restore();
    }

    function drawErrorScreen(game) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.errorTitle;
      ctx.font = '28px sans-serif';
      ctx.fillText('Something went wrong', W / 2, H / 2 - 40, W - 2 * MARGIN);
      ctx.fillStyle = COLORS.text;
      ctx.font = '20px sans-serif';
      ctx.fillText('Reload to try again', W / 2, H / 2, W - 2 * MARGIN);
      ctx.restore();
      if (game && game.notice) {
        ctx.save();
        ctx.fillStyle = COLORS.notice;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(game.notice, W / 2, H / 2 + 40, W - 2 * MARGIN);
        ctx.restore();
      }
    }

    // --- frame -------------------------------------------------------

    function draw(game) {
      drawBackground();
      if (!game || game.mode === 'error' || !game.course) {
        drawErrorScreen(game);
        return;
      }
      var course = game.course;
      var run = game.run;
      var src = readySource(image);
      var camX = run && run.player ? run.player.x / FP - C.PLAYER_START_X : 0;

      drawFinish(course, camX);
      drawWalls(course, camX);
      drawHazards(course, camX);
      drawRunesAndGates(course, run, camX);
      drawEchoes(run, camX, src);
      drawPlayer(run, camX, src);
      drawHudLayer(game); // after all Course elements and Ghosts (10.5)
      drawNotice(game.notice, MARGIN);
    }

    return Object.freeze({ draw: draw });
  }

  return Object.freeze({
    createRenderer: createRenderer,
    readySource: readySource
  });
});
