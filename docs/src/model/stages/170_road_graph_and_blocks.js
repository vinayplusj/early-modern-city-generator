// docs/src/model/stages/170_road_graph_and_blocks.js
//
// Stage 170: Secondary roads (legacy), road graph normalisation, and block extraction.
// Milestone 4.7 migration: accept `graph` (CityMesh-derived GraphView) instead of `vorGraph`.
// Behaviour unchanged; we alias `vorGraph = graph` for legacy helper compatibility.

import { runSecondaryRoadsLegacyStage } from "../roads/secondary_legacy.js";
import { buildRoadGraph } from "../roads/road_graph.js";
import { extractBlocksFromRoadGraph } from "../roads/blocks.js";

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
  // Legacy alias: many helpers still use the name `vorGraph`.
  const vorGraph = graph;

  if (!vorGraph) throw new Error("[EMCG] Stage 170 requires graph.");
  if (!Array.isArray(primaryRoads) || primaryRoads.length === 0) {
    throw new Error("[EMCG] Stage 170 requires non-empty primaryRoads.");
  }

  // 1) Secondary roads (legacy v0)
  const secondaryRoadsLegacy = runSecondaryRoadsLegacyStage({
    ctx,
    graph: vorGraph,
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
  });

  // 2) Build a normalised road graph (planarisation and snapping happen inside)
  const roadGraph = buildRoadGraph({
    ctx,
    graph: vorGraph,
    waterModel,
    anchors,
    primaryRoads,
    secondaryRoadsLegacy,
  });

  // 3) Extract blocks as faces of the planar road graph
  const blocks = extractBlocksFromRoadGraph({
    ctx,
    roadGraph,
    outerBoundary: ctx.state?.outerBoundary ?? null,
    waterModel,
  });

  // 4) Polylines for render (if your renderer expects them)
  const polylines = roadGraph?.polylines ?? null;

  return {
    secondaryRoadsLegacy,
    roadGraph,
    blocks,
    polylines,
  };
}
