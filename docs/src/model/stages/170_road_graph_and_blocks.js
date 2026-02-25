// docs/src/model/stages/170_road_graph_and_blocks.js
//
// Stage 170: Secondary roads (legacy), road graph normalisation, and block extraction.
// Milestone 4.7 migration: accept `graph` (CityMesh-derived GraphView) instead of `vorGraph`.
//
// IMPORTANT:
// - buildRoadGraph (docs/src/src/roads/graph.js) expects (polylines, eps), not an object.
// - polylines must be objects like: { points:[...], kind, width, nodeKindA, nodeKindB }.

import { buildRoadGraph } from "../../../src/roads/graph.js";
import { extractBlocksFromRoadGraph } from "../../../src/roads/blocks.js";

import { generateSecondaryRoads } from "../generate_helpers/roads_stage.js";

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function asPolyline(points, kind, width, nodeKindA = "junction", nodeKindB = "junction") {
  if (!Array.isArray(points) || points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  if (!isFinitePoint(a) || !isFinitePoint(b)) return null;

  return {
    points,
    kind,
    width,
    nodeKindA,
    nodeKindB,
  };
}

export function runRoadGraphAndBlocksStage({
  ctx,
  graph, // CityMesh-derived GraphView (not required by buildRoadGraph today, but kept for 4.7 contract)
  waterModel,
  anchors,
  waterKind, // kept for signature stability
  rng,
  primaryRoads,
  gatesWarped,
  ring,
  ring2,
  squareCentre,
  citCentre, // kept for signature stability
  newTown,
  districts, // kept for signature stability
  wardsWithRoles, // kept for signature stability
}) {
  if (!ctx) throw new Error("[EMCG] Stage 170 requires ctx.");
  if (!graph) throw new Error("[EMCG] Stage 170 requires graph.");
  if (!Array.isArray(primaryRoads) || primaryRoads.length === 0) {
    throw new Error("[EMCG] Stage 170 requires non-empty primaryRoads.");
  }

  // 1) Secondary roads (legacy v0) from existing helper.
  // generateSecondaryRoads expects rng as a function returning [0,1).
  const secondaryRoadsLegacy = generateSecondaryRoads(
    rng,
    Array.isArray(gatesWarped) ? gatesWarped : [],
    ring,
    ring2
  );

  if (secondaryRoadsLegacy != null && !Array.isArray(secondaryRoadsLegacy)) {
    throw new Error("[EMCG] Stage 170 produced invalid secondaryRoadsLegacy (expected array or null).");
  }

  // 2) Assemble polyline inputs for buildRoadGraph
  // Primary roads: keep their routed shape (multi-point polyline).
  const polylines = [];

  for (const r of primaryRoads) {
    const pl = asPolyline(r, "primary", 2.0, "junction", "junction");
    if (pl) polylines.push(pl);
  }

  // Secondary roads: each is typically a 2-point segment from the helper.
  for (const r of (secondaryRoadsLegacy || [])) {
    const pl = asPolyline(r, "secondary", 1.25, "junction", "junction");
    if (pl) polylines.push(pl);
  }

  // New Town streets (if present): keep them as secondary
  if (newTown && Array.isArray(newTown.streets)) {
    for (const seg of newTown.streets) {
      const pl = asPolyline(seg, "secondary", 1.0, "junction", "junction");
      if (pl) polylines.push(pl);
    }
  }

  // Optional: represent New Town main avenue as primary if present (visual continuity).
  // This is not the Milestone 5 mesh-referenced contract yet; it is a display/graph aid.
  if (newTown && Array.isArray(newTown.mainAve)) {
    const pl = asPolyline(newTown.mainAve, "primary", 2.0, "junction", "junction");
    if (pl) polylines.push(pl);
  }

  // 3) Build a normalised road graph from polylines
  const roadEps = Number.isFinite(ctx.params?.roadEps) ? ctx.params.roadEps : 2.0;
  const roadGraph = buildRoadGraph(polylines, roadEps);

  // 4) Extract blocks as faces of the planar road graph
  const blocks = extractBlocksFromRoadGraph({
    ctx,
    roadGraph,
    outerBoundary: ctx.state?.outerBoundary ?? null,
    waterModel,
  });

  return {
    secondaryRoadsLegacy: secondaryRoadsLegacy ?? [],
    roadGraph,
    blocks,
    polylines: roadGraph?.polylines ?? null,
  };
}
