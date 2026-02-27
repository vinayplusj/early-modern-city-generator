// docs/src/render/stages/boundary_newtown.js

import { drawPoly, strokePolyline } from "../helpers/draw.js";

export function drawBoundaryAndNewTown(ctx, { outerBoundary, newTown }) {
  // Outer boundary is already stroked in footprint_debug stage.
  // This stage handles the New Town polygon + streets + main avenue.

  if (newTown && newTown.poly && newTown.poly.length >= 3) {
    ctx.fillStyle = "#f3e7d0";
    drawPoly(ctx, newTown.poly, true);
    ctx.fill();

    // Streets
    if (newTown.streets && newTown.streets.length) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = "#c9b07b";
      ctx.lineWidth = 1.5;
      for (const s of newTown.streets) {
        if (!s || s.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        ctx.lineTo(s[1].x, s[1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Main avenue within New Town
    if (newTown.mainAve && newTown.mainAve.length >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#c9b07b";
      strokePolyline(ctx, newTown.mainAve, 2.0);
      ctx.restore();
    }

    // Outline
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 2;
    drawPoly(ctx, newTown.poly, true);
    ctx.stroke();
  }
}
