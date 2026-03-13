// docs/src/model/wards/ward_shape_utils.js
//
// Ward polygon / centroid utilities.
//
// Behaviour notes
// - Wards may store their polygon as `poly` or `polygon`.
// - These helpers do NOT mutate wards.
// - Sorting of ids is deterministic (numeric ascending).

import { clampPolylineInsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";
import { isPoint } from "../../geom/primitives.js";
import {
  centroid,
  pointInPoly,
  closestPointOnSegment,
} from "../../geom/poly.js";
import { almostEqual } from "../util/numbers.js";

export function wardPolyOrNull(w) {
  const a = w?.poly;
  if (Array.isArray(a) && a.length >= 3) return a;

  const b = w?.polygon;
  if (Array.isArray(b) && b.length >= 3) return b;

  return null;
}

export function wardHasValidPoly(w) {
  return !!wardPolyOrNull(w);
}

export function idsWithMissingPoly(wards, ids) {
  const out = [];
  for (const id of ids) {
    if (!Number.isFinite(id)) continue;
    const w = wards.find((x) => x?.id === id);
    if (!wardHasValidPoly(w)) out.push(id);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function filterIdsWithValidPoly(wards, ids) {
  const out = [];
  for (const id of ids) {
    if (!Number.isFinite(id)) continue;
    const w = wards.find((x) => x?.id === id);
    if (wardHasValidPoly(w)) out.push(id);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Deterministic representative point for a ward.
 * Preference order:
 * 1) ward.centroid if present and valid
 * 2) polygon centroid (computed)
 * 3) ward.seed if present and valid
 * 4) null
 */
export function wardCentroid(w) {
  if (!w) return null;

  if (isPoint(w.centroid)) return w.centroid;

  const poly = wardPolyOrNull(w);
  if (poly) {
    const c = centroid(poly);
    if (isPoint(c)) return c;
  }

  if (isPoint(w.seed)) return w.seed;

  return null;
}

export function dropClosingPoint(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;

  const a = poly[0];
  const b = poly[poly.length - 1];

  if (almostEqual(a.x, b.x) && almostEqual(a.y, b.y)) {
    return poly.slice(0, poly.length - 1);
  }
  return poly;
}

export function assertWardEdgesInsideFootprint({ wardId, poly, footprintPoly, maxFails = 3 }) {
  if (!Array.isArray(poly) || poly.length < 3) return;
  if (!Array.isArray(footprintPoly) || footprintPoly.length < 3) return;

  let fails = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };

    if (!pointInPoly(mid, footprintPoly)) {
      fails += 1;
      console.warn("[EMCG] ward clip invariant failed: edge midpoint outside footprint", {
        wardId,
        edgeIndex: i,
        mid,
      });
      if (fails >= maxFails) break;
    }
  }
}

export function nearestPointOnPoly(p, poly) {
  let best = null;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestPointOnSegment(p, a, b);
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = q;
    }
  }

  return best || { x: poly[0].x, y: poly[0].y };
}

export function projectPointToPolyInterior(p, poly) {
  const nearest = nearestPointOnPoly(p, poly);
  const c = centroid(poly);
  const dx = c.x - nearest.x;
  const dy = c.y - nearest.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const eps = 1e-3;

  const nudged = {
    x: nearest.x + (dx / len) * eps,
    y: nearest.y + (dy / len) * eps,
  };

  return pointInPoly(nudged, poly) ? nudged : nearest;
}

export function densifyPolyline(poly, maxSegLen) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;

  const out = [];
  const maxL = Number.isFinite(maxSegLen) ? maxSegLen : 10;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    out.push(a);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);

    if (!Number.isFinite(L) || L <= maxL || L <= 1e-9) continue;

    const n = Math.ceil(L / maxL);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + dx * t, y: a.y + dy * t });
    }
  }

  return out;
}

export function dropNearDuplicatePoints(poly, eps = 1e-6) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;

  const out = [];
  let prev = null;
  for (const p of poly) {
    if (!prev) {
      out.push(p);
      prev = p;
      continue;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (dx * dx + dy * dy > eps * eps) {
      out.push(p);
      prev = p;
    }
  }

  if (out.length >= 3) {
    const a = out[0];
    const b = out[out.length - 1];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy <= eps * eps) out.pop();
  }

  return out;
}

export function tryClipToFootprint(cellPoly, footprintPoly, params) {
  if (!Array.isArray(cellPoly) || cellPoly.length < 3) return null;
  if (!Array.isArray(footprintPoly) || footprintPoly.length < 3) return null;

  const centre = centroid(footprintPoly);
  const maxSegLen = Number.isFinite(params?.wardClipMaxSegLen) ? params.wardClipMaxSegLen : 10;
  const dense = densifyPolyline(cellPoly, maxSegLen);

  let clamped = clampPolylineInsidePolyAlongRays(dense, centre, footprintPoly, 0);
  if (!clamped || clamped.length < 3) return null;

  clamped = dropNearDuplicatePoints(clamped, 1e-6);
  if (!clamped || clamped.length < 3) return null;

  return clamped;
}
