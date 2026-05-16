// docs/src/model/hull/citadel_fit.js
// Citadel fitting inside the visible Citadel ward, inner hull, and plaza-clearance domain.

import {
  safeArray,
  isPoint,
  polygonCentroidSafe,
  pointInsidePoly,
  polygonAbsArea,
  allPointsInsidePolys,
  polygonInsideAllPolys,
  pointDistanceToPolyBoundary,
  pointDistanceToPolygonSamples,
  polygonClearOfPoint,
  scalePolyToward,
  clamp,
  cross2,
  dedupePoints,
  alignWinding,
} from "./hull_geom.js";
import { wardById, wardPoly } from "./core_set.js";

function buildCitadelWardFitDomain(citadelWardPoly, innerHullPoly) {
  if (!Array.isArray(citadelWardPoly) || citadelWardPoly.length < 3) {
    return {
      poly: citadelWardPoly,
      mode: "raw_ward_unavailable",
      scale: 1,
      centre: null,
    };
  }

  const wardCentre = polygonCentroidSafe(citadelWardPoly);
  if (!isPoint(wardCentre)) {
    return {
      poly: citadelWardPoly,
      mode: "raw_ward_no_centroid",
      scale: 1,
      centre: null,
    };
  }

  // Try a conservative inward radial shrink. This is not a true polygon offset,
  // but it is deterministic and safe because each candidate is validated against
  // both the visible Citadel ward and the accepted inner hull before use.
  const scales = [0.82, 0.76, 0.70, 0.64, 0.58];

  for (const scale of scales) {
    const candidate = scalePolyToward(citadelWardPoly, wardCentre, scale);

    if (
      Array.isArray(candidate) &&
      candidate.length >= 3 &&
      polygonInsideAllPolys(candidate, [citadelWardPoly]) &&
      (
        !Array.isArray(innerHullPoly) ||
        innerHullPoly.length < 3 ||
        polygonInsideAllPolys(candidate, [innerHullPoly])
      )
    ) {
      return {
        poly: alignWinding(candidate, citadelWardPoly),
        mode: "shrunk_visible_citadel_ward",
        scale,
        centre: wardCentre,
      };
    }
  }

  return {
    poly: citadelWardPoly,
    mode: "raw_ward_fallback",
    scale: 1,
    centre: wardCentre,
  };
}

function deriveCitadelPlazaClearance({ citadelWardPoly, innerHullPoly, anchors }) {
  if (!isPoint(anchors?.plaza)) return 0;

  const wardArea = polygonAbsArea(citadelWardPoly);
  const innerArea = polygonAbsArea(innerHullPoly);

  const wardScale = wardArea > 0 ? Math.sqrt(wardArea) : 0;
  const innerScale = innerArea > 0 ? Math.sqrt(innerArea) : 0;

  const fromWard = wardScale > 0 ? wardScale * 0.18 : 0;
  const fromInner = innerScale > 0 ? innerScale * 0.055 : 0;

  const clearance = Math.max(8, Math.min(
    fromWard || Infinity,
    fromInner || Infinity
  ));

  return Number.isFinite(clearance) && clearance > 0 ? clearance : 8;
}

function pointHasPlazaClearance(p, plaza, clearance) {
  if (!isPoint(plaza)) return true;
  if (!isPoint(p)) return false;
  const c = Number.isFinite(clearance) && clearance > 0 ? clearance : 0;
  return Math.hypot(p.x - plaza.x, p.y - plaza.y) >= c;
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

  // Preferred candidates are interior-like points only. Boundary samples are
  // intentionally not used as fit centres because they can make the citadel sit
  // on or across the visible ward edge.
  push(wardC, "citadel_ward_fit_domain_centroid");
  push(anchor, "anchors.citadel");
  push(citC, "legacy_citadel_centroid");

  if (isPoint(anchor) && isPoint(wardC)) {
    for (const t of [0.25, 0.5, 0.75]) {
      push({
        x: anchor.x * (1 - t) + wardC.x * t,
        y: anchor.y * (1 - t) + wardC.y * t,
      }, `anchor_to_fit_domain_centroid_${t}`);
    }
  }

  return out;
}

