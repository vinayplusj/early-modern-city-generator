// docs/src/model/stages/170_road_graph_and_blocks.js
//
// Stage 170: Secondary roads (legacy), road graph normalisation, and block extraction.
// Milestone 4.7 migration: accept `graph` (CityMesh-derived GraphView) instead of `vorGraph`.
// Behaviour unchanged; we alias `vorGraph = graph` for legacy helper compatibility.

import { buildRoadGraph } from "../../roads/graph.js";
import { extractBlocksFromRoadGraph } from "../../roads/blocks.js";

import { generateSecondaryRoads } from "../generate_helpers/roads_stage.js";

export function runRoadGraphAndBlocksStage({
  ctx,
  graph,
  waterModel,
  anchors,
  waterKind,
  rng,
  primaryRoads,
  gatesWarped,
  ring,
  ring2,
  squareCentre,
  citCentre,
  newTown,
  districts,
  wardsWithRoles,
}) {
  // Legacy alias: existing helpers still use the name `vorGraph`.
  const vorGraph = graph;

  if (!vorGraph) throw new Error("[EMCG] Stage 170 requires graph.");
  if (!Array.isArray(primaryRoads) || primaryRoads.length === 0) {
    throw new Error("[EMCG] Stage 170 requires non-empty primaryRoads.");
  }

  // 1) Secondary roads (legacy v0)
  // roads_stage.js export: generateSecondaryRoads(rng, gates, ring1, ring2)
  const secondaryRoadsLegacy = generateSecondaryRoads(
    rng,
    Array.isArray(gatesWarped) ? gatesWarped : [],
    ring,
    ring2
  );

  if (secondaryRoadsLegacy != null && !Array.isArray(secondaryRoadsLegacy)) {
    throw new Error("[EMCG] Stage 170 produced invalid secondaryRoadsLegacy (expected array or null).");
  }

  // 2) Build a normalised road graph (planarisation and snapping happen inside)
  const roadGraph = buildRoadGraph({
    ctx,
    graph: vorGraph,
    waterModel,
    anchors,
    primaryRoads,
    secondaryRoadsLegacy: secondaryRoadsLegacy ?? [],
  });

  // 3) Extract blocks as faces of the planar road graph
  const blocks = extractBlocksFromRoadGraph({
    ctx,
    roadGraph,
    outerBoundary: ctx.state?.outerBoundary ?? null,
    waterModel,
  });

  // 4) Polylines for render (if the renderer expects them)
  const polylines = roadGraph?.polylines ?? null;

  return {
    secondaryRoadsLegacy: secondaryRoadsLegacy ?? [],
    roadGraph,
    blocks,
    polylines,
  };
}
