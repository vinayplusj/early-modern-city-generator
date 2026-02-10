// docs/src/render/stages/landmarks.js

import { pointInPolyOrOn } from "../../geom/poly.js";
import { drawCircle } from "../helpers/draw.js";

export function drawLandmarksAndCentre(ctx, { wallBase, centre, squareR, squareCentre, marketCentre, anchors }) {
  const plaza = anchors?.plaza || squareCentre;
  const market = anchors?.market || marketCentre;

  // Use pointInPolyOrOn so points on the wall line still render.
  const squareInside =
    plaza &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(plaza, wallBase, 1e-6));

  const marketInside =
    market &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(market, wallBase, 1e-6));

  // Square (disc + outline + subtle halo)
  if (squareInside) {
    const r = (squareR || 10) * 0.95;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, plaza, r * 1.15);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#1a1a1a";
    drawCircle(ctx, plaza, r);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2.5;
    drawCircle(ctx, plaza, r);
    ctx.stroke();
    ctx.restore();
  }

  // Market (bigger, with outline + halo so it cannot disappear under roads)
  if (marketInside) {
    const r = Math.max(4, (squareR || 10) * 0.22);

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, market, r * 1.9);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#0f0f0f";
    drawCircle(ctx, market, r);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    drawCircle(ctx, market, r);
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
