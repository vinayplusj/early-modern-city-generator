// docs/src/geom/radial_midband_clamp.js
//
// Clamp points to a radial mid-band (between inner and outer polygon radii) along rays from centre.
// Extracted from: docs/src/model/stages/110_warp_field.js

import { rayPolyMaxT, safeNorm } from "./radial_ray_clamp.js";

export function clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, t, innerMargin, midMargin) {
  const n = safeNorm(p.x - centre.x, p.y - centre.y);
  if (!n) return p;

  const dir = { x: n.x, y: n.y };

  const rIn = rayPolyMaxT(centre, dir, innerPoly);
  const rOut = rayPolyMaxT(centre, dir, outerPoly);
  if (!Number.isFinite(rIn) || !Number.isFinite(rOut)) return p;
  if (rOut <= rIn + 1e-6) return p;

  // Minimum radius: keep outside inner hull.
  const rMin = rIn + (innerMargin || 0);

  // Midway radius between inner and outer hulls.
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.3));
  const rMid = rIn + tt * (rOut - rIn);

  // Maximum radius: stay inside the midway curve (minus margin), but never below rMin.
  const rMax = Math.max(rMin, rMid - (midMargin || 0));

  if (n.m < rMin) return { x: centre.x + n.x * rMin, y: centre.y + n.y * rMin };
  if (n.m > rMax) return { x: centre.x + n.x * rMax, y: centre.y + n.y * rMax };
  return p;
}

export function clampPolylineToMidBandAlongRays(poly, centre, innerPoly, outerPoly, t, innerMargin, midMargin) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;
  if (!Array.isArray(innerPoly) || innerPoly.length < 3) return poly;
  if (!Array.isArray(outerPoly) || outerPoly.length < 3) return poly;

  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out[i] = (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      ? clampPointToMidBandAlongRay(p, centre, innerPoly, outerPoly, t, innerMargin, midMargin)
      : p;
  }
  return out;
}
