// docs/src/render/stages/landmarks.js

import { pointInPolyOrOn } from "../../geom/poly.js";
import { drawCircle } from "../helpers/draw.js";

export function drawLandmarksAndCentre(ctx, { wallBase, centre, squareR, squareCentre, marketCentre }) {
  // ---------- Landmarks (ALWAYS LAST) ----------
  // Use pointInPolyOrOn so points on the wall line still render.
  const squareInside =
    squareCentre &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(squareCentre, wallBase, 1e-6));

  const marketInside =
    marketCentre &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(marketCentre, wallBase, 1e-6));

  // Square (disc + outline + subtle halo)
  if (squareInside) {
    const r = (squareR || 10) * 0.95;

    // Halo behind
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, squareCentre, r * 1.15);
    ctx.fill();
    ctx.restore();

    // Main fill
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#1a1a1a";
    drawCircle(ctx, squareCentre, r);
    ctx.fill();

    // Outline
    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2.5;
    drawCircle(ctx, squareCentre, r);
    ctx.stroke();
    ctx.restore();
  }

  // Market (bigger, with outline + halo so it cannot disappear under roads)
  if (marketInside) {
    const r = Math.max(4, (squareR || 10) * 0.22);

    // Halo
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, marketCentre, r * 1.9);
    ctx.fill();
    ctx.restore();

    // Core dot
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#0f0f0f";
    drawCircle(ctx, marketCentre, r);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    drawCircle(ctx, marketCentre, r);
    ctx.stroke();
    ctx.restore();
  }

  // Centre marker (reference)
  if (centre) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, centre, 2.5);
    ctx.fill();
    ctx.restore();
  }
}
