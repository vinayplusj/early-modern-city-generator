// docs/src/model/generate_helpers/warpfield_slots.js
//
// Helpers for selecting warpfield sample/maxima indices on a circular domain.
// Pure, deterministic utilities (no RNG).
//
// Exports:
// - nearestSampleIndex
// - circDist
// - nearestMaximaIndex

/**
 * Return the index of the point in pts closest to p (Euclidean distance).
 * @param {Array<{x:number,y:number}>} pts
 * @param {{x:number,y:number}} p
 * @returns {number} index in [0, pts.length-1], or -1 if invalid
 */
export function nearestSampleIndex(pts, p) {
  if (!Array.isArray(pts) || pts.length === 0 || !p) return -1;

  let bestI = 0;
  let bestD2 = Infinity;

  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (!q) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
    }
  }
  return bestI;
}

/**
 * Circular distance between sample indices aS and bS on a ring of length L.
 * @param {number} aS
 * @param {number} bS
 * @param {number} L
 * @returns {number} minimal wrapped distance (>=0)
 */
export function circDist(aS, bS, L) {
  if (!Number.isFinite(L) || L <= 0) return Infinity;
  const a = ((aS % L) + L) % L;
  const b = ((bS % L) + L) % L;
  const d = Math.abs(a - b);
  return Math.min(d, L - d);
}

/**
 * Find the index into maxima[] whose s (sample index) is nearest to s0 on a ring.
 * maxima entries may be objects with .s, or numbers directly representing s.
 *
 * @param {Array<any>} maxima
 * @param {number} s0
 * @param {number} L
 * @returns {number} index into maxima[], or -1 if invalid
 */
export function nearestMaximaIndex(maxima, s0, L) {
  if (!Array.isArray(maxima) || maxima.length === 0) return -1;

  let bestI = 0;
  let bestD = Infinity;

  for (let i = 0; i < maxima.length; i++) {
    const m = maxima[i];
    const s = (m && typeof m === "object" && Number.isFinite(m.s)) ? m.s : m;
    if (!Number.isFinite(s)) continue;

    const d = circDist(s, s0, L);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }

  return bestI;
}
