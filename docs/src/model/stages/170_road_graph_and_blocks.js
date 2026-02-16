// docs/src/model/stages/170_road_graph_and_blocks.js
//
// Stage 170: Road polylines -> road graph -> blocks (debug) -> district assignment.
// Extracted from generate.js without functional changes.

import { buildRoadGraphWithIntersections } from "../../roads/graph.js";
import { extractBlocksFromRoadGraph } from "../../roads/blocks.js";
import { assignBlocksToDistrictsByWards } from "../districts_voronoi.js";
import { buildRoadPolylines } from "../generate_helpers/roads_stage.js";

/**
 * @param {object} args
 * @returns {object}
 * {
 *   polylines,
 *   secondaryRoadsLegacy,
 *   roadGraph,
 *   blocks
 * }
 */
export function runRoadGraphAndBlocksStage({
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
  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;

  const builtRoads = buildRoadPolylines({
    rng,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
  });

  let polylines = builtRoads.polylines;
  const secondaryRoadsLegacy = builtRoads.secondaryRoads;

  // Prepend routed primaries so the road graph and block extraction reflect them.
  if (Array.isArray(primaryRoads) && primaryRoads.length) {
    polylines = [...primaryRoads, ...polylines];
  }

  const roadGraph = buildRoadGraphWithIntersections(polylines, ROAD_EPS);

  // ---------------- Milestone 3.6: blocks (debug) ----------------
  const BLOCKS_ANGLE_EPS = 1e-9;
  const BLOCKS_AREA_EPS = 8.0;
  const BLOCKS_MAX_FACE_STEPS = 10000;

  const blocks = extractBlocksFromRoadGraph(roadGraph, {
    ANGLE_EPS: BLOCKS_ANGLE_EPS,
    AREA_EPS: BLOCKS_AREA_EPS,
    MAX_FACE_STEPS: BLOCKS_MAX_FACE_STEPS,
  });

  // Change 3: Assign blocks by ward containment, then map ward role -> district id.
  assignBlocksToDistrictsByWards({
    blocks,
    wards: wardsWithRoles,
    districts,
  });

  return {
    polylines,
    secondaryRoadsLegacy,
    roadGraph,
    blocks,
  };
}
