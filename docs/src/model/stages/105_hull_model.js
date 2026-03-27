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
// Step 3A: improve geometry one contract at a time.
// This version upgrades the INNER hull only.
//
// New behaviour:
// - Build a deterministic star-profile refinement for the inner hull.
// - The refinement is derived from:
//   * the legacy inner hull radial profile
//   * core ward support points
//   * plaza / citadel anchors
//   * citadel geometry, when present
// - The candidate stays inside the legacy inner hull by construction intent.
// - If the refined candidate weakens containment or becomes malformed, the stage
//   falls back to the legacy inner hull.
//
// Important:
// - Outer hull is still legacy-wrapped for now.
// - Citadel fit is still diagnostic for now.
// - Coast geometry is still a publication wrapper for now.

import { assert } from "../util/assert.js";
import { pointInPolyOrOn, centroid, signedArea } from "../../geom/poly.js";

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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapIndex(i, n) {
  return ((i % n) + n) % n;
}

function angleOf(p, centre) {
  return Math.atan2(p.y - centre.y, p.x - centre.x);
}

function distTo(p, centre) {
  return Math.hypot(p.x - centre.x, p.y - centre.y);
}

function dedupePoints(points, eps = 1e-6) {
  const out = [];
  for (const p of safeArray(points)) {
    if (!isPoint(p)) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > eps) out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= eps) out.pop();
  }
  return out;
}

function median3(a, b, c) {
  const arr = [a, b, c].sort((x, y) => x - y);
  return arr[1];
}

function average3(a, b, c) {
  return (a + b + c) / 3;
}

function chooseAngularSampleCount(poly) {
  const n = Array.isArray(poly) ? poly.length : 0;
  if (n >= 80) return 72;
  if (n >= 56) return 64;
  if (n >= 40) return 56;
  return 48;
}

function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function rayMaxRadiusToPoly(centre, dir, poly) {
  if (!isPoint(centre) || !isPoint(dir) || !Array.isArray(poly) || poly.length < 3) return null;

  let bestT = null;
  const eps = 1e-9;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const dx = dir.x;
    const dy = dir.y;

    const den = cross2(dx, dy, sx, sy);
    if (Math.abs(den) <= eps) continue;

    const acx = a.x - centre.x;
    const acy = a.y - centre.y;

    const t = cross2(acx, acy, sx, sy) / den;
    const u = cross2(acx, acy, dx, dy) / den;

    if (t >= -eps && u >= -eps && u <= 1 + eps) {
      const tClamped = t < 0 ? 0 : t;
      if (bestT == null || tClamped > bestT) bestT = tClamped;
    }
  }

  return bestT;
}

function collectCoreSupport({
  wardsState,
  coreSet,
  anchors,
  citadel,
}) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);

  const radialSupportPoints = [];
  const requiredInsidePoints = [];

  for (const wid of safeArray(coreSet.coreIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    if (!w) continue;

    const c = wardCentroid(w);
    if (isPoint(c)) requiredInsidePoints.push(c);

    const poly = wardPoly(w);
    for (const p of safeArray(poly)) {
      if (isPoint(p)) radialSupportPoints.push(p);
    }
  }

  if (isPoint(anchors?.plaza)) {
    radialSupportPoints.push(anchors.plaza);
    requiredInsidePoints.push(anchors.plaza);
  }

  if (isPoint(anchors?.citadel)) {
    radialSupportPoints.push(anchors.citadel);
    requiredInsidePoints.push(anchors.citadel);
  }

  if (Array.isArray(citadel) && citadel.length >= 3) {
    for (const p of citadel) {
      if (isPoint(p)) radialSupportPoints.push(p);
    }
    const cc = polygonCentroidSafe(citadel);
    if (isPoint(cc)) requiredInsidePoints.push(cc);
  }

  return {
    radialSupportPoints: dedupePoints(radialSupportPoints),
    requiredInsidePoints: dedupePoints(requiredInsidePoints),
  };
}

function dilateCyclicMax(values, radius = 1) {
  const n = values.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let best = values[i];
    for (let k = -radius; k <= radius; k++) {
      best = Math.max(best, values[wrapIndex(i + k, n)]);
    }
    out[i] = best;
  }
  return out;
}

function smoothUpperProfile(values) {
  const n = values.length;
  const med = new Array(n);
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    med[i] = median3(
      values[wrapIndex(i - 1, n)],
      values[i],
      values[wrapIndex(i + 1, n)]
    );
  }

  for (let i = 0; i < n; i++) {
    out[i] = average3(
      med[wrapIndex(i - 1, n)],
      med[i],
      med[wrapIndex(i + 1, n)]
    );
  }

  return out;
}

function alignWinding(poly, referencePoly) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;
  const a = signedArea(poly);
  const b = Array.isArray(referencePoly) && referencePoly.length >= 3 ? signedArea(referencePoly) : a;
  if (Number.isFinite(a) && Number.isFinite(b) && a * b < 0) return poly.slice().reverse();
  return poly;
}

