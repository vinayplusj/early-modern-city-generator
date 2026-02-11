// docs/src/render/stages/citadel.js

import { drawPoly, drawCircle } from "../helpers/draw.js";

export function drawCitadel(ctx, { citadel, anchors }) {
  if (!Array.isArray(citadel) || citadel.length < 3) return;

  ctx.fillStyle = "#101010";
  drawPoly(ctx, citadel, true);
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  drawPoly(ctx, citadel, true);
  ctx.stroke();

  const p = anchors?.citadel;

  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, p, 2.5);
    ctx.fill();
  }
}
