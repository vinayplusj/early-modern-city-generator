// docs/src/model/hull/outer_hull_refine.js
// Deterministic outer-hull refinement.

import {
  safeArray,
  isPoint,
  samplePolyline,
  dedupePoints,
  angleOf,
  distTo,
  wrapIndex,
  dilateCyclicMax,
  smoothUpperProfile,
  clamp,
  alignWinding,
  pointInsidePoly,
  chooseAngularSampleCount,
  rayMaxRadiusToPoly,
} from "./hull_geom.js";
import { wardById, wardPoly, wardCentroid } from "./core_set.js";
import { buildHullModel } from "./hull_model.js";

function normaliseAngleDelta(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function resolveNewTownDirection(ctx, centre) {
  const nt = ctx?.state?.newTown?.newTown ?? null;
  const primaryGate = ctx?.state?.primaryGate ?? ctx?.state?.newTown?.primaryGate ?? null;

  let dir = nt?.orientation?.out ?? null;
  if (!isPoint(dir) && isPoint(primaryGate) && isPoint(centre)) {
    const dx = primaryGate.x - centre.x;
    const dy = primaryGate.y - centre.y;
    const m = Math.hypot(dx, dy);
    if (m > 1e-9) dir = { x: dx / m, y: dy / m };
  }

  if (!isPoint(dir)) return null;
  const m = Math.hypot(dir.x, dir.y);
  if (!(Number.isFinite(m) && m > 1e-9)) return null;

  return {
    dir: { x: dir.x / m, y: dir.y / m },
    primaryGate: isPoint(primaryGate) ? primaryGate : null,
  };
}

function collectOuterSupport({
  wardsState,
  coreSet,
  innerHullModel,
  newTownHint,
}) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);

  const radialSupportPoints = [];
  const requiredInsidePoints = [];

  for (const wid of safeArray(coreSet.outerIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    if (!w) continue;

    const c = wardCentroid(w);
    if (isPoint(c)) {
      radialSupportPoints.push(c);
      requiredInsidePoints.push(c);
    }

    const poly = wardPoly(w);
    for (const p of samplePolyline(poly, 16)) {
      if (isPoint(p)) radialSupportPoints.push(p);
    }
  }

  for (const p of samplePolyline(innerHullModel?.poly, 48)) {
    if (isPoint(p)) requiredInsidePoints.push(p);
  }

  if (newTownHint?.primaryGate) {
    radialSupportPoints.push(newTownHint.primaryGate);
    requiredInsidePoints.push(newTownHint.primaryGate);
  }

  return {
    radialSupportPoints: dedupePoints(radialSupportPoints),
    requiredInsidePoints: dedupePoints(requiredInsidePoints),
  };
}

function buildOuterLobeFloor({ upper, step, newTownHint }) {
  const n = upper.length;
  const out = new Array(n).fill(0);

  if (!newTownHint?.dir) return out;

  const theta0 = Math.atan2(newTownHint.dir.y, newTownHint.dir.x);
  const halfWidth = Math.PI / 4.5;

  for (let i = 0; i < n; i++) {
    const theta = i * step;
    const d = Math.abs(normaliseAngleDelta(theta - theta0));
    if (d > halfWidth) continue;

    const w = 1 - d / halfWidth;
    const keep = 0.92 + 0.06 * w;
    out[i] = upper[i] * keep;
  }

  return out;
}

function canonicalAngle01(p, centre) {
  const a = angleOf(p, centre);
  const t = a < 0 ? a + Math.PI * 2 : a;
  return t;
}

function stablePointKey(p, precision = 1000) {
  return `${Math.round(p.x * precision)}:${Math.round(p.y * precision)}`;
}

function uniqueHardPoints(points) {
  const out = [];
  const seen = new Set();

  for (const p of safeArray(points)) {
    if (!isPoint(p)) continue;

    const key = stablePointKey(p, 1000);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(p);
  }

  return out;
}

function requiredPointInsideLegacyOuter(p, legacyPoly) {
  return isPoint(p) && pointInsidePoly(legacyPoly, p);
}

