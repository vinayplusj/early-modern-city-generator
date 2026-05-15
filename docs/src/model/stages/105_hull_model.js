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
// Step 3B: improve geometry one contract at a time.
// This version upgrades the INNER hull, OUTER hull, and CITADEL FIT.
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
// - Citadel fit now generates a fitted radial polygon and publishes it back to ctx.state.citadel.
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

function polygonAbsArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  const a = signedArea(poly);
  return Number.isFinite(a) ? Math.abs(a) : 0;
}

function edgeSampledPoints(poly, samplesPerEdge = 2) {
  const out = [];
  if (!Array.isArray(poly) || poly.length === 0) return out;

  const steps = Math.max(1, samplesPerEdge | 0);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    out.push(a);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({
        x: a.x * (1 - t) + b.x * t,
        y: a.y * (1 - t) + b.y * t,
      });
    }
  }

  return out;
}

function allPointsInsidePolys(points, polys) {
  for (const p of safeArray(points)) {
    if (!isPoint(p)) return false;
    for (const poly of safeArray(polys)) {
      if (Array.isArray(poly) && poly.length >= 3 && !pointInsidePoly(poly, p)) return false;
    }
  }
  return true;
}

function polygonInsideAllPolys(poly, polys) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  return allPointsInsidePolys(edgeSampledPoints(poly, 3), polys);
}

function transformPolyUniform(poly, fromCentre, toCentre, scale) {
  if (!Array.isArray(poly) || !isPoint(fromCentre) || !isPoint(toCentre) || !Number.isFinite(scale)) return null;
  return poly.map((p) => ({
    x: toCentre.x + (p.x - fromCentre.x) * scale,
    y: toCentre.y + (p.y - fromCentre.y) * scale,
  }));
}

function rayMinRadiusToPoly(centre, dir, poly) {
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

    if (t > eps && u >= -eps && u <= 1 + eps) {
      if (bestT == null || t < bestT) bestT = t;
    }
  }

  return bestT;
}

function minBoundaryRadiusForDir(centre, dir, polys) {
  let best = null;
  for (const poly of safeArray(polys)) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const r = rayMinRadiusToPoly(centre, dir, poly);
    if (Number.isFinite(r) && r > 0) {
      best = best == null ? r : Math.min(best, r);
    }
  }
  return best;
}

function candidateFitCentres({ anchors, citadel, citadelWardPoly, innerHullPoly }) {
  const out = [];
  const push = (p, source) => {
    if (!isPoint(p)) return;
    if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)) return;
    out.push({ ...p, source });
  };

  const wardC = polygonCentroidSafe(citadelWardPoly);
  const citC = polygonCentroidSafe(citadel);
  const anchor = anchors?.citadel ?? null;

  push(anchor, "anchors.citadel");
  push(wardC, "citadel_ward_centroid");
  push(citC, "legacy_citadel_centroid");

  if (isPoint(anchor) && isPoint(wardC)) {
    for (const t of [0.25, 0.5, 0.75]) {
      push({
        x: anchor.x * (1 - t) + wardC.x * t,
        y: anchor.y * (1 - t) + wardC.y * t,
      }, `anchor_to_ward_centroid_${t}`);
    }
  }

  for (const p of samplePolyline(citadelWardPoly, 16)) push(p, "citadel_ward_boundary_sample");
  for (const p of samplePolyline(innerHullPoly, 16)) push(p, "inner_hull_boundary_sample");

  return out;
}

function chooseCitadelFitCentre({ anchors, citadel, citadelWardPoly, innerHullPoly }) {
  const domains = [citadelWardPoly, innerHullPoly].filter((p) => Array.isArray(p) && p.length >= 3);
  const candidates = candidateFitCentres({ anchors, citadel, citadelWardPoly, innerHullPoly });
  const anchor = anchors?.citadel ?? null;

  let best = null;
  for (const c of candidates) {
    if (!allPointsInsidePolys([c], domains)) continue;

    const anchorDist = isPoint(anchor) ? Math.hypot(c.x - anchor.x, c.y - anchor.y) : 0;
    const wardC = polygonCentroidSafe(citadelWardPoly);
    const wardDist = isPoint(wardC) ? Math.hypot(c.x - wardC.x, c.y - wardC.y) : 0;
    const score = anchorDist * 0.55 + wardDist * 0.45;

    if (!best || score < best.score) best = { point: c, source: c.source, score };
  }

  return best;
}

