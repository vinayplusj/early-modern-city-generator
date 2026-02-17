// docs/src/render/stages/walls_rings_warp.js

import { drawPoly } from "../helpers/draw.js";

export function drawWallsAndRingsAndWarp(ctx, { wall, wallCurtain, wallBase, bastionPolys, ring, ring2, warp }) {
  // Curtain wall (warped) - draw first
  if (wallCurtain && wallCurtain.length >= 3) {
    const curtainStroke = warp?.wall?.draw?.stroke ?? "#7fdcff";
    const curtainWidth = warp?.wall?.draw?.width ?? 3;

    ctx.save();
    ctx.strokeStyle = curtainStroke;
    ctx.lineWidth = curtainWidth;
    drawPoly(ctx, wallCurtain, true);
    ctx.stroke();
    ctx.restore();
  }

  // Bastioned wall (final composite)
  if (wall && wall.length >= 3) {
    const wallStroke = warp?.wall?.draw?.stroke ?? "#d9d9d9";
    const wallWidth = warp?.wall?.draw?.width ?? 3;

    ctx.strokeStyle = wallStroke;
    ctx.lineWidth = wallWidth;
    drawPoly(ctx, wall, true);
    ctx.stroke();
  }

  // Bastions (polygons) in outworks colour
  if (Array.isArray(bastionPolys)) {
    ctx.save();

    const outworksStroke = warp?.outworks?.draw?.stroke ?? "#ffcc80";
    const outworksWidth = warp?.outworks?.draw?.width ?? 2;

    ctx.strokeStyle = outworksStroke;
    ctx.lineWidth = outworksWidth;

    for (const poly of bastionPolys) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      drawPoly(ctx, poly, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Warp overlay (debug)
  const ww = warp?.wall;
  if (ww?.params?.debug && ww.wallOriginal && ww.wallWarped) {
    ctx.save();
    ctx.lineWidth = 2;

    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([6, 4]);
    drawPoly(ctx, ww.wallOriginal, true);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    drawPoly(ctx, ww.wallWarped, true);
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

  // Rings
  if (ring && ring.length >= 3) {
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2;
    drawPoly(ctx, ring, true);
    ctx.stroke();
  }

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
