// docs/src/render/stages/citadel.js

import { drawPoly, drawCircle } from "../helpers/draw.js";

export function drawCitadel(ctx, { citadel, citCentre }) {
  if (citadel && citadel.length >= 3) {
    ctx.fillStyle = "#101010";
    drawPoly(ctx, citadel, true);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    drawPoly(ctx, citadel, true);
    ctx.stroke();

    if (citCentre) {
      ctx.fillStyle = "#ffffff";
      drawCircle(ctx, citCentre, 2.5);
      ctx.fill();
    }
  }
}
