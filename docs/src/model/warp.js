// docs/src/model/warp.js
import { raySegmentIntersection } from "../geom/intersections.js"; // or add one helper if missing
import { pointInPolyOrOn } from "../geom/poly.js";

export function buildWarpField({ centre, wallPoly, targetPoly = null, districts, bastions, params }) {
  if (!params || !Number.isFinite(params.samples) || params.samples < 32) {
    throw new Error("warp: invalid params.samples");
  }
  
  const N = params.samples;
  const thetas = new Array(N);
  const rFort = new Array(N);
  const rTarget = new Array(N);
    // Defensive defaults: some callers build the warp field before districts exist.
  // Treat missing districts as an empty list (no district modulation).
  const districtsUse = Array.isArray(districts) ? districts : [];
  let nullCount = 0;

  // Debug-only: how often the centre-to-wall ray does not hit the wall at a sample angle.
  // This is a strong signal that centre is outside wallPoly or wallPoly is degenerate/self-intersecting.
  let rFortNullSamples = 0;

  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2;
    thetas[i] = theta;
    // 1) Current wall radius (what we are warping)
    const rawWallR = sampleRadiusAtAngle(centre, theta, wallPoly);
    if (rawWallR == null) rFortNullSamples++;
    rFort[i] = rawWallR;
    
    // Stable fallback: carry previous, else use next later
    if (rFort[i] == null) {
      rFort[i] = (i > 0) ? rFort[i - 1] : null;
    }
    
    // 2) Target radius from the hull (what we want the wall to conform to)
    const polyForTarget =
      (Array.isArray(targetPoly) && targetPoly.length >= 3) ? targetPoly : wallPoly;
    
    let rawTargetR = sampleRadiusAtAngle(centre, theta, polyForTarget);
    if (rawTargetR == null) rawTargetR = rFort[i] ?? 0;
    
    // 3) Apply your existing per-district offsets *on top* of that target hull radius
    rTarget[i] = targetRadiusAtAngle(centre, theta, districtsUse, rawTargetR, params);
    // After rTarget backfill loop, before delta computation:

  }
  
  if (params.debug && districtsUse.length > 0) {
    nullCount = 0;
  
    for (let j = 0; j < N; j++) {
      const d = districtAtAngle(thetas[j], districtsUse);
      if (!d) nullCount++;
    }
  
    // Only warn when districts exist but do not cover the full ring.
    if (nullCount > 0) {
      console.warn("WARP DISTRICT COVERAGE FAILED", { nullCount, N });
    }
  }

  // If rFort[0] is still null, find first non-null and backfill.
  if (rFort[0] == null) {
    let first = -1;
    for (let i = 0; i < N; i++) {
      if (rFort[i] != null) { first = i; break; }
    }
    const fallback = (first >= 0) ? rFort[first] : 0;
    for (let i = 0; i < N; i++) {
      if (rFort[i] == null) rFort[i] = fallback;
    }
  }

  // Ensure rTarget has no nulls after rFort backfill (prevents delta spikes at i=0).
  const polyForTarget =
    (Array.isArray(targetPoly) && targetPoly.length >= 3) ? targetPoly : wallPoly;
  
  for (let i = 0; i < N; i++) {
    if (rTarget[i] == null || !Number.isFinite(rTarget[i])) {
      let rawTargetR = sampleRadiusAtAngle(centre, thetas[i], polyForTarget);
      if (rawTargetR == null) rawTargetR = rFort[i] ?? 0;
      rTarget[i] = targetRadiusAtAngle(centre, thetas[i], districtsUse, rawTargetR, params);
    }
  }
  
  // Optional: smooth spikes in clamp fields (run once, after rTarget is complete)
  if (params && params._clampField === true) {
    for (let j = 0; j < N; j++) {
      const a = rTarget[(j - 1 + N) % N];
      const b = rTarget[j];
      const c = rTarget[(j + 1) % N];
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
  
      const avg = (a + c) * 0.5;
      if (Math.abs(b - avg) > 30) rTarget[j] = avg;
    }
  }

  const delta = new Array(N);
  for (let i = 0; i < N; i++) {
    const raw = rTarget[i] - rFort[i];
    delta[i] = clamp(raw, -params.maxIn, params.maxOut);
  }
  

  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(delta[i])) delta[i] = 0;
  }

    // 1) Hard lock (your current behaviour): damp both in/out near bastions
    const lockMask = buildBastionLockMask(thetas, centre, bastions, params);
  
    // 2) Clearance mask (new): only damp outward (positive) delta near bastions
    const clearMask = buildBastionClearMask(thetas, centre, bastions, params);
  
    for (let i = 0; i < N; i++) {
      // Apply lock to everything
      let d = delta[i] * lockMask[i];
  
      // Apply clearance only to outward bulge
      if (d > 0) d *= clearMask[i];
  
      delta[i] = d;
    }

  const deltaSmooth = smoothCircular(delta, params.smoothRadius);
  const deltaSafe = clampCircularSlope(deltaSmooth, params.maxStep);

  return {
    N,
    thetas,
    rFort,
    rTarget,
    delta: deltaSafe,
    stats: params.debug ? { rFortNullSamples } : null,
  };
}