function maxUniformScaleInside({ poly, fromCentre, toCentre, domains }) {
  if (!Array.isArray(poly) || poly.length < 3 || !isPoint(fromCentre) || !isPoint(toCentre)) return null;
  if (!allPointsInsidePolys([toCentre], domains)) return null;

  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const test = transformPolyUniform(poly, fromCentre, toCentre, hi);
    if (!polygonInsideAllPolys(test, domains)) break;
    hi *= 1.5;
    if (hi > 8) break;
  }

  let lo = 0;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    const test = transformPolyUniform(poly, fromCentre, toCentre, mid);
    if (polygonInsideAllPolys(test, domains)) lo = mid;
    else hi = mid;
  }

  return lo;
}

function buildRadialCitadelCandidate({ poly, fromCentre, toCentre, domains, uniformScale, edgePull }) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  if (!isPoint(fromCentre) || !isPoint(toCentre)) return null;
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) return null;

  const pull = clamp(edgePull, 0, 1);
  const out = [];
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const p = poly[i];
    if (!isPoint(p)) return null;

    let dx = p.x - fromCentre.x;
    let dy = p.y - fromCentre.y;
    let r = Math.hypot(dx, dy);

    if (!(Number.isFinite(r) && r > 1e-9)) {
      const t = (i / Math.max(1, n)) * Math.PI * 2;
      dx = Math.cos(t);
      dy = Math.sin(t);
      r = 1;
    }

    const dir = { x: dx / r, y: dy / r };
    const boundaryR = minBoundaryRadiusForDir(toCentre, dir, domains);
    if (!(Number.isFinite(boundaryR) && boundaryR > 1e-9)) return null;

    const baseR = r * uniformScale * 0.88;
    const maxR = boundaryR * 0.86;
    const targetR = baseR * (1 - pull) + maxR * pull;
    const finalR = Math.min(maxR, targetR);

    out.push({
      x: toCentre.x + dir.x * finalR,
      y: toCentre.y + dir.y * finalR,
    });
  }

  return alignWinding(dedupePoints(out, 1e-6), poly);
}

function buildFittedCitadelPolygon({ citadel, anchors, citadelWardPoly, innerHullPoly }) {
  if (!Array.isArray(citadel) || citadel.length < 3) {
    return { ok: false, reason: "missing_citadel_poly" };
  }

  const domains = [citadelWardPoly, innerHullPoly].filter((p) => Array.isArray(p) && p.length >= 3);
  if (domains.length === 0) {
    return { ok: false, reason: "missing_fit_domain" };
  }

  const fromCentre = polygonCentroidSafe(citadel);
  if (!isPoint(fromCentre)) {
    return { ok: false, reason: "missing_citadel_centroid" };
  }

  const centreChoice = chooseCitadelFitCentre({ anchors, citadel, citadelWardPoly, innerHullPoly });
  if (!centreChoice || !isPoint(centreChoice.point)) {
    return { ok: false, reason: "no_valid_fit_centre" };
  }

  const maxScale = maxUniformScaleInside({
    poly: citadel,
    fromCentre,
    toCentre: centreChoice.point,
    domains,
  });

  if (!(Number.isFinite(maxScale) && maxScale > 1e-6)) {
    return { ok: false, reason: "no_positive_uniform_scale", centreSource: centreChoice.source };
  }

  let best = null;
  for (const edgePull of [0.55, 0.4, 0.25, 0.1, 0]) {
    const candidate = buildRadialCitadelCandidate({
      poly: citadel,
      fromCentre,
      toCentre: centreChoice.point,
      domains,
      uniformScale: maxScale,
      edgePull,
    });

    if (!polygonInsideAllPolys(candidate, domains)) continue;

    const area = polygonAbsArea(candidate);
    if (!best || area > best.area || (area === best.area && edgePull > best.edgePull)) {
      best = { poly: candidate, area, edgePull };
    }
  }

  if (!best) {
    const fallbackScale = maxScale * 0.86;
    const uniform = transformPolyUniform(citadel, fromCentre, centreChoice.point, fallbackScale);
    if (polygonInsideAllPolys(uniform, domains)) {
      best = { poly: alignWinding(uniform, citadel), area: polygonAbsArea(uniform), edgePull: 0 };
    }
  }

  if (!best || !Array.isArray(best.poly) || best.poly.length < 3) {
    return { ok: false, reason: "no_valid_fitted_polygon", centreSource: centreChoice.source };
  }

  return {
    ok: true,
    poly: best.poly,
    centre: centreChoice.point,
    centreSource: centreChoice.source,
    maxUniformScale: maxScale,
    edgePull: best.edgePull,
    area: best.area,
  };
}

