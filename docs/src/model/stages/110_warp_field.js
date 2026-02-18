// docs/src/model/stages/110_warp_field.js
//
// Stage 110: Warp field (FortWarp) + bastion polygon warping.
// Extracted from generate.js without functional changes.

import { buildFortWarp, clampPolylineRadial, resampleClosedPolyline } from "../generate_helpers/warp_stage.js";
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
  const innerHull = fortInnerHull;
    if (!Array.isArray(innerHull) || innerHull.length < 3) {
      console.warn("[warp] innerHull missing/degenerate; wall warp will be no-op", {
        innerHullLen: innerHull?.length,
      });
    }

  const fortOuterHull = fortHulls?.outerHull?.outerLoop ?? null;
  
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
    maxIn: Math.max(ctx.params.warpFort?.maxIn ?? 0, 80),
    maxStep: Math.max(ctx.params.warpFort?.maxStep ?? 0, 2.5),
    // Keep smoothing reasonable so it still converges to the inner hull.
    smoothRadius: Math.min(ctx.params.warpFort?.smoothRadius ?? 10, 8),
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
  if (warpWall?.wallWarped && Array.isArray(wallBaseDense)) {
    const a = wallBaseDense[0];
    const b = warpWall.wallWarped[0];
    console.log("[warpWall] first-pt shift:", Math.hypot(b.x - a.x, b.y - a.y));
    console.log("[warpWall] warped equals input (ref):", warpWall.wallWarped === wallBaseDense);
  }

  console.log("[warpWall] innerHull len:", fortInnerHull?.length ?? null);

  if (warpWall?.field?.delta) {
    let minD = Infinity, maxD = -Infinity;
    for (const d of warpWall.field.delta) {
      if (!Number.isFinite(d)) continue;
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
    console.log("[warpWall] delta range:", { minD, maxD });
  }

  // Curtain wall (pre-bastion) for clamp + debug.
  const wallCurtainForDraw = wallWarped || wallBaseDense;

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
      const mid = (lo + hi) * 0.5;
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
  if (warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe)) {
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
        warpOutworks.maxField,
        2,
        warpOutworks.clampMaxMargin
      );

      // Safety fallback.
      if (!Array.isArray(reclamped) || reclamped.length < 3) {
        shrinkStats.push({ idx, T: 1, movedBefore: res.movedBefore, overshoot: res.overshoot, W: res.W, note: "reclamp_invalid" });
        return poly;
      }

      shrinkStats.push({
        idx,
        T: res.T,
        movedBefore: res.movedBefore,
        overshoot: res.overshoot,
        W: res.W,
      });

      return reclamped;
    });

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
  // ---------------------------------------------------------------------------
  // Final composite wall for rendering:
  // Build from FINAL warped bastion polygons (after clamp + shrink + reclamp).
  // This is the only geometry that is guaranteed to match the orange bastions.
  // ---------------------------------------------------------------------------
  let wallForDraw = wallFinal;
  
  if (Array.isArray(bastionHullWarpedSafe) && bastionHullWarpedSafe.length >= 3) {
    wallForDraw = bastionHullWarpedSafe;
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
