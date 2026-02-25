// docs/src/render/stages/surroundings.js
//
// Render outside-of-city fillers ("surroundings") clipped to the area OUTSIDE outerBoundary.
// Intended for Milestone 5 biomes, but safe to include now.
//
// Inputs:
// - ctx: CanvasRenderingContext2D
// - args.outerBoundary: Array<{x,y}> polygon (not necessarily closed; >=3 points)
// - args.biome: "forest" | "farmland" | "desert" | ... (unknown values -> no-op)
// - args.tokens: style tokens from docs/src/render/style/style_tokens.js
// - args.seed: number|string (optional; used for deterministic stipple jitter)
//
// Contract:
// - Does not mutate geometry.
// - Deterministic pattern placement for a given (seed, canvas size, tokens).
// - Draws only outside the polygon (evenodd clip).

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function polyIsValid(poly) {
  return Array.isArray(poly) && poly.length >= 3 && poly.every(isFinitePoint);
}

function makeRng(seed) {
  // Deterministic, fast RNG based on xorshift32.
  // Accepts number or string.
  let h = 2166136261 >>> 0;
  const s = (seed == null) ? "0" : String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let x = (h || 1) >>> 0;

  return function next() {
    // xorshift32
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

function clipOutsidePolygon(ctx, poly, canvasW, canvasH) {
  // Clip to everything OUTSIDE poly using even-odd rule:
  // Draw a full-rect path, then the polygon path, and clip.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);

  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();

  // "evenodd" clip keeps the rect minus polygon interior.
  ctx.clip("evenodd");
}

function drawHatch(ctx, canvasW, canvasH, angleDeg, spacingPx, strokeStyle, alpha, lineWidth) {
  const ang = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);

  // Direction vector along hatch lines: (cos, sin)
  // Perpendicular direction to step: (-sin, cos)
  const px = -sin;
  const py = cos;

  // We draw lines across a bounding box bigger than the canvas to avoid gaps.
  const diag = Math.hypot(canvasW, canvasH);
  const cx = canvasW / 2;
  const cy = canvasH / 2;

  const steps = Math.ceil((diag * 2) / Math.max(1, spacingPx));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;

  for (let i = -steps; i <= steps; i++) {
    const off = i * spacingPx;

    // A point on this hatch line in canvas coords:
    const ox = cx + px * off;
    const oy = cy + py * off;

    // Draw a segment long enough to cross the whole view:
    const x0 = ox - cos * diag * 2;
    const y0 = oy - sin * diag * 2;
    const x1 = ox + cos * diag * 2;
    const y1 = oy + sin * diag * 2;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  ctx.restore();
}

function drawStipple(ctx, canvasW, canvasH, stepPx, dotRadiusPx, alpha, seed) {
  const rng = makeRng(seed);

  const step = Math.max(2, stepPx);
  const r = Math.max(0.5, dotRadiusPx);

  // Slight deterministic jitter to avoid a perfect grid look.
  const jitter = Math.min(step * 0.35, 2.5);

  ctx.save();
  ctx.globalAlpha = alpha;

  for (let y = 0; y <= canvasH + step; y += step) {
    for (let x = 0; x <= canvasW + step; x += step) {
      const jx = (rng() * 2 - 1) * jitter;
      const jy = (rng() * 2 - 1) * jitter;

      ctx.beginPath();
      ctx.arc(x + jx, y + jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Draw surroundings outside the outer boundary.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} args
 */
export function drawSurroundings(ctx, args = {}) {
  const {
    outerBoundary,
    biome,
    tokens,
    seed,
    canvasW,
    canvasH,
  } = args;

  if (!ctx || !tokens) return;
  if (!polyIsValid(outerBoundary)) return;

  const w = Number.isFinite(canvasW) ? canvasW : (ctx.canvas?.width ?? 0);
  const h = Number.isFinite(canvasH) ? canvasH : (ctx.canvas?.height ?? 0);
  if (!(w > 0 && h > 0)) return;

  const biomeKey = (typeof biome === "string") ? biome.toLowerCase() : "";
  const biomeDef = tokens?.outside?.biomes?.[biomeKey];
  if (!biomeDef) return;

  // Clip to outside-of-city
  clipOutsidePolygon(ctx, outerBoundary, w, h);

  // Draw biome pattern
  if (biomeDef.pattern === "hatch" && biomeDef.hatch) {
    const h1 = biomeDef.hatch;

    drawHatch(
      ctx,
      w,
      h,
      h1.angleDeg,
      h1.spacingPx,
      h1.stroke ?? tokens.colour.inkFaint,
      h1.alpha ?? tokens.alpha.outsideFill,
      h1.width ?? tokens.width.hairline
    );

    // Optional secondary hatch pass
    if (h1.secondary) {
      const h2 = h1.secondary;
      drawHatch(
        ctx,
        w,
        h,
        h2.angleDeg,
        h2.spacingPx,
        h1.stroke ?? tokens.colour.inkFaint,
        h2.alpha ?? 0.08,
        h2.width ?? tokens.width.hairline
      );
    }
  }

  if (biomeDef.pattern === "stipple" && biomeDef.stipple) {
    ctx.save();
    ctx.fillStyle = tokens?.outside?.common?.stroke ?? tokens.colour.inkFaint;
    ctx.restore();

    // Set fill style once (stipple uses fill)
    ctx.save();
    ctx.fillStyle = tokens?.outside?.common?.stroke ?? tokens.colour.inkFaint;
    ctx.restore();

    // Actually draw stipple
    ctx.save();
    ctx.fillStyle = tokens?.outside?.common?.stroke ?? tokens.colour.inkFaint;
    ctx.restore();

    // One save for actual drawing
    ctx.save();
    ctx.fillStyle = tokens?.outside?.common?.stroke ?? tokens.colour.inkFaint;

    drawStipple(
      ctx,
      w,
      h,
      biomeDef.stipple.stepPx,
      biomeDef.stipple.dotRadiusPx,
      biomeDef.stipple.alpha ?? tokens.alpha.outsideFillStrong,
      `stipple:${seed ?? 0}:${biomeKey}:${w}x${h}`
    );

    ctx.restore();

    // Optional hatch overlay
    if (biomeDef.overlayHatch) {
      const oh = biomeDef.overlayHatch;
      drawHatch(
        ctx,
        w,
        h,
        oh.angleDeg,
        oh.spacingPx,
        tokens.colour.inkFaint,
        oh.alpha ?? 0.08,
        oh.width ?? tokens.width.hairline
      );
    }
  }

  // Restore from clipOutsidePolygon
  ctx.restore();
}