function buildCitadelFit({ citadel, wardsState, coreSet, innerHullModel, anchors }) {
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);
  const citadelWard = wardById(wardsWithRoles, coreSet.citadelWardId);
  const citadelWardPoly = wardPoly(citadelWard);
  const innerHullPoly = innerHullModel?.poly ?? null;

  const originalPoly = Array.isArray(citadel) ? citadel : null;
  const fitted = buildFittedCitadelPolygon({
    citadel: originalPoly,
    anchors,
    citadelWardPoly,
    innerHullPoly,
  });

  const poly = fitted.ok ? fitted.poly : originalPoly;
  const pts = safeArray(poly);

  let insideCitadelWard = null;
  let insideInnerHull = null;
  let centroidInsideCitadelWard = null;
  let centroidInsideInnerHull = null;

  if (pts.length >= 3) {
    insideCitadelWard =
      Array.isArray(citadelWardPoly) && citadelWardPoly.length >= 3
        ? polygonInsideAllPolys(poly, [citadelWardPoly])
        : null;

    insideInnerHull =
      Array.isArray(innerHullPoly) && innerHullPoly.length >= 3
        ? polygonInsideAllPolys(poly, [innerHullPoly])
        : null;

    const c = polygonCentroidSafe(poly);
    centroidInsideCitadelWard =
      c && Array.isArray(citadelWardPoly) && citadelWardPoly.length >= 3
        ? pointInsidePoly(citadelWardPoly, c)
        : null;

    centroidInsideInnerHull =
      c && Array.isArray(innerHullPoly) && innerHullPoly.length >= 3
        ? pointInsidePoly(innerHullPoly, c)
        : null;
  }

  return {
    poly,
    originalPoly,
    wardId: coreSet.citadelWardId ?? null,
    fitMode: fitted.ok ? "radial_ward_fit" : "legacy_fallback",
    insideCitadelWard,
    insideInnerHull,
    centroidInsideCitadelWard,
    centroidInsideInnerHull,
    diagnostics: {
      attempted: true,
      accepted: !!fitted.ok,
      reason: fitted.ok ? "accepted" : fitted.reason,
      centre: fitted.centre ?? null,
      centreSource: fitted.centreSource ?? null,
      maxUniformScale: fitted.maxUniformScale ?? null,
      edgePull: fitted.edgePull ?? null,
      originalArea: polygonAbsArea(originalPoly),
      fittedArea: polygonAbsArea(poly),
      citadelWardPointCount: Array.isArray(citadelWardPoly) ? citadelWardPoly.length : 0,
      innerHullPointCount: Array.isArray(innerHullPoly) ? innerHullPoly.length : 0,
    },
  };
}

function dist2PointToSeg(p, a, b) {
  if (!isPoint(p) || !isPoint(a) || !isPoint(b)) return Infinity;

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;

  if (ab2 <= 1e-12) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }

  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const qx = a.x + abx * t;
  const qy = a.y + aby * t;
  const dx = p.x - qx;
  const dy = p.y - qy;
  return dx * dx + dy * dy;
}

