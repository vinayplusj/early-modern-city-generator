import { clamp, add, sub, mul, dist, lerp } from "./primitives.js";

export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;

  if (Math.abs(a) < 1e-6) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  cx /= (6 * a);
  cy /= (6 * a);
  return { x: cx, y: cy };
}

export function offsetRadial(poly, cx, cy, offset) {
  return poly.map(p => {
    const v = { x: p.x - cx, y: p.y - cy };
    const l = Math.hypot(v.x, v.y) || 1;
    const ux = v.x / l, uy = v.y / l;
    return { x: p.x + ux * offset, y: p.y + uy * offset };
  });
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const intersect =
      ((a.y > pt.y) !== (b.y > pt.y)) &&
      (pt.x < (b.x - a.x) * (pt.y - a.y) / ((b.y - a.y) || 1e-9) + a.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointOnSeg(p, a, b, eps = 1e-6) {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > eps) return false;

  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;

  const len2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (dot - len2 > eps) return false;

  return true;
}

export function pointInPolyOrOn(pt, poly, eps = 1e-6) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (pointOnSeg(pt, a, b, eps)) return true;
  }
  return pointInPoly(pt, poly);
}

export function segIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSeg = (p, q, r) =>
    Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
    Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;

  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;

  if (Math.abs(d1) < 1e-9 && onSeg(a, c, b)) return true;
  if (Math.abs(d2) < 1e-9 && onSeg(a, d, b)) return true;
  if (Math.abs(d3) < 1e-9 && onSeg(c, a, d)) return true;
  if (Math.abs(d4) < 1e-9 && onSeg(c, b, d)) return true;

  return false;
}

export function polyIntersectsPoly(A, B) {
  if (!A || !B || A.length < 3 || B.length < 3) return false;

  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      if (segIntersect(a1, a2, b1, b2)) return true;
    }
  }

  if (pointInPolyOrOn(A[0], B)) return true;
  if (pointInPolyOrOn(B[0], A)) return true;

  return false;
}

export function polyIntersectsPolyBuffered(A, B, eps = 1.5) {
  if (polyIntersectsPoly(A, B)) return true;
  for (const p of A) if (pointInPolyOrOn(p, B, eps)) return true;
  for (const p of B) if (pointInPolyOrOn(p, A, eps)) return true;
  return false;
}

export function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (pts.length <= 2) return pts;

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const ab2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / ab2, 0, 1);
  return add(a, mul(ab, t));
}

export function closestPointOnPolyline(p, poly) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestPointOnSegment(p, a, b);
    const d = dist(p, q);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}
