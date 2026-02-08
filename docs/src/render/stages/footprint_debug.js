// docs/src/render/stages/footprint_debug.js

import { drawPoly } from "../helpers/draw.js";

export function drawFootprintAndDebugOverlays(ctx, { footprint, outerBoundary, districts, blocks }) {
  // Footprint fill
  if (footprint && footprint.length >= 3) {
    ctx.fillStyle = "#151515";
    drawPoly(ctx, footprint, true);
    ctx.fill();
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

      if (!b.districtId) {
        ctx.fillStyle = "#ff00ff";
      } else {
        ctx.fillStyle = palette[hashIdToIndex(b.districtId, palette.length)];
      }

      drawPoly(ctx, b.polygon, true);
      ctx.fill();
    }

    // Outline
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (const b of blocks) {
      if (!b || !b.polygon || b.polygon.length < 3) continue;

      if (!b.districtId) {
        ctx.strokeStyle = "#ff00ff";
      } else {
        ctx.strokeStyle = palette[hashIdToIndex(b.districtId, palette.length)];
      }

      drawPoly(ctx, b.polygon, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Outer boundary (convex hull) stroke
  if (outerBoundary && outerBoundary.length >= 3) {
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 2;
    drawPoly(ctx, outerBoundary, true);
    ctx.stroke();
  }
}
