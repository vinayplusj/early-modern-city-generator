// docs/src/model/geom/is_inside_poly_or_skip.js
//
// Helper for debug invariant checks.
// Returns false if point is invalid.
// If poly is missing or too small, it returns true (pass-through), matching legacy behaviour.

import { pointInPolyOrOn } from "./poly.js";

export function isInsidePolyOrSkip(p, poly) {
  if (!p) return false;
  if (!Array.isArray(poly) || poly.length < 3) return true; // pass-through
  return pointInPolyOrOn(p, poly, 1e-6);
}
