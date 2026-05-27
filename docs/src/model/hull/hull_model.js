// docs/src/model/hull/hull_model.js
// Canonical hull model wrapper.

import { safeArray } from "./hull_geom.js";

function hasModelPolygon(model) {
  return Array.isArray(model?.poly) && model.poly.length >= 3;
}

export function finaliseHullStatus(model) {
  const base = model && typeof model === "object" ? model : {};
  const refinement = base.refinement ?? base.diagnostics?.refinement ?? null;

  let status = "invalid";
  let reason = "missing_or_invalid_poly";

  if (hasModelPolygon(base)) {
    if (refinement?.attempted === true && refinement?.accepted === true) {
      status = "optimized";
      reason = refinement.reason ?? "accepted";
    } else if (refinement?.attempted === true && refinement?.accepted !== true) {
      status = "valid_fallback";
      reason = refinement.reason ?? "candidate_rejected";
    } else {
      status = "valid_fallback";
      reason = refinement?.reason ?? "legacy_not_refined";
    }
  }

  const isOptimized = status === "optimized";
  const isValidFallback = status === "valid_fallback";

  return {
    ...base,
    status,
    reason,
    isOptimized,
    isValidFallback,
    diagnostics: {
      ...(base.diagnostics || {}),
      status,
      reason,
      isOptimized,
      isValidFallback,
    },
  };
}

export function buildHullModel(kind, hull, memberWardIds, sourceWardIds, extra = {}) {
  const model = {
    kind,
    poly: Array.isArray(hull?.outerLoop) ? hull.outerLoop : null,
    loops: safeArray(hull?.loops),
    holeCount: Number.isFinite(hull?.holeCount) ? hull.holeCount : 0,
    memberWardIds: safeArray(memberWardIds),
    sourceWardIds: safeArray(sourceWardIds),
    warnings: safeArray(hull?.warnings),
    diagnostics: {
      hasPoly: Array.isArray(hull?.outerLoop) && hull.outerLoop.length >= 3,
      pointCount: Array.isArray(hull?.outerLoop) ? hull.outerLoop.length : 0,
      loopCount: Array.isArray(hull?.loops) ? hull.loops.length : 0,
      holeCount: Number.isFinite(hull?.holeCount) ? hull.holeCount : 0,
    },
    ...extra,
  };

  return finaliseHullStatus(model);
}
