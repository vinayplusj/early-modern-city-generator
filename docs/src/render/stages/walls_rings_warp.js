// docs/src/render/stages/walls_rings_warp.js

import { drawPoly } from "../helpers/draw.js";

export function drawWallsAndRingsAndWarp(ctx, {
  wall,
  wallCurtain,
  wallBase,
  bastionPolys,
  ring,
  ring2,
  warp,
  fortHulls,
}) {
  // Curtain wall (warped) - debug geometry kept, rendering disabled
  const showCurtainWall = false;
  if (showCurtainWall && wallCurtain && wallCurtain.length >= 3) {
    const curtainStroke = warp?.wall?.drawCurtain?.stroke ?? "#00ff00";
    const curtainWidth = warp?.wall?.drawCurtain?.width ?? 3;
  
    ctx.save();
    ctx.strokeStyle = curtainStroke;
    ctx.lineWidth = curtainWidth;
    drawPoly(ctx, wallCurtain, true);
    ctx.stroke();
    ctx.restore();
  }

  // Bastioned wall (final composite)
  if (wall && wall.length >= 3) {
    const wallStroke = warp?.wall?.drawComposite?.stroke ?? "#0F0";
    const wallWidth = warp?.wall?.drawComposite?.width ?? 3;

    ctx.strokeStyle = wallStroke;
    ctx.lineWidth = wallWidth;
    drawPoly(ctx, wall, true);
    ctx.stroke();
  }

  // Bastions (polygons) - debug geometry kept, rendering disabled
  const showBastionPolys = false;
  if (showBastionPolys && Array.isArray(bastionPolys)) {
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
  
  // Warp overlay (debug) - opt-in only (do not render wallOriginal by default)
  const ww = warp?.wall;
  const showWarpOverlay = (ww?.params?.renderOverlay === true);
  
  // Hull loops overlay (debug) - opt-in only
  const showHullLoops = (ww?.params?.renderHullLoops === true);
  
  if (showHullLoops && fortHulls) {
    const innerLoops = fortHulls?.innerHull?.loops;
    const outerLoops = fortHulls?.outerHull?.loops;
  
    const innerIdx = fortHulls?.innerHull?.outerLoopIndex ?? -1;
    const outerIdx = fortHulls?.outerHull?.outerLoopIndex ?? -1;
  
    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
  
    // Inner hull loops: faint, selected loop stronger
    if (Array.isArray(innerLoops)) {
      for (let i = 0; i < innerLoops.length; i++) {
        const loop = innerLoops[i];
        if (!Array.isArray(loop) || loop.length < 3) continue;
  
        ctx.strokeStyle = (i === innerIdx) ? "rgba(255,0,255,0.95)" : "rgba(255,0,255,0.35)";
        drawPoly(ctx, loop, true);
        ctx.stroke();
      }
    }
  
    // Outer hull loops: faint, selected loop stronger
    if (Array.isArray(outerLoops)) {
      for (let i = 0; i < outerLoops.length; i++) {
        const loop = outerLoops[i];
        if (!Array.isArray(loop) || loop.length < 3) continue;
  
        ctx.strokeStyle = (i === outerIdx) ? "rgba(0,180,255,0.90)" : "rgba(0,180,255,0.30)";
        drawPoly(ctx, loop, true);
        ctx.stroke();
      }
    }
  
    ctx.restore();
  }

  if (showWarpOverlay && ww.wallOriginal && ww.wallWarped) {
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

  // Wall base (inner line) - hide when warp curtain exists (prevents duplicate wall curves)
  const hasWarpCurtain = !!(wallCurtain && wallCurtain.length >= 3);
  
  if (wallBase && wallBase.length >= 3 && !hasWarpCurtain) {
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
