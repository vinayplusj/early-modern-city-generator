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
  
  // Curtain wall (pre-bastion) for clamp + debug.
  const wallCurtainForDraw = wallWarped || wallBase;
  
  // Composite fort outline for renderer output.
  const wallForDraw = wallFinal;

  // Build a radial field for the curtain wall itself, so bastions can be clamped OUTSIDE it.
  // This is the "min clamp" for bastions (ensures points stay away from the wall base).
  const curtainMinField =
    (warpOutworks?.params && Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
      ? buildWarpField({
          centre: { x: cx, y: cy },
          wallPoly: wallCurtainForDraw,
          targetPoly: wallCurtainForDraw,
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
      curtainMinField,
      warpOutworks.maxField,
      2,
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
  // Per-bastion shrink-to-fit (independent), using a mixed shrink transform:
  // 1) uniform centre scaling
  // 2) inward push along "outward normal" (estimated)
  // 3) inward push along radial line from centre (same line used by radial clamp)
  // ---------------------------------------------------------------------------
  
  const EPS2 = 1.0; // 1 px squared tolerance
  
  function centroidOfPoly(poly) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      sx += p.x;
      sy += p.y;
      n++;
    }
    if (n === 0) return null;
    return { x: sx / n, y: sy / n };
  }
  
  function norm2(v) {
    return v.x * v.x + v.y * v.y;
  }
  
  function normalize(v) {
    const m = Math.hypot(v.x, v.y);
    if (m < 1e-9) return { x: 0, y: 0 };
    return { x: v.x / m, y: v.y / m };
  }
  
  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }
  
  // Estimate two directions for a bastion polygon:
  // - radialDir: centre -> poly centroid
  // - outwardDir: centroid -> farthest vertex (then aligned to radialDir)
  function polyBasis(poly, centre) {
    const c = centroidOfPoly(poly);
    if (!c) return null;
  
    const radialDir = normalize({ x: c.x - centre.x, y: c.y - centre.y });
  
    // Find farthest valid vertex from centre.
    let far = null;
    let best = -Infinity;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const d2 = (p.x - centre.x) * (p.x - centre.x) + (p.y - centre.y) * (p.y - centre.y);
      if (d2 > best) {
        best = d2;
        far = p;
      }
    }
  
    // Fallback: if we cannot find farthest, use radialDir as outwardDir.
    if (!far) {
      return { c, radialDir, outwardDir: radialDir };
    }
  
    let outwardDir = normalize({ x: far.x - c.x, y: far.y - c.y });
  
    // Align outwardDir to generally point outward (same hemisphere as radialDir).
    if (dot(outwardDir, radialDir) < 0) {
      outwardDir = { x: -outwardDir.x, y: -outwardDir.y };
    }
  
    // If outwardDir is degenerate, fallback to radialDir.
    if (norm2(outwardDir) < 1e-12) outwardDir = radialDir;
  
    return { c, radialDir, outwardDir };
  }
  
  // Returns max squared displacement between original and clamped points.
  // Also returns count of points that moved beyond tolerance.
  function clampDeltaStats(poly, centre, maxField, maxMargin) {
    const clamped = clampPolylineRadial(poly, centre, null, maxField, 0, maxMargin);
  
    let maxD2 = 0;
    let moved = 0;
  
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = clamped[i];
      if (!p || !q) continue;
  
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > EPS2) moved++;
      if (d2 > maxD2) maxD2 = d2;
    }
  
    return { maxD2, moved };
  }
  
  function polyFitsMaxField(poly, centre, maxField, maxMargin) {
    const { moved } = clampDeltaStats(poly, centre, maxField, maxMargin);
    return moved === 0;
  }
  
  // Mixed shrink transform parameterised by t in [0,1].
  // Uses an overshoot distance to scale translation magnitudes.
  function applyMixedShrink(poly, centre, basis, t, overshoot, params) {
    // Tunables (safe defaults).
    const uniformK = params?.bastionShrinkUniformK ?? 1.0; // 1 means up to 100% *t* scaling effect
    const normalK  = params?.bastionShrinkNormalK  ?? 0.7; // push along outwardDir
    const radialK  = params?.bastionShrinkRadialK  ?? 0.7; // push along radialDir
  
    // Uniform scale factor around centre (bounded so it cannot invert).
    const s = Math.max(0.20, 1.0 - t * 0.35 * uniformK);
  
    const out = new Array(poly.length);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        out[i] = p;
        continue;
      }
  
      // 1) uniform scaling about centre
      let x = centre.x + (p.x - centre.x) * s;
      let y = centre.y + (p.y - centre.y) * s;
  
      // 2) inward along outwardDir
      x -= basis.outwardDir.x * (t * overshoot * normalK);
      y -= basis.outwardDir.y * (t * overshoot * normalK);
  
      // 3) inward along radial line (centre->centroid direction)
      x -= basis.radialDir.x * (t * overshoot * radialK);
      y -= basis.radialDir.y * (t * overshoot * radialK);
  
      out[i] = { x, y };
    }
  
    return out;
  }
  
  // Binary search the smallest t that makes the poly fit the maxField.
  // Returns { poly: bestPoly, tBest, overshoot, movedBefore }.
  function shrinkPolyToMaxFieldMixed(poly, centre, maxField, maxMargin, params) {
    // If it already fits, return unchanged.
    const before = clampDeltaStats(poly, centre, maxField, maxMargin);
    if (before.moved === 0) {
      return { poly, tBest: 0, overshoot: 0, movedBefore: 0 };
    }
  
    const basis = polyBasis(poly, centre);
    if (!basis) {
      return { poly, tBest: 0, overshoot: 0, movedBefore: before.moved };
    }
  
    // Use overshoot magnitude as the scale for translations.
    const overshoot = Math.sqrt(before.maxD2);
  
    let lo = 0.0;
    let hi = 1.0;
    let bestT = 1.0;
    let bestPoly = poly;
  
    // Deterministic iterations.
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) * 0.5;
      const candidate = applyMixedShrink(poly, centre, basis, mid, overshoot, params);
  
      if (polyFitsMaxField(candidate, centre, maxField, maxMargin)) {
        bestT = mid;
        bestPoly = candidate;
        hi = mid; // try smaller shrink
      } else {
        lo = mid; // need more shrink
      }
    }
  
    return { poly: bestPoly, tBest: bestT, overshoot, movedBefore: before.moved };
  }

  // ---------------------------------------------------------------------------
  // Apply per-bastion shrink independently (only when maxField exists).
  // Then re-clamp to the bastion band (outside curtain, inside outer hull).
  // ---------------------------------------------------------------------------
  
  if (warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe)) {
    const shrinkStats = [];
  
    bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly, idx) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
  
      // Shrink only if it actually violates the outer hull clamp.
      if (polyFitsMaxField(poly, centre, warpOutworks.maxField, warpOutworks.clampMaxMargin)) {
        shrinkStats.push({ idx, t: 0, movedBefore: 0, overshoot: 0 });
        return poly;
      }
  
      const res = shrinkPolyToMaxFieldMixed(
        poly,
        centre,
        warpOutworks.maxField,
        warpOutworks.clampMaxMargin,
        warpOutworks.params
      );
  
      // After shrink, enforce the band again for stability and style:
      // - outside curtain (curtainMinField)
      // - inside outer hull (warpOutworks.maxField)
      const reclamped = clampPolylineRadial(
        res.poly,
        centre,
        curtainMinField,
        warpOutworks.maxField,
        2,
        warpOutworks.clampMaxMargin
      );
  
      shrinkStats.push({
        idx,
        t: res.tBest,
        movedBefore: res.movedBefore,
        overshoot: res.overshoot,
      });
  
      return reclamped;
    });
  
    // Optional: inspect later in console.
    warpOutworks.bastionShrink = shrinkStats;
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
      polys: [wallCurtainForDraw],
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
    wallForDraw,              // composite
    wallCurtainForDraw,       // new, debug only
    bastionPolysWarpedSafe,
    bastionHullWarpedSafe,
  };
}
