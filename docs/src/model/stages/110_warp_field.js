
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
  nearestClosedPolylineTangent,
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

  // If we have a targetN policy, we can cap/trim the input bastion set deterministically.
  // This is a no-op if targetN is null.
  const polyN0 = Array.isArray(bastionPolys) ? bastionPolys.length : 0;
  const n0 = Math.min(bastionN0, polyN0);
  const bastionN = (targetN != null) ? Math.min(n0, targetN) : n0;
  const bastionsForWarpUsed = Array.isArray(bastionsForWarp)
    ? bastionsForWarp.slice(0, bastionN)
    : bastionsForWarp;
  
  const bastionPolysUsed = Array.isArray(bastionPolys)
    ? bastionPolys.slice(0, bastionN)
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
    3 * bastionN
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
  
  const curtainVertexN = Math.max(curtainVertexMin, Math.round(curtainVertexFactor * bastionN));
  
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
        usedCount: bastionN,
      };
    }  
  applyWarpfieldDrawHints({ warpWall, warpOutworks });

  const innerMargin = Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 10;
  const tMid = Number.isFinite(ctx?.params?.warpFort?.tMid) ? ctx.params.warpFort.tMid : 0.3;
  const midMargin = Number.isFinite(ctx?.params?.warpFort?.midMargin) ? ctx.params.warpFort.midMargin : 0;
  const wallWarped = (warpWall && warpWall.wallWarped) ? warpWall.wallWarped : null;
  let wallWarpedSafe = wallWarped;
  const centre = { x: cx, y: cy };
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
  
    bastionPlacement = {
      curtainPtsS,
      sArr,
      clearance,
      sampleStep,
      totalLen,
      outwardMode,
      minSpacing,
      want,
      maxima, // array of { i, s, c }
    };
  
    if (warpOutworks) warpOutworks.bastionPlacement = bastionPlacement;
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
  
  function unit(v) {
    const L = Math.hypot(v.x, v.y);
    if (!Number.isFinite(L) || L <= 1e-9) return { x: 0, y: 0 };
    return { x: v.x / L, y: v.y / L };
  }
  
  // Deterministic “make a bastion” anchored at a sampled curtain point.
  // Produces a 5-point polygon in the order expected by repairBastionStrictConvex:
  // [B0, S0, T, S1, B1]
  function makePentBastionAtSampleIndex(k, placement, wallCurtainForDraw, centrePt) {
    const P = placement.curtainPtsS[k];
  
    // Tangent from the final curtain polyline.
    const toC = { x: P.x - centrePt.x, y: P.y - centrePt.y };
    const tan = { x: -toC.y, y: toC.x }; // perpendicular to radial, deterministic fallback
    const tHat = unit(tan);
  
    // Outward normal, oriented away from centre.
    let nrm = unit({ x: -tHat.y, y: tHat.x });
    if (nrm.x * toC.x + nrm.y * toC.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
  
    // Size heuristics (deterministic). Tuned to your placement spacing.
    const baseHalf = Math.max(8, 0.22 * placement.minSpacing);
    const shoulderIn = 0.55 * baseHalf;
  
    // Use local clearance as a bound for tip length.
    const c = placement.clearance ? placement.clearance[k] : Infinity;
    const tipLen = Math.max(12, Math.min(Number.isFinite(c) ? 0.60 * c : 40, 0.55 * placement.minSpacing));
  
    const B0 = { x: P.x - tHat.x * baseHalf, y: P.y - tHat.y * baseHalf };
    const B1 = { x: P.x + tHat.x * baseHalf, y: P.y + tHat.y * baseHalf };
  
    const S0 = { x: P.x - tHat.x * shoulderIn + nrm.x * (0.25 * tipLen), y: P.y - tHat.y * shoulderIn + nrm.y * (0.25 * tipLen) };
    const S1 = { x: P.x + tHat.x * shoulderIn + nrm.x * (0.25 * tipLen), y: P.y + tHat.y * shoulderIn + nrm.y * (0.25 * tipLen) };
  
    const T = { x: P.x + nrm.x * tipLen, y: P.y + nrm.y * tipLen };
  
    return [B0, S0, T, S1, B1];
  }
  // Apply outworks warp to bastion polygons (two-target system).
  let bastionPolysWarpedSafe = bastionPolysUsed;
  
  if (warpOutworks?.field && Array.isArray(bastionPolysUsed)) {
    const centrePt = { x: cx, y: cy };

    const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params);

    bastionPolysWarpedSafe = bastionPolysUsed.map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;

      // 1) Warp bastions by the curtain wall warp first (so attachments follow the warped curtain).
      const warpedByCurtain = hasCurtainWarp
        ? warpPolylineRadial(poly, centrePt, warpWall.field, warpWall.params)
        : poly;

      // 2) Then warp by the outworks field (outer hull shaping).
      const warpedByOutworks = warpPolylineRadial(
        warpedByCurtain,
        centrePt,
        warpOutworks.field,
        warpOutworks.params
      );

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
  
  bastionPolysWarpedSafe = shrinkOutworksToFit({
    bastionPolysWarpedSafe,
    centre,
    wallCurtainForDraw,
    curtainMinField,
    outerHullLoop,
    warpOutworks: warpOutworksForBastions,
  });
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
      if (!Array.isArray(poly) || poly.length !== 5) {
        convexStats.push({ idx, ok: false, iters: 0, note: "skip_non5" });
        return poly;
      }
      const res = repairBastionStrictConvex(poly, centre, outerHullLoop, margin, K);
      convexStats.push({ idx, ok: res.ok, iters: res.iters, note: res.note });
      return res.poly;
    });

    // Keep stats on warpOutworks for debugging and later audits.
    warpOutworks.bastionConvex = convexStats;
    // ---------------- Sliding repair (before delete/reinsert) ----------------
    // If a bastion is still failing convexity/angle after repair, try sliding its anchor
    // to nearby clearance maxima slots and rebuild a fresh pentagonal bastion there.
    if (
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
      const failed = convexStats.filter(s => !s.ok).map(s => s.idx).sort((a, b) => a - b);
    
      // Local helper to re-run the same warp/clamp/hull/repair pipeline on a candidate poly.
      const margin = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
      const K = Number.isFinite(ctx?.params?.warpFort?.bastionConvexIters) ? ctx.params.warpFort.bastionConvexIters : 121;
    
      function warpClampRepairOne(poly5) {
        const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params);
    
        const warpedByCurtain = hasCurtainWarp
          ? warpPolylineRadial(poly5, centrePt, warpWall.field, warpWall.params)
          : poly5;
    
        const warpedByOutworks = warpPolylineRadial(warpedByCurtain, centrePt, warpOutworks.field, warpOutworks.params);
    
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
    
        const res = repairBastionStrictConvex(clampedSafe, centrePt, outerHullLoop, margin, K);
        return { ok: res.ok, poly: res.poly };
      }
    
      for (const idx of failed) {
        const cur = bastionPolysWarpedSafe[idx];
        if (!Array.isArray(cur) || cur.length !== 5) continue;
    
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
    
          const candPoly = makePentBastionAtSampleIndex(kSample, placement, wallCurtainForDraw, centrePt);
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
          if (!Array.isArray(poly) || poly.length !== 5) {
            refreshed.push({ idx: i, ok: false, iters: 0, note: "skip_non5" });
            continue;
          }
          const res = repairBastionStrictConvex(poly, centrePt, outerHullLoop, margin, K);
          refreshed.push({ idx: i, ok: res.ok, iters: res.iters, note: "post_slide_check" });
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
