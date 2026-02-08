// docs/src/model/generate_helpers/snap.js
//
// Small geometry helpers used by the generator.

import { raySegmentIntersection } from "../../geom/intersections.js";

function gateAngle(g, cx, cy) {
  return Math.atan2(g.y - cy, g.x - cx);
}

function snapPointToPolyRay(centre, theta, poly) {
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };

  let bestT = Infinity;
  let bestP = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    const hit = raySegmentIntersection(centre, dir, a, b);
    if (!hit || hit.type !== "hit") continue;

    const t = hit.tRay;
    if (t > 1e-6 && t < bestT) {
      bestT = t;
      bestP = hit.p;
    }
  }

  return bestP;
}

export function snapGatesToWall(gates, cx, cy, wallPoly) {
  if (!gates || !gates.length || !wallPoly || wallPoly.length < 3) return gates;

  const centre = { x: cx, y: cy };

  return gates.map((g) => {
    const theta = Number.isFinite(g.theta) ? g.theta : gateAngle(g, cx, cy);

    const p = snapPointToPolyRay(centre, theta, wallPoly);
    if (!p) return { ...g, theta };
    return { ...g, x: p.x, y: p.y, theta };
  });
}
