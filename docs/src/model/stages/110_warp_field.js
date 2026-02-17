// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.
// Extracted from generate.js without functional changes.

import { buildFortWarp, clampPolylineRadial } from "../generate_helpers/warp_stage.js";
import { warpPolylineRadial } from "../warp.js";
import { auditRadialClamp } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";

/**
 * @param {object} args
 * @returns {object}
 *  {
 *    warpWall,
 *    warpOutworks,
 *    wallForDraw,
 *    bastionPolysWarpedSafe
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
  const fortOuterHull = fortHulls?.outerHull?.outerLoop ?? null;

  // Keep behaviour: generator stores warp config on ctx.params.warpFort.
  ctx.params.warpFort = warpFortParams;

  const warpWall = buildFortWarp({
    enabled: true,
    centre: { x: cx, y: cy },
    wallPoly: wallFinal,
    targetPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    // Invariant: wall must stay outside inner hull.
    clampMinPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMaxPoly: null,
    clampMinMargin: 2,
    clampMaxMargin: 2,
    districts,
    bastions: bastionsForWarp,
    params: ctx.params.warpFort,
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

  // ---- Draw style hints (consumed by renderer) ----
  // Wall: light blue
  if (warpWall) {
    warpWall.draw = {
      stroke: "#7fdcff", // light blue
      width: 3,
    };
  }

  // Outworks (bastions, ravelins, etc.): light orange
  if (warpOutworks) {
    warpOutworks.draw = {
      stroke: "#ffcc80", // light orange
      width: 2,
    };
  }

  const wallWarped = (warpWall && warpWall.wallWarped) ? warpWall.wallWarped : null;
  const wallForDraw = wallWarped || wallFinal;

  // Apply outworks warp to bastion polygons (two-target system).
  let bastionPolysWarpedSafe = bastionPolys;

  if (warpOutworks?.field && Array.isArray(bastionPolys)) {
    bastionPolysWarpedSafe = bastionPolys.map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;

      const warped = warpPolylineRadial(
        poly,
        { x: cx, y: cy },
        warpOutworks.field,
        warpOutworks.params
      );

      const clamped = clampPolylineRadial(
        warped,
        { x: cx, y: cy },
        warpOutworks.minField,
        warpOutworks.maxField,
        warpOutworks.clampMinMargin,
        warpOutworks.clampMaxMargin
      );

      return clamped;
    });
  }

  // ---------------- Bastion hull (global convex hull) ----------------
  // Compute convex hull of all (warped, clamped) bastion vertices, then clamp that hull
  // so it is guaranteed to be inside the OUTER hull (even if the outer hull is concave).
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
        // Only enforce: inside OUTER hull. (No inner constraint for this diagnostic shape.)
        // Uses the same radial clamp semantics as bastion polygon clamping.
        bastionHullWarpedSafe = clampPolylineRadial(
          h,
          { x: cx, y: cy },
          null,
          warpOutworks?.maxField ?? null,
          0,
          warpOutworks?.clampMaxMargin ?? 0
        );
      }
    }
  }

  // Debug audits (preserve same log behaviour).
  if (warpDebugEnabled) {
    auditRadialClamp({
      name: "WALL",
      polys: [wallForDraw],
      minField: warpWall?.minField,
      maxField: warpWall?.maxField,
      cx,
      cy,
      minMargin: warpWall?.clampMinMargin,
      maxMargin: warpWall?.clampMaxMargin,
      debugEnabled: true,
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
  }

  return {
    warpWall,
    warpOutworks,
    wallForDraw,
    bastionPolysWarpedSafe,
    bastionHullWarpedSafe,
  };
}
