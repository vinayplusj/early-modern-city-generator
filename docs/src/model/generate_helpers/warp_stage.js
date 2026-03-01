// docs/src/model/generate_helpers/warp_stage.js
//
// Fort warp stage helper.
//
// This wraps buildWarpField() and provides:
// - A clearer API name: targetPoly (instead of fieldPoly).
// - Automatic band tuning from the mean wall radius.
// - Optional radial clamping against an inner and/or outer hull.

import { buildWarpField, warpPolylineRadial } from "./warp_apply.js";
import { dist, dist2, add, sub, mul, perp, normalize } from "../../geom/primitives.js";

function clampNumber(x, lo, hi) {
  if (!Number.isFinite(x)) return x;
  if (Number.isFinite(lo) && x < lo) return lo;
  if (Number.isFinite(hi) && x > hi) return hi;
  return x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrapAngle(t) {
  const twoPi = Math.PI * 2;
  let a = t % twoPi;
  if (a < 0) a += twoPi;
  return a;
}
export function sampleClosedPolylineByArcLength(poly, step) {
  if (!Array.isArray(poly) || poly.length < 3) return { pts: [], s: [], totalLen: 0 };
  const ds = Number(step);
  if (!Number.isFinite(ds) || ds <= 0) throw new Error("sampleClosedPolylineByArcLength: invalid step");

  // Total length
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    total += dist(a, b);
  }
  if (!Number.isFinite(total) || total <= 1e-9) return { pts: [], s: [], totalLen: 0 };

  const pts = [];
  const sArr = [];

  let s0 = 0;
  let nextS = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    if (!Number.isFinite(L) || L <= 1e-9) continue;

    while (nextS <= s0 + L + 1e-9) {
      const t = (nextS - s0) / L;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      sArr.push(nextS);
      nextS += ds;
    }
    s0 += L;
  }

  if (pts.length === 0) {
    pts.push({ x: poly[0].x, y: poly[0].y });
    sArr.push(0);
  }

  return { pts, s: sArr, totalLen: total };
}
export function nearestClosedPolylineTangent(poly, p) {
  if (!Array.isArray(poly) || poly.length < 3 || !p) return { x: 0, y: 0 };

  let bestI = 0;
  let bestD = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const m = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const d = dist2(p, m);
    if (d < bestD) { bestD = d; bestI = i; } // tie-break by smaller i
  }

  const a = poly[bestI];
  const b = poly[(bestI + 1) % poly.length];
  return normalize(sub(b, a));
}
// Sample an array defined on a uniform theta grid.
function sampleOnRing(thetas, values, theta) {
  if (!Array.isArray(thetas) || !Array.isArray(values)) return null;
  const n = Math.min(thetas.length, values.length);
  if (n < 2) return null;

  const twoPi = Math.PI * 2;
  const a = wrapAngle(theta);
  const step = twoPi / n;
  const i0 = Math.floor(a / step) % n;
  const i1 = (i0 + 1) % n;
  const t0 = i0 * step;
  const u = (a - t0) / step;

  const v0 = values[i0];
  const v1 = values[i1];
  if (!Number.isFinite(v0) && !Number.isFinite(v1)) return null;
  if (!Number.isFinite(v0)) return v1;
  if (!Number.isFinite(v1)) return v0;
  return lerp(v0, v1, u);
}
function rayHitT(P, dir, A, B) {
  // Solve P + t*dir = A + u*(B-A), with t>=0, u in [0,1]
  const vx = B.x - A.x;
  const vy = B.y - A.y;

  const det = dir.x * (-vy) - dir.y * (-vx);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  const ax = A.x - P.x;
  const ay = A.y - P.y;

  const t = (ax * (-vy) - ay * (-vx)) / det;
  const u = (dir.x * ay - dir.y * ax) / det;

  if (t < 0) return null;
  if (u < 0 || u > 1) return null;
  return t;
}

