
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import { warpPolylineRadial } from "../warp.js";
import { buildBastionHull, runFortWarpAudits } from "../debug/fortwarp_audit.js";
import {
  buildFortWarp,
  clampPolylineRadial,
  resampleClosedPolyline,
} from "../generate_helpers/warp_stage.js";
import { repairBastionStrictConvex } from "../generate_helpers/bastion_convexity.js";
import {
  clampCurtainPostConditions,
  deriveFinalCurtainFromPostClamp,
  rebindWarpWallToFinalCurtain,
  buildCurtainMinField,
} from "../generate_helpers/curtain_post_clamp.js";
import { runStrictConvexRepairPass } from "../generate_helpers/bastion_convex_repair.js";
import { runSlideRepairPass } from "../generate_helpers/bastion_slide_repair.js";
import { loopPerimeter } from "../../geom/loop_metrics.js";
import { ensureWinding , signedArea} from "../../geom/poly.js";
import { applyWarpfieldDrawHints } from "../../render/stages/warpfield_draw_hints.js";
import { auditWallDeterministicOutsideInnerHull } from "../debug/warpfield_wall_audit.js";
import {
  deriveBastionPlacementFromCurtain,
  resolveCompositeWallForDraw,
  buildStage110Return,
  runBastionWarpPass,
} from "../generate_helpers/warpfield_pipeline.js";

/**
 * @param {object} args
 * @returns {object}
 *  {
 *    warpWall: object|null,
 *    warpOutworks: object|null,
 *    wallForDraw: Array<{x:number,y:number}>|null,
 *    wallCurtainForDraw: Array<{x:number,y:number}>|null,
 *    bastionPolysWarpedSafe: Array<Array<{x:number,y:number}>>|null,
 *    bastionHullWarpedSafe: Array<{x:number,y:number}>|null
 *  }
 */
