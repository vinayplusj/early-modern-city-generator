// docs/src/model/hull/core_set.js
// Core ward set and ward lookup helpers for Stage 105.

import { safeArray, isPoint, polygonCentroidSafe } from "./hull_geom.js";

export function wardById(wardsWithRoles, id) {
  for (const w of safeArray(wardsWithRoles)) {
    if (w && w.id === id) return w;
  }
  return null;
}

export function wardPoly(w) {
  return Array.isArray(w?.poly) ? w.poly : null;
}

export function wardCentroid(w) {
  if (isPoint(w?.seed)) return w.seed;
  const poly = wardPoly(w);
  return polygonCentroidSafe(poly);
}

function boolResult(ok, extra = {}) {
  return { ok: !!ok, ...extra };
}

function firstRoleId(value) {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  if (Number.isInteger(value)) return value;
  return null;
}

export function buildCoreSet({ wardsState, anchors, citadel }) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);
  const roleIdx = wardsState?.wardRoleIndices || {};
  const fortHulls = wardsState?.fortHulls || {};

  const plazaWardId = firstRoleId(roleIdx.plaza);
  const citadelWardId = firstRoleId(roleIdx.citadel);

  const innerWardIds = Array.isArray(roleIdx.inner)
    ? roleIdx.inner.slice()
    : wardsWithRoles.filter(w => w?.role === "inner").map(w => w.id);

  const coreWardIds = Array.isArray(fortHulls.coreIds)
    ? fortHulls.coreIds.slice()
    : innerWardIds.slice();

  const ring1WardIds = Array.isArray(fortHulls.ring1Ids) ? fortHulls.ring1Ids.slice() : [];

  return {
    plazaWardId,
    citadelWardId,
    innerWardIds,
    coreWardIds,
    ring1WardIds,
    coreIdsForHull: safeArray(fortHulls.coreIdsForHull),
    ring1IdsForHull: safeArray(fortHulls.ring1IdsForHull),
    outerIdsForHull: safeArray(fortHulls.outerIdsForHull),
    plazaAnchor: anchors?.plaza ?? null,
    citadelAnchor: anchors?.citadel ?? null,
    hasCitadelGeometry: Array.isArray(citadel) && citadel.length >= 3,
    source: "wards.fortHulls + anchors + wards.wardRoleIndices",
  };