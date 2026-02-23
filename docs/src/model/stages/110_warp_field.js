
// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.

import { buildFortWarp, clampPolylineRadial, resampleClosedPolyline } from "../generate_helpers/warp_stage.js";
import { warpPolylineRadial, buildWarpField } from "../warp.js";
import { auditRadialClamp, auditPolyContainment } from "../debug/fortwarp_audit.js";
import { convexHull } from "../../geom/hull.js";
import { repairBastionStrictConvex } from "../generate_helpers/bastion_convexity.js";
 
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
// Clamp a point so it stays within a radial band:
// - outside innerPoly by innerMargin
// - inside the "mid" radius between innerPoly and outerPoly by midMargin
//
// t in [0,1]: 0 => at inner hull, 1 => at outer hull, 0.5 => halfway.
function clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, t, innerMargin, midMargin) {
  const n = safeNorm(p.x - centre.x, p.y - centre.y);
  if (!n) return p;

  const dir = { x: n.x, y: n.y };

  const rIn = rayPolyMaxT(centre, dir, innerPoly);
  const rOut = rayPolyMaxT(centre, dir, outerPoly);
  if (!Number.isFinite(rIn) || !Number.isFinite(rOut)) return p;
  if (rOut <= rIn + 1e-6) return p;
  
  // Minimum radius: keep outside inner hull.
  const rMin = rIn + (innerMargin || 0);

  // Midway radius between inner and outer hulls.
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.3));
  const rMid = rIn + tt * (rOut - rIn);

  // Maximum radius: stay inside the midway curve (minus margin), but never below rMin.
  const rMax = Math.max(rMin, rMid - (midMargin || 0));

  if (n.m < rMin) return { x: centre.x + n.x * rMin, y: centre.y + n.y * rMin };
  if (n.m > rMax) return { x: centre.x + n.x * rMax, y: centre.y + n.y * rMax };
  return p;
}

