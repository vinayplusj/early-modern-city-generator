// docs/src/geom/radial_ray_clamp.js
//
// Deterministic ray + radial clamp helpers extracted from:
// - docs/src/model/stages/110_warp_field.js
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// 76a52f64e7453b38960f4bff2a7255f2f7f2c8a3f6d6c1b0d3e2a2b39f5b6a32

/**
 * Ray–segment intersection in 2D.
 * Ray: o + t*d, t >= 0
 * Segment: a + u*(b-a), u in [0,1]
 * Returns t (ray distance scalar) or null.
 *
 * @param {{x:number,y:number}} o
 * @param {{x:number,y:number}} d
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @param {number} [eps]
 * @returns {number|null}
 */
export function raySegmentT(o, d, a, b, eps = 1e-9) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;

  // Solve o + t d = a + u v
  const det = d.x * (-vy) - d.y * (-vx); // det([d, -v])
  if (Math.abs(det) < eps) return null; // parallel or nearly

  const ax = a.x - o.x;
  const ay = a.y - o.y;

  const t = (ax * (-vy) - ay * (-vx)) / det;
  const u = (d.x * ay - d.y * ax) / det;

  if (t < 0) return null;
  if (u < -eps || u > 1 + eps) return null;

  return t;
}

/**
 * Farthest intersection distance along a ray from centre in direction dir.
 * This is the correct boundary radius for "inside polygon" constraints when centre is inside.
 *
 * @param {{x:number,y:number}} centre
 * @param {{x:number,y:number}} dir
 * @param {Array<{x:number,y:number}>} poly
 * @returns {number|null}
 */
export function rayPolyMaxT(centre, dir, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;

  let tMax = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;

    const t = raySegmentT(centre, dir, a, b);
    if (t == null) continue;

    if (tMax == null || t > tMax) tMax = t;
  }

  return tMax;
}

/**
 * @param {number} vx
 * @param {number} vy
 * @returns {{x:number,y:number,m:number}|null}
 */
export function safeNorm(vx, vy) {
  const m = Math.hypot(vx, vy);
  if (m < 1e-12) return null;
  return { x: vx / m, y: vy / m, m };
}

/**
 * Clamp a single point so it is OUTSIDE innerPoly along its ray from centre.
 * If point is inside (radius smaller than boundary), it is pushed outward to boundary + margin.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>} innerPoly
 * @param {number} margin
 * @returns {{x:number,y:number}}
 */
export function clampPointOutsideAlongRay(p, centre, innerPoly, margin) {
  const n = safeNorm(p.x - centre.x, p.y - centre.y);
  if (!n) return p;

  const tBoundary = rayPolyMaxT(centre, { x: n.x, y: n.y }, innerPoly);
  if (!Number.isFinite(tBoundary)) return p;

  const rMin = tBoundary + margin;
  if (n.m >= rMin) return p;

  return { x: centre.x + n.x * rMin, y: centre.y + n.y * rMin };
}

/**
 * Clamp a single point so it is INSIDE outerPoly along its ray from centre.
 * If point is outside (radius larger than boundary), it is pulled inward to boundary - margin.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>} outerPoly
 * @param {number} margin
 * @returns {{x:number,y:number}}
 */
export function clampPointInsideAlongRay(p, centre, outerPoly, margin) {
  const n = safeNorm(p.x - centre.x, p.y - centre.y);
  if (!n) return p;

  const tBoundary = rayPolyMaxT(centre, { x: n.x, y: n.y }, outerPoly);
  if (!Number.isFinite(tBoundary)) return p;

  const rMax = Math.max(0, tBoundary - margin);
  if (n.m <= rMax) return p;

  return { x: centre.x + n.x * rMax, y: centre.y + n.y * rMax };
}

/**
 * @param {Array<{x:number,y:number}>} poly
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>} innerPoly
 * @param {number} margin
 * @returns {Array<{x:number,y:number}>}
 */
export function clampPolylineOutsidePolyAlongRays(poly, centre, innerPoly, margin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;
  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out[i] = (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      ? clampPointOutsideAlongRay(p, centre, innerPoly, margin)
      : p;
  }
  return out;
}

/**
 * @param {Array<{x:number,y:number}>} poly
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>} outerPoly
 * @param {number} margin
 * @returns {Array<{x:number,y:number}>}
 */
export function clampPolylineInsidePolyAlongRays(poly, centre, outerPoly, margin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;
  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out[i] = (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      ? clampPointInsideAlongRay(p, centre, outerPoly, margin)
      : p;
  }
  return out;
}