function buildOuterCandidateVerticesWithHardPoints({
  centre,
  radii,
  step,
  legacyPoly,
  requiredInsidePoints,
}) {
  const vertices = [];

  for (let i = 0; i < radii.length; i++) {
    const t = i * step;
    vertices.push({
      p: {
        x: centre.x + Math.cos(t) * radii[i],
        y: centre.y + Math.sin(t) * radii[i],
      },
      theta: t,
      kind: "radial_sample",
      index: i,
    });
  }

  const hardPoints = uniqueHardPoints(requiredInsidePoints)
    .filter((p) => requiredPointInsideLegacyOuter(p, legacyPoly))
    .map((p, i) => ({
      p,
      theta: canonicalAngle01(p, centre),
      kind: "required_point",
      index: i,
    }));

  vertices.push(...hardPoints);

  vertices.sort((a, b) => {
    if (a.theta !== b.theta) return a.theta - b.theta;

    // Deterministic tie-break:
    // required points come after the radial sample at the same angle,
    // so the radial outline remains the main scaffold.
    if (a.kind !== b.kind) {
      if (a.kind === "radial_sample") return -1;
      if (b.kind === "radial_sample") return 1;
    }

    return a.index - b.index;
  });

  const points = dedupePoints(vertices.map(v => v.p), 1e-5);

  return {
    points,
    hardPointCount: hardPoints.length,
  };
}

function expandOuterRadiiForRequiredPoints({
  centre,
  upper,
  lowerDilated,
  lobeFloor,
  requiredInsidePoints,
  step,
}) {
  const n = upper.length;
  const hardLower = new Array(n);

  for (let i = 0; i < n; i++) {
    hardLower[i] = Math.max(lowerDilated[i] || 0, lobeFloor[i] || 0);
  }

  for (const p of safeArray(requiredInsidePoints)) {
    if (!isPoint(p)) continue;

    const theta = canonicalAngle01(p, centre);
    const radius = distTo(p, centre);

    if (!(Number.isFinite(radius) && radius > 0)) continue;

    const floatIndex = theta / step;
    const i0 = wrapIndex(Math.floor(floatIndex), n);
    const i1 = wrapIndex(i0 + 1, n);
    const i2 = wrapIndex(i0 - 1, n);

    // Direct bin support.
    hardLower[i0] = Math.max(hardLower[i0], radius);
    hardLower[i1] = Math.max(hardLower[i1], radius);

    // Neighbour support reduces the chance that the polygon chord cuts behind
    // the required point. Required points are also inserted as hard vertices
    // later, so this is an additional stabiliser, not the only guarantee.
    hardLower[i2] = Math.max(hardLower[i2], radius * 0.92);

    // Never force a lower bound beyond the safe legacy upper bound.
    hardLower[i0] = Math.min(hardLower[i0], upper[i0] * 0.995);
    hardLower[i1] = Math.min(hardLower[i1], upper[i1] * 0.995);
    hardLower[i2] = Math.min(hardLower[i2], upper[i2] * 0.995);
  }

  return hardLower;
}