export function clearanceToHullAlongRay(P, dirRaw, outerHullLoop) {
  if (!Array.isArray(outerHullLoop) || outerHullLoop.length < 3) return { ok: false, dist: Infinity, hit: null };
  const dir = normalize(dirRaw);
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || (Math.abs(dir.x) + Math.abs(dir.y)) < 1e-12) {
    return { ok: false, dist: Infinity, hit: null };
  }

  let bestT = Infinity;
  for (let i = 0; i < outerHullLoop.length; i++) {
    const A = outerHullLoop[i];
    const B = outerHullLoop[(i + 1) % outerHullLoop.length];
    const t = rayHitT(P, dir, A, B);
    if (t != null && t < bestT) bestT = t;
  }

  if (!Number.isFinite(bestT) || bestT === Infinity) return { ok: false, dist: Infinity, hit: null };
  return { ok: true, dist: bestT, hit: add(P, mul(dir, bestT)) };
}
export function computeCurtainClearanceProfile({ curtainPts, centre, outerHullLoop, outwardMode = "normal" }) {
  const n = Array.isArray(curtainPts) ? curtainPts.length : 0;
  const clearance = new Array(n);
  const outward = new Array(n);

  for (let i = 0; i < n; i++) {
    const P = curtainPts[i];

    let dir;
    if (outwardMode === "radial") {
      dir = normalize(sub(P, centre));
    } else {
      const tan = nearestClosedPolylineTangent(curtainPts, P);
      let nrm = normalize(perp(tan));

      // orient away from centre
      const toC = sub(P, centre);
      if (nrm.x * toC.x + nrm.y * toC.y < 0) nrm = mul(nrm, -1);

      dir = (Math.abs(nrm.x) + Math.abs(nrm.y) > 1e-12) ? nrm : normalize(toC);
    }

    outward[i] = dir;
    const hit = clearanceToHullAlongRay(P, dir, outerHullLoop);
    clearance[i] = hit.ok ? hit.dist : Infinity;
  }

  return { clearance, outward };
}
export function pickClearanceMaximaWithSpacing({ s, clearance, targetN, minSpacing, neighbourhood = 2, totalLen }) {
  const n = Math.min(s.length, clearance.length);
  if (n === 0 || !Number.isFinite(targetN) || targetN <= 0) return [];

  const cand = [];
  for (let i = 0; i < n; i++) {
    const c0 = clearance[i];
    if (!Number.isFinite(c0)) continue;

    let isMax = true;
    for (let k = 1; k <= neighbourhood; k++) {
      const j1 = (i - k + n) % n;
      const j2 = (i + k) % n;
      if (Number.isFinite(clearance[j1]) && clearance[j1] > c0) isMax = false;
      if (Number.isFinite(clearance[j2]) && clearance[j2] > c0) isMax = false;
      if (!isMax) break;
    }
    if (isMax) cand.push({ i, s: s[i], c: c0 });
  }

  cand.sort((a, b) => (b.c - a.c) || (a.s - b.s) || (a.i - b.i));

  const chosen = [];
  const minD = Math.max(0, Number(minSpacing) || 0);
  const L = Number.isFinite(totalLen) ? totalLen : (s[n - 1] || 0);

  function circDist(aS, bS) {
    const d = Math.abs(aS - bS);
    return Math.min(d, Math.max(0, L - d));
  }

  for (const c of cand) {
    if (chosen.length >= targetN) break;
    let ok = true;
    for (const p of chosen) {
      if (circDist(c.s, p.s) < minD) { ok = false; break; }
    }
    if (ok) chosen.push(c);
  }

  return chosen;
}
function isValidWarpField(field) {
  if (!field) return false;
  if (!Number.isFinite(field.N) || field.N < 16) return false;
  if (!Array.isArray(field.thetas) || field.thetas.length !== field.N) return false;
  if (!Array.isArray(field.rTarget) || field.rTarget.length !== field.N) return false;

  // Require at least some finite samples.
  let finite = 0;
  for (const v of field.rTarget) {
    if (Number.isFinite(v)) finite++;
  }
  return finite >= Math.max(8, Math.floor(field.N * 0.25));
}
export function resampleClosedPolyline(poly, targetN) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;
  const N = Math.max(3, Math.floor(targetN));
  if (poly.length >= N) return poly;

  // Build cumulative lengths
  const pts = poly;
  const segLen = [];
  let total = 0;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    segLen.push(L);
    total += L;
  }
  if (total < 1e-6) return poly;

  const step = total / N;

  const out = [];
  let segIdx = 0;
  let distAcc = 0;

  for (let k = 0; k < N; k++) {
    const d = k * step;

    while (segIdx < segLen.length && distAcc + segLen[segIdx] < d) {
      distAcc += segLen[segIdx];
      segIdx++;
    }
    if (segIdx >= segLen.length) segIdx = segLen.length - 1;

    const a = pts[segIdx];
    const b = pts[(segIdx + 1) % pts.length];
    const L = Math.max(1e-9, segLen[segIdx]);
    const t = (d - distAcc) / L;

    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }

  return out;
}

export function clampPolylineRadial(poly, centre, minField, maxField, minMargin, maxMargin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;

  const out = [];
  for (const p of poly) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      out.push(p);
      continue;
    }

    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) {
      out.push(p);
      continue;
    }

    const theta = Math.atan2(dy, dx);
    const rMinRaw = minField ? sampleOnRing(minField.thetas, minField.rTarget, theta) : null;
    const rMaxRaw = maxField ? sampleOnRing(maxField.thetas, maxField.rTarget, theta) : null;

    const rMin = Number.isFinite(rMinRaw) ? (rMinRaw + (minMargin || 0)) : null;
    const rMax = Number.isFinite(rMaxRaw) ? (rMaxRaw - (maxMargin || 0)) : null;

    const rClamped = clampNumber(r, rMin, rMax);
    if (!Number.isFinite(rClamped) || Math.abs(rClamped - r) < 1e-6) {
      out.push(p);
      continue;
    }

    const s = rClamped / r;
    out.push({ x: centre.x + dx * s, y: centre.y + dy * s });
  }
  return out;
}

