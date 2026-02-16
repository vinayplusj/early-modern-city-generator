// docs/src/geom/intersections.js
//
// Milestone 3.4 geometry: segment intersections + helpers.
// Focus: robust "proper" intersections for splitting road segments.
// Collinear overlaps are intentionally treated as "no proper intersection" for stability.

import { clamp } from "./primitives.js";

// ---------- Vector helpers ----------
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(a, s) {
  return { x: a.x * s, y: a.y * s };
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function snapKey(x, y, eps) {
  return `${Math.round(x / eps)}|${Math.round(y / eps)}`;
}

export function samePoint(a, b, eps) {
  return dist2(a, b) <= eps * eps;
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

// ---------- Ray vs segment intersection ----------
//
// Ray: O + t * D, with t >= 0 (D should be unit length for "t" to be distance)
// Segment: A + u * (B - A), with u in [0,1]
//
// Returns:
//  { type: "hit", tRay, uSeg, p }  or  { type: "none" | "parallel" | "collinear" }
//
// Notes:
// - Collinear overlaps intentionally return "collinear" and are treated as no hit by callers.
// - Endpoint hits are allowed (caller can exclude if needed).
export function raySegmentIntersection(O, D, A, B, eps = 1e-9) {
  const r = D;          // ray direction
  const s = sub(B, A);  // segment direction

  const rxs = cross2(r, s);
  const q_p = sub(A, O);
  const qpxr = cross2(q_p, r);

  // Parallel
  if (Math.abs(rxs) < eps) {
    if (Math.abs(qpxr) < eps) {
      return { type: "collinear" };
    }
    return { type: "parallel" };
  }

  // Solve O + t r = A + u s
  const t = cross2(q_p, s) / rxs; // along ray
  const u = cross2(q_p, r) / rxs; // along segment

  if (t < -eps) return { type: "none" };
  if (u < -eps || u > 1 + eps) return { type: "none" };

  const p = add(O, mul(r, t));
  return { type: "hit", tRay: t, uSeg: clamp(u, 0, 1), p };
}

// ---------- Segment intersection ----------
//
// Returns a rich result:
//  {
//    type: "proper" | "touch" | "collinear" | "parallel" | "none",
//    p?: {x,y},
//    t?: number, // along AB
//    u?: number, // along CD
//  }
//
// "proper": strict crossing inside both segments (not endpoints)
// "touch": intersection at an endpoint (often not desired for splitting)
// "collinear": collinear overlap (not handled in Milestone 3.4 splitting)
// "parallel": parallel non-collinear
export function segmentIntersection(a, b, c, d, eps = 1e-9) {
  const r = sub(b, a);
  const s = sub(d, c);

  const rxs = cross2(r, s);
  const q_p = sub(c, a);
  const qpxr = cross2(q_p, r);

  // Parallel
  if (Math.abs(rxs) < eps) {
    if (Math.abs(qpxr) < eps) {
      // Collinear
      return { type: "collinear" };
    }
    return { type: "parallel" };
  }

  const t = cross2(q_p, s) / rxs;
  const u = cross2(q_p, r) / rxs;

  // Outside bounds
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) {
    return { type: "none" };
  }

  const p = add(a, mul(r, t));

  const onEndpoint =
    (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps);

  if (onEndpoint) {
    return { type: "touch", p, t: clamp(t, 0, 1), u: clamp(u, 0, 1) };
  }

  return { type: "proper", p, t, u };
}

// Convenience: only return proper intersection point (excluding endpoint touches)
export function segmentProperIntersectionPoint(a, b, c, d, eps = 1e-9) {
  const hit = segmentIntersection(a, b, c, d, eps);
  if (hit.type !== "proper") return null;
  return hit; // {type:"proper", p, t, u}
}

// ---------- Segment splitting utilities ----------
//
// Given a segment AB and a list of parameters t in (0,1),
// return an array of points [A, ..., B] including split points,
// sorted and uniqued.
export function buildSplitPointsOnSegment(a, b, ts, tol = 1e-6) {
  if (!ts || ts.length === 0) return [a, b];

  const sorted = ts.slice().sort((x, y) => x - y);

  const uniq = [];
  for (const t of sorted) {
    if (t <= tol || t >= 1 - tol) continue;
    if (uniq.length === 0 || Math.abs(t - uniq[uniq.length - 1]) > tol) {
      uniq.push(t);
    }
  }

  const pts = [a];
  for (const t of uniq) pts.push(lerpPoint(a, b, t));
  pts.push(b);
  return pts;
}

// Snap a point to a canonical representative by bucket.
// Useful to prevent float noise creating multiple nearly-identical nodes.
export function makePointSnapper(eps = 2.0) {
  const canonical = new Map(); // key -> point

  function snapPoint(p) {
    const k = snapKey(p.x, p.y, eps);
    const existing = canonical.get(k);
    if (existing) return existing;
    canonical.set(k, p);
    return p;
  }

  return snapPoint;
}

// Split an array of 2-point segments at proper intersections.
//
// Input segments: [{ a, b, ...meta }]
// Output segments: same meta, but split into smaller segments.
// Any new interior endpoints are considered junctions by the caller.
export function splitSegmentsAtProperIntersections(segments, eps = 2.0) {
  if (!segments || segments.length <= 1) return segments || [];

  const splits = new Array(segments.length);
  for (let i = 0; i < splits.length; i++) splits[i] = [];

  // Pairwise proper intersections
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j];

      // Do not split when sharing endpoints
      if (
        samePoint(si.a, sj.a, eps) ||
        samePoint(si.a, sj.b, eps) ||
        samePoint(si.b, sj.a, eps) ||
        samePoint(si.b, sj.b, eps)
      ) {
        continue;
      }

      const hit = segmentProperIntersectionPoint(si.a, si.b, sj.a, sj.b);
      if (!hit) continue;

      splits[i].push(hit.t);
      splits[j].push(hit.u);
    }
  }

  const snap = makePointSnapper(eps);
  const out = [];

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const pts = buildSplitPointsOnSegment(s.a, s.b, splits[i]);

    for (let k = 0; k < pts.length - 1; k++) {
      const a = snap(pts[k]);
      const b = snap(pts[k + 1]);

      // Drop tiny segments
      if (dist2(a, b) <= (eps * eps) * 0.01) continue;

      out.push({ ...s, a, b });
    }
  }

  return out;
}

