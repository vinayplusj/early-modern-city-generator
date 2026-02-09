// docs/src/model/warp.js
import { raySegmentIntersection } from "../geom/intersections.js"; // or add one helper if missing

export function buildWarpField({ centre, wallPoly, districts, bastions, params }) {
  if (!params || !Number.isFinite(params.samples) || params.samples < 32) {
    throw new Error("warp: invalid params.samples");
  }

  const N = params.samples;
  const thetas = new Array(N);
  const rFort = new Array(N);
  const rTarget = new Array(N);

  // ---- DEBUG: check whether wall vertices fall inside the warp band ----
  if (params.debug) {
    let inside = 0;
    let outside = 0;
  
    for (const p of wallPoly) {
      const rr = Math.hypot(p.x - centre.x, p.y - centre.y);
      if (rr >= params.bandInner && rr <= params.bandOuter) inside++;
      else outside++;
    }
  
    console.log("WARP BAND TEST", {
      bandInner: params.bandInner,
      bandOuter: params.bandOuter,
      wallVertsInsideBand: inside,
      wallVertsOutsideBand: outside,
      wallVertexCount: wallPoly.length,
    });
  }


  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2;
    thetas[i] = theta;
    rFort[i] = sampleRadiusAtAngle(centre, theta, wallPoly);

    // Stable fallback: carry previous, else use next later
    if (rFort[i] == null) {
      rFort[i] = (i > 0) ? rFort[i - 1] : null;
    }

    rTarget[i] = targetRadiusAtAngle(centre, theta, districts, rFort[i] ?? 0, params);
    if (params.debug && i % 120 === 0) {
      const d = districtAtAngle(theta, districts);
      console.log("WARP DISTRICT SAMPLE", { i, theta, kind: d?.kind ?? null });
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

  const delta = new Array(N);
  for (let i = 0; i < N; i++) {
    const raw = rTarget[i] - rFort[i];
    delta[i] = clamp(raw, -params.maxIn, params.maxOut);
  }
  
  // ---- DEBUG: delta range ----
  if (params.debug) {
    let minD = Infinity;
    let maxD = -Infinity;
  
    for (let i = 0; i < delta.length; i++) {
      if (!Number.isFinite(delta[i])) continue;
      minD = Math.min(minD, delta[i]);
      maxD = Math.max(maxD, delta[i]);
    }
  
    console.log("WARP DELTA RANGE", { minD, maxD });
  }

  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(delta[i])) delta[i] = 0;
  }

   const mask = buildBastionLockMask(thetas, centre, bastions, params);
    for (let i = 0; i < N; i++) {
       delta[i] *= mask[i];
     }

  const deltaSmooth = smoothCircular(delta, params.smoothRadius);
  const deltaSafe = clampCircularSlope(deltaSmooth, params.maxStep);

  return { N, thetas, rFort, rTarget, delta: deltaSafe };
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

    console.log("WARP WALL MAX SHIFT", maxShift);
  }

  return warpedPoly;
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
  if (!hit || hit.type !== "hit") return null;
  return hit.tRay;
}

function targetRadiusAtAngle(centre, theta, districts, rFort, params) {
  // First safe version: per-district scalar target, derived from current rFort and district role.
  // You can replace this later with real boundary curves.
  if (!Number.isFinite(rFort)) rFort = 0;

  const d = districtAtAngle(theta, districts);
  if (!d) return rFort;

  const kind = d.kind; // You already have deterministic roles
  const margin = params.targetMargin ?? 0;

  const offset =
    kind === "new_town" ? (params.newTownFortOffset ?? 30) :
    kind === "citadel"  ? (params.citadelFortOffset ?? -10) :
    (params.defaultFortOffset ?? 0);

  return rFort + offset - margin;
}

function districtAtAngle(theta, districts) {
  // You have angular sectors. Use the same wrap logic you use now.
  // Expect districts to carry startAngle, endAngle in radians.
  const t = wrapAngle(theta);
  for (const d of districts) {
    if (angleInInterval(t, d.startAngle, d.endAngle)) return d;
  }
  return null;
}

function districtAtAngle(theta, districts) {
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

  return null;
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

    const a0 = angleOfPoint(centre, b.shoulders[0]);
    const a1 = angleOfPoint(centre, b.shoulders[1]);

    // Expand the locked interval a little past the shoulders.
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

function angularDistance(a, b) {
  let d = Math.abs(wrapAngle(a) - wrapAngle(b));
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function smoothstep01(x) {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}

