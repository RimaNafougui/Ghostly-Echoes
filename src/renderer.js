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
 *     opts.createCanvas(w, h)  factory for offscreen canvases (brick tile,
 *            vignette, Echo tints). The default calls
 *            document.createElement('canvas') only when createRenderer or
 *            draw runs, so this file loads in Node.
 *
 * Camera: camX (px) = player.x / FP - PLAYER_START_X, so the Player stays
 * at PLAYER_START_X on screen. Course coordinates are FP units.
 *
 * Castle theme: the background is a brick wall pre-rendered once into a
 * horizontally seamless tile (half-brick row offset, mortar lines, per-brick
 * color from a deterministic hash of row and column, a dim torch glow) and
 * tiled every frame with parallax at 40 % of the camera speed. A vignette
 * overlay, also pre-rendered once, darkens the edges. Colors come from
 * constants.PALETTE. The wallpaper is darker and lower in contrast than
 * every gameplay object.
 *
 * Draw order per frame (10.5):
 *   1. background (brick tile + vignette), finish line, walls, Hazards
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
  var P = C.PALETTE;

  var FP = C.FP;
  var W = C.COURSE_W;
  var H = C.COURSE_H;
  var PW = C.PLAYER_W;
  var PH = C.PLAYER_H;

  var OPEN_GATE_ALPHA = 0.25; // 6.12
  var OPEN_GATE_SYMBOL_ALPHA = 0.6;
  var TINT_FILL_ALPHA = 0.65; // tint strength over the sprite silhouette
  var MARGIN = 12;

  // Brick wallpaper geometry (px). One tile = TILE_COLS bricks wide and the
  // full Course height, so it only repeats horizontally.
  var BRICK_W = 44;
  var BRICK_H = 20;
  var MORTAR = 4;
  var PITCH_X = BRICK_W + MORTAR; // 48
  var PITCH_Y = BRICK_H + MORTAR; // 24
  var TILE_COLS = 8;
  var TILE_W = TILE_COLS * PITCH_X; // 384
  var TILE_H = H;
  var PARALLAX = 0.4; // wallpaper scrolls at 40 % of the camera speed
  var TORCH_Y = 120;
  var TORCH_RADIUS = 170; // < TILE_W / 2, so the glow fades out before the tile edge
  var STONE_SEAM = 30;

  // Deterministic 32-bit hash of a brick's row and column (no randomness).
  function brickHash(row, col) {
    var h = Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(col + 1, 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return h >>> 0;
  }

  // Same rgba() color with alpha 0 (for gradient end stops).
  function transparent(rgba) {
    return String(rgba).replace(/,\s*[\d.]+\)\s*$/, ', 0)');
  }

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

  // Offscreen canvas with its 2D context, or null if unavailable.
  function offscreen(createCanvas, w, h) {
    try {
      var canvas = createCanvas(w, h);
      var octx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
      return octx ? { canvas: canvas, ctx: octx } : null;
    } catch (e) {
      return null;
    }
  }

  // Horizontally seamless brick tile. Bricks are colored by their column
  // index modulo TILE_COLS, and bricks that cross the left or right edge are
  // drawn on both sides, so tile copies placed side by side line up exactly.
  function buildBrickTile(createCanvas) {
    var off = offscreen(createCanvas, TILE_W, TILE_H);
    if (!off) return null;
    var c = off.ctx;
    var colors = P.brick;
    c.fillStyle = P.mortar;
    c.fillRect(0, 0, TILE_W, TILE_H);

    var rows = Math.ceil(TILE_H / PITCH_Y);
    for (var r = 0; r < rows; r++) {
      var rowOffset = r % 2 === 1 ? PITCH_X / 2 : 0; // half-brick offset
      var y = r * PITCH_Y + MORTAR / 2;
      for (var k = -1; k <= TILE_COLS; k++) {
        var x = k * PITCH_X + rowOffset + MORTAR / 2;
        if (x >= TILE_W || x + BRICK_W <= 0) continue;
        var col = ((k % TILE_COLS) + TILE_COLS) % TILE_COLS;
        var h = brickHash(r, col);
        c.fillStyle = colors[h % colors.length];
        c.fillRect(x, y, BRICK_W, BRICK_H);
        // Slight per-brick brightness variation.
        var v = (h >>> 8) % 4;
        if (v === 0) {
          c.fillStyle = 'rgba(0, 0, 0, 0.14)';
          c.fillRect(x, y, BRICK_W, BRICK_H);
        } else if (v === 1) {
          c.fillStyle = 'rgba(255, 220, 190, 0.04)';
          c.fillRect(x, y, BRICK_W, BRICK_H);
        }
        // Worn top edge and shaded bottom edge.
        c.fillStyle = P.brickHighlight;
        c.fillRect(x, y, BRICK_W, 2);
        c.fillStyle = P.brickShade;
        c.fillRect(x, y + BRICK_H - 3, BRICK_W, 3);
      }
    }

    // Dim the whole wall so it stays behind the gameplay objects.
    c.fillStyle = P.wallDim;
    c.fillRect(0, 0, TILE_W, TILE_H);

    // Warm, dim torch light in the middle of the tile. The radius is under
    // half the tile width, so the glow is fully transparent at the seams.
    var cx = TILE_W / 2;
    var glow = c.createRadialGradient(cx, TORCH_Y, 0, cx, TORCH_Y, TORCH_RADIUS);
    glow.addColorStop(0, P.torchGlow);
    glow.addColorStop(1, transparent(P.torchGlow));
    c.fillStyle = glow;
    c.fillRect(0, 0, TILE_W, TILE_H);
    return off.canvas;
  }

  // Screen-space vignette: transparent center, dark edges.
  function buildVignette(createCanvas) {
    var off = offscreen(createCanvas, W, H);
    if (!off) return null;
    var c = off.ctx;
    var outer = Math.sqrt((W / 2) * (W / 2) + (H / 2) * (H / 2));
    var g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, outer);
    g.addColorStop(0, transparent(P.vignette));
    g.addColorStop(1, P.vignette);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    return off.canvas;
  }

  function createRenderer(ctx, image, opts) {
    var o = opts || {};
    var createCanvas = typeof o.createCanvas === 'function' ? o.createCanvas : defaultCreateCanvas;

    // Pre-rendered once at startup; null means a flat fallback background.
    var brickTile = buildBrickTile(createCanvas);
    var vignette = buildVignette(createCanvas);

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
      var off = offscreen(createCanvas, PW, PH);
      if (off) {
        try {
          var octx = off.ctx;
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
          canvas = off.canvas;
        } catch (e) {
          canvas = null; // fall back to tinted rectangles
        }
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

    function textWidth(text) {
      if (typeof ctx.measureText !== 'function') return 0;
      var m = ctx.measureText(text);
      return m && typeof m.width === 'number' ? m.width : 0;
    }

    // Dark semi-transparent panel behind text, clamped to the canvas.
    function backing(x, y, w, h) {
      var l = Math.max(0, x);
      var t = Math.max(0, y);
      var r = Math.min(W, x + w);
      var b = Math.min(H, y + h);
      if (r <= l || b <= t) return;
      ctx.fillStyle = P.textBacking;
      ctx.fillRect(l, t, r - l, b - t);
    }

    // Brick wallpaper with parallax, then the vignette (all pre-rendered).
    function drawBackground(camX) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = P.mortar;
      ctx.fillRect(0, 0, W, H);
      if (brickTile) {
        var shift = Math.floor(camX * PARALLAX);
        var offset = ((shift % TILE_W) + TILE_W) % TILE_W;
        for (var x = -offset; x < W; x += TILE_W) ctx.drawImage(brickTile, x, 0);
      }
      if (vignette) ctx.drawImage(vignette, 0, 0);
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
      ctx.strokeStyle = P.finish;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
    }

    // Cool weathered stone, clearly unlike the red/brown bricks behind it.
    function drawWalls(course, camX) {
      var walls = course.walls || [];
      ctx.save();
      for (var i = 0; i < walls.length; i++) {
        var s = screenRect(walls[i], camX);
        if (!visible(s)) continue;
        ctx.fillStyle = P.stone;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        // Horizontal seams between stone blocks.
        ctx.fillStyle = P.stoneEdge;
        ctx.globalAlpha = 0.35;
        for (var y = s.y + STONE_SEAM; y < s.y + s.h - 2; y += STONE_SEAM) {
          ctx.fillRect(s.x, y, s.w, 1);
        }
        // Lit left edge.
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.stoneHighlight;
        ctx.fillRect(s.x, s.y, Math.min(3, s.w), s.h);
        ctx.strokeStyle = P.stoneEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 1, s.y + 1, Math.max(0, s.w - 2), Math.max(0, s.h - 2));
      }
      ctx.restore();
    }

    function drawHazards(course, camX) {
      var hazards = course.hazards || [];
      ctx.save();
      for (var i = 0; i < hazards.length; i++) {
        var s = screenRect(hazards[i], camX);
        if (!visible(s)) continue;
        ctx.fillStyle = P.hazard;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeStyle = P.hazardEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
        // Cross mark so it reads as dangerous at a glance.
        ctx.beginPath();
        ctx.moveTo(s.x + 6, s.y + 6);
        ctx.lineTo(s.x + s.w - 6, s.y + s.h - 6);
        ctx.moveTo(s.x + s.w - 6, s.y + 6);
        ctx.lineTo(s.x + 6, s.y + s.h - 6);
        ctx.stroke();
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

      // Runes: dark backing, translucent color fill, outline and symbol.
      for (k = 0; k < runes.length; k++) {
        s = screenRect(runes[k], camX);
        if (!visible(s)) continue;
        style = styleFor(course, k);
        ctx.save();
        ctx.fillStyle = P.textBacking;
        ctx.fillRect(s.x, s.y, s.w, s.h);
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
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(s.x, s.y, s.w, s.h);
          ctx.setLineDash([]);
          ctx.globalAlpha = OPEN_GATE_SYMBOL_ALPHA;
          drawSymbol(style.symbol, style.color, s.x + s.w / 2, s.y + s.h / 2, 18);
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.color;
          ctx.fillRect(s.x, s.y, s.w, s.h);
          ctx.strokeStyle = P.gateEdge;
          ctx.lineWidth = 2;
          ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
          drawSymbol(style.symbol, P.gateSymbol, s.x + s.w / 2, s.y + s.h / 2, 18);
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
        ctx.fillStyle = P.player; // 11.5
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
      ctx.font = '14px sans-serif';
      var maxW = W - 2 * MARGIN;
      var w = Math.min(maxW, textWidth(text));
      backing(W - MARGIN - w - 6, y - 4, w + 12, 14 + 8);
      ctx.fillStyle = P.notice;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      // maxWidth keeps the text inside the canvas.
      ctx.fillText(text, W - MARGIN, y, maxW);
      ctx.restore();
    }

    function drawErrorScreen(game) {
      ctx.save();
      ctx.globalAlpha = 1;
      backing(MARGIN, H / 2 - 70, W - 2 * MARGIN, 140);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = P.errorTitle;
      ctx.font = '28px sans-serif';
      ctx.fillText('Something went wrong', W / 2, H / 2 - 40, W - 2 * MARGIN);
      ctx.fillStyle = P.text;
      ctx.font = '20px sans-serif';
      ctx.fillText('Reload to try again', W / 2, H / 2, W - 2 * MARGIN);
      ctx.restore();
      if (game && game.notice) {
        ctx.save();
        ctx.fillStyle = P.notice;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(game.notice, W / 2, H / 2 + 40, W - 2 * MARGIN);
        ctx.restore();
      }
    }

    // --- frame -------------------------------------------------------

    function draw(game) {
      if (!game || game.mode === 'error' || !game.course) {
        drawBackground(0);
        drawErrorScreen(game);
        return;
      }
      var course = game.course;
      var run = game.run;
      var src = readySource(image);
      var camX = run && run.player ? run.player.x / FP - C.PLAYER_START_X : 0;

      drawBackground(camX);
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
    readySource: readySource,
    brickHash: brickHash
  });
});
