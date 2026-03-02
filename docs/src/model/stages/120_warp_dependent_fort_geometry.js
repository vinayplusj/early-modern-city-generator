// docs/src/model/stages/120_warp_dependent_fort_geometry.js
//
// Stage 120: Warp-dependent fort geometry (moatworks + rings) and gate snapping.
// Extracted from generate.js without functional changes.

import { offsetRadial } from "../../geom/offset.js";
import { snapGatesToWall } from "../generate_helpers/snap.js";
import { resampleClosedPolyline } from "../generate_helpers/warp_stage.js";

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

  let ditchWidth = fortR * 0.035;
  let glacisWidth = fortR * 0.08;
  ctx.params.minWallClear = ditchWidth * 1.25;

  // Curtain wall (pre-bastion) is wallWarped.
  // Composite wall (with bastions) is ctx.state.warp.wallForDraw when Stage 110 built it.
  const wallCurtainForDraw = (Array.isArray(wallWarped) && wallWarped.length >= 3)
    ? wallWarped
    : wallBase;
  
  const wallCompositeForDraw =
    (ctx?.state?.warp?.wallForDraw && Array.isArray(ctx.state.warp.wallForDraw) && ctx.state.warp.wallForDraw.length >= 3)
      ? ctx.state.warp.wallForDraw
      : null;
  
  // Strategy A: ditches adapt to bastions => build moatworks off the composite wall when available.
  const wallForMoatworksRaw = wallCompositeForDraw || wallCurtainForDraw;
  
  // Densify to avoid chord “shortcuts” across tight curvature at bastion shoulders/tips.
  const moatN =
    Number.isFinite(ctx?.params?.warpFort?.moatVertexN)
      ? Math.max(120, ctx.params.warpFort.moatVertexN | 0)
      : 360;
  
  const wallForMoatworks =
    (Array.isArray(wallForMoatworksRaw) && wallForMoatworksRaw.length >= 3)
      ? resampleClosedPolyline(wallForMoatworksRaw, moatN)
      : wallForMoatworksRaw;
  
  const ditchOuter  = offsetRadial(wallForMoatworks, cx, cy, ditchWidth);
  const ditchInner  = offsetRadial(wallForMoatworks, cx, cy, ditchWidth * 0.35);
  const glacisOuter = offsetRadial(wallForMoatworks, cx, cy, ditchWidth + glacisWidth);
  
  // Rings are also fort geometry; keep them consistent with the visible wall trace.
  // If this causes artefacts, switch these two back to wallCurtainForDraw.
  const ring = offsetRadial(wallForMoatworks, cx, cy, -fortR * 0.06);
  const ring2 = offsetRadial(wallForMoatworks, cx, cy, -fortR * 0.13);
  
  // Preserve for return payload naming
  const wallBaseForDraw = wallCurtainForDraw;

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