function buildRefinedOuterHullCandidate({
  centre,
  legacyPoly,
  innerPoly,
  radialSupportPoints,
  requiredInsidePoints,
  newTownHint,
}) {
  if (!isPoint(centre)) {
    return { ok: false, reason: "missing_centre" };
  }
  if (!Array.isArray(legacyPoly) || legacyPoly.length < 3) {
    return { ok: false, reason: "missing_legacy_poly" };
  }
  if (!pointInsidePoly(legacyPoly, centre)) {
    return { ok: false, reason: "centre_outside_legacy_outer_hull" };
  }

  const sampleCount = chooseAngularSampleCount(legacyPoly);
  const step = (Math.PI * 2) / sampleCount;

  const upper = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i * step;
    const dir = { x: Math.cos(t), y: Math.sin(t) };
    const r = rayMaxRadiusToPoly(centre, dir, legacyPoly);
    if (!(Number.isFinite(r) && r > 0)) {
      return { ok: false, reason: "failed_legacy_outer_profile", sampleIndex: i };
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
  const lobeFloor = buildOuterLobeFloor({
    upper,
    step,
    centre,
    newTownHint,
  });

  const hardLower = expandOuterRadiiForRequiredPoints({
    centre,
    upper,
    lowerDilated,
    lobeFloor,
    requiredInsidePoints,
    step,
  });

  const radii = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const theta = i * step;
    const theta0 = newTownHint?.dir ? Math.atan2(newTownHint.dir.y, newTownHint.dir.x) : null;
    const lobeDelta = theta0 == null ? Math.PI : Math.abs(normaliseAngleDelta(theta - theta0));
    const lobeHalfWidth = Math.PI / 4.5;
    const lobeW = theta0 == null || lobeDelta > lobeHalfWidth ? 0 : 1 - lobeDelta / lobeHalfWidth;

    const lowerBound = hardLower[i];
    const targetBase = upperSmooth[i];
    const target = targetBase * (1 - 0.65 * lobeW) + upper[i] * (0.65 * lobeW);

    radii[i] = clamp(target, lowerBound, upper[i]);
  }

  const vertexBuild = buildOuterCandidateVerticesWithHardPoints({
    centre,
    radii,
    step,
    legacyPoly,
    requiredInsidePoints,
  });

  let poly = vertexBuild.points;
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
      return { ok: false, reason: "candidate_leaves_legacy_outer_hull" };
    }
  }

  if (Array.isArray(innerPoly) && innerPoly.length >= 3) {
    for (const p of samplePolyline(innerPoly, 64)) {
      if (!pointInsidePoly(poly, p)) {
        return { ok: false, reason: "candidate_excludes_inner_hull_sample" };
      }
    }
  }

  return {
    ok: true,
    poly,
    meta: {
      sampleCount,
      hardPointCount: vertexBuild.hardPointCount,
      supportPointCount: safeArray(radialSupportPoints).length,
      requiredPointCount: safeArray(requiredInsidePoints).length,
      hasNewTownLobe: !!newTownHint?.dir,
      objective: "ring1_plus_new_town_lobes_inside_legacy",
      constraintMode: "required_points_as_hard_vertices",
    },
  };
}

export function buildOptimisedOuterHullModel({
  ctx,
  cx,
  cy,
  wardsState,
  coreSet,
  legacyHull,
  innerHullModel,
}) {
  const legacyModel = buildHullModel(
    "outerHull",
    legacyHull,
    coreSet.outerIdsForHull,
    coreSet.coreWardIds.concat(coreSet.ring1WardIds),
    {
      closureMode:
        legacyHull?._forcedSingleLoop ? "forced_single_outer_loop" : "normal",
      objective: { mode: "legacy_core_plus_ring1_outer_loop" },
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
  const newTownHint = resolveNewTownDirection(ctx, centre);
  const support = collectOuterSupport({
    wardsState,
    coreSet,
    innerHullModel,
    newTownHint,
  });

  const candidate = buildRefinedOuterHullCandidate({
    centre,
    legacyPoly,
    innerPoly: innerHullModel?.poly ?? null,
    radialSupportPoints: support.radialSupportPoints,
    requiredInsidePoints: support.requiredInsidePoints,
    newTownHint,
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
          hasNewTownLobe: !!newTownHint?.dir,
        },
      },
    };
  }

  const refinedPoly = candidate.poly;

  return {
    kind: "outerHull",
    poly: refinedPoly,
    loops: [refinedPoly],
    holeCount: 0,
    memberWardIds: safeArray(coreSet.outerIdsForHull),
    sourceWardIds: safeArray(coreSet.coreWardIds).concat(safeArray(coreSet.ring1WardIds)),
    warnings: safeArray(legacyHull?.warnings),
    closureMode:
      legacyHull?._forcedSingleLoop ? "forced_single_outer_loop" : "normal",
    objective: {
      mode: "ring1_plus_new_town_lobes_inside_legacy",
      source: "legacy_outer_hull + outer_member_support + new_town_direction",
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