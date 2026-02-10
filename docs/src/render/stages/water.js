// docs/src/render/stages/water.js
//
// Water renderer (river or coast).
// Expects model.water from docs/src/model/generate_helpers/water.js.
//
// Conventions:
// - water.kind: "none" | "river" | "coast"
// - water.polyline: array of points (river centreline)
// - water.polygon: array of points (coast water area)

import { drawPoly } from "../helpers/draw.js";

function drawPolyline(ctx, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
}

export function drawWater(ctx, { water }) {
  if (!water || water.kind === "none") return;

  // Keep the palette subtle so it does not overpower the city.
  // We use a dark fill and a lighter stroke.
  const fill = "#0b2033";
  const stroke = "#6fb7ff";

  // -------- Coast (filled polygon) --------
  if (water.kind === "coast") {
    const poly = water.polygon;
    if (!Array.isArray(poly) || poly.length < 3) return;

    ctx.save();

    // Fill
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = fill;
    drawPoly(ctx, poly, true);
    ctx.fill();

    // Shoreline stroke
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.0;
    drawPoly(ctx, poly, true);
    ctx.stroke();

    ctx.restore();
    return;
  }

  // -------- River (centreline polyline) --------
  if (water.kind === "river") {
    const line = water.polyline;
    if (!Array.isArray(line) || line.length < 2) return;

    ctx.save();

    // Wide dark body
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, line);
    ctx.stroke();

    // Inner lighter stroke
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, line);
    ctx.stroke();

    ctx.restore();
  }
}
