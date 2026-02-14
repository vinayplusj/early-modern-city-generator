// docs/src/model/generate_helpers/warp_stage.js
//
// Fort warp stage helper.
//
// This wraps buildWarpField() and provides:
// - A clearer API name: targetPoly (instead of fieldPoly).
// - Automatic band tuning from the mean wall radius.
// - Optional radial clamping against an inner and/or outer hull.

import { buildWarpField, warpPolylineRadial } from "../warp.js";
import { dist } from "../../geom/primitives.js";

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
    minField = buildWarpField({
      centre,
      wallPoly,
      targetPoly: clampMinPoly,
      districts: null,
      bastions: null,
      params: { ...tuned, bandInner: 0, bandOuter: 0 },
    });
  }

  if (Array.isArray(clampMaxPoly) && clampMaxPoly.length >= 3) {
    maxField = buildWarpField({
      centre,
      wallPoly,
      targetPoly: clampMaxPoly,
      districts: null,
      bastions: null,
      params: { ...tuned, bandInner: 0, bandOuter: 0 },
    });
  }

  if (minField || maxField) {
    wallWarped = clampPolylineRadial(
      wallWarped,
      centre,
      minField,
      maxField,
      clampMinMargin,
      clampMaxMargin
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
