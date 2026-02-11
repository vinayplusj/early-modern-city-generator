// docs/src/render/stages/gates.js

import { drawCircle } from "../helpers/draw.js";
import { drawGatehouse } from "../icons/gatehouse.js";

export function drawGatesAndPrimaryGate(ctx, { gates, primaryGate, cx, cy, squareR, anchors }) {
  // Gates + markers
  if (gates && gates.length) {
    for (const g of gates) {
      drawGatehouse(ctx, g, { x: cx, y: cy }, (squareR || 10) * 0.55);
      ctx.fillStyle = "#ffffff";
      drawCircle(ctx, g, 3.5);
      ctx.fill();
    }
  }

  if (primaryGate) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, primaryGate, 6);
    ctx.fill();
    ctx.restore();
  }
}