export function warpPointRadial(p, centre, field, params) {
  const vx = p.x - centre.x;
  const vy = p.y - centre.y;
  const r = Math.hypot(vx, vy);
  if (r < 1e-6) return p;

  const theta = Math.atan2(vy, vx);
  const dr = sampleDelta(field, theta);

  const w = params.ignoreBand ? 1 : radialBandWeight(r, params.bandInner, params.bandOuter);

  const scale = 1 + (w * dr) / r;

  return { x: centre.x + vx * scale, y: centre.y + vy * scale };
}

export function warpPolylineRadial(poly, centre, field, params) {
  const warpedPoly = poly.map((p) => warpPointRadial(p, centre, field, params));

  // ---- DEBUG: wall displacement magnitude ----
  if (params.debug && poly.length > 0) {
    let maxShift = 0;

    for (let i = 0; i < poly.length; i++) {
      const dx = warpedPoly[i].x - poly[i].x;
      const dy = warpedPoly[i].y - poly[i].y;
      const d = Math.hypot(dx, dy);
      if (d > maxShift) maxShift = d;
    }
  }

  return warpedPoly;
}

export function enforceInsidePolyAlongRay(points, centre, poly, eps = 1e-6, iters = 24) {
  // Deterministic: for each point outside poly, pull it inward along the ray from centre
  // until it is inside (or on) the polygon.
  if (!centre || !poly || !Array.isArray(points)) return points;
  if (!Array.isArray(poly) || poly.length < 3) return points;

  for (const p of points) {
    if (!p) continue;

    const inside = pointInPolyOrOn(p, poly, eps);
    if (inside) continue;

    // Binary search along segment centre -> p for the last inside point.
    let lo = 0.0; // at centre, assumed inside for your fort hull use case
    let hi = 1.0;

    // If centre is not inside, do not try to “fix” deterministically here.
    // That indicates a deeper hull problem.
    if (!pointInPolyOrOn(centre, poly, eps)) continue;

    for (let k = 0; k < iters; k++) {
      const mid = (lo + hi) * 0.5;
      const q = {
        x: centre.x + (p.x - centre.x) * mid,
        y: centre.y + (p.y - centre.y) * mid,
      };

      if (pointInPolyOrOn(q, poly, eps)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // Move point to the last-known inside location.
    p.x = centre.x + (p.x - centre.x) * lo;
    p.y = centre.y + (p.y - centre.y) * lo;
  }

  return points;
}

/* ---------- helpers ---------- */

function sampleRadiusAtAngle(centre, theta, poly) {
  // Ray from centre: centre + t * dir, t > 0
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);

  let bestT = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const t = raySegHit(centre, { x: dx, y: dy }, a, b);
    if (t != null && t > 0 && t < bestT) bestT = t;
  }

  // Fallback if something goes wrong
  if (!Number.isFinite(bestT)) return null;
  return bestT;
}

function raySegHit(o, d, a, b) {
  const hit = raySegmentIntersection(o, d, a, b);
  if (!hit) return null;

  if (Number.isFinite(hit.tRay)) return hit.tRay;
  if (hit.type === "hit" && Number.isFinite(hit.tRay)) return hit.tRay;

  return null;
}

