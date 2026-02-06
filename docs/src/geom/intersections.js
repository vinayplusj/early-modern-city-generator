// docs/src/geom/intersections.js
//
// Milestone 3.4 geometry: segment intersections + helpers.
// Focus: robust "proper" intersections for splitting road segments.
// Collinear overlaps are intentionally treated as "no proper intersection" for stability.

import { clamp } from "./primitives.js";

// ---------- Vector helpers ----------
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function mul(a, s) {
  return { x: a.x * s, y: a.y * s };
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function snapKey(x, y, eps) {
  return `${Math.round(x / eps)}|${Math.round(y / eps)}`;
}

export function samePoint(a, b, eps) {
  return dist2(a, b) <= eps * eps;
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
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
