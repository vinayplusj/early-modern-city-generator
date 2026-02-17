// docs/src/render/stages/walls_rings_warp.js

import { drawPoly } from "../helpers/draw.js";

export function drawWallsAndRingsAndWarp(ctx, { wall, wallBase, bastionPolys, ring, ring2, warp }) {
  // Bastioned wall (final)
  if (wall && wall.length >= 3) {
    const wallStroke = warp?.wall?.draw?.stroke ?? "#d9d9d9";
    const wallWidth = warp?.wall?.draw?.width ?? 3;

    ctx.strokeStyle = wallStroke;
    ctx.lineWidth = wallWidth;
    drawPoly(ctx, wall, true);
    ctx.stroke();
  }

    // Bastions (polygons). Some may be null if hidden due to New Town overlap.
  if (bastionPolys && Array.isArray(bastionPolys)) {
    ctx.save();

    // Bastions are part of the fort outline composite.
    // Draw them with the same stroke as the curtain wall so the outline is continuous.
    const outworksStroke = warp?.wall?.draw?.stroke ?? "#d9d9d9";
    const outworksWidth = warp?.wall?.draw?.width ?? 3;

    ctx.strokeStyle = outworksStroke;
    ctx.lineWidth = outworksWidth;

    for (const poly of bastionPolys) {
      if (!Array.isArray(poly) || poly.length < 3) continue; // skips nulls
      drawPoly(ctx, poly, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Warp overlay (debug)
  const ww = warp?.wall;
  if (ww && ww.params && ww.params.debug && ww.wallOriginal && ww.wallWarped) {

    ctx.save();

    ctx.lineWidth = 2;

    // Original wall (dashed)
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([6, 4]);
    drawPoly(ctx, warp.wallOriginal, true);
    ctx.stroke();

    // Warped wall (solid)
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    drawPoly(ctx, warp.wallWarped, true);
    ctx.stroke();

    ctx.restore();
  }

  // Wall base (inner line)
  if (wallBase && wallBase.length >= 3) {
    ctx.strokeStyle = "#9a9a9a";
    ctx.lineWidth = 1.5;
    drawPoly(ctx, wallBase, true);
    ctx.stroke();
  }

  // Ring boulevard (primary)
  if (ring && ring.length >= 3) {
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2;
    drawPoly(ctx, ring, true);
    ctx.stroke();
  }

  // Second ring (secondary)
  if (ring2 && ring2.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 1.25;
    drawPoly(ctx, ring2, true);
    ctx.stroke();
    ctx.restore();
  }
}
