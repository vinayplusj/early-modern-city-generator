
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import { warpPolylineRadial, buildWarpField } from "../warp.js";
import { auditRadialClamp, auditPolyContainment } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";
import {
  buildFortWarp,
  clampPolylineRadial,
  resampleClosedPolyline,
  sampleClosedPolylineByArcLength,
  computeCurtainClearanceProfile,
  pickClearanceMaximaWithSpacing,
} from "../generate_helpers/warp_stage.js";
import { repairBastionStrictConvex } from "../generate_helpers/bastion_convexity.js";
import { buildCompositeWallFromCurtainAndBastions } from "../generate_helpers/composite_wall_builder.js"; 
import { shrinkOutworksToFit } from "../generate_helpers/outworks_shrink_fit.js";
import { clampCurtainPostConditions } from "../generate_helpers/curtain_post_clamp.js";
import { buildPentBastionAtSampleIndex } from "../generate_helpers/bastion_builder.js";
import { nearestSampleIndex, nearestMaximaIndex } from "../generate_helpers/warpfield_slots.js";
import { bastionCentroid } from "../generate_helpers/bastion_geom.js";
import { repairBastionsStrictConvex } from "../generate_helpers/bastion_convex_repair.js";
import { slideRepairBastions } from "../generate_helpers/bastion_slide_repair.js";
import { clampPolylineInsidePolyAlongRays} from "../../geom/radial_ray_clamp.js";
import { loopPerimeter, polyAreaSigned } from "../../geom/loop_metrics.js";
import { ensureWinding } from "../../geom/poly.js";
import { applyWarpfieldDrawHints } from "../../render/stages/warpfield_draw_hints.js";
import { auditWallDeterministicOutsideInnerHull } from "../debug/warpfield_wall_audit.js";
import { assert } from "../util/assert.js";
import { median } from "../util/stats.js";
import { runWarpfieldPipeline } from "../generate_helpers/warpfield_pipeline.js";

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

  // Curtain wall (pre-bastion) for clamp + debug.
  // This is the FINAL curtain polyline that downstream attachments should follow.
  const wallCurtainForDrawRaw = wallWarpedSafe || wallWarped || wallBaseDense;
  const wallCurtainForDraw = (Array.isArray(wallCurtainForDrawRaw) && wallCurtainForDrawRaw.length >= 3)
    ? resampleClosedPolyline(wallCurtainForDrawRaw, curtainVertexN)
    : wallCurtainForDrawRaw;
  const curtainArea = (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
    ? polyAreaSigned(wallCurtainForDraw)
    : 1;
  
  const wantCCW = curtainArea > 0;
	
  // ---------------- Bastion placement candidates (clearance maxima) ----------------
  // Compute once per run. Deterministic. Used later for soft reinsertion.
  let bastionPlacement = null;
  
  if (outerHullLoop && Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 8) {
  
    // Sampling step in map units. Lower => more accurate but more expensive.
    const sampleStep =
      Number.isFinite(ctx?.params?.warpFort?.placementSampleStep)
        ? Math.max(2, ctx.params.warpFort.placementSampleStep)
        : 10;
  
    const { pts: curtainPtsS, s: sArr, totalLen } =
      sampleClosedPolylineByArcLength(wallCurtainForDraw, sampleStep);
  
    // Clearance measured outward from curtain toward outer hull.
    const outwardMode = ctx?.params?.warpFort?.placementOutwardMode || "normal";
    const { clearance } = computeCurtainClearanceProfile({
      curtainPts: curtainPtsS,
      centre: centrePt,
      outerHullLoop,
      outwardMode,
    });
  
    // Determine target count and spacing.
    const soft = ctx?.params?.bastionSoft || null;
    const budget = Number.isFinite(soft?.reinsertBudget) ? Math.max(0, soft.reinsertBudget | 0) : 0;
    // ---- Fixed clearance from bastion tips to outer hull ----
    // Goal: leave enough space for moatworks (ditch + glacis) plus a margin.
    // Stage 120 uses: ditchWidth = fortR * 0.035, glacisWidth = fortR * 0.08.
	const fortRParam =
	  (Number.isFinite(ctx?.params?.warpFort?.bandOuter) && ctx.params.warpFort.bandOuter > 0)
	    ? ctx.params.warpFort.bandOuter
	    : (Number.isFinite(warpFortParams?.bandOuter) ? warpFortParams.bandOuter : null);
	
	// Deterministic geometric fallback: median curtain radius from centre.
	let fortRGeom = null;
	if (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 8) {
	  const rs = [];
	  for (let i = 0; i < wallCurtainForDraw.length; i++) {
	    const p = wallCurtainForDraw[i];
	    if (!p) continue;
	    rs.push(Math.hypot(p.x - cx, p.y - cy));
	  }
	  fortRGeom = median(rs);
	}
	
	const fortR =
	  (Number.isFinite(fortRParam) && fortRParam > 0)
	    ? fortRParam
	    : fortRGeom;
	
	assert(
	  Number.isFinite(fortR) && fortR > 0,
	  `warpFort.bandOuter invalid; fortRParam=${fortRParam}, fortRGeom=${fortRGeom}`
	);
	if (warpOutworks) {
	  warpOutworks._fortR = { param: fortRParam, geom: fortRGeom, used: fortR };
	}
    const ditchWidthEst  = Number.isFinite(fortR) ? fortR * 0.030 : 0;
    const glacisWidthEst = Number.isFinite(fortR) ? fortR * 0.070  : 0;
  
    const bastionOuterClearance =
      Number.isFinite(ctx?.params?.warpFort?.bastionOuterClearance)
        ? Math.max(0, ctx.params.warpFort.bastionOuterClearance)
        : (ditchWidthEst + glacisWidthEst) * 1.20; // fixed default + safety margin
	assert(Number.isFinite(bastionOuterClearance), `bastionOuterClearance non-finite: ${bastionOuterClearance}`);
	assert(bastionOuterClearance > 0, `bastionOuterClearance is zero; fortR=${fortR}, ditchWidthEst=${ditchWidthEst}, glacisWidthEst=${glacisWidthEst}`);
	if (warpDebugEnabled) console.log("[bastionOuterClearance]", { fortRParam, fortRGeom, fortR, ditchWidthEst, glacisWidthEst, bastionOuterClearance });
    // Minimum spacing along the curtain perimeter (map units).
    // Defaults: ~ one bastion per (perimeter/targetN) but with a conservative lower bound.
    const minSpacing =
      Number.isFinite(ctx?.params?.warpFort?.placementMinSpacing)
        ? Math.max(0, ctx.params.warpFort.placementMinSpacing)
        : (targetN > 0 ? Math.max(20, 0.65 * (totalLen / targetN)) : 0);
  
    // Pick enough candidates to support reinsertion: targetN + budget + small cushion.
    const want = Math.max(0, targetN + budget + 3);
  
    const maxima = pickClearanceMaximaWithSpacing({
      s: sArr,
      clearance,
      targetN: want,
      minSpacing,
      neighbourhood: 2,
      totalLen,
    });
    // ---- Local spacing per maxima (arc-length to neighbours) ----
    // We want each bastion sized independently based on its own available spacing.
    const maximaByS = maxima.slice().sort((a, b) => a.s - b.s);
    const localSpacingByK = new Map();

    for (let j = 0; j < maximaByS.length; j++) {
      const prev = maximaByS[(j - 1 + maximaByS.length) % maximaByS.length];
      const cur  = maximaByS[j];
      const next = maximaByS[(j + 1) % maximaByS.length];

      const dPrev = (cur.s - prev.s + totalLen) % totalLen;
      const dNext = (next.s - cur.s + totalLen) % totalLen;

      const localSpacing = Math.min(dPrev, dNext);
      localSpacingByK.set(cur.i, localSpacing);
    }  
    bastionPlacement = {
      curtainPtsS,
      sArr,
      clearance,
      sampleStep,
      totalLen,
      outwardMode,
      bastionOuterClearance,
      localSpacingByK,
      minSpacing,
      want,
      maxima, // array of { i, s, c }
    };
  
    if (warpOutworks) warpOutworks.bastionPlacement = bastionPlacement;
    if (warpOutworks) warpOutworks.bastionsBuiltFromMaxima = bastionsBuiltFromMaxima;
    
    // Replace upstream bastion polys if we have maxima.
    if (bastionPlacement?.maxima?.length && bastionNDesired > 0) {
      const maximaTop = bastionPlacement.maxima.slice(0, bastionNDesired);
    
      // Build new bastion polygons directly from maxima sample indices.
      const built = maximaTop
        .map(m => m.i)
        .filter(k => Number.isFinite(k) && k >= 0 && k < bastionPlacement.curtainPtsS.length)
        .map(k => buildPentBastionAtSampleIndex({
		  k,
		  placement: bastionPlacement,
		  cx,
		  cy,
		  wantCCW,
		  shoulderSpanToTip: ctx?.params?.warpFort?.bastionShoulderSpanToTip,
		outerHullLoop,
		}));

      if (built.length > 0) {
        bastionPolysUsed.length = 0;
        for (const poly of built) bastionPolysUsed.push(poly);
      
        bastionsBuiltFromMaxima = true; // must be the function-scope variable
        if (warpOutworks) warpOutworks.bastionsBuiltFromMaxima = true;
        if (warpOutworks) warpOutworks.bastionsBuiltCount = built.length;
      }
    }
  }
  // -------------------------------------------------------------------------
  // Make warpWall.wallWarped equal the final curtain used for draw + downstream.
  // Preserve the original (pre-final) as wallWarpedRaw for debugging.
  // -------------------------------------------------------------------------
  if (warpWall) {
    // Preserve original output from buildFortWarp (already warped + any internal clamps).
    if (!warpWall.wallWarpedRaw) {
      warpWall.wallWarpedRaw = warpWall.wallWarped || null;
    }
    // Overwrite: this is the final curtain after deterministic hard clamps.
    // Downstream features (ditches, attachments) should use this.
    warpWall.wallWarped = wallCurtainForDraw;
  
    if (warpDebugEnabled) {
      console.log("[warpWall] overwrite wallWarped -> wallCurtainForDraw", {
        rawLen: warpWall.wallWarpedRaw?.length ?? null,
        finalLen: warpWall.wallWarped?.length ?? null,
        sameRef: warpWall.wallWarpedRaw === warpWall.wallWarped,
      });
    }
  }

  if (warpDebugEnabled && warpWall && Array.isArray(wallBaseDense) && wallBaseDense[0]) {
    const base0 = wallBaseDense[0];
  
    const raw0 = warpWall?.wallWarpedRaw?.[0];
  
    const final0 = warpWall?.wallWarped?.[0];
  }
  
  // -------------------------------------------------------------------------
  // Replace the curtain warp field with a "final" field that maps
  // the original curtain input (wallBaseDense) directly to the final curtain
  // (wallCurtainForDraw). This keeps all attachments (ditches, etc.) in sync.
  // No smoothing pass.
  // -------------------------------------------------------------------------
  
  const finalCurtainParams = (warpWall?.params)
    ? {
        ...warpWall.params,
        debug: false,
        _clampField: true,
        ignoreBand: true,
        smoothRadius: 0,
        maxStep: 1e9,
        maxIn: 1e9,
        maxOut: 1e9,
      }
    : null;
  
  const finalCurtainField =
    (Array.isArray(wallBaseDense) && wallBaseDense.length >= 3 &&
     Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3 &&
     finalCurtainParams)
      ? buildWarpField({
          centre: { x: cx, y: cy },
          wallPoly: wallBaseDense,
          targetPoly: wallCurtainForDraw,
          districts: null,
          bastions: [],
          params: finalCurtainParams,
        })
      : null;
  
  if (warpWall && finalCurtainField) {
    // Keep the originals for debug and regression checks.
    warpWall.fieldOriginal = warpWall.field;
    warpWall.paramsOriginal = warpWall.params;

    // Replace the field AND the warped curtain polyline.
    // Downstream attachments (ditches, glacis, etc.) that read warpWall.wallWarped
    // will now follow the final, post-clamp curtain.
    warpWall.field = finalCurtainField;
    warpWall.params = finalCurtainParams;
  }
  if (warpDebugEnabled && warpWall?.field && Array.isArray(wallBaseDense) && wallBaseDense[0]) {
    const p = wallBaseDense[0];
    const q = warpPolylineRadial([p], { x: cx, y: cy }, warpWall.field, warpWall.params)[0];
  }
    

  // Build a radial field for the curtain wall itself, so bastions can be clamped OUTSIDE it.
  // This is the "min clamp" for bastions (ensures points stay away from the wall base).
  const curtainMinField =
    (warpOutworks?.params && Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
      ? buildWarpField({
          centre: { x: cx, y: cy },
          wallPoly: wallCurtainForDraw,
          targetPoly: wallCurtainForDraw,
          districts: null,
          bastions: [],
          params: { ...warpOutworks.params, debug: false },
        })
      : null;
  
  // Apply outworks warp to bastion polygons (two-target system).
  let bastionPolysWarpedSafe = bastionPolysUsed;
  
  if (warpOutworks?.field && Array.isArray(bastionPolysUsed)) {

  const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params) && !bastionsBuiltFromMaxima;
  
  bastionPolysWarpedSafe = bastionPolysUsed.map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
      // Preserve base endpoints for 5-point bastions: [B0, S0, T, S1, B1]
      const B0 = (poly.length === 5) ? poly[0] : null;
      const B1 = (poly.length === 5) ? poly[4] : null;
    
    // 1) Warp bastions by the curtain wall warp first (so attachments follow the warped curtain).
  const warpedByCurtain = hasCurtainWarp
    ? warpPolylineRadial(poly, centrePt, warpWall.field, warpWall.params)
    : poly;

    // 2) Then warp by the outworks field (outer hull shaping).
    const warpedByOutworks = bastionsBuiltFromMaxima
      ? warpedByCurtain // do not shear maxima-built geometry on first pass
      : warpPolylineRadial(warpedByCurtain, centrePt, warpOutworks.field, warpOutworks.params);

    // 3) Clamp into the allowed radial band.
      const clamped = clampPolylineRadial(
        warpedByOutworks,
        centrePt,
        curtainMinField,
        null, // do not enforce radial max for bastions
        2,
        warpOutworks.clampMaxMargin
      );

      // Hard invariant: outworks must remain inside the outer hull polygon.
      // Deterministic “shrink-to-fit” along centre rays.
      let clampedSafe = clamped;

      if (outerHullLoop) {
        const baseM = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
        const m = baseM + bastionOuterInset;
        clampedSafe = clampPolylineInsidePolyAlongRays(clampedSafe, centrePt, outerHullLoop, m);
      }
      
      return clampedSafe;

    });
  }

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
{
	let bastionConvexSummary = null;
	
	{
	  const { bastionPolysOut, convexStats } = repairBastionsStrictConvex({
	    bastionPolys: bastionPolysWarpedSafe,
	    wantCCW,
	    areaEps: 1e-3,
	    ensureWinding,
	    polyAreaSigned,
	    repairOne: (poly) => {
	      const r = repairBastionStrictConvex(poly, centrePt, outerHullLoop, margin, K);
	      if (!r) return { ok: false, reason: "repairBastionStrictConvex returned null" };
	      return (r.ok && Array.isArray(r.poly))
	        ? { ok: true, poly: r.poly }
	        : { ok: false, reason: r.reason || "repair failed" };
	    },
	  });
	
	  bastionPolysWarpedSafe = bastionPolysOut;
	  bastionConvexSummary = convexStats;
	}
	// ---------------- Sliding repair (before delete/reinsert) ----------------
	// If a bastion is still failing convexity/angle after repair, try sliding its anchor
	// to nearby clearance maxima slots and rebuild a fresh pentagonal bastion there.
	const enableSlideRepair = Boolean(ctx?.params?.warpFort?.enableSlideRepair);
	
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
    if (Math.abs(polyAreaSigned(poly2)) < 1e-3) {
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
    polyAreaSigned,
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

  // Optional: refresh convex summary after sliding (summary-only).
  const refreshed = repairBastionsStrictConvex({
    bastionPolys: bastionPolysWarpedSafe,
    wantCCW,
    areaEps: 1e-3,
    ensureWinding,
    polyAreaSigned,
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
  }
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

  // Prefer a composite final wall built from the FINAL warped curtain + FINAL bastions.
  // This keeps bastionHullWarpedSafe for debug only.
  const compositeWall = buildCompositeWallFromCurtainAndBastions(
    wallCurtainForDraw,
    bastionPolysWarpedSafe
  );

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
    wallCurtainForDraw: (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3) ? wallCurtainForDraw : null,
    bastionPolysWarpedSafe: Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : null,
    bastionHullWarpedSafe: (Array.isArray(bastionHullWarpedSafe) && bastionHullWarpedSafe.length >= 3) ? bastionHullWarpedSafe : null,
  };
}
