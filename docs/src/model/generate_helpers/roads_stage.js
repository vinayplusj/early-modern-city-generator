// docs/src/model/generate_helpers/roads_stage.js
//
// Road polyline assembly (inputs only; does not mutate global state).

import { closestPointOnPolyline } from "../../geom/poly.js";

import {
  generateSecondaryRoads,
  routeGateToSquareViaRing,
} from "../features.js";

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

  return { polylines, secondaryRoads, roadEps };
}
