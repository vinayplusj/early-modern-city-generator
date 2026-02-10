// docs/src/model/anchors/anchor_constraints.js
//
// Deterministic anchor constraint helpers.
// Goals:
// - Keep anchors inside a target polygon (typically the fort interior).
// - Keep anchors a minimum distance away from a wall polyline (closed loop).
// - Enforce minimum separation between two anchors.
// No RNG. Pure math only.
//
// Notes:
// - Uses centreHint to define an "inward" direction without relying on polygon winding.
// - Assumes poly is a closed loop of {x,y} points (length >= 3).

import { add, sub, mul, dist } from "../../geom/primitives.js";
import { pointInPolyOrOn, closestPointOnPolyline } from "../../geom/poly.js";

function normalizeSafe(v) {
  const l = Math.hypot(v.x, v.y);
  if (!Number.isFinite(l) || l <= 1e-9) return { x: 1, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

/**
 * Ensure p is inside (or on) the polygon. If outside, project to the closest
 * point on the polygon boundary, then nudge inward using centreHint.
 *
 * @param {Array<{x:number,y:number}>} poly
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} centreHint
 * @param {number} epsIn Small deterministic nudge distance
 * @returns {{x:number,y:number}}
 */
export function ensureInside(poly, p, centreHint, epsIn = 1.0) {
  if (!poly || poly.length < 3) return p;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return p;

  if (pointInPolyOrOn(p, poly)) return p;

  const q = closestPointOnPolyline(p, poly);
  if (!q) return p;

  const dirIn = normalizeSafe(sub(centreHint, q));
  const nudged = add(q, mul(dirIn, epsIn));

  // One more safety pass: if still outside (possible for thin shapes),
  // return boundary point q to avoid oscillation.
  return pointInPolyOrOn(nudged, poly) ? nudged : q;
}

/**
 * Push p away from a wall polyline until it is at least minClear away.
 * Direction is toward interior as defined by centreHint.
 *
 * @param {Array<{x:number,y:number}>} wallPoly Closed loop polyline
 * @param {{x:number,y:number}} p
 * @param {number} minClear
 * @param {{x:number,y:number}} centreHint
 * @returns {{x:number,y:number}}
 */
export function pushAwayFromWall(wallPoly, p, minClear, centreHint) {
  if (!wallPoly || wallPoly.length < 3) return p;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return p;
  if (!Number.isFinite(minClear) || minClear <= 0) return p;

  const q = closestPointOnPolyline(p, wallPoly);
  if (!q) return p;

  const d = dist(p, q);
  if (!Number.isFinite(d) || d >= minClear) return p;

  const dirIn = normalizeSafe(sub(centreHint, q));
  const moved = add(p, mul(dirIn, (minClear - d)));

  // Keep inside the wall after the move (deterministic).
  return ensureInside(wallPoly, moved, centreHint, 1.0);
}

/**
 * Enforce minimum separation between two points by moving both symmetrically.
 * No polygon knowledge here; caller can re-apply ensureInside/pushAwayFromWall.
 *
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @param {number} minSep
 * @returns {{a:{x:number,y:number}, b:{x:number,y:number}}}
 */
export function enforceMinSeparation(a, b, minSep) {
  if (!a || !b) return { a, b };
  if (!Number.isFinite(minSep) || minSep <= 0) return { a, b };

  const v = sub(b, a);
  const d = Math.hypot(v.x, v.y);

  if (!Number.isFinite(d) || d >= minSep) return { a, b };

  const dir = (d <= 1e-9) ? { x: 1, y: 0 } : { x: v.x / d, y: v.y / d };
  const delta = (minSep - d) * 0.5;

  return {
    a: add(a, mul(dir, -delta)),
    b: add(b, mul(dir, +delta)),
  };
}
