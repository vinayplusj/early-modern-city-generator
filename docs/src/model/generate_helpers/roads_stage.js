// docs/src/model/generate_helpers/roads_stage.js
//
// Road polyline assembly (inputs only; does not mutate global state).

import { closestPointOnPolyline } from "../../geom/poly.js";
import { clamp, lerp, dist } from "../../geom/primitives.js";

export function buildRoadPolylines({
  rng,
  gatesWarped,
  squareCentre,
  citCentre,
  ring,
  ring2,
  newTown,
  roadEps,
}) {
  const polylines = [];

  // Secondary roads (legacy generator returns arrays of points)
  const secondaryRoads = generateSecondaryRoads(rng, gatesWarped, ring, ring2);

  // Gate -> ring -> square (primary), to avoid cutting through bastions
  for (const g of gatesWarped || []) {
    const path = routeGateToSquareViaRing(g, ring, squareCentre);
    if (!path || path.length < 2) continue;

    if (path.length === 2) {
      polylines.push({
        points: [path[0], path[1]],
        kind: "primary",
        width: 2.5,
        nodeKindA: "gate",
        nodeKindB: "square",
      });
      continue;
    }

    // 3+ points: split at ring snap
    polylines.push({
      points: [path[0], path[1]],
      kind: "primary",
      width: 2.2,
      nodeKindA: "gate",
      nodeKindB: "junction",
    });

    polylines.push({
      points: [path[1], path[2]],
      kind: "primary",
      width: 2.5,
      nodeKindA: "junction",
      nodeKindB: "square",
    });
  }

  // Square -> citadel (primary)
  polylines.push({
    points: [squareCentre, citCentre],
    kind: "primary",
    width: 3.0,
    nodeKindA: "square",
    nodeKindB: "citadel",
  });

  // Secondary roads
  for (const r of secondaryRoads || []) {
    if (!r || r.length < 2) continue;
    polylines.push({ points: r, kind: "secondary", width: 1.25 });
  }

  // New Town streets
  if (newTown && newTown.streets) {
    for (const seg of newTown.streets) {
      if (!seg || seg.length < 2) continue;
      polylines.push({ points: seg, kind: "secondary", width: 1.0 });
    }

    // New Town main avenue: route into the city via the ring, then to the square
    if (newTown.mainAve && ring) {
      const entry = closestPointOnPolyline(newTown.mainAve[0], ring);

      polylines.push({
        points: [newTown.mainAve[0], entry],
        kind: "primary",
        width: 2.0,
        nodeKindA: "junction",
        nodeKindB: "junction",
      });

      polylines.push({
        points: [entry, squareCentre],
        kind: "primary",
        width: 2.2,
        nodeKindA: "junction",
        nodeKindB: "square",
      });
    } else if (newTown.mainAve) {
      polylines.push({ points: newTown.mainAve, kind: "primary", width: 2.0 });
    }
  }

export function generateSecondaryRoads(rng, gates, ring1, ring2) {
  const secondary = [];
  if (!gates || !gates.length || !ring1 || !ring2) return secondary;

  const ring1Snaps = [];
  const ring2Snaps = [];

  for (const g of gates) {
    const a = closestPointOnPolyline(g, ring1);
    const b = closestPointOnPolyline(a, ring2);

    ring1Snaps.push(a);
    ring2Snaps.push(b);

    secondary.push([g, a]); // gate -> ring1
    secondary.push([a, b]); // ring1 -> ring2
  }

  const linkCount = clamp(Math.floor(gates.length / 2), 2, 3);
  const used = new Set();

  let guard = 0;
  while (used.size < linkCount && guard++ < 2000) {
    const i = Math.floor(rng() * ring2Snaps.length);
    const step = Math.max(1, Math.floor(lerp(2, Math.max(3, ring2Snaps.length - 1), rng())));
    const j = (i + step) % ring2Snaps.length;

    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (used.has(key)) continue;

    if (dist(ring2Snaps[i], ring2Snaps[j]) < 20) continue;

    used.add(key);
    secondary.push([ring2Snaps[i], ring2Snaps[j]]);
  }

  return secondary;
}

  return { polylines, secondaryRoads, roadEps };
}

export function routeGateToSquareViaRing(gate, ring, squareCentre) {
  if (!ring || ring.length < 3) return [gate, squareCentre];
  const a = closestPointOnPolyline(gate, ring);
  return [gate, a, squareCentre];
}
