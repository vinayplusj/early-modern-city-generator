// src/geom/nearest.js
// Nearest-point helpers used for snapping roads to rings.
// Quarantined on 23 feb 2026

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }

export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const ab2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / ab2, 0, 1);
  return add(a, mul(ab, t));
}

// Note: treats poly as a closed loop (wraps last -> first), matching your earlier code.
export function closestPointOnPolyline(p, poly) {
  if (!poly || poly.length < 2) return null;

  let best = null;
  let bestD = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestPointOnSegment(p, a, b);
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }

  return best;
}