export function runWarpFieldStage({
  ctx,
  cx,
  cy,

  wallFinal,
  wallBase,

  fortHulls,
  districts,

  bastionsForWarp,
  bastionPolys,

  warpFortParams,
  warpDebugEnabled,
}) {
  const fortInnerHull = fortHulls?.innerHull?.outerLoop ?? null;
  const innerHull = fortInnerHull;

  const fortOuterHull = fortHulls?.outerHull?.outerLoop ?? null;
  
  const outerHullLoop =
    (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null;

  // Keep behaviour: generator stores warp config on ctx.params.warpFort.
  ctx.params.warpFort = warpFortParams;
  const bastionSoft = (ctx.params && ctx.params.bastionSoft) ? ctx.params.bastionSoft : null;
  const targetN = bastionSoft && Number.isFinite(bastionSoft.targetN) ? Math.max(0, bastionSoft.targetN | 0) : null;
  
  // Use actual warped bastion count (not ctx.params.bastions).
  const bastionN0 = Array.isArray(bastionsForWarp) ? bastionsForWarp.length : 0;
  const polyN0 = Array.isArray(bastionPolys) ? bastionPolys.length : 0;
  
  // Desired count is driven by targetN (density), even if upstream provides zero bastions.
  const bastionNDesired =
    (targetN != null) ? Math.max(0, targetN | 0) : Math.min(bastionN0, polyN0);
  
  // We still keep “used” slices from upstream if they exist, but they are no longer the source of truth.
  const bastionsForWarpUsed = Array.isArray(bastionsForWarp)
    ? bastionsForWarp.slice(0, bastionNDesired)
    : bastionsForWarp;
  
  const bastionPolysUsed = Array.isArray(bastionPolys)
    ? bastionPolys.slice(0, bastionNDesired)
    : bastionPolys;

  // Extra inset (map units) to keep warped bastions further inside the outer hull.
  // Deterministic: purely parameter-driven.
  // Default chosen to be visibly effective without crushing geometry.
  const bastionOuterInset =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.bastionOuterInset))
      ? Math.max(0, ctx.params.warpFort.bastionOuterInset)
      : 4;  
  
	// Requirement: curtain warp field samples = max(existing, 18, 3 * bastions).
	const curtainSamples =
	  Number.isFinite(ctx.params.warpFort?.samples)
	    ? Math.max(18, ctx.params.warpFort.samples)
	    : 90; // fixed stable default
  
  // Curtain vertex count controls how many points the wall warp operates on.
  // Lower N => fewer points in wallBaseDense => fewer points after warp/clamps.
  // Defaults chosen to reduce point count while staying visually stable.
  const curtainVertexFactor =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.curtainVertexFactor))
      ? ctx.params.warpFort.curtainVertexFactor
      : 12; 
  
  const curtainVertexMin =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.curtainVertexMin))
      ? ctx.params.warpFort.curtainVertexMin
      : 60; 
  
	const basePerimeter = loopPerimeter(wallBase);
	
	const targetEdgeLen =
	  Number.isFinite(ctx.params.warpFort?.curtainTargetEdgeLen)
	    ? Math.max(1, ctx.params.warpFort.curtainTargetEdgeLen)
	    : 5;
	
	const curtainVertexN = Math.max(
	  curtainVertexMin,
	  Math.round(basePerimeter / targetEdgeLen)
	);
  
  // Curtain wall warp tuning: allow stronger inward movement.
  const curtainParams = {
    ...ctx.params.warpFort,
    samples: curtainSamples,
    maxIn: Math.max(ctx.params.warpFort?.maxIn ?? 0, 200),
    maxStep: Math.max(ctx.params.warpFort?.maxStep ?? 0, 5.0),
    // Keep smoothing reasonable so it still converges to the inner hull.
    smoothRadius: Math.min(ctx.params.warpFort?.smoothRadius ?? 10, 6),
  };

  const wallBaseDense = (Array.isArray(wallBase) && wallBase.length >= 3)
    ? resampleClosedPolyline(wallBase, curtainVertexN)
    : wallBase;

  const warpWall = buildFortWarp({
    enabled: true,
    centre: { x: cx, y: cy },
    wallPoly: wallBaseDense,
    targetPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    tuningPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMinPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMaxPoly: null,
    clampMinMargin: 2,
    clampMaxMargin: 2,
    districts: null,
    bastions: bastionsForWarpUsed,
    params: curtainParams,
  });


  const warpOutworks = buildFortWarp({
    enabled: true,
    centre: { x: cx, y: cy },
    wallPoly: wallFinal,
    targetPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    tuningPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    // Invariant: outworks must stay inside outer hull.
    clampMinPoly: null,
    clampMaxPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    clampMinMargin: 2,
    clampMaxMargin: 2,
    districts,
    bastions: bastionsForWarpUsed,
    params: ctx.params.warpFort,
  });
  const reinsertBudget = bastionSoft && Number.isFinite(bastionSoft.reinsertBudget) ? Math.max(0, bastionSoft.reinsertBudget | 0) : 0;
  const minFinalRatio = bastionSoft && Number.isFinite(bastionSoft.minFinalRatio) ? Math.max(0, Math.min(1, bastionSoft.minFinalRatio)) : 1.0;

    if (warpOutworks) {
      warpOutworks.bastionSoft = {
        targetN,
        reinsertBudget,
        minFinalRatio,
        inputCount: bastionN0,
        usedCount: bastionNDesired,
      };
    }  
  applyWarpfieldDrawHints({ warpWall, warpOutworks });

  const innerMargin = Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 10;
  const tMid = Number.isFinite(ctx?.params?.warpFort?.tMid) ? ctx.params.warpFort.tMid : 0.3;
  const midMargin = Number.isFinite(ctx?.params?.warpFort?.midMargin) ? ctx.params.warpFort.midMargin : 0;
  const wallWarped = (warpWall && warpWall.wallWarped) ? warpWall.wallWarped : null;
  let wallWarpedSafe = wallWarped;
  const centre = { x: cx, y: cy };
	const centrePt = { x: cx, y: cy };
  let bastionsBuiltFromMaxima = false;
  if (warpOutworks) warpOutworks.bastionsBuiltFromMaxima = bastionsBuiltFromMaxima;
  wallWarpedSafe = clampCurtainPostConditions({
    wallWarped: wallWarpedSafe,
    centre,
    innerHull,
    outerHullLoop,
    innerMargin,
    tMid,
    midMargin,
  });

  const {
    wallCurtainForDrawRaw,
    wallCurtainForDraw,
    curtainArea,
    wantCCW,
  } = deriveFinalCurtainFromPostClamp({
    wallWarpedSafe,
    wallWarped,
    wallBaseDense,
    curtainVertexN,
  });
	
  let bastionPlacement = null;

  {
    const placementRes = deriveBastionPlacementFromCurtain({
      ctx,
      wallCurtainForDraw,
      outerHullLoop,
      centrePt,
      cx,
      cy,
      warpFortParams,
      warpOutworks,
      targetN,
      bastionNDesired,
      wantCCW,
      bastionPolysUsed,
      warpDebugEnabled,
    });

    bastionPlacement = placementRes.bastionPlacement;
    bastionsBuiltFromMaxima = placementRes.bastionsBuiltFromMaxima;
  }
  // sync helper mutates warpWall in place so downstream attachments follow the final curtain.
  rebindWarpWallToFinalCurtain({
    warpWall,
    wallBaseDense,
    wallCurtainForDraw,
    cx,
    cy,
    warpDebugEnabled,
  });

  if (warpDebugEnabled && warpWall?.field && Array.isArray(wallBaseDense) && wallBaseDense[0]) {
    const p = wallBaseDense[0];
    const q = warpPolylineRadial([p], { x: cx, y: cy }, warpWall.field, warpWall.params)[0];
  }

  const curtainMinField = buildCurtainMinField({
    warpOutworks,
    wallCurtainForDraw,
    cx,
    cy,
  });
  
  let bastionPolysWarpedSafe = warpBastionPolysThroughFields({
    warpOutworks,
    warpWall,
    bastionPolysUsed,
    centrePt,
    curtainMinField,
    outerHullLoop,
    bastionOuterInset,
    bastionsBuiltFromMaxima,
  });

  // ---------------------------------------------------------------------------

  const warpOutworksForBastions = warpOutworks
    ? {
        ...warpOutworks,
        clampMaxMargin: (Number.isFinite(warpOutworks.clampMaxMargin) ? warpOutworks.clampMaxMargin : 0) + bastionOuterInset,
      }
    : warpOutworks;
  
  if (!bastionsBuiltFromMaxima) {
    bastionPolysWarpedSafe = shrinkOutworksToFit({
      bastionPolysWarpedSafe,
      centre,
      wallCurtainForDraw,
      curtainMinField,
      outerHullLoop,
      warpOutworks: warpOutworksForBastions,
    });
  }
	// ---------------- Strict convexity repair (post-warp, post-shrink) ----------------
		const margin = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
		const K = Number.isFinite(ctx?.params?.warpFort?.bastionConvexIters)
		  ? ctx.params.warpFort.bastionConvexIters
		  : 121;
		let bastionConvexSummary = null;
		{
		  const convexRes = runStrictConvexRepairPass({
		    ctx,
		    bastionPolysWarpedSafe,
		    wantCCW,
		    centrePt,
		    outerHullLoop,
		    margin,
		    K,
		    ensureWinding,
		    repairBastionStrictConvex,
		    polyAreaSigned: signedArea,
		  });
		  bastionPolysWarpedSafe = convexRes.bastionPolysOut;
		  bastionConvexSummary = convexRes.convexStats;
		}
	// ---------------- Sliding repair (before delete/reinsert) ----------------
		{
		  const slideRes = runSlideRepairPass({
		    ctx,
		    warpDebugEnabled,
		    bastionPolysWarpedSafe,
		    wantCCW,
		    centrePt,
		    outerHullLoop,
		    margin,
		    K,
		    warpOutworks,
		    wallCurtainForDraw,
		    warpWall,
		    curtainMinField,
		    bastionOuterInset,
		    bastionsBuiltFromMaxima,
		    warpPolylineRadial,
		    clampPolylineRadial,
		    ensureWinding,
		    repairBastionStrictConvex,
		    polyAreaSigned: signedArea,
		  });
		  bastionPolysWarpedSafe = slideRes.bastionPolysOut;
		  if (slideRes.convexStats) bastionConvexSummary = slideRes.convexStats;
		}
    // Debug: record final count and whether we have enough placement candidates.
    if (warpOutworks && warpOutworks.bastionPlacement) {
      const soft = ctx?.params?.bastionSoft || null;
      const targetN = Number.isFinite(soft?.targetN) ? soft.targetN : null;
    
      warpOutworks.bastionPlacement.final = {
        targetN,
        finalCount: Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe.length : 0,
        candidates: warpOutworks.bastionPlacement.maxima ? warpOutworks.bastionPlacement.maxima.length : 0,
      };
    }
  
  const bastionHullWarpedSafe = buildBastionHull(bastionPolysWarpedSafe);

  runFortWarpAudits({
    warpDebugEnabled,
    auditWallDeterministicOutsideInnerHull,
    wallCurtainForDraw,
    innerHull,
    cx,
    cy,
    warpWall,
    bastionPolysWarpedSafe,
    warpOutworks,
    outerHullLoop,
    bastionPlacement,
  });

  // ---------------------------------------------------------------------------
  // Final composite wall for rendering:
  // Build from FINAL warped bastion polygons (after clamp + shrink + reclamp).
  // This is the only geometry that is guaranteed to match the orange bastions.
  // ---------------------------------------------------------------------------
  const {
    compositeWall,
    wallForDraw,
  } = resolveCompositeWallForDraw({
    ctx,
    warpDebugEnabled,
    wallFinal,
    wallCurtainForDraw,
    bastionPolysWarpedSafe,
    cx,
    compositeDebugOnlyEast: true,
  });


  return buildStage110Return({
    warpWall,
    warpOutworks,
    wallForDraw,
    wallCurtainForDraw,
    compositeWall,
    bastionPolysWarpedSafe,
    bastionHullWarpedSafe,
  });
}