function chooseCitadelFitCentre({
  anchors,
  citadel,
  citadelWardPoly,
  innerHullPoly,
  plazaClearance,
}) {
  const domains = [citadelWardPoly, innerHullPoly].filter((p) => Array.isArray(p) && p.length >= 3);
  const candidates = candidateFitCentres({ anchors, citadel, citadelWardPoly, innerHullPoly });
  const anchor = anchors?.citadel ?? null;
  const plaza = anchors?.plaza ?? null;
  const wardC = polygonCentroidSafe(citadelWardPoly);

  let best = null;

  for (const c of candidates) {
    if (!allPointsInsidePolys([c], domains)) continue;
    if (!pointHasPlazaClearance(c, plaza, plazaClearance * 0.75)) continue;

    const anchorDist = isPoint(anchor) ? Math.hypot(c.x - anchor.x, c.y - anchor.y) : 0;
    const wardDist = isPoint(wardC) ? Math.hypot(c.x - wardC.x, c.y - wardC.y) : 0;
    const plazaPenalty = isPoint(plaza)
      ? Math.max(0, plazaClearance - Math.hypot(c.x - plaza.x, c.y - plaza.y)) * 10
      : 0;

    const boundaryClearance = pointDistanceToPolyBoundary(c, citadelWardPoly);
    const boundaryReward = Number.isFinite(boundaryClearance)
      ? -Math.min(boundaryClearance, plazaClearance) * 0.15
      : 0;

    const score =
      anchorDist * 0.35 +
      wardDist * 0.45 +
      plazaPenalty +
      boundaryReward;

    if (!best || score < best.score) {
      best = {
        point: { x: c.x, y: c.y },
        source: c.source,
        score,
        boundaryClearance,
      };
    }
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

  if (!Array.isArray(citadelWardPoly) || citadelWardPoly.length < 3) {
    return { ok: false, reason: "missing_visible_citadel_ward_poly" };
  }

  const plazaClearance = deriveCitadelPlazaClearance({
    citadelWardPoly,
    innerHullPoly,
    anchors,
  });

  const fitDomain = buildCitadelWardFitDomain(citadelWardPoly, innerHullPoly);
  const wardFitPoly = fitDomain.poly;

  const domains = [wardFitPoly, innerHullPoly].filter((p) => Array.isArray(p) && p.length >= 3);
  const proofDomains = [citadelWardPoly, innerHullPoly].filter((p) => Array.isArray(p) && p.length >= 3);

  if (domains.length === 0) {
    return { ok: false, reason: "missing_fit_domain" };
  }

  const fromCentre = polygonCentroidSafe(citadel);
  if (!isPoint(fromCentre)) {
    return { ok: false, reason: "missing_citadel_centroid" };
  }

  const centreChoice = chooseCitadelFitCentre({
    anchors,
    citadel,
    citadelWardPoly: wardFitPoly,
    innerHullPoly,
    plazaClearance,
  });

  if (!centreChoice || !isPoint(centreChoice.point)) {
    return {
      ok: false,
      reason: "no_valid_fit_centre",
      plazaClearance,
      fitDomainMode: fitDomain.mode,
    };
  }

  const maxScale = maxUniformScaleInside({
    poly: citadel,
    fromCentre,
    toCentre: centreChoice.point,
    domains,
  });

  if (!(Number.isFinite(maxScale) && maxScale > 1e-6)) {
    return {
      ok: false,
      reason: "no_positive_uniform_scale",
      centreSource: centreChoice.source,
      plazaClearance,
      fitDomainMode: fitDomain.mode,
    };
  }

  let best = null;

  for (const edgePull of [0.45, 0.32, 0.2, 0.1, 0]) {
    const candidate = buildRadialCitadelCandidate({
      poly: citadel,
      fromCentre,
      toCentre: centreChoice.point,
      domains,
      uniformScale: maxScale,
      edgePull,
    });

    if (!polygonInsideAllPolys(candidate, domains)) continue;
    if (!polygonInsideAllPolys(candidate, proofDomains)) continue;
    if (!polygonClearOfPoint(candidate, anchors?.plaza, plazaClearance)) continue;

    const area = polygonAbsArea(candidate);
    if (!best || area > best.area || (area === best.area && edgePull > best.edgePull)) {
      best = {
        poly: candidate,
        area,
        edgePull,
        mode: "radial_ward_fit",
      };
    }
  }

  if (!best) {
    // Deterministic fallback: shrink around the selected fit centre until the
    // citadel fits the visible ward domain and clears the plaza.
    for (const factor of [0.82, 0.74, 0.66, 0.58, 0.50, 0.42, 0.34]) {
      const uniform = transformPolyUniform(citadel, fromCentre, centreChoice.point, maxScale * factor);
      const candidate = alignWinding(uniform, citadel);

      if (!polygonInsideAllPolys(candidate, domains)) continue;
      if (!polygonInsideAllPolys(candidate, proofDomains)) continue;
      if (!polygonClearOfPoint(candidate, anchors?.plaza, plazaClearance)) continue;

      best = {
        poly: candidate,
        area: polygonAbsArea(candidate),
        edgePull: 0,
        mode: "uniform_visible_ward_fit",
        fallbackFactor: factor,
      };
      break;
    }
  }

  if (!best || !Array.isArray(best.poly) || best.poly.length < 3) {
    return {
      ok: false,
      reason: "no_valid_fitted_polygon",
      centreSource: centreChoice.source,
      plazaClearance,
      fitDomainMode: fitDomain.mode,
      fitDomainScale: fitDomain.scale,
    };
  }

  return {
    ok: true,
    poly: best.poly,
    centre: centreChoice.point,
    centreSource: centreChoice.source,
    maxUniformScale: maxScale,
    edgePull: best.edgePull,
    area: best.area,
    fitMode: best.mode,
    plazaClearance,
    clearOfPlaza: polygonClearOfPoint(best.poly, anchors?.plaza, plazaClearance),
    fitDomainMode: fitDomain.mode,
    fitDomainScale: fitDomain.scale,
    fitDomainPointCount: Array.isArray(wardFitPoly) ? wardFitPoly.length : 0,
  };
}

export function buildCitadelFit({ citadel, wardsState, coreSet, innerHullModel, anchors }) {
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

  const plazaClearance = fitted.plazaClearance ?? deriveCitadelPlazaClearance({
    citadelWardPoly,
    innerHullPoly,
    anchors,
  });

  const clearOfPlaza = polygonClearOfPoint(poly, anchors?.plaza, plazaClearance);

  return {
    poly,
    originalPoly,
    wardId: coreSet.citadelWardId ?? null,
    fitMode: fitted.ok ? (fitted.fitMode ?? "radial_ward_fit") : "legacy_fallback",
    insideCitadelWard,
    insideInnerHull,
    centroidInsideCitadelWard,
    centroidInsideInnerHull,
    clearOfPlaza,
    plazaClearance,
    diagnostics: {
      attempted: true,
      accepted: !!fitted.ok,
      reason: fitted.ok ? "accepted" : fitted.reason,
      centre: fitted.centre ?? null,
      centreSource: fitted.centreSource ?? null,
      maxUniformScale: fitted.maxUniformScale ?? null,
      edgePull: fitted.edgePull ?? null,
      fitDomainMode: fitted.fitDomainMode ?? null,
      fitDomainScale: fitted.fitDomainScale ?? null,
      fitDomainPointCount: fitted.fitDomainPointCount ?? null,
      originalArea: polygonAbsArea(originalPoly),
      fittedArea: polygonAbsArea(poly),
      citadelWardPointCount: Array.isArray(citadelWardPoly) ? citadelWardPoly.length : 0,
      innerHullPointCount: Array.isArray(innerHullPoly) ? innerHullPoly.length : 0,
      plazaClearance,
      clearOfPlaza,
      plazaDistanceToCitadel: isPoint(anchors?.plaza)
        ? pointDistanceToPolygonSamples(anchors.plaza, poly)
        : null,
    },
  };
}
