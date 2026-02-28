
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import { buildFortWarp, clampPolylineRadial, resampleClosedPolyline } from "../generate_helpers/warp_stage.js";
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
  
  // Use actual warped bastion count (not ctx.params.bastions).
  const bastionN = Array.isArray(bastionsForWarp) ? bastionsForWarp.length : 0;
  
  // Extra inset (map units) to keep warped bastions further inside the outer hull.
  // Deterministic: purely parameter-driven.
  // Default chosen to be visibly effective without crushing geometry.
  const bastionOuterInset =
    (ctx.params && ctx.params.warpFort && Number.isFinite(ctx.params.warpFort.bastionOuterInset))
      ? Math.max(0, ctx.params.warpFort.bastionOuterInset)
      : 12;  
  
  // Requirement: curtain warp field samples = max(existing, 72, 3 * bastions).
  const curtainSamples = Math.max(
    ctx.params.warpFort?.samples ?? 0,
    36,
    6 * bastionN
  );
  
  // Vertex density for the curtain wall polyline (separate from field samples).
  const curtainVertexN = Math.max(90, 12 * bastionN);
  
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
    bastions: bastionsForWarp,
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
    bastions: bastionsForWarp,
    params: ctx.params.warpFort,
  });

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
  const wallCurtainForDraw = wallWarpedSafe || wallWarped || wallBaseDense;
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
  let bastionPolysWarpedSafe = bastionPolys;

  if (warpOutworks?.field && Array.isArray(bastionPolys)) {
    const centrePt = { x: cx, y: cy };

    const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params);

    bastionPolysWarpedSafe = bastionPolys.map((poly) => {
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
