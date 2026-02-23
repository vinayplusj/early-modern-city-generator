// docs/src/model/wards/ward_shape_utils.js
//
// Ward polygon / centroid utilities.
//
// Behaviour notes
// - Wards may store their polygon as `poly` or `polygon`.
// - These helpers do NOT mutate wards.
// - Sorting of ids is deterministic (numeric ascending).

import { centroid } from "../../geom/poly.js";
import { isPoint } from "../../geom/primitives.js";

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
