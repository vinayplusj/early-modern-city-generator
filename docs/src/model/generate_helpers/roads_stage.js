// docs/src/model/generate_helpers/roads_stage.js
//
// Road polyline assembly (inputs only; does not mutate global state).

import { closestPointOnPolyline } from "../../geom/poly.js";
import { clamp, lerp, dist } from "../../geom/primitives.js";
export function buildRoadIntents({
  rng,
  gatesWarped,
  squareCentre,
  citCentre,
  ring,
  ring2,
  newTown,
  roadEps,
}) {
  const intents = [];

  // Secondary roads (legacy generator returns arrays of points)
  const secondaryRoads = generateSecondaryRoads(rng, gatesWarped, ring, ring2);

  // IMPORTANT:
  // Primary roads are now generated in Stage 140 (routed on the Voronoi graph),
  // so Stage 170 should not add Euclidean primary segments here.
  // Secondary roads
  for (const r of secondaryRoads || []) {
    if (!r || r.length < 2) continue;
    intents.push({
      a: r[0],
      b: r[r.length - 1],
      kind: "secondary",
      width: 1.25,
      nodeKindA: "junction",
      nodeKindB: "junction",
    });
  }

  // New Town streets
  if (newTown && newTown.streets) {
    for (const seg of newTown.streets) {
      if (!seg || seg.length < 2) continue;
      intents.push({
        a: seg[0],
        b: seg[seg.length - 1],
        kind: "secondary",
        width: 1.0,
        nodeKindA: "junction",
        nodeKindB: "junction",
      });
    }

    // New Town main avenue: route into the city via the ring, then to the square
    if (newTown.mainAve && ring) {
      const entry = closestPointOnPolyline(newTown.mainAve[0], ring);

      intents.push({
        a: newTown.mainAve[0],
        b: entry,
        kind: "primary",
        width: 2.0,
        nodeKindA: "junction",
        nodeKindB: "junction",
      });

      intents.push({
        a: entry,
        b: squareCentre,
        kind: "primary",
        width: 2.2,
        nodeKindA: "junction",
        nodeKindB: "square",
      });
    } else if (newTown.mainAve) {
      // Fallback: represent the main avenue as a single intent between endpoints.
      intents.push({
        a: newTown.mainAve[0],
        b: newTown.mainAve[newTown.mainAve.length - 1],
        kind: "primary",
        width: 2.0,
        nodeKindA: "junction",
        nodeKindB: "junction",
      });
    }
  }

  return { intents, secondaryRoadsLegacy: secondaryRoads, roadEps };
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


export function routeGateToSquareViaRing(gate, ring, squareCentre) {
  if (!ring || ring.length < 3) return [gate, squareCentre];
  const a = closestPointOnPolyline(gate, ring);
  return [gate, a, squareCentre];
}