export function buildFortWarp({
  enabled,
  centre,
  wallPoly,

  // Primary warp target.
  // Backwards compatible: accept fieldPoly too.
  targetPoly,
  fieldPoly,

  // Optional tuning polygon (defaults to wallPoly).
  tuningPoly,
  // Optional clamps.
  clampMinPoly,
  clampMaxPoly,
  clampMinMargin = 0,
  clampMaxMargin = 0,

  districts,
  bastions,
  params,
}) {
  if (!enabled) return null;
  if (!Array.isArray(wallPoly) || wallPoly.length < 3) return null;

  const targetPolyUse =
    (Array.isArray(targetPoly) && targetPoly.length >= 3)
      ? targetPoly
      : ((Array.isArray(fieldPoly) && fieldPoly.length >= 3) ? fieldPoly : null);

  // Pass 1: measure mean radius of the tuning polygon (defaults to wall).
  const tunePoly =
    (Array.isArray(tuningPoly) && tuningPoly.length >= 3) ? tuningPoly : wallPoly;

  let sum = 0;
  let count = 0;

  for (const p of tunePoly) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const r = dist(p, centre);
    if (!Number.isFinite(r)) continue;
    sum += r;
    count += 1;
  }

  if (count === 0) return null;

  const rMean = sum / count;

  const tuned = {
    ...params,
    bandOuter: rMean,
    bandInner: Math.max(0, rMean - (params?.bandThickness || 0)),
  };

  // Pass 2: the actual tuned warp field.
  const field = buildWarpField({
    centre,
    wallPoly,
    targetPoly: targetPolyUse,
    districts,
    bastions,
    params: tuned,
  });

  let wallWarped = warpPolylineRadial(wallPoly, centre, field, tuned);

  // Optional clamp fields (computed as pure target-radius fields).
  let minField = null;
  let maxField = null;

  if (Array.isArray(clampMinPoly) && clampMinPoly.length >= 3) {
    // Clamp fields should be pure radius targets, with no district modulation and no bastion masks.
    // Also, avoid any smoothing behaviour in warp.js by using smoothRadius: 0 here.
    minField = buildWarpField({
      centre,
      wallPoly,
      targetPoly: clampMinPoly,
      districts: [],
      bastions: [],
      params: {
        ...tuned,
        bandInner: 0,
        bandOuter: 0,
        smoothRadius: 0,
        // Keep slope clamp conservative to prevent jagged clamp rings.
        maxStep: Number.isFinite(tuned.maxStep) ? tuned.maxStep : 2.5,
        // No directional gain needed for clamp fields.
        inwardGain: 1.0,
        outwardGain: 1.0,
      },
    });

    if (!isValidWarpField(minField)) minField = null;
  }

  if (Array.isArray(clampMaxPoly) && clampMaxPoly.length >= 3) {
    maxField = buildWarpField({
      centre,
      wallPoly,
      targetPoly: clampMaxPoly,
      districts: [],
      bastions: [],
      params: {
        ...tuned,
        bandInner: 0,
        bandOuter: 0,
        smoothRadius: 0,
        maxStep: Number.isFinite(tuned.maxStep) ? tuned.maxStep : 2.5,
        inwardGain: 1.0,
        outwardGain: 1.0,
      },
    });

    if (!isValidWarpField(maxField)) maxField = null;
  }
  // If both fields exist but margins invert the band at some angles, clamping can jitter.
  // Keep margins non-negative.
  const minM = Math.max(0, Number.isFinite(clampMinMargin) ? clampMinMargin : 0);
  const maxM = Math.max(0, Number.isFinite(clampMaxMargin) ? clampMaxMargin : 0);
  if (minField || maxField) {
    wallWarped = clampPolylineRadial(
      wallWarped,
      centre,
      minField,
      maxField,
      minM,
      maxM
    );
  }

  // Extra sanity: avoid NaNs.
  if (params?.debug) {
    for (const p of wallWarped) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new Error("buildFortWarp produced invalid wall point");
      }
    }
  }

  return {
    centre,
    params: tuned,
    field,
    // Expose clamp fields so callers can clamp other geometry (outworks).
    minField,
    maxField,
    clampMinMargin,
    clampMaxMargin,
    wallOriginal: wallPoly,
    wallWarped,
    rMean,
  };
}
