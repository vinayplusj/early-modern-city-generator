
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import {
  buildFortWarp,
  clampPolylineRadial,
  resampleClosedPolyline,
  sampleClosedPolylineByArcLength,
  computeCurtainClearanceProfile,
  pickClearanceMaximaWithSpacing,
} from "../generate_helpers/warp_stage.js";
import { warpPolylineRadial, buildWarpField } from "../warp.js";
import { auditRadialClamp, auditPolyContainment } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";
import { repairBastionStrictConvex } from "../generate_helpers/bastion_convexity.js";
import { clampPolylineInsidePolyAlongRays} from "../../geom/radial_ray_clamp.js";
import { buildCompositeWallFromCurtainAndBastions } from "../generate_helpers/composite_wall_builder.js"; 
import { shrinkOutworksToFit } from "../generate_helpers/outworks_shrink_fit.js";
import { clampCurtainPostConditions } from "../generate_helpers/curtain_post_clamp.js";
import { applyWarpfieldDrawHints } from "../../render/stages/warpfield_draw_hints.js";
import { auditWallDeterministicOutsideInnerHull } from "../debug/warpfield_wall_audit.js";

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
  const curtainSamples = Math.max(
    ctx.params.warpFort?.samples ?? 0,
    18,
    3 * bastionNDesired
  );
  
  // Curtain vertex count controls how many points the wall warp operates on.
  // Lower N => fewer points in wallBaseDense => fewer points after warp/clamps.
  // Defaults chosen to reduce point count while staying visually stable.
  const curtainVertexFactor =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.curtainVertexFactor))
      ? ctx.params.warpFort.curtainVertexFactor
      : 6; 
  
  const curtainVertexMin =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.curtainVertexMin))
      ? ctx.params.warpFort.curtainVertexMin
      : 60; 
  
  const curtainVertexN = Math.max(curtainVertexMin, Math.round(curtainVertexFactor * bastionNDesired));
  
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
    ? polySignedArea(wallCurtainForDraw)
    : 1;
  
  const wantCCW = curtainArea > 0;
  function unit(v) {
    const L = Math.hypot(v.x, v.y);
    if (!Number.isFinite(L) || L <= 1e-9) return { x: 0, y: 0 };
    return { x: v.x / L, y: v.y / L };
  }
  function add(p, v, s) { return { x: p.x + v.x * s, y: p.y + v.y * s }; }
  
  function polySignedArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      a += (p.x * q.y - q.x * p.y);
    }
    return 0.5 * a;
  }
  
  function ensureWinding(poly, wantCCW) {
    const a = polySignedArea(poly);
    const isCCW = a > 0;
    if (wantCCW ? !isCCW : isCCW) return poly.slice().reverse();
    return poly;
  }
  // Build a 5-point bastion anchored on the sampled curtain at index k.
  // Output order: [B0, S0, T, S1, B1] (required by repairBastionStrictConvex).	
  function makePentBastionAtSampleIndex(k, placement) {
    const P = placement.curtainPtsS[k];	
    const out = unit({ x: P.x - cx, y: P.y - cy });
    const tan = unit({ x: -out.y, y: out.x });	
    const nrm = out;		
    const c = placement.clearance?.[k];
	const shoulderSpanToTip =
	  Number.isFinite(ctx?.params?.warpFort?.bastionShoulderSpanToTip)
	    ? Math.max(0.1, ctx.params.warpFort.bastionShoulderSpanToTip)
	    : 0.55; // default: shoulders ~= 55% of tip length
    // Local spacing for this maxima (fallback to global minSpacing if missing).
    const localSpacing =
      (placement.localSpacingByK && placement.localSpacingByK.has(k))
        ? placement.localSpacingByK.get(k)
        : placement.minSpacing;
	const shoulderInMaxFromSpacing = 0.45 * localSpacing;
    // 1) Base size depends on local spacing only.
    // Ensure base consumes well under half the neighbour gap to avoid overlap.
    // 2) Tip length depends on clearance-to-outer-hull, with a fixed reserved buffer.
    // This enforces a fixed bastion↔outerHull clearance (space for ditch + glacis).
    const reserve = Number.isFinite(placement.bastionOuterClearance) ? placement.bastionOuterClearance : 0;

    // If clearance is missing, fall back to a conservative default.
    const tipLenFromClearance = Number.isFinite(c) ? Math.max(0, c - reserve) : 40;

    // Hard safety: never let the tip reach the hull even if reserve is 0.
    const tipLen0 = Math.max(10, Number.isFinite(c) ? Math.min(tipLenFromClearance, Math.max(0, c - 2)) : tipLenFromClearance);
	// Shoulder half-span from tip length (ratio rule)
	const shoulderInTarget = 0.5 * shoulderSpanToTip * tipLen0;
	
	// Final shoulder half-span
	const shoulderInHardCap0 = 0.60 * tipLen0;
	const shoulderIn0 = Math.max(6, Math.min(shoulderInTarget, shoulderInMaxFromSpacing, shoulderInHardCap0));
	
	// Keep B0/B1 sampling compatible with existing logic.
	// Previously: shoulderIn = 0.55 * baseHalf  => baseHalf = shoulderIn / 0.55
	const baseHalf0 = shoulderIn0 / 0.55;
	  function build(baseHalf, shoulderIn, tipLen) {	

      const pts = placement.curtainPtsS;
      const n = pts.length;	
	
      // sampleStep exists on placement (you set it when building bastionPlacement)	
      const step = Number.isFinite(placement.sampleStep) ? placement.sampleStep : 10;	
	
	// Convert baseHalf (map units) to a sample index offset	
		let d = Math.max(1, Math.round(baseHalf / step));
		
		// Ensure base endpoints are not degenerate.
		// Deterministic: increase d until B0-B1 chord exceeds a minimum or we hit a cap.
		const minBaseChord = Math.max(2, 0.20 * shoulderIn);
		const dMax = Math.min((n / 6) | 0, 12);
		
		let B0 = pts[(k - d + n) % n];
		let B1 = pts[(k + d) % n];
		
		for (let tries = 0; tries < dMax; tries++) {
		  const dx = B1.x - B0.x;
		  const dy = B1.y - B0.y;
		  const chord = Math.hypot(dx, dy);
		  if (chord >= minBaseChord) break;
		  d += 1;
		  B0 = pts[(k - d + n) % n];
		  B1 = pts[(k + d) % n];
		}
	const S0 = add(add(P, tan, -shoulderIn), nrm, 0.25 * tipLen);
    const S1 = add(add(P, tan, +shoulderIn), nrm, 0.25 * tipLen);
    const T = add(P, nrm, tipLen);
    return ensureWinding([B0, S0, T, S1, B1], wantCCW);
	}
	// Deterministic max-fit search (shrinks only)
	const tipScales = [1.00, 0.85, 0.72, 0.60];
	const widthExtraScales = [1.00, 0.85, 0.72]; // extra squeeze if needed
	
	for (const ts of tipScales) {
	  const tipLen = tipLen0 * ts;
	
	  // Shoulder half-span derived from tip length (ratio rule), then clamped by spacing
	  const shoulderInTarget2 = 0.5 * shoulderSpanToTip * tipLen;
		const shoulderInHardCap = 0.60 * tipLen; // do not allow shoulders wider than 60% of tip length per side
		const shoulderIn2 = Math.max(6, Math.min(shoulderInTarget2, shoulderInMaxFromSpacing, shoulderInHardCap));	
	  // Keep B0/B1 sampling consistent with shoulderIn
	  const baseHalf2 = shoulderIn2 / 0.55;
	
	  for (const ws of widthExtraScales) {
	    const shoulderInTry = shoulderIn2 * ws;
	    const baseHalfTry = shoulderInTry / 0.55;
	
	    const poly = build(baseHalfTry, shoulderInTry, tipLen);   // IMPORTANT: 3 args in this order
	    if (Math.abs(polySignedArea(poly)) < 1e-3) continue;
	    return poly;
	  }
	}
	
	// Best-effort fallback (still respects ratio rule)
	return build(baseHalf0, shoulderIn0, tipLen0);
  }  
  // ---------------- Bastion placement candidates (clearance maxima) ----------------
  // Compute once per run. Deterministic. Used later for soft reinsertion.
  let bastionPlacement = null;
  
  if (outerHullLoop && Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3) {
    const centrePt = { x: cx, y: cy };
  
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
    const fortR = Number.isFinite(ctx?.params?.warpFort?.bandOuter)
      ? ctx.params.warpFort.bandOuter
      : (Number.isFinite(warpFortParams?.bandOuter) ? warpFortParams.bandOuter : null);
  
    const ditchWidthEst  = Number.isFinite(fortR) ? fortR * 0.035 : 0;
    const glacisWidthEst = Number.isFinite(fortR) ? fortR * 0.08  : 0;
  
    const bastionOuterClearance =
      Number.isFinite(ctx?.params?.warpFort?.bastionOuterClearance)
        ? Math.max(0, ctx.params.warpFort.bastionOuterClearance)
        : (ditchWidthEst + glacisWidthEst) * 1.10; // fixed default + safety margin
    
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
        .map(k => makePentBastionAtSampleIndex(k, bastionPlacement));

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
  function bastionCentroid(poly) {
    let sx = 0, sy = 0, n = 0;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      sx += p.x; sy += p.y; n++;
    }
    return (n > 0) ? { x: sx / n, y: sy / n } : { x: cx, y: cy };
  }
  
  function nearestSampleIndex(pts, p) {
    // Deterministic: first minimum wins.
    let bestI = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
    return bestI;
  }
  
  function circDist(aS, bS, L) {
    const d = Math.abs(aS - bS);
    return Math.min(d, Math.max(0, L - d));
  }
  
  function nearestMaximaIndex(maxima, s0, L) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < maxima.length; i++) {
      const d = circDist(maxima[i].s, s0, L);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  
  // Apply outworks warp to bastion polygons (two-target system).
  let bastionPolysWarpedSafe = bastionPolysUsed;
  
  if (warpOutworks?.field && Array.isArray(bastionPolysUsed)) {
    const centrePt = { x: cx, y: cy };

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
  // Enforce: all turns match expectedSign AND no near-collinear turns.
  // Only affects 5-point bastions: [B0, S0, T, S1, B1].
  if (outerHullLoop && Array.isArray(bastionPolysWarpedSafe)) {
    const K = Number.isFinite(ctx?.params?.warpFort?.bastionConvexIters)
      ? ctx.params.warpFort.bastionConvexIters
      : 121;

    const margin = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;

    const convexStats = [];
    bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly, idx) => {
    if (!Array.isArray(poly) || poly.length < 3) {
      convexStats.push({ idx, ok: false, iters: 0, note: "skip_invalid" });
      return poly;
    }
    if (poly.length === 3) {
      convexStats.push({ idx, ok: true, iters: 0, note: "fallback_triangle" });
      return poly;
    }
    if (poly.length !== 5) {
      convexStats.push({ idx, ok: false, iters: 0, note: "skip_non5" });
      return poly;
    }
      poly = ensureWinding(poly, wantCCW);
      if (Math.abs(polySignedArea(poly)) < 1e-3) {
        convexStats.push({ idx, ok: false, iters: 0, note: "degenerate_area" });
        return poly;
      }
      const res = repairBastionStrictConvex(poly, centre, outerHullLoop, margin, K);
            
      if (!res.ok) {
        convexStats.push({ idx, ok: false, iters: res.iters, note: res.note });
        return res.poly; // keep 5 points for sliding
      }
      
      convexStats.push({ idx, ok: true, iters: res.iters, note: res.note });
      return res.poly;
    });

    // Keep stats on warpOutworks for debugging and later audits.
    warpOutworks.bastionConvex = convexStats;
    // ---------------- Sliding repair (before delete/reinsert) ----------------
    // If a bastion is still failing convexity/angle after repair, try sliding its anchor
    // to nearby clearance maxima slots and rebuild a fresh pentagonal bastion there.
    const enableSlideRepair = Boolean(ctx?.params?.warpFort?.enableSlideRepair);
    
    if (
      enableSlideRepair &&
      warpOutworks?.bastionPlacement?.maxima?.length &&
      warpOutworks.bastionPlacement.curtainPtsS?.length &&
      warpOutworks.bastionPlacement.sArr?.length &&
      warpOutworks.bastionPlacement.clearance?.length &&
      warpOutworks?.field &&
      outerHullLoop &&
      Array.isArray(wallCurtainForDraw)
    ) {
      const placement = warpOutworks.bastionPlacement;
      const maxima = placement.maxima;
      const L = placement.totalLen;
      const centrePt = { x: cx, y: cy };
    
      // Deterministic sliding budget per failing bastion.
      const slideTries = Number.isFinite(ctx?.params?.warpFort?.slideMaxTries)
        ? Math.max(1, ctx.params.warpFort.slideMaxTries | 0)
        : 3;
    
      // Track maxima used by successful slides to avoid stacking two repairs onto one slot.
      const usedMax = new Set();
    
      // Use convexStats as the failure signal (extend later to include visibility).
      const failed = convexStats
        .filter(s => !s.ok)
        .map(s => s.idx)
        .sort((a, b) => a - b);
    
      // Local helper to re-run the same warp/clamp/hull/repair pipeline on a candidate poly.
      const margin = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
      const K = Number.isFinite(ctx?.params?.warpFort?.bastionConvexIters) ? ctx.params.warpFort.bastionConvexIters : 121;
    
      function warpClampRepairOne(poly5) {
        const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params) && !bastionsBuiltFromMaxima;
        
        const warpedByCurtain = hasCurtainWarp
          ? warpPolylineRadial(poly5, centrePt, warpWall.field, warpWall.params)
          : poly5;
        
        const warpedByOutworks = bastionsBuiltFromMaxima
          ? warpedByCurtain
          : warpPolylineRadial(warpedByCurtain, centrePt, warpOutworks.field, warpOutworks.params);
    
        const clamped = clampPolylineRadial(
          warpedByOutworks,
          centrePt,
          curtainMinField,
          null,
          2,
          warpOutworks.clampMaxMargin
        );
        
        let clampedSafe = clamped;
        if (outerHullLoop) {
          const baseM = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
          const m = baseM + bastionOuterInset;
          clampedSafe = clampPolylineInsidePolyAlongRays(clampedSafe, centrePt, outerHullLoop, m);

        }
    
        let poly2 = ensureWinding(clampedSafe, wantCCW);
        if (Math.abs(polySignedArea(poly2)) < 1e-3) return { ok: false, poly: poly2 };
        const res = repairBastionStrictConvex(poly2, centrePt, outerHullLoop, margin, K);
        return { ok: res.ok, poly: res.poly };
      }
    
      for (const idx of failed) {
        const cur = bastionPolysWarpedSafe[idx];
        if (!Array.isArray(cur) || cur.length < 3) continue;
    
        // Project current bastion to a nearby s value on the sampled curtain.
        const c = bastionCentroid(cur);
        const k0 = nearestSampleIndex(placement.curtainPtsS, c);
        const s0 = placement.sArr[k0] || 0;
    
        // Find nearest maxima and try around it deterministically.
        const j0 = nearestMaximaIndex(maxima, s0, L);
    
        const candJs = [j0];
        for (let k = 1; k <= slideTries; k++) {
          candJs.push((j0 - k + maxima.length) % maxima.length);
          candJs.push((j0 + k) % maxima.length);
        }
    
        let repaired = false;
    
        for (const j of candJs) {
          if (usedMax.has(j)) continue;
          const m = maxima[j];
          const kSample = m.i;
    
          if (kSample < 0 || kSample >= placement.curtainPtsS.length) continue;
    
          const candPoly = makePentBastionAtSampleIndex(kSample, placement);
          const out = warpClampRepairOne(candPoly);
    
          if (out.ok) {
            bastionPolysWarpedSafe[idx] = out.poly;
            usedMax.add(j);
            repaired = true;
            break;
          }
        }
    
        if (!repaired && warpDebugEnabled) {
          console.log("[slideRepair] could not repair bastion", { idx });
        }
      }
    
      // Optional (recommended): refresh convex stats after sliding so your audit matches final geometry.
      // Keep it deterministic by re-running the repair check only.
      if (warpOutworks?.bastionConvex && Array.isArray(warpOutworks.bastionConvex)) {
        const refreshed = [];
        for (let i = 0; i < bastionPolysWarpedSafe.length; i++) {
          const poly = bastionPolysWarpedSafe[i];
          if (!Array.isArray(poly) || poly.length < 3) {
            refreshed.push({ idx: i, ok: false, iters: 0, note: "skip_invalid" });
            continue;
          }
          if (poly.length === 3) {
            // Already a fallback triangle; keep it as a valid end state.
            refreshed.push({ idx: i, ok: true, iters: 0, note: "fallback_triangle" });
            continue;
          }
          if (poly.length !== 5) {
            refreshed.push({ idx: i, ok: false, iters: 0, note: "skip_non5" });
            continue;
          }
        let poly2 = ensureWinding(poly, wantCCW);
        
        if (Math.abs(polySignedArea(poly2)) < 1e-3) {
          refreshed.push({ idx: i, ok: false, iters: 0, note: "degenerate_area" });
          bastionPolysWarpedSafe[i] = poly2;
          continue;
        }
        
        const res = repairBastionStrictConvex(poly2, centrePt, outerHullLoop, margin, K);
        
        if (!res.ok) {
          const tri = [res.poly[0], res.poly[2], res.poly[4]];
          refreshed.push({ idx: i, ok: true, iters: res.iters, note: "fallback_triangle" });
          bastionPolysWarpedSafe[i] = tri;
          continue;
        }
        
        refreshed.push({ idx: i, ok: true, iters: res.iters, note: "post_slide_check" });
        bastionPolysWarpedSafe[i] = res.poly;
        }
        warpOutworks.bastionConvex = refreshed;
      }
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
