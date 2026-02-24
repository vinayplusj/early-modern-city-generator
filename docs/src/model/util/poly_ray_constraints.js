// docs/src/model/util/poly_ray_constraints.js
//
// Polygon ray constraints.
// Extracted from docs/src/model/warp.js to thin that file (no behaviour change).
//
// Notes:
// - All angles are in radians.
// - Polylines / polygons are arrays of { x, y } objects.
// - "poly" is assumed to be a closed polygon ring (first point does not need to repeat).
//
// This file is intentionally small and deterministic.

import { pointInPolyOrOn } from "../../geom/poly.js";

/**
 * Push a point that must be inside (or on) a polygon back inside along a ray.
 *
 * If p is already inside, it is returned unchanged.
 * If the ray does not hit the polygon, returns the original p (caller can decide what to do).
 *
 * @param {{x:number,y:number}} centre
 * @param {{x:number,y:number}} p
 * @param {Array<{x:number,y:number}>} poly
 * @param {number} theta Ray direction angle
 * @param {number} pad Distance to keep inside after projection
 * @returns {{x:number,y:number}}
 */
export function enforceInsidePolyAlongRay(centre, p, poly, theta, pad = 0) {
  if (pointInPolyOrOn(p, poly)) return p;

  const hitR = sampleRadiusAtAngle(centre, theta, poly);
  if (hitR == null || !Number.isFinite(hitR)) return p;

  const dx = Math.cos(theta);
  const dy = Math.sin(theta);

  const targetR = Math.max(0, hitR - pad);
  return { x: centre.x + dx * targetR, y: centre.y + dy * targetR };
}

/**
 * Push a point that must be outside (or on) a polygon back outside along a ray.
 *
 * If p is already outside, it is returned unchanged.
 * If the ray does not hit the polygon, returns the original p.
 *
 * @param {{x:number,y:number}} centre
 * @param {{x:number,y:number}} p
 * @param {Array<{x:number,y:number}>} poly
 * @param {number} theta Ray direction angle
 * @param {number} pad Distance to keep outside after projection
 * @returns {{x:number,y:number}}
 */
export function enforceOutsidePolyAlongRay(centre, p, poly, theta, pad = 0) {
  if (!pointInPolyOrOn(p, poly)) return p;

  const hitR = sampleRadiusAtAngle(centre, theta, poly);
  if (hitR == null || !Number.isFinite(hitR)) return p;

  const dx = Math.cos(theta);
  const dy = Math.sin(theta);

  const targetR = Math.max(0, hitR + pad);
  return { x: centre.x + dx * targetR, y: centre.y + dy * targetR };
}

/* ------------------ private helpers ------------------ */

function sampleRadiusAtAngle(centre, theta, poly) {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);

  let bestT = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    const t = raySegHit(centre.x, centre.y, dx, dy, a.x, a.y, b.x, b.y);
    if (t != null && t > 0 && t < bestT) bestT = t;
  }

  if (!Number.isFinite(bestT) || bestT === Infinity) return null;
  return bestT;
}

// Ray: P + t * D, t >= 0
// Segment: A + u * (B - A), u in [0, 1]
//
// Returns t (distance along ray direction) if intersects, else null.
function raySegHit(px, py, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;

  const det = dx * (-sy) - dy * (-sx);
  if (Math.abs(det) < 1e-12) return null; // parallel or near-parallel

  const rx = ax - px;
  const ry = ay - py;

  const invDet = 1 / det;

  // Solve:
  // px + t*dx = ax + u*sx
  // py + t*dy = ay + u*sy
  const t = (rx * (-sy) - ry * (-sx)) * invDet;
  const u = (dx * ry - dy * rx) * invDet;

  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}
