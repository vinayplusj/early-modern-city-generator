// docs/src/model/hull/hull_model.js
// Canonical hull model wrapper.

import { safeArray } from "./hull_geom.js";

export function buildHullModel(kind, hull, memberWardIds, sourceWardIds, extra = {}) {
  return {
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
}