/*
 * Ghostly Echoes - hud.js
 * HUD model (pure, core) and, later, HUD drawing (browser shell).
 *
 *   getHudModel(game) -> { lines: ['Stage: S', 'Attempt: N', 'Echoes: X/3'], hint }
 *     hint is the Stage 1 hint on Stage 1 and null on every other Stage
 *     (10.1-10.3, 10.7, 10.8). Produced in every mode, including both
 *     Countdowns and 'error' mode (where game.course is null); the
 *     Renderer decides what to draw. Read-only: the Game object is never
 *     written, frozen or otherwise changed (10.6).
 *
 *   drawHud(ctx, model)
 *     Stats top-left, 16px font, 20 px line height, 12 px margins (rows at
 *     y = 12, 32, 52, textBaseline 'top'). The hint is word-wrapped to
 *     COURSE_W - 24 with ctx.measureText and bottom-aligned 12 px above the
 *     canvas bottom; it is skipped if its top would reach into the stats
 *     block. fillText always gets maxWidth so no text leaves the canvas
 *     (10.4, 10.5, 10.7). The game.notice drawn by the Renderer sits
 *     top-right, so it does not collide with the stats.
 *
 * The pure part has no host-global access. drawHud only touches the ctx
 * argument it receives, so this file still loads in Node.
 *
 * Loads as a classic <script> (attaches to globalThis.GhostlyEchoes.hud)
 * and through require() in Node (module.exports).
 */
(function (root, factory) {
  var ns = (root.GhostlyEchoes = root.GhostlyEchoes || {});
  var isNode = typeof module === 'object' && module.exports;
  var deps = isNode
    ? { constants: require('./constants.js') }
    : { constants: ns.constants };
  var api = factory(deps);
  ns.hud = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.constants;

  // ---------------------------------------------------------------------
  // Pure HUD model (core, DOM-free)
  // ---------------------------------------------------------------------

  function getHudModel(game) {
    var g = game || {};
    var stage = g.stage;
    var attempt = g.attempt;
    var echoCount = Array.isArray(g.echoes) ? g.echoes.length : 0;
    return {
      lines: [
        'Stage: ' + stage,
        'Attempt: ' + attempt,
        'Echoes: ' + echoCount + '/' + C.MAX_ECHOES
      ],
      hint: stage === 1 ? C.STAGE1_HINT : null
    };
  }

  // ---------------------------------------------------------------------
  // HUD drawing (browser shell). Only touches the ctx argument.
  // ---------------------------------------------------------------------

  var HUD_FONT_PX = 16;
  var HUD_LINE_H = 20;
  var HUD_MARGIN = 12;
  var HUD_FONT = HUD_FONT_PX + 'px sans-serif';
  var HUD_TEXT = '#ffffff';
  var HUD_SHADOW = 'rgba(0, 0, 0, 0.85)';

  function textWidth(ctx, text) {
    var m = ctx.measureText(text);
    return m && typeof m.width === 'number' ? m.width : 0;
  }

  // Splits a word wider than maxWidth into pieces that each fit.
  function breakWord(ctx, word, maxWidth) {
    var pieces = [];
    var cur = '';
    for (var i = 0; i < word.length; i++) {
      var next = cur + word.charAt(i);
      if (cur !== '' && textWidth(ctx, next) > maxWidth) {
        pieces.push(cur);
        cur = word.charAt(i);
      } else {
        cur = next;
      }
    }
    if (cur !== '') pieces.push(cur);
    return pieces;
  }

  // Greedy word wrap using ctx.measureText (font must already be set).
  function wrapText(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/).filter(function (w) { return w !== ''; });
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var parts = textWidth(ctx, words[i]) > maxWidth ? breakWord(ctx, words[i], maxWidth) : [words[i]];
      for (var j = 0; j < parts.length; j++) {
        var joined = line === '' ? parts[j] : line + ' ' + parts[j];
        if (line !== '' && textWidth(ctx, joined) > maxWidth) {
          lines.push(line);
          line = parts[j];
        } else {
          line = joined;
        }
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  }

  // Stats top-left (16 px font, 12 px margins). Hint word-wrapped to
  // COURSE_W - 24, bottom-aligned 12 px above the canvas bottom, drawn only
  // if its top stays below the stats block (10.4, 10.5, 10.7).
  function drawHud(ctx, model) {
    if (!ctx || typeof ctx.fillText !== 'function' || !model) return;
    var lines = Array.isArray(model.lines) ? model.lines : [];
    var maxWidth = C.COURSE_W - 2 * HUD_MARGIN;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = HUD_FONT;
    ctx.fillStyle = HUD_TEXT;
    ctx.shadowColor = HUD_SHADOW;
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = 'left';

    // Stats block: top-aligned rows starting at y = 12.
    ctx.textBaseline = 'top';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(String(lines[i]), HUD_MARGIN, HUD_MARGIN + i * HUD_LINE_H, maxWidth);
    }
    var statsBottom = HUD_MARGIN + lines.length * HUD_LINE_H;

    // Hint: bottom-aligned rows ending 12 px above the canvas bottom.
    if (typeof model.hint === 'string' && model.hint !== '') {
      var hintLines = wrapText(ctx, model.hint, maxWidth);
      var bottom = C.COURSE_H - HUD_MARGIN;
      var top = bottom - hintLines.length * HUD_LINE_H;
      if (hintLines.length > 0 && top >= statsBottom) {
        ctx.textBaseline = 'bottom';
        for (var k = 0; k < hintLines.length; k++) {
          var y = bottom - (hintLines.length - 1 - k) * HUD_LINE_H;
          ctx.fillText(hintLines[k], HUD_MARGIN, y, maxWidth);
        }
      }
    }
    ctx.restore();
  }

  return Object.freeze({
    getHudModel: getHudModel,
    drawHud: drawHud,
    wrapText: wrapText
  });
});
