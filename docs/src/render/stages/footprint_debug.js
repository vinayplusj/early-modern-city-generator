// docs/src/render/stages/footprint_debug.js

import { drawPoly } from "../helpers/draw.js";

function hasPoly(p) {
  return Array.isArray(p) && p.length >= 3;
}

function clipToPoly(ctx, poly) {
  ctx.save();
  ctx.beginPath();
  drawPoly(ctx, poly, true);
  ctx.clip();
}

/**
 * Draws footprint fill + debug overlays.
 *
 * IMPORTANT:
 * - If outerBoundary exists, it is the draw-truth for the city envelope.
 * - Fill and clip should use the SAME polygon that we later stroke,
 *   otherwise you get visible slivers near the edge.
 */
export function drawFootprintAndDebugOverlays(ctx, { footprint, outerBoundary, districts, blocks }) {
  const boundaryForDraw = hasPoly(outerBoundary) ? outerBoundary : (hasPoly(footprint) ? footprint : null);

  // Footprint / boundary fill (use boundaryForDraw so fill matches the stroke)
  if (boundaryForDraw) {
    ctx.fillStyle = "#f3e7d0";
    drawPoly(ctx, boundaryForDraw, true);
    ctx.fill();
  }

  // Clip all debug overlays to the same boundary to avoid edge artefacts
  if (boundaryForDraw) {
    clipToPoly(ctx, boundaryForDraw);
  }

  // Districts (debug)
  if (districts && districts.length) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#ffffff";
    for (const d of districts) {
      if (!d.polygon || d.polygon.length < 3) continue;
      drawPoly(ctx, d.polygon, true);
      ctx.fill();
    }
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (const d of districts) {
      if (!d.polygon || d.polygon.length < 3) continue;
      drawPoly(ctx, d.polygon, true);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Blocks (debug) coloured by district
  if (blocks && blocks.length) {
    const palette = [
      "#5ddcff", "#7dffb2", "#ffd36b", "#ff7d7d",
      "#c08bff", "#7dd7ff", "#9cff7d", "#ffb27d",
      "#7d7dff", "#b2ff7d", "#ff7dd7", "#d7d7d7",
    ];

    function hashIdToIndex(id, m) {
      const s = String(id || "");
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h % m;
    }

    ctx.save();

    // Fill
    ctx.globalAlpha = 0.18;
    for (const b of blocks) {
      if (!b || !b.polygon || b.polygon.length < 3) continue;

      if (!b.districtId) ctx.fillStyle = "#ff00ff";
      else ctx.fillStyle = palette[hashIdToIndex(b.districtId, palette.length)];

      drawPoly(ctx, b.polygon, true);
      ctx.fill();
    }

    // Outline
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (const b of blocks) {
      if (!b || !b.polygon || b.polygon.length < 3) continue;

      if (!b.districtId) ctx.strokeStyle = "#ff00ff";
      else ctx.strokeStyle = palette[hashIdToIndex(b.districtId, palette.length)];

      drawPoly(ctx, b.polygon, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Undo clip if we applied it
  if (boundaryForDraw) {
    ctx.restore();
  }

  // Outer boundary stroke (draw last)
  if (hasPoly(outerBoundary)) {
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 2;
    drawPoly(ctx, outerBoundary, true);
    ctx.stroke();
  }
}
