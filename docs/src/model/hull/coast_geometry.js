// docs/src/model/hull/coast_geometry.js
// Coast-as-neighbour-curve model for Stage 105.

import {
  safeArray,
  isPoint,
  polygonCentroidSafe,
  dist2PointToSeg,
  wrapIndex,
  dedupePoints,
} from "./hull_geom.js";

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

export function buildCoastGeometry({ waterModel, outerBoundary, waterIntent, cx, cy }) {
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