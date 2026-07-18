/* ============================================================
   PB Mag — "Invisible Ink" hero veil
   A grain-textured veil sits over the hero; pointer movement
   brushes it away with soft feathered strokes. Auto-reveals
   after 8s idle, on Skip, or once ~65% is uncovered.
   ============================================================ */

(function () {
  "use strict";

  var hero = document.getElementById("hero");
  var canvas = document.getElementById("veil");
  var skipBtn = document.getElementById("veil-skip");
  if (!hero || !canvas || !skipBtn) return;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    finishInstantly();
    return;
  }

  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var isCoarse = window.matchMedia("(pointer: coarse)").matches;

  // Mask canvas: low-res accumulator of revealed area. Upscaling it
  // back onto the veil is what gives the strokes their soft edge.
  var MASK_SCALE = 0.25;
  var mask = document.createElement("canvas");
  var mctx = mask.getContext("2d");

  // Grain tiles: a few pre-rendered noise frames cycled slowly so the
  // veil feels alive (mist, not a flat screenshot of noise).
  var TILE = 192;
  var tiles = [];
  var TILE_COUNT = isCoarse ? 2 : 3;

  var w = 0, h = 0;
  var done = false;
  var finishing = false;
  var lastPointer = null;
  var strokes = 0;
  var idleTimer = null;
  var rafId = null;
  var frame = 0;

  var BRUSH = isCoarse ? 90 : 120; // css px, mid of the 80–150 spec

  function makeTiles() {
    tiles.length = 0;
    for (var t = 0; t < TILE_COUNT; t++) {
      var c = document.createElement("canvas");
      c.width = TILE;
      c.height = TILE;
      var x = c.getContext("2d");
      var img = x.createImageData(TILE, TILE);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = Math.random();
        // sparse paper-toned specks over transparency; the veil's
        // base coat supplies the black
        if (v > 0.82) {
          d[i] = 244; d[i + 1] = 241; d[i + 2] = 234;
          d[i + 3] = Math.floor(18 + Math.random() * 40);
        } else if (v < 0.08) {
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
          d[i + 3] = Math.floor(30 + Math.random() * 50);
        } else {
          d[i + 3] = 0;
        }
      }
      x.putImageData(img, 0, 0);
      tiles.push(c);
    }
  }

  function resize() {
    var r = hero.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // preserve revealed area across resizes (unless the old mask was
    // degenerate, e.g. measured before layout settled)
    var old = null;
    if (mask.width > 4 && mask.height > 4) old = mask;
    var nm = document.createElement("canvas");
    nm.width = Math.max(1, Math.round(w * MASK_SCALE));
    nm.height = Math.max(1, Math.round(h * MASK_SCALE));
    var nctx = nm.getContext("2d");
    if (old) nctx.drawImage(old, 0, 0, nm.width, nm.height);
    mask = nm;
    mctx = nctx;
  }

  function stamp(cssX, cssY, radius) {
    var x = cssX * MASK_SCALE;
    var y = cssY * MASK_SCALE;
    var r = radius * MASK_SCALE;
    var g = mctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.55, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.fill();
  }

  function onMove(e) {
    if (done || finishing) return;
    var r = canvas.getBoundingClientRect();
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;

    // interpolate between events so fast sweeps leave a continuous stroke
    if (lastPointer) {
      var dx = x - lastPointer.x;
      var dy = y - lastPointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.min(24, Math.max(1, Math.floor(dist / (BRUSH * 0.28))));
      for (var i = 1; i <= steps; i++) {
        stamp(lastPointer.x + (dx * i) / steps, lastPointer.y + (dy * i) / steps, BRUSH);
      }
      strokes += steps;
    } else {
      stamp(x, y, BRUSH);
      strokes++;
    }
    lastPointer = { x: x, y: y };
    armIdleTimer();

    // periodically check coverage; hand the last stretch to the dissolve
    if (strokes > 40 && strokes % 24 === 0 && coverage() > 0.65) beginFinish();
  }

  function onPointerDown(e) {
    lastPointer = null;
    onMove(e);
  }

  function onLeave() {
    lastPointer = null;
  }

  function coverage() {
    var step = 6;
    var data = mctx.getImageData(0, 0, mask.width, mask.height).data;
    var hit = 0, total = 0;
    for (var i = 3; i < data.length; i += 4 * step) {
      total++;
      if (data[i] > 140) hit++;
    }
    return total ? hit / total : 0;
  }

  function render() {
    if (done) return;
    frame++;

    // layout can settle after init (fonts, image, pane restore) — re-measure
    if (Math.abs(hero.clientWidth - w) > 1 || Math.abs(hero.clientHeight - h) > 1) {
      resize();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);

    // base coat — near-black veil with a faint vertical drift
    var base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#0A0A0A");
    base.addColorStop(1, "#101010");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // living grain — cycle tiles at ~10fps with a slow drift
    var tile = tiles[Math.floor(frame / 6) % tiles.length];
    var drift = (frame * 0.15) % TILE;
    ctx.save();
    ctx.translate(-drift, -drift * 0.6);
    ctx.fillStyle = ctx.createPattern(tile, "repeat");
    ctx.fillRect(0, 0, w + TILE, h + TILE);
    ctx.restore();

    // carve out the revealed area
    ctx.globalCompositeOperation = "destination-out";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, w, h);

    rafId = requestAnimationFrame(render);
  }

  /* ---- completion ---- */

  function beginFinish() {
    if (finishing || done) return;
    finishing = true;
    skipBtn.classList.add("done");
    clearTimeout(idleTimer);

    // mist evaporation: soft blooms scattered across the veil while
    // the whole mask brightens, then the canvas is removed
    var start = performance.now();
    var DURATION = 1600;

    function evaporate(now) {
      var t = Math.min(1, (now - start) / DURATION);
      var eased = t * t * (3 - 2 * t); // smoothstep

      for (var i = 0; i < 6; i++) {
        stamp(Math.random() * w, Math.random() * h, BRUSH * (1.5 + eased * 3));
      }
      mctx.fillStyle = "rgba(255,255,255," + (0.02 + eased * 0.09) + ")";
      mctx.fillRect(0, 0, mask.width, mask.height);

      if (t < 1) {
        requestAnimationFrame(evaporate);
      } else {
        finishInstantly();
      }
    }
    requestAnimationFrame(evaporate);
  }

  function finishInstantly() {
    done = true;
    if (rafId) cancelAnimationFrame(rafId);
    canvas.classList.add("done");
    skipBtn.classList.add("done");
    skipBtn.setAttribute("tabindex", "-1");
  }

  function armIdleTimer() {
    if (window.location.search.indexOf("noidle") !== -1) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(beginFinish, 8000);
  }

  /* ---- wire up ---- */

  makeTiles();
  resize();
  render();
  armIdleTimer();

  if (window.location.search.indexOf("noidle") !== -1) {
    window.__veilDebug = {
      coverage: coverage,
      state: function () {
        return { strokes: strokes, finishing: finishing, done: done, maskW: mask.width, maskH: mask.height, w: w, h: h };
      }
    };
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerleave", onLeave);
  skipBtn.addEventListener("click", beginFinish);
  window.addEventListener("resize", function () {
    if (!done) resize();
  });
})();
