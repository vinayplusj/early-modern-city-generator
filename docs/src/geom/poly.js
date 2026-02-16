import { add, sub, mul, dist, lerp, clamp, vec, safeNormalize } from "./primitives.js";

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

function offsetRadial(poly, cx, cy, offset) {
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

export function supportPoint(poly, dir) {
  if (!Array.isArray(poly) || poly.length < 1) return null;

  let best = poly[0];
  let bestDot = best.x * dir.x + best.y * dir.y;

  for (let i = 1; i < poly.length; i++) {
    const p = poly[i];
    const d = p.x * dir.x + p.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      best = p;
    }
  }
  return best;
}

export function snapPointToPolyline(p, line) {
  if (!p || !Array.isArray(line) || line.length < 2) return p;

  let best = line[0];
  let bestD2 = Infinity;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;

    const ab2 = abx * abx + aby * aby;
    let t = 0;
    if (ab2 > 1e-12) {
      t = (apx * abx + apy * aby) / ab2;
      t = Math.max(0, Math.min(1, t));
    }

    const cxp = a.x + abx * t;
    const cyp = a.y + aby * t;

    const dx = p.x - cxp;
    const dy = p.y - cyp;
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2) {
      bestD2 = d2;
      best = { x: cxp, y: cyp };
    }
  }

  return best;
}

// Deterministic “pull point into polygon” by stepping toward `toward`
export function pushInsidePoly(p, poly, toward, step = 4, iters = 60) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return p;

  let q = p;
  const dir = safeNormalize(vec(q, toward));

  for (let i = 0; i < iters; i++) {
    if (pointInPolyOrOn(q, poly, 1e-6)) return q;
    q = add(q, mul(dir, step));
  }
  return q;
}

// Deterministic “push point out of polygon” by stepping away from `awayFrom`
export function pushOutsidePoly(p, poly, awayFrom, step = 4, iters = 80) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return p;

  let q = p;
  const dir = safeNormalize(vec(awayFrom, q)); // move away from centre

  for (let i = 0; i < iters; i++) {
    if (!pointInPolyOrOn(q, poly, 1e-6)) return q;
    q = add(q, mul(dir, step));
  }
  return q;
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

function polyIntersectsPolyBuffered(A, B, eps = 1.5) {
  if (polyIntersectsPoly(A, B)) return true;
  for (const p of A) if (pointInPolyOrOn(p, B, eps)) return true;
  for (const p of B) if (pointInPolyOrOn(p, A, eps)) return true;
  return false;
}

function convexHull(points) {
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
