// docs/src/model/stages/105_hull_model.js
//
// Milestone 4.9
// Publish canonical hull-related outputs for later stages:
// - coreSet
// - innerHullModel
// - outerHullModel
// - hullProofs
// - citadelFit
// - coastGeometry
//
// This stage does not invent new geometry. It formalises geometry that already
// exists in ctx.state after wards / anchors / citadel / water are available.

import { assert } from "../util/assert.js";
import { pointInPolyOrOn, centroid } from "../../geom/poly.js";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function firstPoint(poly) {
  return Array.isArray(poly) && poly.length > 0 ? poly[0] : null;
}

function samplePolyline(poly, maxSamples = 64) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  if (poly.length <= maxSamples) return poly.slice();

  const out = [];
  const step = Math.max(1, Math.floor(poly.length / maxSamples));
  for (let i = 0; i < poly.length; i += step) out.push(poly[i]);
  const last = poly[poly.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function pointInsidePoly(poly, p) {
  return Array.isArray(poly) && poly.length >= 3 && isPoint(p)
    ? pointInPolyOrOn(p, poly)
    : false;
}

function polygonCentroidSafe(poly) {
  try {
    return Array.isArray(poly) && poly.length >= 3 ? centroid(poly) : null;
  } catch {
    return firstPoint(poly);
  }
}

function wardById(wardsWithRoles, id) {
  for (const w of safeArray(wardsWithRoles)) {
    if (w && w.id === id) return w;
  }
  return null;
}

function wardPoly(w) {
  return Array.isArray(w?.poly) ? w.poly : null;
}

function wardCentroid(w) {
  if (isPoint(w?.seed)) return w.seed;
  const poly = wardPoly(w);
  return polygonCentroidSafe(poly);
}

function boolResult(ok, extra = {}) {
  return { ok: !!ok, ...extra };
}

function buildCoreSet({ wardsState, anchors, citadel }) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);
  const roleIdx = wardsState?.wardRoleIndices || {};
  const fortHulls = wardsState?.fortHulls || {};

  const plazaWardId =
    Array.isArray(roleIdx.plaza) && roleIdx.plaza.length > 0 ? roleIdx.plaza[0] : null;

  const citadelWardId =
    Array.isArray(roleIdx.citadel) && roleIdx.citadel.length > 0 ? roleIdx.citadel[0] : null;

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
}

function buildHullModel(kind, hull, memberWardIds, sourceWardIds, extra = {}) {
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

function buildHullProofs({ cx, cy, wardsState, coreSet, innerHullModel, outerHullModel }) {
  const centre = { x: cx, y: cy };
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);

  const centreInInner = pointInsidePoly(innerHullModel.poly, centre);
  const centreInOuter = pointInsidePoly(outerHullModel.poly, centre);

  const innerSamples = samplePolyline(innerHullModel.poly, 64);
  let sampledFails = 0;
  for (const p of innerSamples) {
    if (!pointInsidePoly(outerHullModel.poly, p)) sampledFails++;
  }

  const missingCoreWardIds = [];
  for (const wid of safeArray(coreSet.coreIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    const c = wardCentroid(w);
    if (!pointInsidePoly(innerHullModel.poly, c)) missingCoreWardIds.push(wid);
  }

  const missingOuterWardIds = [];
  for (const wid of safeArray(coreSet.outerIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    const c = wardCentroid(w);
    if (!pointInsidePoly(outerHullModel.poly, c)) missingOuterWardIds.push(wid);
  }

  return {
    centreInInnerHull: boolResult(centreInInner, { value: centreInInner }),
    centreInOuterHull: boolResult(centreInOuter, { value: centreInOuter }),
    innerHullInsideOuterHullSampled: boolResult(sampledFails === 0, {
      samples: innerSamples.length,
      fails: sampledFails,
    }),
    coreMembersInsideInnerHull: boolResult(missingCoreWardIds.length === 0, {
      missingWardIds: missingCoreWardIds,
    }),
    claimedOuterMembersInsideOuterHull: boolResult(missingOuterWardIds.length === 0, {
      missingWardIds: missingOuterWardIds,
    }),
  };
}

function buildCitadelFit({ citadel, wardsState, coreSet, innerHullModel }) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);
  const citadelWard = wardById(wardsWithRoles, coreSet.citadelWardId);
  const citadelWardPoly = wardPoly(citadelWard);

  const poly = Array.isArray(citadel) ? citadel : null;
  const pts = safeArray(poly);

  let insideCitadelWard = null;
  let insideInnerHull = null;
  let centroidInsideCitadelWard = null;

  if (pts.length >= 3) {
    insideCitadelWard =
      Array.isArray(citadelWardPoly) && citadelWardPoly.length >= 3
        ? pts.every(p => pointInsidePoly(citadelWardPoly, p))
        : null;

    insideInnerHull =
      Array.isArray(innerHullModel.poly) && innerHullModel.poly.length >= 3
        ? pts.every(p => pointInsidePoly(innerHullModel.poly, p))
        : null;

    const c = polygonCentroidSafe(poly);
    centroidInsideCitadelWard =
      c && Array.isArray(citadelWardPoly) && citadelWardPoly.length >= 3
        ? pointInsidePoly(citadelWardPoly, c)
        : null;
  }

  return {
    poly,
    wardId: coreSet.citadelWardId ?? null,
    fitMode: "generated_from_anchor",
    insideCitadelWard,
    insideInnerHull,
    centroidInsideCitadelWard,
  };
}

