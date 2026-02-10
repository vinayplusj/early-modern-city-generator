// docs/src/model/water.js
//
// Model-level wrapper for water generation.
// This keeps generate.js clean and gives render code a stable shape.
//
// Expected helper location:
//   docs/src/model/generate_helpers/water.js
//
// Expected helper export (one of these names):
//   - buildWaterFeature
//   - generateWaterFeature
//   - makeWaterFeature
//
// This wrapper normalizes output to:
//   { kind: "none" | "river" | "coast", poly: Array<{x,y}>|null, shoreline: Array<{x,y}>|null }

import * as waterHelper from "./generate_helpers/water.js";

function pickHelperFn() {
  return (
    waterHelper.buildWaterFeature ||
    waterHelper.generateWaterFeature ||
    waterHelper.makeWaterFeature ||
    null
  );
}

function normalizeKind(kind) {
  const k = (typeof kind === "string") ? kind : "none";
  if (k === "river" || k === "coast") return k;
  return "none";
}

function normalizePoly(poly) {
  return Array.isArray(poly) && poly.length >= 3 ? poly : null;
}

function normalizeShoreline(shoreline, poly) {
  // Shoreline may be a polyline (>= 2) or a closed ring (>= 3).
  if (Array.isArray(shoreline) && shoreline.length >= 2) return shoreline;

  // If helper did not supply a shoreline, fall back to the polygon ring.
  if (Array.isArray(poly) && poly.length >= 3) return poly;

  return null;
}

export function buildWaterModel({
  rng,
  cx,
  cy,
  width,
  height,
  outerBoundary,
  site,
  params,
} = {}) {
  const requested = normalizeKind(site && site.water);

  if (requested === "none") {
    return { kind: "none", poly: null, shoreline: null };
  }

  const fn = pickHelperFn();
  if (!fn) {
    // Hard fail would be annoying during iteration.
    // Return "none" so the rest of the model still works.
    return { kind: "none", poly: null, shoreline: null };
  }

  const raw = fn({
    rng,
    cx,
    cy,
    width,
    height,
    outerBoundary,
    site: { ...(site || {}), water: requested },
    params: params || {},
  }) || {};

  const kind = normalizeKind(raw.kind || requested);
  const poly = normalizePoly(raw.poly || raw.waterPoly || raw.polygon);
  const shoreline = normalizeShoreline(
    raw.shoreline || raw.bank || raw.coastline || raw.riverbank,
    poly
  );

  // If helper returns nothing useful, treat as none.
  if (!poly || !shoreline) {
    return { kind: "none", poly: null, shoreline: null };
  }

  return { kind, poly, shoreline };
}
