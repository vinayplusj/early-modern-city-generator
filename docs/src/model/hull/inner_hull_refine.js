// docs/src/model/hull/inner_hull_refine.js
// Deterministic inner-hull refinement.

import {
  safeArray,
  isPoint,
  polygonCentroidSafe,
  dedupePoints,
  samplePolyline,
  chooseAngularSampleCount,
  clippedSafeRadiusToPoly,
  angleOf,
  distTo,
  wrapIndex,
  dilateCyclicMax,
  smoothUpperProfile,
  capInnerSupportLowerBound,
  clamp,
  alignWinding,
  pointInsidePoly,
} from "./hull_geom.js";
import { wardById, wardPoly, wardCentroid } from "./core_set.js";
import { buildHullModel } from "./hull_model.js";

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

    const r = clippedSafeRadiusToPoly(centre, dir, legacyPoly);

    if (!(Number.isFinite(r) && r > 0)) {
      return { ok: false, reason: "failed_safe_inner_radial_profile", sampleIndex: i };
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
    const lowerBound = capInnerSupportLowerBound(lowerDilated[i], upperBound);

    // The smoothed profile is also clipped to the safe first-exit radius.
    // This keeps every radial sample inside the legacy inner hull.
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

export function buildOptimisedInnerHullModel({
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

