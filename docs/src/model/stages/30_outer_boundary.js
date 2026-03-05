// docs/src/model/stages/30_outer_boundary.js
//
// Stage 30: Overall boundary (outer boundary).
// Extracted from generate.js without functional changes.

/**
 * @param {Array<{x:number,y:number}>} footprint
 * @param {object|null} newTown
 * @returns {Array<{x:number,y:number}>} outerBoundary
 */
function _signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function _dedupeConsecutive(poly, eps = 1e-6) {
  if (!Array.isArray(poly) || poly.length < 2) return poly || [];
  const out = [];
  let prev = null;
  const eps2 = eps * eps;

  for (const p of poly) {
    if (!p) continue;
    if (!prev) {
      out.push({ x: p.x, y: p.y });
      prev = p;
      continue;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (dx * dx + dy * dy > eps2) {
      out.push({ x: p.x, y: p.y });
      prev = p;
    }
  }

  // Also check last vs first to avoid a duplicate closing point.
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy <= eps2) out.pop();
  }

  return out;
}

function _ensureCCW(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return poly || [];
  if (_signedArea(poly) < 0) {
    const rev = poly.slice().reverse();
    return rev;
  }
  return poly;
}
export function runOuterBoundaryStage(footprint, newTown) {
  // Milestone deferral: New Town must not affect the city outer boundary.
  // Keep the parameter for now to avoid re-threading call sites.
  void newTown;

  // Use the (already angle-ordered) footprint ring directly.
  // This preserves corridor-based stretching, instead of replacing it with a convex hull.
  let outerBoundary = _dedupeConsecutive(footprint, 1e-6);
  outerBoundary = _ensureCCW(outerBoundary);

  return outerBoundary;
}
