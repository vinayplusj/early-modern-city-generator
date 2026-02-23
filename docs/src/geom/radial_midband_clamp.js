// docs/src/geom/radial_midband_clamp.js
//
// Clamp points to a radial mid-band (between inner and outer polygon radii) along rays from centre.
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// 1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708

import { rayPolyMaxT, safeNorm } from "./radial_ray_clamp.js";

/**
 * Clamp a single point p onto the radial band:
 *   r in [rInner + margin, rOuter - margin]
 * where rInner is the ray intersection radius with innerPoly (if provided),
 * and rOuter is the ray intersection radius with outerPoly (if provided).
 *
 * If either polygon is missing or does not intersect on the ray, that side is ignored.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>|null} innerPoly
 * @param {Array<{x:number,y:number}>|null} outerPoly
 * @param {number} margin
 * @returns {{x:number,y:number}}
 */
export function clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, margin) {
  const n = safeNorm(p.x - centre.x, p.y - centre.y);
  if (!n) return p;

  let rMin = -Infinity;
  let rMax = Infinity;

  if (innerPoly) {
    const tInner = rayPolyMaxT(centre, { x: n.x, y: n.y }, innerPoly);
    if (Number.isFinite(tInner)) rMin = tInner + margin;
  }

  if (outerPoly) {
    const tOuter = rayPolyMaxT(centre, { x: n.x, y: n.y }, outerPoly);
    if (Number.isFinite(tOuter)) rMax = tOuter - margin;
  }

  // If constraints are invalid or inverted, do nothing.
  if (!(Number.isFinite(rMin) || Number.isFinite(rMax))) return p;
  if (rMin > rMax) return p;

  const r = n.m;

  if (r < rMin) return { x: centre.x + n.x * rMin, y: centre.y + n.y * rMin };
  if (r > rMax) return { x: centre.x + n.x * rMax, y: centre.y + n.y * rMax };

  return p;
}

/**
 * Clamp all points of a polyline into the mid-band along rays from centre.
 *
 * @param {Array<{x:number,y:number}>} poly
 * @param {{x:number,y:number}} centre
 * @param {Array<{x:number,y:number}>|null} innerPoly
 * @param {Array<{x:number,y:number}>|null} outerPoly
 * @param {number} margin
 * @returns {Array<{x:number,y:number}>}
 */
export function clampPolylineToMidBandAlongRays(poly, centre, innerPoly, outerPoly, margin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;

  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out[i] = (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      ? clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, margin)
      : p;
  }
  return out;
}
