// docs/src/model/hull/hull_geom.js
// Shared geometry helpers for Stage 105 hull modelling.

import { pointInPolyOrOn, centroid, signedArea } from "../../geom/poly.js";
import { isPoint, clamp } from "../../geom/primitives.js";

export { isPoint, clamp };

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function firstPoint(poly) {
  return Array.isArray(poly) && poly.length > 0 ? poly[0] : null;
}

export function samplePolyline(poly, maxSamples = 64) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  if (poly.length <= maxSamples) return poly.slice();

  const out = [];
  const step = Math.max(1, Math.floor(poly.length / maxSamples));
  for (let i = 0; i < poly.length; i += step) out.push(poly[i]);
  const last = poly[poly.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function pointInsidePoly(poly, p) {
  return Array.isArray(poly) && poly.length >= 3 && isPoint(p)
    ? pointInPolyOrOn(p, poly)
    : false;
}

export function polygonCentroidSafe(poly) {
  try {
    return Array.isArray(poly) && poly.length >= 3 ? centroid(poly) : null;
  } catch {
    return firstPoint(poly);
  }
}

export function polygonAbsArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  const a = signedArea(poly);
  return Number.isFinite(a) ? Math.abs(a) : 0;
}

export function edgeSampledPoints(poly, samplesPerEdge = 2) {
  const out = [];
  if (!Array.isArray(poly) || poly.length === 0) return out;

  const steps = Math.max(1, samplesPerEdge | 0);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    out.push(a);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({
        x: a.x * (1 - t) + b.x * t,
        y: a.y * (1 - t) + b.y * t,
      });
    }
  }

  return out;
}

export function allPointsInsidePolys(points, polys) {
  for (const p of safeArray(points)) {
    if (!isPoint(p)) return false;
    for (const poly of safeArray(polys)) {
      if (Array.isArray(poly) && poly.length >= 3 && !pointInsidePoly(poly, p)) return false;
    }
  }
  return true;
}

export function polygonInsideAllPolys(poly, polys) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  return allPointsInsidePolys(edgeSampledPoints(poly, 3), polys);
}

export function pointDistanceToPolyBoundary(p, poly) {
  if (!isPoint(p) || !Array.isArray(poly) || poly.length < 2) return Infinity;

  let best = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d2 = dist2PointToSeg(p, a, b);
    if (d2 < best) best = d2;
  }

  return Number.isFinite(best) ? Math.sqrt(best) : Infinity;
}

export function pointDistanceToPolygonSamples(p, poly) {
  if (!isPoint(p) || !Array.isArray(poly) || poly.length < 1) return Infinity;

  let best = Infinity;

  for (const q of edgeSampledPoints(poly, 3)) {
    if (!isPoint(q)) continue;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best) best = d;
  }

  return best;
}

export function polygonClearOfPoint(poly, point, clearance) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  if (!isPoint(point)) return true;

  const minClearance = Number.isFinite(clearance) && clearance > 0 ? clearance : 0;

  for (const p of edgeSampledPoints(poly, 3)) {
    if (!isPoint(p)) return false;
    if (Math.hypot(p.x - point.x, p.y - point.y) < minClearance) return false;
  }

  return true;
}

export function scalePolyToward(poly, centre, scale) {
  if (!Array.isArray(poly) || poly.length < 3 || !isPoint(centre)) return null;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) return null;

  return poly.map((p) => ({
    x: centre.x + (p.x - centre.x) * scale,
    y: centre.y + (p.y - centre.y) * scale,
  }));
}


export function dist2PointToSeg(p, a, b) {
  if (!isPoint(p) || !isPoint(a) || !isPoint(b)) return Infinity;

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;

  if (ab2 <= 1e-12) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }

  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const qx = a.x + abx * t;
  const qy = a.y + aby * t;
  const dx = p.x - qx;
  const dy = p.y - qy;
  return dx * dx + dy * dy;
}

export function wrapIndex(i, n) {
  return ((i % n) + n) % n;
}

export function angleOf(p, centre) {
  return Math.atan2(p.y - centre.y, p.x - centre.x);
}

export function distTo(p, centre) {
  return Math.hypot(p.x - centre.x, p.y - centre.y);
}

export function dedupePoints(points, eps = 1e-6) {
  const out = [];
  for (const p of safeArray(points)) {
    if (!isPoint(p)) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > eps) out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= eps) out.pop();
  }
  return out;
}

export function median3(a, b, c) {
  const arr = [a, b, c].sort((x, y) => x - y);
  return arr[1];
}

export function average3(a, b, c) {
  return (a + b + c) / 3;
}

export function chooseAngularSampleCount(poly) {
  const n = Array.isArray(poly) ? poly.length : 0;
  if (n >= 80) return 72;
  if (n >= 56) return 64;
  if (n >= 40) return 56;
  return 48;
}

export function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