function coastSideToDir(side) {
  if (side === 0) return { x: -1, y: 0 };
  if (side === 1) return { x: 1, y: 0 };
  if (side === 2) return { x: 0, y: -1 };
  if (side === 3) return { x: 0, y: 1 };
  return null;
}

function unitDirOrNull(v) {
  if (!isPoint(v)) return null;
  const m = Math.hypot(v.x, v.y);
  if (!(Number.isFinite(m) && m > 1e-9)) return null;
  return { x: v.x / m, y: v.y / m };
}

function inferCoastDir({ waterIntent, waterModel, centre }) {
  const fromIntentDir = unitDirOrNull(waterIntent?.dir);
  if (fromIntentDir) return { dir: fromIntentDir, source: "waterIntent.dir" };

  const fromIntentSide = coastSideToDir(waterIntent?.side);
  if (fromIntentSide) return { dir: fromIntentSide, source: "waterIntent.side" };

  if (isPoint(waterModel?.bankPoint) && isPoint(centre)) {
    const dir = unitDirOrNull({
      x: waterModel.bankPoint.x - centre.x,
      y: waterModel.bankPoint.y - centre.y,
    });
    if (dir) return { dir, source: "waterModel.bankPoint" };
  }

  return { dir: null, source: "unavailable" };
}

function nearestBoundaryVertexIndex(poly, point) {
  if (!Array.isArray(poly) || poly.length === 0 || !isPoint(point)) return -1;

  let bestI = -1;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!isPoint(p)) continue;
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && i < bestI)) {
      bestD2 = d2;
      bestI = i;
    }
  }

  return bestI;
}

function nearestBoundaryEdgeIndex(poly, point) {
  if (!Array.isArray(poly) || poly.length < 2 || !isPoint(point)) return -1;

  let bestI = -1;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d2 = dist2PointToSeg(point, a, b);
    if (d2 < bestD2 || (d2 === bestD2 && i < bestI)) {
      bestD2 = d2;
      bestI = i;
    }
  }

  return bestI;
}

function supportBoundaryVertexIndex(poly, centre, dir) {
  if (!Array.isArray(poly) || poly.length === 0 || !isPoint(centre) || !isPoint(dir)) return -1;

  let bestI = -1;
  let bestProj = -Infinity;

  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!isPoint(p)) continue;
    const proj = (p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y;
    if (proj > bestProj || (proj === bestProj && i < bestI)) {
      bestProj = proj;
      bestI = i;
    }
  }

  return bestI;
}