function targetRadiusAtAngle(centre, theta, districts, rFort, params) {
  // First safe version: per-district scalar target, derived from current rFort and district role.
  // You can replace this later with real boundary curves.
  if (!Number.isFinite(rFort)) rFort = 0;

  const d = districtAtAngle(theta, districts);
  if (!d) return rFort;

  const kind = d.kind; // Deterministic roles
  const margin = params.targetMargin ?? 0;

  // Treat “outer” land-use roles like outer_ward for fort offset purposes.
  const isOuterLike =
    kind === "outer_ward" ||
    kind === "slums" ||
    kind === "farms" ||
    kind === "plains" ||
    kind === "woods";

  const offset =
    kind === "new_town" ? (params.newTownFortOffset ?? 30) :
    isOuterLike         ? (params.outerWardFortOffset ?? 10) :
    kind === "citadel"  ? (params.citadelFortOffset ?? -10) :
    (params.defaultFortOffset ?? 0);

  return rFort + offset - margin;
}

function districtAtAngle(theta, districts) {
  if (!Array.isArray(districts) || districts.length === 0) return null;
  const t = wrapAngle(theta);

  for (const d of districts) {
    // Prefer first-class fields if they exist.
    const a0 =
      Number.isFinite(d.startAngle) ? d.startAngle :
      d._debug?.a0;

    const a1 =
      Number.isFinite(d.endAngle) ? d.endAngle :
      d._debug?.a1;

    if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;

    if (angleInInterval(t, a0, a1)) return d;
  }
    // Fallback: if due to boundary gaps nothing matched, pick nearest sector midpoint.
  let best = null;
  let bestDist = Infinity;

  for (const d of districts) {
    const a0 =
      Number.isFinite(d.startAngle) ? d.startAngle :
      d._debug?.a0;
    const a1 =
      Number.isFinite(d.endAngle) ? d.endAngle :
      d._debug?.a1;

    if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;

    const mid = wrapAngle(a0 + angularSpan(a0, a1) * 0.5);
    const dist = angularDistance(t, mid);

    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  return best;
}

function smoothCircular(values, radius) {
  const N = values.length;
  const out = new Array(N);

  for (let i = 0; i < N; i++) {
    let sum = 0;
    let wsum = 0;

    for (let k = -radius; k <= radius; k++) {
      const j = (i + k + N) % N;
      const w = (radius + 1) - Math.abs(k); // triangular kernel
      sum += values[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

function clampCircularSlope(values, maxStep) {
  const N = values.length;
  const out = values.slice();

  // One forward pass and one backward pass is usually enough.
  for (let i = 1; i < N; i++) out[i] = clampToNeighbour(out[i], out[i - 1], maxStep);
  out[0] = clampToNeighbour(out[0], out[N - 1], maxStep);
  for (let i = N - 2; i >= 0; i--) out[i] = clampToNeighbour(out[i], out[i + 1], maxStep);

  return out;
}

function clampToNeighbour(v, n, maxStep) {
  return clamp(v, n - maxStep, n + maxStep);
}

function sampleDelta(field, theta) {
  const t = wrapAngle(theta);
  const u = (t / (Math.PI * 2)) * field.N;
  const i0 = Math.floor(u) % field.N;
  const i1 = (i0 + 1) % field.N;
  const f = u - Math.floor(u);
  return field.delta[i0] * (1 - f) + field.delta[i1] * f;
}

function radialBandWeight(r, bandInner, bandOuter) {
  if (r <= bandInner) return 0;
  if (r >= bandOuter) return 1;
  const x = (r - bandInner) / (bandOuter - bandInner);
  // Smoothstep for gentle transition
  return x * x * (3 - 2 * x);
}

function wrapAngle(theta) {
  let t = theta % (Math.PI * 2);
  if (t < 0) t += Math.PI * 2;
  return t;
}

function angleInInterval(t, a0, a1) {
  const start = wrapAngle(a0);
  const end = wrapAngle(a1);
  if (start <= end) return t >= start && t < end;
  return t >= start || t < end; // wrap interval
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function buildBastionLockMask(thetas, centre, bastions, params) {
  const N = thetas.length;
  const out = new Array(N).fill(1);

  if (!bastions || !Array.isArray(bastions) || bastions.length === 0) return out;

  const lockPad = params.bastionLockPad ?? 0.10;         // radians
  const lockFeather = params.bastionLockFeather ?? 0.08; // radians

  for (const b of bastions) {
    if (!b || !Array.isArray(b.shoulders) || b.shoulders.length < 2) continue;

  let a0 = wrapAngle(angleOfPoint(centre, b.shoulders[0]));
  let a1 = wrapAngle(angleOfPoint(centre, b.shoulders[1]));
  
  // Force the smaller arc between the two shoulders.
  // If the forward span a0 -> a1 is bigger than PI, swap them.
  if (angularSpan(a0, a1) > Math.PI) {
    const tmp = a0;
    a0 = a1;
    a1 = tmp;
  }
  
  const start = a0 - lockPad;
  const end   = a1 + lockPad;

    for (let i = 0; i < N; i++) {
      const t = thetas[i];

      // Weight is 0 inside [start,end], ramps to 1 across lockFeather.
      const w = intervalLockWeight(t, start, end, lockFeather);

      // Combine locks conservatively: once locked, it stays locked.
      out[i] = Math.min(out[i], w);
    }
  }
  if (params.debug) {
  let minW = 1, maxW = 0;
  for (const w of out) { minW = Math.min(minW, w); maxW = Math.max(maxW, w); }
}

  return out;
}

function buildBastionClearMask(thetas, centre, bastions, params) {
  const N = thetas.length;
  const out = new Array(N).fill(1);

  if (!bastions || !Array.isArray(bastions) || bastions.length === 0) return out;

  // Make this much smaller than lockPad, by design.
  const halfWidth = params.bastionClearHalfWidth ?? 0.05;   // radians
  const feather   = params.bastionClearFeather   ?? 0.06;   // radians

  for (const b of bastions) {
    if (!b || !Array.isArray(b.pts) || b.pts.length === 0) continue;

    // Bastion mid angle: use the average of the bastion polygon points.
    let mx = 0, my = 0;
    for (const p of b.pts) { mx += p.x; my += p.y; }
    mx /= b.pts.length;
    my /= b.pts.length;

    const mid = wrapAngle(angleOfPoint(centre, { x: mx, y: my }));

    const start = mid - halfWidth;
    const end   = mid + halfWidth;

    for (let i = 0; i < N; i++) {
      const t = thetas[i];
      const w = intervalLockWeight(t, start, end, feather);
      out[i] = Math.min(out[i], w);
    }
  }

  if (params.debug) {
    let zeros = 0;
    let minW = 1, maxW = 0;
    for (const w of out) {
      if (w <= 1e-6) zeros++;
      minW = Math.min(minW, w);
      maxW = Math.max(maxW, w);
    }
  }

  return out;
}


function angleOfPoint(centre, p) {
  return Math.atan2(p.y - centre.y, p.x - centre.x);
}

// Returns 0 in the locked interior, 1 far outside, smooth at edges.
function intervalLockWeight(theta, a0, a1, feather) {
  const t = wrapAngle(theta);
  const start = wrapAngle(a0);
  const end = wrapAngle(a1);

  if (feather <= 1e-6) {
    return angleInInterval(t, start, end) ? 0 : 1;
  }

  // Distance in radians to the nearest boundary of the interval.
  const d = angularDistanceToInterval(t, start, end);

  // Inside interval => d = 0 => lock (0)
  // Outside => ramp up to 1 over 'feather'
  return smoothstep01(d / feather);
}

function angularDistanceToInterval(t, start, end) {
  if (angleInInterval(t, start, end)) return 0;

  // Compute distance to each boundary along the circle.
  const d0 = angularDistance(t, start);
  const d1 = angularDistance(t, end);
  return Math.min(d0, d1);
}

function angularSpan(a0, a1) {
  const start = wrapAngle(a0);
  const end = wrapAngle(a1);
  let span = end - start;
  if (span < 0) span += Math.PI * 2;
  return span;
}

function angularDistance(a, b) {
  let d = Math.abs(wrapAngle(a) - wrapAngle(b));
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function smoothstep01(x) {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}