export function rayMaxRadiusToPoly(centre, dir, poly) {
  if (!isPoint(centre) || !isPoint(dir) || !Array.isArray(poly) || poly.length < 3) return null;

  let bestT = null;
  const eps = 1e-9;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const dx = dir.x;
    const dy = dir.y;

    const den = cross2(dx, dy, sx, sy);
    if (Math.abs(den) <= eps) continue;

    const acx = a.x - centre.x;
    const acy = a.y - centre.y;

    const t = cross2(acx, acy, sx, sy) / den;
    const u = cross2(acx, acy, dx, dy) / den;

    if (t >= -eps && u >= -eps && u <= 1 + eps) {
      const tClamped = t < 0 ? 0 : t;
      if (bestT == null || tClamped > bestT) bestT = tClamped;
    }
  }

  return bestT;
}

export function rayFirstExitRadiusToPoly(centre, dir, poly) {
  if (!isPoint(centre) || !isPoint(dir) || !Array.isArray(poly) || poly.length < 3) return null;

  let bestT = null;
  const eps = 1e-9;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const dx = dir.x;
    const dy = dir.y;

    const den = cross2(dx, dy, sx, sy);
    if (Math.abs(den) <= eps) continue;

    const acx = a.x - centre.x;
    const acy = a.y - centre.y;

    const t = cross2(acx, acy, sx, sy) / den;
    const u = cross2(acx, acy, dx, dy) / den;

    // First positive boundary hit from an interior point is the safe exit.
    // Do not use the farthest hit on concave / non-star-shaped hulls.
    if (t > eps && u >= -eps && u <= 1 + eps) {
      if (bestT == null || t < bestT) bestT = t;
    }
  }

  return bestT;
}

export function radialPoint(centre, dir, radius) {
  return {
    x: centre.x + dir.x * radius,
    y: centre.y + dir.y * radius,
  };
}

export function clippedSafeRadiusToPoly(centre, dir, poly) {
  const exitR = rayFirstExitRadiusToPoly(centre, dir, poly);

  if (!(Number.isFinite(exitR) && exitR > 1e-9)) {
    return null;
  }

  // Pull slightly inward first. This avoids boundary precision failures.
  let hi = exitR * 0.995;
  let lo = 0;

  if (!pointInsidePoly(poly, radialPoint(centre, dir, hi))) {
    // The first-exit value can still land outside due to vertex hits or
    // floating-point edge cases. Binary search for the furthest inside point.
    hi = exitR;
    for (let i = 0; i < 42; i++) {
      const mid = (lo + hi) / 2;
      const p = radialPoint(centre, dir, mid);
      if (pointInsidePoly(poly, p)) lo = mid;
      else hi = mid;
    }

    return lo > 1e-9 ? lo : null;
  }

  return hi;
}

export function capInnerSupportLowerBound(lowerBound, upperBound) {
  if (!(Number.isFinite(upperBound) && upperBound > 1e-9)) return 0;
  if (!(Number.isFinite(lowerBound) && lowerBound > 0)) return 0;

  // Ward boundary support points are advisory. Because they are binned by angle,
  // they can exceed the safe radial bound for that exact sampled direction.
  // Required points are still checked explicitly after the polygon is built.
  return Math.min(lowerBound, upperBound * 0.985);
}


export function dilateCyclicMax(values, radius = 1) {
  const n = values.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let best = values[i];
    for (let k = -radius; k <= radius; k++) {
      best = Math.max(best, values[wrapIndex(i + k, n)]);
    }
    out[i] = best;
  }
  return out;
}

export function smoothUpperProfile(values) {
  const n = values.length;
  const med = new Array(n);
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    med[i] = median3(
      values[wrapIndex(i - 1, n)],
      values[i],
      values[wrapIndex(i + 1, n)]
    );
  }

  for (let i = 0; i < n; i++) {
    out[i] = average3(
      med[wrapIndex(i - 1, n)],
      med[i],
      med[wrapIndex(i + 1, n)]
    );
  }

  return out;
}

export function alignWinding(poly, referencePoly) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;
  const a = signedArea(poly);
  const b = Array.isArray(referencePoly) && referencePoly.length >= 3 ? signedArea(referencePoly) : a;
  if (Number.isFinite(a) && Number.isFinite(b) && a * b < 0) return poly.slice().reverse();
  return poly;
}


export function normaliseAngleDelta(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function canonicalAngle01(p, centre) {
  const a = angleOf(p, centre);
  const t = a < 0 ? a + Math.PI * 2 : a;
  return t;
}

export function stablePointKey(p, precision = 1000) {
  return `${Math.round(p.x * precision)}:${Math.round(p.y * precision)}`;
}

export function uniqueHardPoints(points) {
  const out = [];
  const seen = new Set();

  for (const p of safeArray(points)) {
    if (!isPoint(p)) continue;

    const key = stablePointKey(p, 1000);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(p);
  }

  return out;
}

export function requiredPointInsideLegacyOuter(p, legacyPoly) {
  return isPoint(p) && pointInsidePoly(legacyPoly, p);
}