function projectionRange(poly, centre, dir) {
  let min = Infinity;
  let max = -Infinity;

  for (const p of safeArray(poly)) {
    if (!isPoint(p)) continue;
    const v = (p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max, span: Math.max(0, max - min) };
}

function cyclicSegmentIndices(poly, centre, dir, seedIndex) {
  const n = Array.isArray(poly) ? poly.length : 0;
  if (n < 2 || !isPoint(centre) || !isPoint(dir) || seedIndex < 0) return [];

  const range = projectionRange(poly, centre, dir);
  if (!range || range.span <= 1e-9) {
    return [wrapIndex(seedIndex - 1, n), seedIndex, wrapIndex(seedIndex + 1, n)];
  }

  const threshold = range.max - range.span * 0.22;
  const passes = (idx) => {
    const p = poly[wrapIndex(idx, n)];
    if (!isPoint(p)) return false;
    const v = (p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y;
    return v >= threshold;
  };

  let left = seedIndex;
  let right = seedIndex;
  let guard = 0;

  while (guard++ < n && passes(left - 1)) left = wrapIndex(left - 1, n);
  guard = 0;
  while (guard++ < n && passes(right + 1)) right = wrapIndex(right + 1, n);

  const out = [];
  let i = left;
  guard = 0;
  while (guard++ <= n) {
    out.push(i);
    if (i === right) break;
    i = wrapIndex(i + 1, n);
  }

  if (out.length >= Math.ceil(n * 0.75)) {
    return [wrapIndex(seedIndex - 1, n), seedIndex, wrapIndex(seedIndex + 1, n)];
  }

  if (out.length < 2) {
    return [wrapIndex(seedIndex - 1, n), seedIndex, wrapIndex(seedIndex + 1, n)];
  }

  return out;
}

function boundaryCurveFromIndices(poly, indices) {
  const out = [];
  for (const idx of safeArray(indices)) {
    const p = poly[wrapIndex(idx, poly.length)];
    if (isPoint(p)) out.push({ x: p.x, y: p.y });
  }
  return dedupePoints(out, 1e-6);
}

function buildOuterBoundaryCoastCurve({ outerBoundary, waterModel, waterIntent, centre }) {
  if (!Array.isArray(outerBoundary) || outerBoundary.length < 3) {
    return { ok: false, reason: "missing_outer_boundary" };
  }

  const dirInfo = inferCoastDir({ waterIntent, waterModel, centre });
  let seedIndex = -1;
  let seedSource = null;

  if (dirInfo.dir) {
    seedIndex = supportBoundaryVertexIndex(outerBoundary, centre, dirInfo.dir);
    seedSource = dirInfo.source;
  }

  if (seedIndex < 0 && isPoint(waterModel?.bankPoint)) {
    seedIndex = nearestBoundaryVertexIndex(outerBoundary, waterModel.bankPoint);
    seedSource = "nearest_boundary_vertex_to_bankPoint";
  }

  if (seedIndex < 0 && Array.isArray(waterModel?.shoreline) && waterModel.shoreline.length >= 2) {
    const mid = polygonCentroidSafe(waterModel.shoreline);
    seedIndex = nearestBoundaryVertexIndex(outerBoundary, mid);
    seedSource = "nearest_boundary_vertex_to_shoreline";
  }

  if (seedIndex < 0) {
    return { ok: false, reason: "no_coast_seed_on_outer_boundary" };
  }

  let indices = dirInfo.dir
    ? cyclicSegmentIndices(outerBoundary, centre, dirInfo.dir, seedIndex)
    : [];

  if (indices.length < 2 && isPoint(waterModel?.bankPoint)) {
    const edgeIndex = nearestBoundaryEdgeIndex(outerBoundary, waterModel.bankPoint);
    if (edgeIndex >= 0) indices = [edgeIndex, wrapIndex(edgeIndex + 1, outerBoundary.length)];
  }

  if (indices.length < 2) {
    indices = [wrapIndex(seedIndex - 1, outerBoundary.length), seedIndex, wrapIndex(seedIndex + 1, outerBoundary.length)];
  }

  const curve = boundaryCurveFromIndices(outerBoundary, indices);
  if (!Array.isArray(curve) || curve.length < 2) {
    return { ok: false, reason: "coast_curve_too_short" };
  }

  return {
    ok: true,
    curve,
    boundaryVertexIndices: indices,
    seedIndex,
    seedSource,
    dir: dirInfo.dir,
    dirSource: dirInfo.source,
  };
}

function buildCoastGeometry({ waterModel, outerBoundary, waterIntent, cx, cy }) {
  if (!waterModel || waterModel.kind !== "coast") return null;

  const centre = Number.isFinite(cx) && Number.isFinite(cy) ? { x: cx, y: cy } : null;
  const boundaryCurve = buildOuterBoundaryCoastCurve({
    outerBoundary,
    waterModel,
    waterIntent,
    centre,
  });

  const fallbackCurve =
    Array.isArray(waterModel.shoreline) && waterModel.shoreline.length >= 2
      ? waterModel.shoreline
      : (Array.isArray(waterModel.coastline) && waterModel.coastline.length >= 2
          ? waterModel.coastline
          : null);

  const curve = boundaryCurve.ok ? boundaryCurve.curve : fallbackCurve;

  return {
    kind: "coast_curve",
    curve,
    bankPoint: waterModel.bankPoint ?? null,
    boundaryVertexIndices: boundaryCurve.ok ? boundaryCurve.boundaryVertexIndices : [],
    source: boundaryCurve.ok ? "outerBoundary_seaward_segment" : "waterModel_fallback_curve",
    fitMode: boundaryCurve.ok ? "outer_boundary_neighbour_curve" : "water_model_curve_fallback",
    diagnostics: {
      attempted: true,
      accepted: !!boundaryCurve.ok,
      reason: boundaryCurve.ok ? "accepted" : boundaryCurve.reason,
      neighboursOuterBoundary: !!boundaryCurve.ok,
      curveLiesOnOuterBoundary: !!boundaryCurve.ok,
      intersectsOuterBoundaryAsPolygon: false,
      isPolygon: false,
      seedIndex: boundaryCurve.seedIndex ?? null,
      seedSource: boundaryCurve.seedSource ?? null,
      dir: boundaryCurve.dir ?? null,
      dirSource: boundaryCurve.dirSource ?? null,
      curvePointCount: Array.isArray(curve) ? curve.length : 0,
      outerBoundaryPointCount: Array.isArray(outerBoundary) ? outerBoundary.length : 0,
      legacyShorelinePointCount: Array.isArray(waterModel.shoreline) ? waterModel.shoreline.length : 0,
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
    newTownHint,
  });

  const radii = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const theta = i * step;
    const theta0 = newTownHint?.dir ? Math.atan2(newTownHint.dir.y, newTownHint.dir.x) : null;
    const lobeDelta = theta0 == null ? Math.PI : Math.abs(normaliseAngleDelta(theta - theta0));
    const lobeHalfWidth = Math.PI / 4.5;
    const lobeW = theta0 == null || lobeDelta > lobeHalfWidth ? 0 : 1 - lobeDelta / lobeHalfWidth;

    const lowerBound = Math.max(lowerDilated[i], lobeFloor[i]);
    const targetBase = upperSmooth[i];
    const target = targetBase * (1 - 0.65 * lobeW) + upper[i] * (0.65 * lobeW);

    radii[i] = clamp(target, lowerBound, upper[i]);
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
      supportPointCount: safeArray(radialSupportPoints).length,
      requiredPointCount: safeArray(requiredInsidePoints).length,
      hasNewTownLobe: !!newTownHint?.dir,
      objective: "ring1_plus_new_town_lobes_inside_legacy",
    },
  };
}

