// docs/src/render/stages/water.js

import { drawPoly } from "../../render/helpers/draw.js";

function drawPolyline(ctx, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

export function drawWater(ctx, { water }) {
  if (!water || water.kind === "none") return;

  const coastPoly = water?.coast?.polygon || null;
  const riverLine = water?.river?.polyline || null;
  const shoreline = water?.shoreline || null;

  const fill = "#0b2033";
  const stroke = "#6fb7ff";

  if (water.kind === "coast") {
    if (!Array.isArray(coastPoly) || coastPoly.length < 3) return;

    ctx.save();

    // Fill the sea area
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = fill;
    drawPoly(ctx, coastPoly, true);
    ctx.fill();

    // Stroke only the shoreline segment when available
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;

    if (Array.isArray(shoreline) && shoreline.length >= 2) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawPolyline(ctx, shoreline);
      ctx.stroke();
    } else {
      // Fallback: outline the polygon if shoreline is missing
      drawPoly(ctx, coastPoly, true);
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  if (water.kind === "river") {
    if (!Array.isArray(riverLine) || riverLine.length < 2) return;

    ctx.save();

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, riverLine);
    ctx.stroke();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, riverLine);
    ctx.stroke();

    ctx.restore();
  }
}
