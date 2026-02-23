// docs/src/model/generate_helpers/outworks_shrink_fit.js
//
// Per-bastion / per-ravelin shrink-to-fit (independent).
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// 3357804faa77bcfb40dd7157ef57fd5ee8fc5631c09f85363a4471fd95cc8b65

import { clampPolylineRadial } from "./warp_stage.js";
import { clampPolylineInsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";

// ---------------------------------------------------------------------------
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
function centroidGlobalWeight(centroid, centre, params, rMean) {
  const d = dist(centroid, centre);

  // Use rMean if present to normalise; else a safe fallback.
  const base = (rMean && Number.isFinite(rMean)) ? rMean : 500;
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
function shrinkPolyToFitWeighted(poly, centre, maxField, maxMargin, params, W, rMean) {
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
  const gW = centroidGlobalWeight(c, centre, params, rMean);

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

/**
 * Extraction wrapper for Stage 110.
 * Behaviour: identical to the inlined shrink-to-fit block.
 *
 * Side effects:
 * - Updates warpOutworks.bastionShrink when enabled and inputs are valid.
 *
 * @param {object} args
 * @param {Array<Array<{x:number,y:number}>>} args.bastionPolysWarpedSafe
 * @param {{x:number,y:number}} args.centre
 * @param {Array<{x:number,y:number}>|null} args.wallCurtainForDraw
 * @param {number|null} args.curtainMinField
 * @param {Array<{x:number,y:number}>|null} args.outerHullLoop
 * @param {object|null} args.warpOutworks
 * @returns {Array<Array<{x:number,y:number}>>} Updated bastionPolysWarpedSafe
 */
export function shrinkOutworksToFit({
  bastionPolysWarpedSafe,
  centre,
  wallCurtainForDraw,
  curtainMinField,
  outerHullLoop,
  warpOutworks,
}) {
  // Apply per-bastion shrink independently, then re-clamp to the band.
  const enableRadialMaxShrink = (warpOutworks?.params?.enableRadialMaxShrink === true);

  if (enableRadialMaxShrink && warpOutworks?.maxField && Array.isArray(bastionPolysWarpedSafe)) {
    const shrinkStats = [];

    const rMean = warpOutworks?.rMean;

    const out = bastionPolysWarpedSafe.map((poly, idx) => {
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
        W,
        rMean
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
    return out;
  }

  return bastionPolysWarpedSafe;
}
