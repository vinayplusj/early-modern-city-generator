// docs/src/model/generate_helpers/bastion_geom.js
//
// Bastion-specific geometry helpers.
// Keep these separate from general polygon helpers to avoid leaking
// fortification-specific assumptions into generic geom modules.

/**
 * Compute a simple centroid for a bastion polygon.
 * Uses the arithmetic mean of vertices (stable for small convex-ish polygons).
 *
 * @param {Array<{x:number,y:number}>} poly
 * @returns {{x:number,y:number}} centroid point (0,0 if invalid)
 */
export function bastionCentroid(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return { x: 0, y: 0 };

  let sx = 0;
  let sy = 0;
  let n = 0;

  for (const p of poly) {
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }

  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}
