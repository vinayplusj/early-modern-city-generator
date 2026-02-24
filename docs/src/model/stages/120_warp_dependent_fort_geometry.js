// docs/src/model/stages/120_warp_dependent_fort_geometry.js
//
// Stage 120: Warp-dependent fort geometry (moatworks + rings) and gate snapping.
// Extracted from generate.js without functional changes.

import { offsetRadial } from "../../geom/offset.js";
import { snapGatesToWall } from "../generate_helpers/snap.js";

/**
 * @param {object} args
 * @returns {object}
 * {
 *   fortR,
 *   ditchWidth,
 *   glacisWidth,
 *   wallBaseForDraw,
 *   ditchOuter,
 *   ditchInner,
 *   glacisOuter,
 *   ring,
 *   ring2,
 *   wallForGateSnap,
 *   gatesWarped,
 *   primaryGateWarped
 * }
 */
export function runWarpDependentFortGeometryStage({
  ctx,
  cx,
  cy,
  wallR,
  wallBase,
  wallWarped,
  warpWall,
  gates,
  primaryGate,
}) {
  const fortR = (warpWall && warpWall.params && Number.isFinite(warpWall.params.bandOuter))
    ? warpWall.params.bandOuter
    : wallR;

  ctx.geom.wallR = fortR;

  let ditchWidth = fortR * 0.035;
  let glacisWidth = fortR * 0.08;
  ctx.params.minWallClear = ditchWidth * 1.25;
  
  // wallWarped is now the already-warped-and-clamped CURTAIN wall from Stage 110.
  // Do not warp wallBase again here.
  const wallBaseForDraw = (Array.isArray(wallWarped) && wallWarped.length >= 3)
    ? wallWarped
    : wallBase;

  ctx.geom.wallBase = wallBaseForDraw;

  const ditchOuter = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth);
  const ditchInner = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth * 0.35);
  const glacisOuter = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth + glacisWidth);

  const ring = offsetRadial(wallBaseForDraw, cx, cy, -fortR * 0.06);
  const ring2 = offsetRadial(wallBaseForDraw, cx, cy, -fortR * 0.13);

  // Gate snapping must follow the wall that will be rendered as the "final" trace.
  // Prefer the Stage 110 composite wall (warp.wallForDraw). Fall back to the warped curtain wall.
  const wallForGateSnap = (ctx?.state?.warp?.wallForDraw && Array.isArray(ctx.state.warp.wallForDraw) && ctx.state.warp.wallForDraw.length >= 3)
    ? ctx.state.warp.wallForDraw
    : ((wallWarped && wallWarped.length >= 3) ? wallWarped : null);

  const gatesWarped = (wallForGateSnap)
    ? snapGatesToWall(gates, cx, cy, wallForGateSnap)
    : gates;
  
  const primaryGateWarped = (primaryGate && wallForGateSnap)
    ? snapGatesToWall([primaryGate], cx, cy, wallForGateSnap)[0]
    : primaryGate;

  return {
    fortR,
    ditchWidth,
    glacisWidth,
    wallBaseForDraw,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ring,
    ring2,
    wallForGateSnap,
    gatesWarped,
    primaryGateWarped,
  };
}