function buildRefinedInnerHullCandidate({
  centre,
  legacyPoly,
  outerPoly,
  radialSupportPoints,
  requiredInsidePoints,
}) {
  if (!isPoint(centre)) {
    return { ok: false, reason: "missing_centre" };
  }
  if (!Array.isArray(legacyPoly) || legacyPoly.length < 3) {
    return { ok: false, reason: "missing_legacy_poly" };
  }
  if (!pointInsidePoly(legacyPoly, centre)) {
    return { ok: false, reason: "centre_outside_legacy_inner_hull" };
  }

  const sampleCount = chooseAngularSampleCount(legacyPoly);
  const step = (Math.PI * 2) / sampleCount;

  const upper = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i * step;
    const dir = { x: Math.cos(t), y: Math.sin(t) };
    const r = rayMaxRadiusToPoly(centre, dir, legacyPoly);
    if (!(Number.isFinite(r) && r > 0)) {
      return { ok: false, reason: "failed_legacy_radial_profile", sampleIndex: i };
    }
    upper[i] = r;
  }

  const lower = new Array(sampleCount).fill(0);
  for (const p of safeArray(radialSupportPoints)) {
    if (!isPoint(p)) continue;
    const theta = angleOf(p, centre);
    const radius = distTo(p, centre);
    const idx = wrapIndex(Math.round(theta / step), sampleCount);
    lower[idx] = Math.max(lower[idx], radius);
  }

  const lowerDilated = dilateCyclicMax(lower, 1);
  const upperSmooth = smoothUpperProfile(upper);

  const radii = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const upperBound = upper[i];
    const lowerBound = lowerDilated[i];
    const target = Math.min(upperBound, upperSmooth[i]);
    radii[i] = clamp(target, lowerBound, upperBound);
  }

  let poly = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i * step;
    poly.push({
      x: centre.x + Math.cos(t) * radii[i],
      y: centre.y + Math.sin(t) * radii[i],
    });
  }

  poly = dedupePoints(poly, 1e-5);
  poly = alignWinding(poly, legacyPoly);

  if (!Array.isArray(poly) || poly.length < 8) {
    return { ok: false, reason: "candidate_too_short" };
  }

  if (!pointInsidePoly(poly, centre)) {
    return { ok: false, reason: "centre_outside_candidate" };
  }

  for (const p of safeArray(requiredInsidePoints)) {
    if (!pointInsidePoly(poly, p)) {
      return { ok: false, reason: "required_point_outside_candidate", point: p };
    }
  }

  const candidateSamples = samplePolyline(poly, 96);

  for (const p of candidateSamples) {
    if (!pointInsidePoly(legacyPoly, p)) {
      return { ok: false, reason: "candidate_leaves_legacy_inner_hull" };
    }
  }

  if (Array.isArray(outerPoly) && outerPoly.length >= 3) {
    for (const p of candidateSamples) {
      if (!pointInsidePoly(outerPoly, p)) {
        return { ok: false, reason: "candidate_leaves_outer_hull" };
      }
    }
  }

  return {
    ok: true,
    poly,
    meta: {
      sampleCount,
      supportPointCount: safeArray(radialSupportPoints).length,
      requiredPointCount: safeArray(requiredInsidePoints).length,
      objective: "radial_star_profile_inside_legacy",
    },
  };
}

function buildOptimisedInnerHullModel({
  cx,
  cy,
  wardsState,
  anchors,
  citadel,
  coreSet,
  legacyHull,
  outerHullModel,
}) {
  const legacyModel = buildHullModel(
    "innerHull",
    legacyHull,
    coreSet.coreIdsForHull,
    coreSet.coreWardIds,
    {
      objective: { mode: "legacy_core_union_outer_loop" },
      refinement: {
        attempted: false,
        accepted: false,
        reason: "not_attempted",
      },
    }
  );

  const legacyPoly = legacyModel.poly;
  if (!Array.isArray(legacyPoly) || legacyPoly.length < 3) {
    return legacyModel;
  }

  const centre = { x: cx, y: cy };
  const support = collectCoreSupport({
    wardsState,
    coreSet,
    anchors,
    citadel,
  });

  const candidate = buildRefinedInnerHullCandidate({
    centre,
    legacyPoly,
    outerPoly: outerHullModel?.poly ?? null,
    radialSupportPoints: support.radialSupportPoints,
    requiredInsidePoints: support.requiredInsidePoints,
  });

  if (!candidate.ok) {
    return {
      ...legacyModel,
      refinement: {
        attempted: true,
        accepted: false,
        reason: candidate.reason || "candidate_rejected",
      },
      diagnostics: {
        ...legacyModel.diagnostics,
        refinement: {
          attempted: true,
          accepted: false,
          reason: candidate.reason || "candidate_rejected",
          supportPointCount: support.radialSupportPoints.length,
          requiredPointCount: support.requiredInsidePoints.length,
        },
      },
    };
  }

  const refinedPoly = candidate.poly;

  return {
    kind: "innerHull",
    poly: refinedPoly,
    loops: [refinedPoly],
    holeCount: 0,
    memberWardIds: safeArray(coreSet.coreIdsForHull),
    sourceWardIds: safeArray(coreSet.coreWardIds),
    warnings: safeArray(legacyHull?.warnings),
    objective: {
      mode: "radial_star_profile_inside_legacy",
      source: "legacy_inner_hull + core_support",
    },
    refinement: {
      attempted: true,
      accepted: true,
      reason: "accepted",
      ...candidate.meta,
    },
    diagnostics: {
      hasPoly: true,
      pointCount: refinedPoly.length,
      loopCount: 1,
      holeCount: 0,
      legacyPointCount: legacyPoly.length,
      refinement: {
        attempted: true,
        accepted: true,
        ...candidate.meta,
      },
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

  const innerHullModel = buildOptimisedInnerHullModel({
    cx,
    cy,
    wardsState,
    anchors,
    citadel,
    coreSet,
    legacyHull: fortHulls.innerHull,
    outerHullModel,
  });

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
