// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.
// Extracted from generate.js without functional changes.

import { buildFortWarp, clampPolylineRadial } from "../generate_helpers/warp_stage.js";
import { warpPolylineRadial, buildWarpField } from "../warp.js";
import { auditRadialClamp } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";

/**
 * @param {object} args
 * @returns {object}
 *  {
 *    warpWall,
 *    warpOutworks,
 *    wallForDraw,
 *    bastionPolysWarpedSafe,
 *    bastionHullWarpedSafe
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
    // Curtain wall is wallBase (pre-bastion expansion).
    wallPoly: wallBase,
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
  // Wall-for-draw is the CURTAIN wall (not the bastion-composite).
  const wallForDraw = wallWarped || wallBase;

  // Build a radial field for the curtain wall itself, so bastions can be clamped OUTSIDE it.
  // This is the "min clamp" for bastions (ensures points stay away from the wall base).
  const curtainMinField =
    (warpOutworks?.params && Array.isArray(wallForDraw) && wallForDraw.length >= 3)
      ? buildWarpField({
          centre: { x: cx, y: cy },
          wallPoly: wallForDraw,
          targetPoly: wallForDraw,
          districts: [],
          bastions: [],
          params: { ...warpOutworks.params, debug: false },
        })
      : null;

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
      null,
      warpOutworks.maxField,
      0,
      warpOutworks.clampMaxMargin
    );

      return clamped;
    });
  }
  // Always enforce the bastion band when we have an outer clamp.
  if (warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe)) {
    bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
  
      return clampPolylineRadial(
        poly,
        { x: cx, y: cy },
        curtainMinField,           // may be null; clamp function should treat null as "no min"
        warpOutworks.maxField,
        2,                         // min margin from curtain
        warpOutworks.clampMaxMargin
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Enforce: convexHull(all bastion vertices) must be inside the OUTER hull.
  // If not, shrink bastions inward (around the city centre) until it fits.
  // ---------------------------------------------------------------------------
  const centre = { x: cx, y: cy };
  
  function scalePoint(p, s) {
    return { x: centre.x + (p.x - centre.x) * s, y: centre.y + (p.y - centre.y) * s };
  }
  
  function scalePolys(polys, s) {
    return (polys || []).map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
      return poly.map((p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? scalePoint(p, s) : p);
    });
  }
  
  function collectVertices(polys) {
    const pts = [];
    for (const poly of polys || []) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      for (const p of poly) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
      }
    }
    return pts;
  }
  
  // Sample points along hull edges so we test edges, not only vertices.
  function sampleClosedPoly(poly, samplesPerEdge) {
    if (!Array.isArray(poly) || poly.length < 3) return [];
    const out = [];
    const n = Math.max(1, samplesPerEdge | 0);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
  
      out.push(a);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  }

  // Returns true only if the bastion convex hull is fully inside the OUTER hull.
  function hullFitsOuter(polys) {
    if (!warpOutworks?.maxField) return true;
  
    const verts = collectVertices(polys);
    if (verts.length < 3) return true;
  
    const hull = convexHull(verts);
    if (!Array.isArray(hull) || hull.length < 3) return true;
  
    const samples = sampleClosedPoly(hull, 10);
  
    // Clamp samples to outer hull. If any moved, then hull was outside.
    const clamped = clampPolylineRadial(
      samples,
      centre,
      null,
      warpOutworks.maxField,
      0,
      warpOutworks.clampMaxMargin
    );
  
    const EPS2 = 1.0; // 1 px squared tolerance
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const q = clamped[i];
      if (!p || !q) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if ((dx * dx + dy * dy) > EPS2) return false;
    }
    return true;
  }

  // If needed, shrink bastions until their convex hull fits inside outer hull.
  if (warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe) && bastionPolysWarpedSafe.length) {
    if (!hullFitsOuter(bastionPolysWarpedSafe)) {
      // Binary search the largest scale s in (0, 1] that fits.
      let lo = 0.0;
      let hi = 1.0;
  
      // Deterministic number of iterations.
      for (let it = 0; it < 24; it++) {
        const mid = (lo + hi) * 0.5;
        const scaled = scalePolys(bastionPolysWarpedSafe, mid);
        if (hullFitsOuter(scaled)) {
          lo = mid; // fits, try larger
        } else {
          hi = mid; // does not fit, shrink more
        }
      }
  
      bastionPolysWarpedSafe = scalePolys(bastionPolysWarpedSafe, lo);
      // Safety: re-clamp into the BAND:
      // - outside the curtain (minField = curtainMinField)
      // - inside the outer hull (maxField = warpOutworks.maxField)
      // This is what makes bastions look natural (tips stay away from the wall base).
      bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly) => {
        if (!Array.isArray(poly) || poly.length < 3) return poly;
        return clampPolylineRadial(
          poly,
          { x: cx, y: cy },
          curtainMinField,
          warpOutworks.maxField,
          2,
          warpOutworks.clampMaxMargin
        );
      });
  
      // Optional debug value you can inspect later.
      warpOutworks.bastionHullScale = lo;
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
