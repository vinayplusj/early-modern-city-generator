// docs/src/geom/clip_convex.js
//
// Purpose
// - Clip a subject polygon against a convex clip polygon using
//   the Sutherland–Hodgman algorithm.
// - Deterministic, no retries, no external dependencies.
//
// Contract / assumptions
// - clipPoly must be convex and non-degenerate.
// - subjectPoly can be concave.
// - Polygons are arrays of {x, y}. They may be open (no repeated first point).
// - Output is open (no repeated first point).
//
// Geometry variant note
// - This is a half-plane clipper. It does not handle holes.
// - If clipPoly is not convex, results are undefined.
//
// Typical usage
//   import { clipPolyConvex } from "../geom/clip_convex.js";
//   const clipped = clipPolyConvex(cellPoly, outerBoundary);

export function clipPolyConvex(subjectPoly, clipPoly) {
  if (!Array.isArray(subjectPoly) || subjectPoly.length < 3) return [];
  if (!Array.isArray(clipPoly) || clipPoly.length < 3) return [];

  const clip = dropClosingPoint(clipPoly);
  const subj = dropClosingPoint(subjectPoly);

  // Ensure clip polygon is counter-clockwise so "inside" test is consistent.
  const clipCCW = polygonSignedArea(clip) < 0 ? clip.slice().reverse() : clip;

  let output = subj;

  for (let i = 0; i < clipCCW.length; i++) {
    const A = clipCCW[i];
    const B = clipCCW[(i + 1) % clipCCW.length];

    const input = output;
    output = [];
    if (input.length === 0) break;

    let S = input[input.length - 1];

    for (let j = 0; j < input.length; j++) {
      const E = input[j];

      const EInside = isInsideHalfPlane(E, A, B);
      const SInside = isInsideHalfPlane(S, A, B);

      if (EInside) {
        if (!SInside) {
          const I = intersectionSegmentLine(S, E, A, B);
          if (I) output.push(I);
        }
        output.push(E);
      } else if (SInside) {
        const I = intersectionSegmentLine(S, E, A, B);
        if (I) output.push(I);
      }

      S = E;
    }

    output = dedupeNear(output, 1e-9);
  }

  // Final clean-up: drop collinear noise and repeated endpoints if any.
  output = dropClosingPoint(output);
  output = dedupeNear(output, 1e-9);

  if (output.length < 3) return [];
  return output;
}

/* ------------------------------- Geometry -------------------------------- */

function isInsideHalfPlane(P, A, B) {
  // For CCW clip polygon, inside is to the left of directed edge A->B.
  // Include boundary as inside for stability.
  return cross(B.x - A.x, B.y - A.y, P.x - A.x, P.y - A.y) >= -1e-12;
}

function intersectionSegmentLine(S, E, A, B) {
  // Intersect segment S->E with the infinite line through A->B.
  // We compute intersection with the half-plane boundary.
  const dxSE = E.x - S.x;
  const dySE = E.y - S.y;

  const dxAB = B.x - A.x;
  const dyAB = B.y - A.y;

  // Solve for t where S + t*(E-S) lies on line AB:
  // cross(AB, (S + t*(E-S)) - A) = 0
  // => cross(AB, S-A) + t*cross(AB, E-S) = 0
  const num = cross(dxAB, dyAB, S.x - A.x, S.y - A.y);
  const den = cross(dxAB, dyAB, dxSE, dySE);

  if (Math.abs(den) < 1e-12) {
    // Segment is parallel to clip edge line. No reliable intersection.
    return null;
  }

  const t = -num / den;

  // Clamp to segment for numerical stability. Sutherland–Hodgman expects
  // an intersection on the segment when we call it, but rounding can push it out.
  const tc = Math.max(0, Math.min(1, t));

  return {
    x: S.x + tc * dxSE,
    y: S.y + tc * dySE,
  };
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function polygonSignedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/* ------------------------------ Housekeeping ----------------------------- */

function dropClosingPoint(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  if (poly.length < 2) return poly.slice();

  const a = poly[0];
  const b = poly[poly.length - 1];

  if (almostEqual(a.x, b.x) && almostEqual(a.y, b.y)) {
    return poly.slice(0, poly.length - 1);
  }
  return poly.slice();
}

function dedupeNear(poly, eps) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
      continue;
    }
    if (dist2(p, last) > eps * eps) out.push(p);
  }
  // Also dedupe first/last if they became equal.
  if (out.length >= 2 && dist2(out[0], out[out.length - 1]) <= eps * eps) {
    out.pop();
  }
  return out;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function almostEqual(a, b) {
  return Math.abs(a - b) <= 1e-9;
}