// ---------- Polygon intersection helpers ----------
//
// These are used by the city model for collision tests (New Town vs wall/bastions).
// They are intentionally simple and stable.

function pointOnSeg(p, a, b, eps = 1e-6) {
  // Collinearity via cross product, then bounding box.
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > eps) return false;

  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;

  const len2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (dot - len2 > eps) return false;

  return true;
}

function pointInPoly(pt, poly) {
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

function pointInPolyOrOn(pt, poly, eps = 1e-6) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (pointOnSeg(pt, a, b, eps)) return true;
  }
  return pointInPoly(pt, poly);
}

export function polyIntersectsPoly(A, B) {
  if (!A || !B || A.length < 3 || B.length < 3) return false;

  // Edge-edge intersection (treat any hit as collision)
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit.type === "proper" || hit.type === "touch" || hit.type === "collinear") {
        return true;
      }
    }
  }

  // Containment (boundary treated as inside)
  if (pointInPolyOrOn(A[0], B)) return true;
  if (pointInPolyOrOn(B[0], A)) return true;

  return false;
}

export function polyIntersectsPolyBuffered(A, B, eps = 1.5) {
  if (polyIntersectsPoly(A, B)) return true;

  // “Buffered” test: any vertex on/inside the other polygon.
  for (const p of A) if (pointInPolyOrOn(p, B, eps)) return true;
  for (const p of B) if (pointInPolyOrOn(p, A, eps)) return true;

  return false;
}
