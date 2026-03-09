// docs/src/model/boundary/build_boundary_exits.js
//
// Build canonical outer-boundary exits for outward road continuation.
// v1: gate-based radial exits only.

import { isFinitePoint } from "../../geom/primitives.js";
import { assert } from "../util/assert.js";

function unit(v) {
  const m = Math.hypot(v.x, v.y);
  if (!Number.isFinite(m) || m <= 1e-9) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

function raySegIntersection(p, d, a, b) {
  const rx = d.x;
  const ry = d.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) <= 1e-9) return null;

  const qpx = a.x - p.x;
  const qpy = a.y - p.y;

  const tRay = (qpx * sy - qpy * sx) / denom;
  const tSeg = (qpx * ry - qpy * rx) / denom;

  if (!(tRay >= 0)) return null;
  if (!(tSeg >= 0 && tSeg <= 1)) return null;

  return {
    tRay,
    tSeg,
    point: {
      x: p.x + tRay * rx,
      y: p.y + tRay * ry,
    },
  };
}

/**
 * Build canonical outer-boundary exits for gates.
 *
 * Output:
 * [{
 *   exitId,
 *   kind: "gate_radial",
 *   gateId,
 *   portalGateId,
 *   point,
 *   outerBoundarySegIndex,
 *   t,
 *   outward,
 *   sourcePoint
 * }]
 */
export function buildBoundaryExits({
  outerBoundary,
  centre,
  gates,
  gatePortals,
}) {
  assert(Array.isArray(outerBoundary) && outerBoundary.length >= 3, "[EMCG][boundaryExits] outerBoundary invalid.");
  assert(isFinitePoint(centre), "[EMCG][boundaryExits] centre invalid.");
  assert(Array.isArray(gates), "[EMCG][boundaryExits] gates must be an array.");
  assert(Array.isArray(gatePortals), "[EMCG][boundaryExits] gatePortals must be an array.");

  const exits = [];

  for (let gateId = 0; gateId < gates.length; gateId++) {
    const g = gates[gateId];
    if (!isFinitePoint(g)) continue;

    const outward = unit({ x: g.x - centre.x, y: g.y - centre.y });

    let best = null;

    for (let i = 0; i < outerBoundary.length; i++) {
      const a = outerBoundary[i];
      const b = outerBoundary[(i + 1) % outerBoundary.length];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

      const hit = raySegIntersection(g, outward, a, b);
      if (!hit) continue;

      if (best == null || hit.tRay < best.tRay - 1e-9 || (Math.abs(hit.tRay - best.tRay) <= 1e-9 && i < best.outerBoundarySegIndex)) {
        best = {
          point: hit.point,
          outerBoundarySegIndex: i,
          t: hit.tSeg,
          tRay: hit.tRay,
        };
      }
    }

    if (!best) continue;

    exits.push({
      exitId: exits.length,
      kind: "gate_radial",
      gateId,
      portalGateId: gateId,
      point: best.point,
      outerBoundarySegIndex: best.outerBoundarySegIndex,
      t: best.t,
      outward,
      sourcePoint: { x: g.x, y: g.y },
    });
  }

  return exits;
}
