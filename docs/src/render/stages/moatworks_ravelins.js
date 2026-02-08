// docs/src/render/stages/moatworks_ravelins.js

import { drawPoly } from "../helpers/draw.js";

export function drawMoatworksAndRavelins(ctx, { glacisOuter, ditchOuter, ditchInner, ravelins }) {
  // Glacis ring
  if (glacisOuter && glacisOuter.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#242424";
    ctx.lineWidth = 2;
    drawPoly(ctx, glacisOuter, true);
    ctx.stroke();
    ctx.restore();
  }

  // Ditch rings
  if (ditchOuter && ditchOuter.length >= 3 && ditchInner && ditchInner.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.55;

    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 2;
    drawPoly(ctx, ditchOuter, true);
    ctx.stroke();

    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 2;
    drawPoly(ctx, ditchInner, true);
    ctx.stroke();

    ctx.restore();
  }

  // Ravelins
  if (ravelins && ravelins.length) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "#8a8a8a";
    ctx.lineWidth = 2;
    for (const rv of ravelins) {
      if (!rv || rv.length < 3) continue;
      drawPoly(ctx, rv, true);
      ctx.stroke();
    }
    ctx.restore();
  }
}
