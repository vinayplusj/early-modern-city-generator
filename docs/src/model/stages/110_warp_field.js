
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import { warpPolylineRadial } from "../warp.js";
import { auditRadialClamp, auditPolyContainment } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";
import {
  buildFortWarp,
  clampPolylineRadial,
  resampleClosedPolyline,
} from "../generate_helpers/warp_stage.js";
import { repairBastionStrictConvex } from "../generate_helpers/bastion_convexity.js";
import { buildCompositeWallFromCurtainAndBastions } from "../generate_helpers/composite_wall_builder.js"; 
import { shrinkOutworksToFit } from "../generate_helpers/outworks_shrink_fit.js";
import {
  clampCurtainPostConditions,
  deriveFinalCurtainFromPostClamp,
  rebindWarpWallToFinalCurtain,
  buildCurtainMinField,
} from "../generate_helpers/curtain_post_clamp.js";
import { buildPentBastionAtSampleIndex } from "../generate_helpers/bastion_builder.js";
import { nearestSampleIndex, nearestMaximaIndex } from "../generate_helpers/warpfield_slots.js";
import { bastionCentroid } from "../generate_helpers/bastion_geom.js";
import { repairBastionsStrictConvex } from "../generate_helpers/bastion_convex_repair.js";
import { slideRepairBastions } from "../generate_helpers/bastion_slide_repair.js";
import { clampPolylineInsidePolyAlongRays} from "../../geom/radial_ray_clamp.js";
import { loopPerimeter } from "../../geom/loop_metrics.js";
import { ensureWinding , signedArea} from "../../geom/poly.js";
import { applyWarpfieldDrawHints } from "../../render/stages/warpfield_draw_hints.js";
import { auditWallDeterministicOutsideInnerHull } from "../debug/warpfield_wall_audit.js";
import { debugCompositeWallSplices } from "../debug/composite_wall_splice_debug.js";
import {
  deriveBastionPlacementFromCurtain,
  warpBastionPolysThroughFields,
} from "../generate_helpers/warpfield_pipeline.js";
import { pruneBastionsByCurtainIntervals } from "../generate_helpers/bastion_interval_prune.js";

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
	  if (ctx?.params?.warpFort?.debug) {
		  const arr = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
		  const lens = arr.slice(0, 5).map(p => Array.isArray(p) ? p.length : null);
		
		  // Sample signed areas for first few polys (this is the most common “flattening” root cause).
		  const areaSamples = [];
		  for (let i = 0; i < Math.min(5, arr.length); i++) {
		    try {
		      const a = (typeof signedArea === "function") ? signedArea(arr[i]) : null;
		      areaSamples.push(a);
		    } catch (e) {
		      areaSamples.push("ERR");
		    }
		  }
		
		  console.info("[Warp110] bastions BEFORE strict repair", {
		    n: arr.length,
		    sampleLens: lens,
		    signedAreaType: typeof signedArea,
		    areaEps: 1e-3,
		    margin,
		    K,
		    areaSamples,
		  });
		}
		const { bastionPolysOut, convexStats } = repairBastionsStrictConvex({
	    bastionPolys: bastionPolysWarpedSafe,
	    wantCCW,
	    areaEps: 1e-3,
	    ensureWinding,
	    polyAreaSigned: signedArea,
	    repairOne: (poly) => {
	      const r = repairBastionStrictConvex(poly, centrePt, outerHullLoop, margin, K);
			if (ctx?.params?.warpFort?.debug && (!r || !r.ok)) {
			  console.info("[Warp110] repairBastionStrictConvex raw return", r);
			}
			if (ctx?.params?.warpFort?.debug && (!r || !r.ok)) {
			  const a = (typeof signedArea === "function") ? signedArea(poly) : null;
			  console.info("[Warp110] repairBastionStrictConvex FAIL", {
			    nVerts: Array.isArray(poly) ? poly.length : null,
			    areaSigned: a,
			    margin,
			    K,
			    reason: r && r.reason ? r.reason : null,
			  });
			}
			if (!r) {
			    return { ok: false, reason: "repairBastionStrictConvex returned null" };
			  }
			
			  // Normal success case.
			  if (r.ok && Array.isArray(r.poly)) {
			    return { ok: true, poly: r.poly };
			  }
			
			  // Special case: algorithm gave up but explicitly chose to keep the current poly.
			  // This should not count as a failure, because we still have a valid polygon.
			  if (r.note === "fallback_keep_current" && Array.isArray(r.poly)) {
			    return { ok: true, poly: r.poly };
			  }
			
			  // All other failures.
			  return { ok: false, reason: r.reason || r.note || "repair failed" };
			},
	  });
	
	  bastionPolysWarpedSafe = bastionPolysOut;
	  bastionConvexSummary = convexStats;
		if (ctx?.params?.warpFort?.debug) {
		  const outArr = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
		  const nonNull = outArr.filter(p => Array.isArray(p) && p.length >= 3).length;
		
		  console.info("[Warp110] bastions AFTER strict repair", {
		    nOut: outArr.length,
		    nonNull,
		    convexStats: bastionConvexSummary || null,
		  });
		}
	}
	// ---------------- Sliding repair (before delete/reinsert) ----------------
	// If a bastion is still failing convexity/angle after repair, try sliding its anchor
	// to nearby clearance maxima slots and rebuild a fresh pentagonal bastion there.
	const enableSlideRepair = Boolean(ctx?.params?.warpFort?.enableSlideRepair ?? true);
	if (ctx?.params?.warpFort?.debug) {
	  const arr = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
	  console.info("[Warp110] slideRepair gate", {
	    enableSlideRepair,
	    bastionPolysN: arr.length,
	    hasPlacement: Boolean(warpOutworks?.bastionPlacement),
	  });
	}
	if (
	  enableSlideRepair &&
	  warpOutworks?.bastionPlacement?.maxima?.length &&
	  warpOutworks.bastionPlacement.curtainPtsS?.length &&
	  warpOutworks.bastionPlacement.sArr?.length &&
	  warpOutworks?.field &&
	  outerHullLoop &&
	  Array.isArray(wallCurtainForDraw)

	) {
	  const placement = warpOutworks.bastionPlacement;
	  const maxima = placement.maxima;
	  const L = placement.totalLen;
	
	  const slideTries = Number.isFinite(ctx?.params?.warpFort?.slideMaxTries)
	    ? Math.max(1, ctx.params.warpFort.slideMaxTries | 0)
	    : 3;
	
	  // Compute failing indices deterministically (do not rely on convexStats array).
	  // We re-check each 5-point bastion using the same strict convex repair function.
	  const failedIndices = [];
	  for (let i = 0; i < bastionPolysWarpedSafe.length; i++) {
	    const poly = bastionPolysWarpedSafe[i];
	    if (!Array.isArray(poly) || poly.length !== 5) continue;

    const poly2 = ensureWinding(poly, wantCCW);
    if (Math.abs(signedArea(poly2)) < 1e-3) {
      failedIndices.push(i);
      continue;
    }

    const res = repairBastionStrictConvex(poly2.slice(), centrePt, outerHullLoop, margin, K);
    if (!res || !res.ok) failedIndices.push(i);
  }

  if (failedIndices.length && warpDebugEnabled) {
    console.log("[slideRepair] failedIndices", failedIndices);
  }

  const { bastionPolysOut, slideStats } = slideRepairBastions({
    bastionPolys: bastionPolysWarpedSafe,
    failedIndices,
    placement,
    maxima,
    L,
    centrePt,
    cx,
    cy,
    wantCCW,
    outerHullLoop,
	debug: Boolean(ctx?.params?.warpFort?.debug),
    warpWall,
    warpOutworks,
    curtainMinField,
    bastionOuterInset,
    bastionsBuiltFromMaxima,

    slideTries,
    margin,
    K,

    // Dependencies
    warpPolylineRadial,
    clampPolylineRadial,
    clampPolylineInsidePolyAlongRays,
    ensureWinding,
    signedArea,
    repairBastionStrictConvex,

    bastionCentroid,
    nearestSampleIndex,
    nearestMaximaIndex,

    // Wrap builder so we preserve your shoulderSpanToTip param.
    buildPentBastionAtSampleIndex: (args) => buildPentBastionAtSampleIndex({
      ...args,
      shoulderSpanToTip: ctx?.params?.warpFort?.bastionShoulderSpanToTip,
    }),
  });

  bastionPolysWarpedSafe = bastionPolysOut;
  warpOutworks.bastionSlideRepair = slideStats;
		if (ctx?.params?.warpFort?.debug) {
		  const polys = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
		
		  function d(a, b) {
		    if (!a || !b) return NaN;
		    return Math.hypot(b.x - a.x, b.y - a.y);
		  }
		
		  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }
		
		  function isStrictConvex5(p, wantCCW, eps = 1e-9) {
		    if (!Array.isArray(p) || p.length !== 5) return { ok: false, why: "not_5" };
		    let sign = 0;
		    for (let i = 0; i < 5; i++) {
		      const a = p[i];
		      const b = p[(i + 1) % 5];
		      const c = p[(i + 2) % 5];
		      const abx = b.x - a.x, aby = b.y - a.y;
		      const bcx = c.x - b.x, bcy = c.y - b.y;
		      const z = cross(abx, aby, bcx, bcy);
		      if (!Number.isFinite(z) || Math.abs(z) < eps) return { ok: false, why: "collinear_turn", i };
		      const s = z > 0 ? 1 : -1;
		      if (sign === 0) sign = s;
		      else if (s !== sign) return { ok: false, why: "non_convex", i };
		    }
		    if (wantCCW && sign < 0) return { ok: false, why: "wrong_winding" };
		    if (!wantCCW && sign > 0) return { ok: false, why: "wrong_winding" };
		    return { ok: true };
		  }
		
		  const eps = Number.isFinite(ctx?.params?.warpFort?.bastionTriEps) ? ctx.params.warpFort.bastionTriEps : 1.0;
		
		  for (let i = 0; i < polys.length; i++) {
		    const p = polys[i];
		    if (!Array.isArray(p)) {
		      console.warn("[Warp110] bastion diag", { i, kind: "not_array" });
		      continue;
		    }
		
		    const n = p.length;
		    const a = (typeof signedArea === "function" && n >= 3) ? signedArea(p) : null;
		
		    // Only meaningful for 5-point bastions.
		    let shoulderGap = null;
		    let baseGap = null;
		    let tipShoulder0 = null;
		    let tipShoulder1 = null;
		
		    if (n === 5) {
		      // Expected layout: [B0, S0, T, S1, B1]
		      baseGap = d(p[0], p[4]);
		      shoulderGap = d(p[1], p[3]);
		      tipShoulder0 = d(p[2], p[1]);
		      tipShoulder1 = d(p[2], p[3]);
		    }
		
		    const convex = isStrictConvex5(p, wantCCW);
		
		    // Triangle-like heuristics (pure diagnostics, no behaviour change)
		    const triFlags = [];
		    if (n === 5 && Number.isFinite(shoulderGap) && shoulderGap < eps) triFlags.push("shoulders_collapsed");
		    if (n === 5 && Number.isFinite(baseGap) && baseGap < eps) triFlags.push("base_collapsed");
		    if (n === 5 && convex.ok === false) triFlags.push(`convex_fail:${convex.why}`);
		
		    if (triFlags.length) {
		      console.warn("[Warp110] bastion TRIANGLE-LIKE", {
		        i,
		        n,
		        areaSigned: a,
		        baseGap,
		        shoulderGap,
		        tipShoulder0,
		        tipShoulder1,
		        triFlags,
		      });
		    } else {
		      console.info("[Warp110] bastion ok", { i, n, areaSigned: a, baseGap, shoulderGap });
		    }
		  }
		}
		if (ctx?.params?.warpFort?.debug) {
		  const arr = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
		  const nonNull = arr.filter(p => Array.isArray(p) && p.length >= 3).length;
		  console.info("[Warp110] bastions AFTER slide repair", { n: arr.length, nonNull });
		}
  // Optional: refresh convex summary after sliding (summary-only).
  const refreshed = repairBastionsStrictConvex({
    bastionPolys: bastionPolysWarpedSafe,
    wantCCW,
    areaEps: 1e-3,
    ensureWinding,
    polyAreaSigned: signedArea,
    repairOne: (poly, opts) => {
      const r = repairBastionStrictConvex(poly, centrePt, outerHullLoop, margin, K);
      if (!r) return { ok: false, reason: "repairBastionStrictConvex returned null" };
      return (r.ok && Array.isArray(r.poly)) ? { ok: true, poly: r.poly } : { ok: false, reason: r.reason || "repair failed" };
    },
    repairOpts: {}, // already bound above via closure values
  });

  bastionConvexSummary = refreshed.convexStats;
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
  
 // ---------------- Bastion hull (global convex hull) ----------------
  // Compute convex hull of the FINAL bastion vertices (after any shrinking).
  // This must remain a convex hull; do not clamp the hull itself.
  let bastionHullWarpedSafe = null;

  if (Array.isArray(bastionPolysWarpedSafe) && bastionPolysWarpedSafe.length) {
    const pts = [];
    for (const poly of bastionPolysWarpedSafe) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      for (const p of poly) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
      }

    }

    if (pts.length >= 3) {
      const h = convexHull(pts);
      if (Array.isArray(h) && h.length >= 3) {
        bastionHullWarpedSafe = h;
      }
    }
  }

  // Debug audits (preserve same log behaviour).
  if (warpDebugEnabled) {
  auditWallDeterministicOutsideInnerHull({
    debugEnabled: warpDebugEnabled,
    wallCurtainForDraw,
    innerHull,
    centre: { x: cx, y: cy },
    margin: Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 2,
  });

    auditRadialClamp({
      name: "BASTIONS",
      polys: bastionPolysWarpedSafe,
      minField: warpOutworks?.minField,
      maxField: warpOutworks?.maxField,
      cx,
      cy,
      minMargin: warpOutworks?.clampMinMargin,
      maxMargin: warpOutworks?.clampMaxMargin,
      debugEnabled: true,
    });
    auditPolyContainment({
      name: "BASTIONS",
      polys: bastionPolysWarpedSafe,
      containerPoly: outerHullLoop, // the same loop used for enforcement
      debugEnabled: true,
});

  }

    if (warpDebugEnabled && bastionPlacement) {
    console.log("[bastionPlacement]", {
      want: bastionPlacement.want,
      minSpacing: bastionPlacement.minSpacing,
      top3: bastionPlacement.maxima.slice(0, 3),
    });
  }
  // ---------------------------------------------------------------------------
  // Final composite wall for rendering:
  // Build from FINAL warped bastion polygons (after clamp + shrink + reclamp).
  // This is the only geometry that is guaranteed to match the orange bastions.
  // ---------------------------------------------------------------------------
  let wallForDraw = wallFinal;
  let bastionPolysForComposite = bastionPolysWarpedSafe;
  // Prefer a composite final wall built from the FINAL warped curtain + FINAL bastions.
  // This keeps bastionHullWarpedSafe for debug only.
	const compositeWall = buildCompositeWallFromCurtainAndBastions(
	  wallCurtainForDraw,
	  bastionPolysForComposite
	);
	  // ---------------------------------------------------------------------------
  // Deterministically prune bastions that reserve overlapping or too-close
  // curtain intervals before composite-wall assembly.
  // This prevents neighbouring bastions (such as bi:2 and bi:3) from crowding
  // the same sector and creating reflex splice kinks.
  // ---------------------------------------------------------------------------


  if (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 8 &&
      Array.isArray(bastionPolysWarpedSafe) && bastionPolysWarpedSafe.length > 1) {
    const minGapSamples = Number.isFinite(ctx?.params?.warpFort?.bastionCompositeGapSamples)
      ? Math.max(0, ctx.params.warpFort.bastionCompositeGapSamples | 0)
      : 3;

    const pruneRes = pruneBastionsByCurtainIntervals({
      curtain: wallCurtainForDraw,
      bastions: bastionPolysWarpedSafe,
      minGapSamples,
      debug: Boolean(warpDebugEnabled),
    });

    if (Array.isArray(pruneRes?.bastionsOut) && pruneRes.bastionsOut.length) {
      bastionPolysForComposite = pruneRes.bastionsOut;
    }
  }
	if (ctx?.params?.warpFort?.debug) {
	  console.info("[Warp110] compositeWall decision", {
	    wallCurtainForDrawN: Array.isArray(wallCurtainForDraw) ? wallCurtainForDraw.length : null,
	    bastionPolysN: Array.isArray(bastionPolysForComposite) ? bastionPolysForComposite.length : null,
	    compositeWallN: Array.isArray(compositeWall) ? compositeWall.length : null,
	    willUseComposite: Array.isArray(compositeWall) && compositeWall.length >= 3,
	  });
	debugCompositeWallSplices({
	  wallCurtainForDraw,
	  bastionPolys: bastionPolysForComposite,
	  compositeWall,
	  cx,
	  onlyEast: true,
	  enabled: Boolean(warpDebugEnabled),
	});
	}
  if (Array.isArray(compositeWall) && compositeWall.length >= 3) {
    wallForDraw = compositeWall;
  } else if (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3) {
    // Fallback to warped curtain (better than pre-warp wallFinal)
    wallForDraw = wallCurtainForDraw;
  }


  return {
    warpWall: warpWall ?? null,
    warpOutworks: warpOutworks ?? null,
    wallForDraw: (Array.isArray(wallForDraw) && wallForDraw.length >= 3) ? wallForDraw : null,
	wallCurtainForDraw:
	  (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
	    ? wallCurtainForDraw
	    : null,
	drawPlainCurtain:
  		!(Array.isArray(compositeWall) && compositeWall.length >= 3),
    bastionPolysWarpedSafe: Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : null,
    bastionHullWarpedSafe: (Array.isArray(bastionHullWarpedSafe) && bastionHullWarpedSafe.length >= 3) ? bastionHullWarpedSafe : null,
  };
}
