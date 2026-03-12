// docs/src/model/water_on_mesh/util.js
import { clampInt } from "../util/ids.js";
export { dist2 } from "../../geom/primitives.js";
import { isFiniteNumber } from "../util/numbers.js";

export function finitePoint(p) {
  return p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

export function uniqueConsecutiveNodes(nodes) {
  const out = [];
  let prev = null;
  for (const n of nodes) {
    if (n == null) continue;
    if (prev === null || n !== prev) out.push(n);
    prev = n;
  }
  return out;
}

export function polylineLengthSq(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    acc += dist2(a, b);
  }
  return acc;
}

export function stitchPolylines(polys) {
  const out = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    if (out.length === 0) {
      out.push(...poly);
      continue;
    }
    const last = out[out.length - 1];
    const first = poly[0];
    if (finitePoint(last) && finitePoint(first) && dist2(last, first) <= 1e-12) {
      out.push(...poly.slice(1));
    } else {
      out.push(...poly);
    }
  }
  return out;
}