function buildCoastGeometry(waterModel) {
  if (!waterModel || waterModel.kind !== "coast") return null;

  return {
    kind: "coast_curve",
    curve:
      waterModel.shoreline ??
      waterModel.coastline ??
      waterModel.polyline ??
      null,
    bankPoint: waterModel.bankPoint ?? null,
    diagnostics: {
      neighboursOuterBoundary: true,
      intersectsOuterBoundaryAsPolygon: false,
    },
  };
}

export function runHullModelStage({ ctx, cx, cy }) {
  assert(ctx && ctx.state, "runHullModelStage: missing ctx.state.");

  const wardsState = ctx.state.wards;
  const anchors = ctx.state.anchors;
  const citadel = ctx.state.citadel;
  const waterModel = ctx.state.waterModel;

  assert(wardsState?.fortHulls, "[EMCG][105] Missing ctx.state.wards.fortHulls.");
  assert(anchors, "[EMCG][105] Missing ctx.state.anchors.");

  const fortHulls = wardsState.fortHulls;
  const coreSet = buildCoreSet({ wardsState, anchors, citadel });

  const innerHullModel = buildHullModel(
    "innerHull",
    fortHulls.innerHull,
    coreSet.coreIdsForHull,
    coreSet.coreWardIds,
    {
      objective: { mode: "core_union_outer_loop" },
    }
  );

  const outerHullModel = buildHullModel(
    "outerHull",
    fortHulls.outerHull,
    coreSet.outerIdsForHull,
    coreSet.coreWardIds.concat(coreSet.ring1WardIds),
    {
      closureMode:
        fortHulls?.outerHull?._forcedSingleLoop ? "forced_single_outer_loop" : "normal",
    }
  );

  const hullProofs = buildHullProofs({
    cx,
    cy,
    wardsState,
    coreSet,
    innerHullModel,
    outerHullModel,
  });

  const citadelFit = buildCitadelFit({
    citadel,
    wardsState,
    coreSet,
    innerHullModel,
  });

  const coastGeometry = buildCoastGeometry(waterModel);

  const hullModel = {
    coreSet,
    innerHull: innerHullModel,
    outerHull: outerHullModel,
    hullProofs,
    citadelFit,
    coastGeometry,
  };

  ctx.state.hullModel = hullModel;

  // Canonical aliases for later stages.
  ctx.state.coreSet = coreSet;
  ctx.state.innerHullModel = innerHullModel;
  ctx.state.outerHullModel = outerHullModel;
  ctx.state.hullProofs = hullProofs;
  ctx.state.citadelFit = citadelFit;
  ctx.state.coastGeometry = coastGeometry;

  return hullModel;
}

export default runHullModelStage;
