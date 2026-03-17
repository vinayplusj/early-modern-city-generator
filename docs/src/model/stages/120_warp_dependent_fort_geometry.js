// docs/src/model/stages/120_warp_dependent_fort_geometry.js
//
// Stage 120: Warp-dependent fort geometry (moatworks + rings) and gate snapping.
// Extracted from generate.js without functional changes.

import { offsetRadial } from "../../geom/offset.js";
import { snapGatesToWall } from "../generate_helpers/snap.js";
import { resampleClosedPolyline } from "../generate_helpers/warp_stage.js";
import { buildGatePortals } from "../mesh/city_mesh/build_gate_portals.js";
import { buildBoundaryExits } from "../boundary/build_boundary_exits.js";


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

  const fortGeometryWarped = {
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

  const rings = { ring, ring2 };

  if (!ctx?.state?.routingMesh?.cityMesh || !ctx?.state?.routingMesh?.boundaryBinding) {
    throw new Error("[EMCG] Stage 120 requires routingMesh.cityMesh and routingMesh.boundaryBinding (Stage 70 output).");
  }

  const gatePortals = buildGatePortals({
    cityMesh: ctx.state.routingMesh.cityMesh,
    boundaryBinding: ctx.state.routingMesh.boundaryBinding,
    gates: gatesWarped,
  });
  if (!Array.isArray(gatePortals)) {
    throw new Error("[EMCG] Stage 120 produced invalid gatePortals (expected array).");
  }
  if (gatePortals.length !== gatesWarped.length) {
    throw new Error("[EMCG] Stage 120 gatePortals length mismatch with gatesWarped.");
  }

  const outerBoundary = ctx?.state?.outerBoundary;
  if (!Array.isArray(outerBoundary) || outerBoundary.length < 3) {
    throw new Error("[EMCG] Stage 120 requires ctx.state.outerBoundary (Stage 30 output) for boundaryExits.");
  }

  const boundaryExits = buildBoundaryExits({
    outerBoundary,
    centre: ctx?.state?.fortifications?.centre || { x: cx, y: cy },
    gates: gatesWarped,
    gatePortals,
  });
  if (!Array.isArray(boundaryExits)) {
    throw new Error("[EMCG] Stage 120 produced invalid boundaryExits (expected array).");
  }
  if (boundaryExits.length !== gatesWarped.length) {
    throw new Error("[EMCG] Stage 120 boundaryExits length mismatch with gatesWarped.");
  }

  if (ctx?.state) {
    ctx.state.rings = rings;
    if (ctx.state.anchors) {
      ctx.state.anchors.gates = gatesWarped;
      ctx.state.anchors.primaryGate = primaryGateWarped;
    }
    if (ctx.state.routingMesh) {
      ctx.state.routingMesh.gatePortals = gatePortals;
    }
    ctx.state.gatePortals = gatePortals;
    ctx.state.boundaryExits = boundaryExits;
  }

  return fortGeometryWarped;
}
