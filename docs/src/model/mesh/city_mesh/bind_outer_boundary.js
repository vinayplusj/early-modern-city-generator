// docs/src/model/mesh/city_mesh/bind_outer_boundary.js
//
// Option 1 binding: reuse existing outerBoundary polygon for geometry,
// and bind it to a specific CityMesh boundary loop for topology references.
//
// Output: boundaryBinding
// {
//   loopId: number,
//   halfEdgeIds: number[],
//   polygon: Array<{x,y}>,
//   metrics: { areaAbsOuter:number, areaAbsLoop:number, centroidDist:number }
// }

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function polygonAreaSigned(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return 0.5 * s;
}

function polygonAreaAbs(points) {
  return Math.abs(polygonAreaSigned(points));
}

function polygonCentroid(points) {
  const a = polygonAreaSigned(points);
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of points) { sx += p.x; sy += p.y; }
    const n = points.length || 1;
    return { x: sx / n, y: sy / n };
  }

  let cx = 0;
  let cy = 0;
  let fsum = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    fsum += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }

  const inv = 1 / (3 * fsum);
  return { x: cx * inv, y: cy * inv };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * @param {object} args
 * @param {object} args.cityMesh
 * @param {Array<{x:number,y:number}>} args.outerBoundary
 */
export function bindOuterBoundaryToCityMesh({ cityMesh, outerBoundary }) {
  assert(cityMesh && typeof cityMesh === "object", "[EMCG][bindOuterBoundary] cityMesh is required.");
  assert(Array.isArray(cityMesh.boundaryLoops), "[EMCG][bindOuterBoundary] cityMesh.boundaryLoops must be an array.");
  assert(Array.isArray(outerBoundary) && outerBoundary.length >= 3, "[EMCG][bindOuterBoundary] outerBoundary must be a polygon.");
  assert(outerBoundary.every(isFinitePoint), "[EMCG][bindOuterBoundary] outerBoundary has invalid points.");

  const areaOuter = polygonAreaAbs(outerBoundary);
  const ctrOuter = polygonCentroid(outerBoundary);

  let best = null;

  for (const loop of cityMesh.boundaryLoops) {
    if (!loop || typeof loop !== "object") continue;
    if (!Number.isInteger(loop.id)) continue;
    if (!Array.isArray(loop.halfEdges) || loop.halfEdges.length < 3) continue;
    if (!Array.isArray(loop.polygon) || loop.polygon.length < 3) continue;

    const areaLoop = Number.isFinite(loop.areaAbs) ? loop.areaAbs : polygonAreaAbs(loop.polygon);
    const ctrLoop = loop.centroid && isFinitePoint(loop.centroid) ? loop.centroid : polygonCentroid(loop.polygon);

    const areaDiff = Math.abs(areaLoop - areaOuter);
    const ctrDist = dist(ctrLoop, ctrOuter);

    const cand = {
      loopId: loop.id,
      halfEdgeIds: loop.halfEdges.slice(),
      polygon: loop.polygon.slice(),
      metrics: { areaAbsOuter: areaOuter, areaAbsLoop: areaLoop, centroidDist: ctrDist },
      score: { areaDiff, ctrDist },
    };

    if (!best) {
      best = cand;
      continue;
    }

    // Deterministic selection:
    // 1) minimal areaDiff
    // 2) minimal centroidDist
    // 3) minimal loopId
    if (cand.score.areaDiff < best.score.areaDiff - 1e-9) {
      best = cand;
      continue;
    }
    if (Math.abs(cand.score.areaDiff - best.score.areaDiff) <= 1e-9) {
      if (cand.score.ctrDist < best.score.ctrDist - 1e-9) {
        best = cand;
        continue;
      }
      if (Math.abs(cand.score.ctrDist - best.score.ctrDist) <= 1e-9 && cand.loopId < best.loopId) {
        best = cand;
      }
    }
  }

  if (!best) {
    throw new Error("[EMCG][bindOuterBoundary] No suitable CityMesh boundary loop found to bind outerBoundary.");
  }

  return {
    loopId: best.loopId,
    halfEdgeIds: best.halfEdgeIds,
    polygon: best.polygon,
    metrics: best.metrics,
  };
}