function buildOptimisedOuterHullModel({
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

  const legacyInnerHullModel = buildHullModel(
    "innerHull",
    fortHulls.innerHull,
    coreSet.coreIdsForHull,
    coreSet.coreWardIds,
    { objective: { mode: "legacy_core_union_outer_loop" } }
  );

  // First pass: build outer hull against the legacy inner hull.
  // The accepted inner hull then uses this outer constraint.
  const outerHullModelPass1 = buildOptimisedOuterHullModel({
    ctx,
    cx,
    cy,
    wardsState,
    coreSet,
    legacyHull: fortHulls.outerHull,
    innerHullModel: legacyInnerHullModel,
  });

  const innerHullModel = buildOptimisedInnerHullModel({
    cx,
    cy,
    wardsState,
    anchors,
    citadel,
    coreSet,
    legacyHull: fortHulls.innerHull,
    outerHullModel: outerHullModelPass1,
  });

  // Second pass: rebuild the outer hull against the accepted inner hull.
  // This ensures the final outer model is tested against the final inner model,
  // not only the legacy inner shape.
  const outerHullModel = buildOptimisedOuterHullModel({
    ctx,
    cx,
    cy,
    wardsState,
    coreSet,
    legacyHull: fortHulls.outerHull,
    innerHullModel,
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
    anchors,
  });

  if (Array.isArray(citadelFit?.poly) && citadelFit.poly.length >= 3) {
    ctx.state.citadel = citadelFit.poly;
  }

  const coastGeometry = buildCoastGeometry({
    waterModel,
    outerBoundary: ctx.state.outerBoundary ?? null,
    waterIntent: ctx.state.waterIntent ?? null,
    cx,
    cy,
  });

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