function clampPolylineToMidBandAlongRays(poly, centre, innerPoly, outerPoly, t, innerMargin, midMargin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;
  if (!Array.isArray(innerPoly) || innerPoly.length < 3) return poly;
  if (!Array.isArray(outerPoly) || outerPoly.length < 3) return poly;

  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out[i] = (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      ? clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, t, innerMargin, midMargin)
      : p;
  }
  return out;
}
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
  
  // Requirement: curtain warp field samples = max(existing, 72, 3 * bastions).
  const curtainSamples = Math.max(
    ctx.params.warpFort?.samples ?? 0,
    72,
    3 * bastionN
  );
  
  // Vertex density for the curtain wall polyline (separate from field samples).
  const curtainVertexN = Math.max(24, 3 * bastionN);
  
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

  // ---- Draw style hints (consumed by renderer) ----
  if (warpWall) {
    // Warped curtain wall (inner/warped reference)
    warpWall.drawCurtain = {
      stroke: "#00ff00", // debug green (pick what you want)
      width: 3,
    };
  
    // Final composite wall (bastioned outline)
    warpWall.drawComposite = {
      stroke: "#d9d9d9", // normal wall grey (pick what you want)
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
  // Hard invariant (deterministic): curtain vertices must be OUTSIDE inner hull.
  // This is a post-condition clamp that does not depend on field sampling.
  let wallWarpedSafe = wallWarped;
  
  if (Array.isArray(wallWarpedSafe) && Array.isArray(innerHull) && innerHull.length >= 3) {
    const innerMargin = Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 2;
  
    // First, enforce the hard invariant: outside inner hull.
    wallWarpedSafe = clampPolylineOutsidePolyAlongRays(
      wallWarpedSafe,
      { x: cx, y: cy },
      innerHull,
      innerMargin
    );
  
    // Then, enforce "not too far from inner hull" by clamping to the midway curve
    // between inner hull and outer hull.
    if (outerHullLoop) {
      const tMid = Number.isFinite(ctx?.params?.warpFort?.curtainMidT) ? ctx.params.warpFort.curtainMidT : 0.3;
      const midMargin = Number.isFinite(ctx?.params?.warpFort?.curtainMidMargin) ? ctx.params.warpFort.curtainMidMargin : 6;
  
      wallWarpedSafe = clampPolylineToMidBandAlongRays(
        wallWarpedSafe,
        { x: cx, y: cy },
        innerHull,
        outerHullLoop,
        tMid,
        innerMargin,
        midMargin
      );
    }
  }

  if (warpWall?.field?.delta) {
    let minD = Infinity, maxD = -Infinity;
    for (const d of warpWall.field.delta) {
      if (!Number.isFinite(d)) continue;
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
  }

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
    
  const centre = { x: cx, y: cy };
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
        const m = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 2;
        clampedSafe = clampPolylineInsidePolyAlongRays(clampedSafe, centrePt, outerHullLoop, m);
      }
      
      return clampedSafe;

    });
  }

  // ---------------------------------------------------------------------------
  // Per-bastion / per-ravelin shrink-to-fit (independent).
  //
  // Shrink strength is a combination of:
  // (A) vertex distance from bastion centroid (per-vertex weight)
  // (B) apex overshoot beyond outer hull, measured along a wall normal direction
  // (C) centroid distance from global image centre (global-scale weight)
  //
  // Asymmetry is allowed.
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

  function normalize(v) {
    const m = Math.hypot(v.x, v.y);
    if (m < 1e-9) return { x: 0, y: 0 };
    return { x: v.x / m, y: v.y / m };
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Clamp and return movement stats (how many points were moved by clamp).
  function clampDeltaStats(poly, centre, maxField, maxMargin) {
    const clamped = clampPolylineRadial(poly, centre, null, maxField, 0, maxMargin);
  
    let maxD2 = 0;
    let moved = 0;
  
    const vecs = new Array(poly.length);
    const mags = new Array(poly.length);
  
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = clamped[i];
  
      if (!p || !q) {
        vecs[i] = { x: 0, y: 0 };
        mags[i] = 0;
        continue;
      }
  
      const vx = q.x - p.x;
      const vy = q.y - p.y;
      const d2 = vx * vx + vy * vy;
  
      vecs[i] = { x: vx, y: vy };
      mags[i] = Math.sqrt(d2);
  
      if (d2 > EPS2) moved++;
      if (d2 > maxD2) maxD2 = d2;
    }
  
    return { clamped, vecs, mags, maxD2, moved };
  }

  
  function inwardDirsFromClamp(poly, clamped) {
    const dirs = new Array(poly.length);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = clamped[i];
      if (!p || !q) {
        dirs[i] = { x: 0, y: 0 };
        continue;
      }
      dirs[i] = normalize({ x: q.x - p.x, y: q.y - p.y }); // inward correction direction
    }
    return dirs;
  }

  function polyFitsMaxField(poly, centre, maxField, maxMargin) {
    const { moved } = clampDeltaStats(poly, centre, maxField, maxMargin);
    return moved === 0;
  }

  // Pick an apex: farthest vertex from global centre.
  function findApex(poly, centre) {
    let best = -Infinity;
    let apex = null;
    let apexIdx = -1;

    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const d2 = (p.x - centre.x) * (p.x - centre.x) + (p.y - centre.y) * (p.y - centre.y);
      if (d2 > best) {
        best = d2;
        apex = p;
        apexIdx = i;
      }
    }
    return { apex, apexIdx, bestD2: best };
  }

  // Approximate a wall normal direction at the apex:
  // Use the inward direction implied by the clamp: apex -> clamped(apex).
  // This is stable and ties directly to "distance from wall along normal".
  function apexWallNormal(poly, apexIdx, centre, maxField, maxMargin) {
    const { clamped } = clampDeltaStats(poly, centre, maxField, maxMargin);
    const p = poly[apexIdx];
    const q = clamped[apexIdx];
    if (!p || !q) return { nIn: { x: 0, y: 0 }, overshoot: 0 };

    const v = { x: q.x - p.x, y: q.y - p.y }; // inward correction
    const overshoot = Math.hypot(v.x, v.y);
    const nIn = normalize(v);
    return { nIn, overshoot };
  }

  // Build per-vertex weights from distance to centroid.
  // Vertices farther from centroid get larger weight.
  function vertexWeights(poly, centroid) {
    const ds = [];
    let dMax = 0;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        ds.push(0);
        continue;
      }
      const d = dist(p, centroid);
      ds.push(d);
      if (d > dMax) dMax = d;
    }

    // Avoid divide-by-zero.
    const inv = (dMax > 1e-6) ? (1 / dMax) : 0;

    // Weight in [0.2, 1.0] so even inner vertices move a bit.
    return ds.map((d) => 0.2 + 0.8 * (d * inv));
  }

  // Global centre distance weight for this bastion.
  // Farther from centre => more shrink pressure.
  function centroidGlobalWeight(centroid, centre, params) {
    const d = dist(centroid, centre);

    // Use rMean if present to normalise; else a safe fallback.
    const base = (warpOutworks?.rMean && Number.isFinite(warpOutworks.rMean)) ? warpOutworks.rMean : 500;
    const x = Math.min(2.0, d / Math.max(1, base)); // cap

    // Map to [0.8, 1.4] by default.
    const k = params?.bastionShrinkCentreK ?? 0.3;
    return 1.0 + k * (x - 1.0);
  }

  // Apply shrink for a given bastion with per-vertex weighting.
  // T in [0,1] is the bastion-level shrink amount.
  function applyWeightedShrink(poly, centroid, clampVecs, clampMags, T, params, gain) {
    // Uniform scale about centroid
    const uniformK = params?.bastionShrinkUniformK ?? 0.25;
    const s = Math.max(0.25, 1.0 - uniformK * T);
  
    // Clamp-vector translation gain (lets it succeed without T=1 everywhere)
    const clampGain = params?.bastionShrinkClampGain ?? 1.75; // try 1.5–3.0
    const g = clampGain * gain;
  
    const out = new Array(poly.length);
  
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        out[i] = p;
        continue;
      }
  
      // 1) scale about centroid
      let x = centroid.x + (p.x - centroid.x) * s;
      let y = centroid.y + (p.y - centroid.y) * s;
  
      // 2) translate by the clamp correction vector (asymmetric, per-vertex)
      // Only apply if this vertex was actually violating
      const m = clampMags[i] || 0;
      if (m > 1e-6) {
        const v = clampVecs[i]; // points inward
        x += v.x * (T * g);
        y += v.y * (T * g);
      }
  
      out[i] = { x, y };
    }
  
    return out;
  }

  function avgRadiusFromCentroid(poly, c) {
    let sum = 0;
    let n = 0;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      sum += Math.hypot(dx, dy);
      n++;
    }
    return n ? (sum / n) : 0;
  }
  
  // Finds the closest point on a polyline segment list (closed polygon).
  function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-9) return { x: a.x, y: a.y, t: 0 };
    let t = (apx * abx + apy * aby) / ab2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: a.x + abx * t, y: a.y + aby * t, t };
  }
  
  // Approximate outward normal of the curtain wall at the closest point to apex.
  // We define "outward" as pointing away from the city centre.
  function apexClearanceAlongWallNormal(apex, wallPoly, centre) {
    if (!Array.isArray(wallPoly) || wallPoly.length < 3) return 0;
  
    let best = null;
    let bestD2 = Infinity;
  
    for (let i = 0; i < wallPoly.length; i++) {
      const a = wallPoly[i];
      const b = wallPoly[(i + 1) % wallPoly.length];
      if (!a || !b) continue;
  
      const q = closestPointOnSegment(apex, a, b);
      const dx = apex.x - q.x;
      const dy = apex.y - q.y;
      const d2 = dx * dx + dy * dy;
  
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { a, b, q };
      }
    }
  
    if (!best) return 0;
  
    // Segment tangent.
    const tx = best.b.x - best.a.x;
    const ty = best.b.y - best.a.y;
    const tLen = Math.hypot(tx, ty);
    if (tLen < 1e-9) return 0;
  
    const tnx = tx / tLen;
    const tny = ty / tLen;
  
    // Two candidate normals.
    let nx = -tny;
    let ny =  tnx;
  
    // Make normal point outward (away from centre).
    const vx = best.q.x - centre.x;
    const vy = best.q.y - centre.y;
    if ((nx * vx + ny * vy) < 0) {
      nx = -nx;
      ny = -ny;
    }
  
    // Signed clearance of apex along outward normal.
    const ax = apex.x - best.q.x;
    const ay = apex.y - best.q.y;
    return (ax * nx + ay * ny);
  }

  // Solve for the smallest bastion-level T that makes the polygon fit maxField.
  // T combines:
  // - overshoot severity (apex correction magnitude)
  // - centroid distance from global centre (global weight)
  // Vertex weighting is applied inside applyWeightedShrink.
  function shrinkPolyToFitWeighted(poly, centre, maxField, maxMargin, params, W) {
    const Wc = Math.max(0.10, Math.min(1.50, Number.isFinite(W) ? W : 0));
    const c = centroidOfPoly(poly);
    if (!c) return { poly, T: 0, movedBefore: 0, overshoot: 0, W: Wc };
  
    const before = clampDeltaStats(poly, centre, maxField, maxMargin);
    if (before.moved === 0) {
      return { poly, T: 0, movedBefore: 0, overshoot: 0, W: Wc };
    }
  
    // Worst violating vertex magnitude (pixels)
    const overshoot = Math.sqrt(before.maxD2);
  
    // If overshoot is tiny, do not overreact.
    const minOvershoot = params?.bastionShrinkMinOvershoot ?? 1.0;
    if (overshoot < minOvershoot) {
      return { poly, T: 0, movedBefore: before.moved, overshoot, W: Wc };
    }
  
    // Global weight (keep your existing behaviour)
    const gW = centroidGlobalWeight(c, centre, params);
  
    // Combined gain for clamp-vector translation
    const gain = Math.max(0.6, Math.min(2.5, gW * Wc));
  
    // Base target T from overshoot
    const overshootScale = params?.bastionShrinkOvershootScale ?? 180;
    const baseT = Math.min(1.0, overshoot / Math.max(1, overshootScale));
    const targetT = Math.min(1.0, baseT * gain);
  
    let lo = 0.0;
    let hi = Math.max(0.05, targetT);
    let bestT = hi;
    let bestPoly = poly;
  
    // Expand hi if needed
    for (let expand = 0; expand < 6; expand++) {
      const candidate = applyWeightedShrink(poly, c, before.vecs, before.mags, hi, params, gain);
      if (polyFitsMaxField(candidate, centre, maxField, maxMargin)) {
        bestPoly = candidate;
        bestT = hi;
        break;
      }
      hi = Math.min(1.0, hi * 1.6);
      bestT = hi;
      bestPoly = candidate;
      if (hi >= 1.0) break;
    }
  
    // Binary search smallest T that fits
    for (let it = 0; it < 22; it++) {
      const mid = (lo * 0.7 + hi * 0.3);
      const candidate = applyWeightedShrink(poly, c, before.vecs, before.mags, mid, params, gain);
      if (polyFitsMaxField(candidate, centre, maxField, maxMargin)) {
        bestPoly = candidate;
        bestT = mid;
        hi = mid;
      } else {
        lo = mid;
      }
    }
  
    return { poly: bestPoly, T: bestT, movedBefore: before.moved, overshoot, W: Wc };
  }

    // Apply per-bastion shrink independently, then re-clamp to the band.
  const enableRadialMaxShrink = (warpOutworks?.params?.enableRadialMaxShrink === true);
  
  if (enableRadialMaxShrink && warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe)) {
    const shrinkStats = [];

    bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly, idx) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;

      // Fast path.
      if (polyFitsMaxField(poly, centre, warpOutworks.maxField, warpOutworks.clampMaxMargin)) {
        shrinkStats.push({ idx, T: 0, movedBefore: 0, overshoot: 0, W: 0 });
        return poly;
      }

      const c = centroidOfPoly(poly);
      if (!c) {
        shrinkStats.push({ idx, T: 0, movedBefore: 0, overshoot: 0, W: 0, note: "no_centroid" });
        return poly;
      }
      
      // (1) Vertex distance from centroid (size / spread)
      const sizeR = avgRadiusFromCentroid(poly, c);          // pixels
      const sizeN = Math.min(1.0, sizeR / 140);              // normalise
      
      // (2) Apex distance from curtain wall along outward normal
      const { apex } = findApex(poly, centre);
      let apexClear = 0;
      if (apex && wallCurtainForDraw) {
        apexClear = apexClearanceAlongWallNormal(apex, wallCurtainForDraw, centre); // pixels, signed
      }
      // Lower clearance => higher shrink pressure
      const apexN = Math.min(1.0, Math.max(0.0, 1.0 - (apexClear / 50)));
      
      // (3) Centroid distance from global centre
      const centreDist = dist(c, centre);
      const baseR = (warpOutworks?.rMean && Number.isFinite(warpOutworks.rMean)) ? warpOutworks.rMean : 500;
      const radialN = Math.min(1.0, centreDist / Math.max(1, baseR * 1.4));
      
      // Combine (weights are tunable)
      const W = (0.40 * sizeN) + (0.35 * apexN) + (0.25 * radialN);
      
      const res = shrinkPolyToFitWeighted(
        poly,
        centre,
        warpOutworks.maxField,
        warpOutworks.clampMaxMargin,
        warpOutworks.params,
        W
      );

      const reclamped = clampPolylineRadial(
        res.poly,
        centre,
        curtainMinField,
        null, // do not enforce radial max for bastions
        2,
        0
      );

      // Safety fallback.
      if (!Array.isArray(reclamped) || reclamped.length < 3) {
        shrinkStats.push({ idx, T: 1, movedBefore: res.movedBefore, overshoot: res.overshoot, W: res.W, note: "reclamp_invalid" });
        return poly;
      }

      // Hard invariant: outworks must remain inside the outer hull polygon.
      // Deterministic “shrink-to-fit” along centre rays.
      let reclampedSafe = reclamped;

      if (outerHullLoop) {
        const m = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 2;
        reclampedSafe = clampPolylineInsidePolyAlongRays(reclampedSafe, centre, outerHullLoop, m);
      }
      
      shrinkStats.push({
        idx,
        T: res.T,
        movedBefore: res.movedBefore,
        overshoot: res.overshoot,
        W: res.W,
      });
      
      return reclampedSafe;
    });

    warpOutworks.bastionShrink = shrinkStats;
  }
  // ---------------- Strict convexity repair (post-warp, post-shrink) ----------------
  // Enforce: all turns match expectedSign AND no near-collinear turns.
  // Only affects 5-point bastions: [B0, S0, T, S1, B1].
  if (outerHullLoop && Array.isArray(bastionPolysWarpedSafe)) {
    const K = Number.isFinite(ctx?.params?.warpFort?.bastionConvexIters)
      ? ctx.params.warpFort.bastionConvexIters
      : 18;

    const margin = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 2;

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
    // ---------------- Composite wall builder (curtain + bastions) ----------------
    // Build a single outer loop by splicing final bastion polygons into the final curtain loop.
    // Assumes bastion point order [B0, S0, T, S1, B1].
    // Deterministic; no polygon boolean ops.
  
    function dist2(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return dx * dx + dy * dy;
    }
  
    // Return nearest vertex index on a closed polyline (curtain) for point p.
    // This assumes B0/B1 are already aligned very close to curtain vertices after warp.
    function nearestVertexIndexOnClosed(poly, p) {
      if (!Array.isArray(poly) || poly.length < 3 || !p) return -1;
      let bestI = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const q = poly[i];
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
        const d2 = dist2(p, q);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestI = i;
        }
      }
      return bestI;
    }
  
    // Circular forward arc from i0 to i1 inclusive on a closed polyline.
    function circularArcInclusive(poly, i0, i1) {
      const n = poly.length;
      const out = [];
      if (n < 1 || i0 < 0 || i1 < 0) return out;
  
      let i = i0;
      for (let guard = 0; guard < n + 1; guard++) {
        out.push(poly[i]);
        if (i === i1) break;
        i = (i + 1) % n;
      }
      return out;
    }
  
    // Number of edges in forward circular walk i0 -> i1.
    function circularEdgeCount(n, i0, i1) {
      if (n <= 0) return 0;
      return (i1 - i0 + n) % n;
    }
  
    // Remove consecutive duplicate / near-duplicate points.
    function dedupeConsecutiveClosed(poly, eps = 1e-6) {
      if (!Array.isArray(poly) || poly.length < 2) return poly;
      const eps2 = eps * eps;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (!p) continue;
        const prev = out[out.length - 1];
        if (!prev || dist2(prev, p) > eps2) out.push(p);
      }
      // Also drop duplicate closure point if present.
      if (out.length >= 2 && dist2(out[0], out[out.length - 1]) <= eps2) {
        out.pop();
      }
      return out;
    }
  
    // Signed area helper already exists above (signedArea). Reuse it.
  
    // Orient a polygon to match the curtain orientation sign.
    function orientLike(poly, targetSign) {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
      const a = signedArea(poly);
      const s = (a >= 0) ? 1 : -1;
      if (s === targetSign) return poly;
      return poly.slice().reverse();
    }
  
    // Build one composite loop by replacing curtain arcs with bastion arcs.
    // Returns null on failure; caller can fall back to curtain.
    function buildCompositeWallFromCurtainAndBastions(curtain, bastionPolys) {
      if (!Array.isArray(curtain) || curtain.length < 3) return null;
      if (!Array.isArray(bastionPolys) || bastionPolys.length === 0) return curtain;
  
      const curtainClean = dedupeConsecutiveClosed(curtain, 1e-6);
      if (curtainClean.length < 3) return null;
  
      const curtainSign = (signedArea(curtainClean) >= 0) ? 1 : -1;
  
      // Collect valid bastion splice descriptors.
      const splices = [];
      for (let bi = 0; bi < bastionPolys.length; bi++) {
        let b = bastionPolys[bi];
        if (!Array.isArray(b) || b.length !== 5) continue;
  
        // Match orientation to curtain so arc direction is consistent.
        b = orientLike(b, curtainSign);
  
        // Semantic order after orientLike may invert.
        // We must re-identify attachments as the two endpoints of the 5-point chain.
        // We preserve the chain order [0..4] as the bastion arc candidate.
        const B0 = b[0];
        const B1 = b[4];
  
        const i0 = nearestVertexIndexOnClosed(curtainClean, B0);
        const i1 = nearestVertexIndexOnClosed(curtainClean, B1);
        if (i0 < 0 || i1 < 0 || i0 === i1) continue;
  
        // Curtain arc lengths in both directions; prefer replacing the shorter one.
        const n = curtainClean.length;
        const fwdEdges = circularEdgeCount(n, i0, i1);
        const revEdges = circularEdgeCount(n, i1, i0);
  
        // We define the bastion arc in the chain direction 0->4.
        // It should replace the shorter curtain arc between attachments.
        const useForward = (fwdEdges <= revEdges);
  
        splices.push({
          bi,
          poly: b,
          iStart: useForward ? i0 : i1,
          iEnd:   useForward ? i1 : i0,
          // Arc to insert must start at curtain[iStart] and end at curtain[iEnd].
          // If we flip direction, reverse bastion chain.
          bastionArc: useForward ? b : b.slice().reverse(),
        });
      }
  
      if (splices.length === 0) return curtainClean;
  
      // Sort splices by start index around curtain to apply deterministically.
      splices.sort((a, b) => a.iStart - b.iStart);
  
      // Detect overlapping curtain intervals (simple guard).
      // This assumes one bastion per local curtain segment and no overlap.
      // If overlap occurs, skip composite build and fall back to curtain.
      const n = curtainClean.length;
      for (let k = 0; k < splices.length; k++) {
        const s = splices[k];
        const span = circularEdgeCount(n, s.iStart, s.iEnd);
        if (span <= 0) return curtainClean;
      }
  
      // Build composite by walking curtain once and replacing marked arcs.
      // Use a map keyed by start index for O(1) splice lookup.
      const spliceByStart = new Map();
      for (const s of splices) {
        // If duplicate starts occur, prefer the longer bastion arc (more likely real).
        const prev = spliceByStart.get(s.iStart);
        if (!prev || s.bastionArc.length > prev.bastionArc.length) {
          spliceByStart.set(s.iStart, s);
        }
      }
  
      const out = [];
      let i = 0;
      let steps = 0;
  
      while (steps < n) {
        const s = spliceByStart.get(i);
        if (s) {
          // Insert bastion arc, but avoid duplicating curtain point if it matches previous output.
          for (let j = 0; j < s.bastionArc.length; j++) {
            const p = s.bastionArc[j];
            if (!p) continue;
            const prev = out[out.length - 1];
            if (!prev || dist2(prev, p) > 1e-12) out.push(p);
          }
  
          // Jump to end of replaced curtain arc.
          i = s.iEnd;
          steps += circularEdgeCount(n, s.iStart, s.iEnd);
        } else {
          const p = curtainClean[i];
          const prev = out[out.length - 1];
          if (!prev || dist2(prev, p) > 1e-12) out.push(p);
  
          i = (i + 1) % n;
          steps += 1;
        }
      }
  
      const finalOut = dedupeConsecutiveClosed(out, 1e-6);
      if (!Array.isArray(finalOut) || finalOut.length < 3) return curtainClean;
  
      return finalOut;
    }  // ---------------- Bastion hull (global convex hull) ----------------
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
  // Deterministic WALL audit: verify outside inner hull along centre rays.
  // This matches the clamp we actually enforce (clampPolylineOutsidePolyAlongRays).
  (function auditWallDeterministic() {
    if (!warpDebugEnabled) return;
    if (!Array.isArray(wallCurtainForDraw) || wallCurtainForDraw.length < 3) return;
    if (!Array.isArray(innerHull) || innerHull.length < 3) return;
  
    const centrePt = { x: cx, y: cy };
    const m = Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 2;
  
    let belowMin = 0;
    for (const p of wallCurtainForDraw) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
  
      const n = safeNorm(p.x - centrePt.x, p.y - centrePt.y);
      if (!n) continue;
  
      const tBoundary = rayPolyMaxT(centrePt, { x: n.x, y: n.y }, innerHull);
      if (!Number.isFinite(tBoundary)) continue;
  
      // Should be >= boundary + margin
      const rMin = tBoundary + m;
      if (n.m < rMin - 1e-6) belowMin++;
    }
  })();

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
