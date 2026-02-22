// docs/src/model/stages/170_road_graph_and_blocks.js
//
// Stage 170: Road polylines -> road graph -> blocks (debug) -> district assignment.
// Extracted from generate.js without functional changes.

import { buildRoadGraphWithIntersections } from "../../roads/graph.js";
import { extractBlocksFromRoadGraph } from "../../roads/blocks.js";
import { assignBlocksToDistrictsByWards } from "../districts_voronoi.js";
import { buildRoadIntents } from "../generate_helpers/roads_stage.js";

// Mesh routing (same stack as Stage 140)
import { snapPointToGraph } from "../mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "../routing/shortest_path.js";
import { makeRoadWeightFn } from "../routing/weights.js";
import { buildBlockedEdgeSet } from "../routing/blocked_edges.js";
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
  ctx,
  vorGraph,
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
  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;
  // Primary roads can arrive in multiple shapes during Phase 2 migration.
  // Accept:
  // - Array<Polyline>
  // - { primaryRoads: Array<Polyline> }
  const primaryRoadsArr = Array.isArray(primaryRoads)
    ? primaryRoads
    : primaryRoads?.primaryRoads;
  
  // If Stage 140 produced nothing, force a minimal primary road so blocks and graph are stable.
  const fallbackPrimary =
    (squareCentre && citCentre)
      ? [squareCentre, citCentre]
      : (anchors?.plaza && anchors?.citadel)
        ? [anchors.plaza, anchors.citadel]
        : null;
  // Weighting and blocking rules are consistent with Stage 140.
  const roadWeight = makeRoadWeightFn({
    graph: vorGraph,
    waterModel,
    anchors,
    params: ctx.params,
  });

  const snapCfg = { graph: vorGraph, maxSnapDist: 40, splitEdges: true };
  const hasGraph = Boolean(vorGraph && Array.isArray(vorGraph.nodes) && Array.isArray(vorGraph.edges));
  function routePointsOrFallback(pA, pB) {
    if (!pA || !pB) return null;

    if (!hasGraph) return [pA, pB];
    
    const nA = snapPointToGraph({ point: pA, ...snapCfg });
    const nB = snapPointToGraph({ point: pB, ...snapCfg });
    if (nA == null || nB == null) return [pA, pB];

    const blocked = buildBlockedEdgeSet(vorGraph, ctx.params);

    const nodePath = dijkstra({
      graph: vorGraph,
      startNode: nA,
      goalNode: nB,
      weightFn: roadWeight,
      blockedEdgeIds: blocked,
    });

    if (!Array.isArray(nodePath) || nodePath.length < 2) return [pA, pB];
    const poly = pathNodesToPolyline({ graph: vorGraph, nodePath });
    return (Array.isArray(poly) && poly.length >= 2) ? poly : [pA, pB];
  }

  // Deterministic ordering is required because splitEdges=true mutates vorGraph.
  function stableKey(p) {
    if (!p) return "0,0";
    return `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`;
  }

  const builtRoads = buildRoadIntents({
    rng,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
  });

  const roadIntents = Array.isArray(builtRoads.intents) ? builtRoads.intents : [];
  const secondaryRoadsLegacy = builtRoads.secondaryRoadsLegacy;

  // Sort intents in a stable order before snapping and routing.
  roadIntents.sort((a, b) => {
    const aKey = `${a.kind || ""}|${stableKey(a.a)}|${stableKey(a.b)}`;
    const bKey = `${b.kind || ""}|${stableKey(b.a)}|${stableKey(b.b)}`;
    return aKey < bKey ? -1 : (aKey > bKey ? 1 : 0);
  });

  // Route all non-primary intents on the Voronoi graph.
  let polylines = [];
  for (const it of roadIntents) {
    if (!it || !it.a || !it.b) continue;
    const pts = routePointsOrFallback(it.a, it.b);
    if (!pts || pts.length < 2) continue;

    polylines.push({
      points: pts,
      kind: it.kind || "secondary",
      width: (typeof it.width === "number") ? it.width : 1.0,
      nodeKindA: it.nodeKindA || "junction",
      nodeKindB: it.nodeKindB || "junction",
    });
  }

  // Prepend routed primaries so the road graph and block extraction reflect them.
  const primSource = (Array.isArray(primaryRoadsArr) && primaryRoadsArr.length)
    ? primaryRoadsArr
    : (fallbackPrimary ? [fallbackPrimary] : []);
  
  if (primSource.length) {
    const primAsPolylines = primSource
      .filter((p) => Array.isArray(p) && p.length >= 2 && p[0] && p[p.length - 1])
      .map((p) => ({
        points: p,
        kind: "primary",
        width: 2.5,
        nodeKindA: "junction",
        nodeKindB: "junction",
      }));
  
    polylines = [...primAsPolylines, ...polylines];
  }

  polylines = polylines.filter((pl) => {
    const pts = pl?.points;
    return Array.isArray(pts) && pts.length >= 2 && pts[0] && pts[pts.length - 1];
  });
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
