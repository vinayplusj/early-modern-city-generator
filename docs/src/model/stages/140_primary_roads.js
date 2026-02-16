// docs/src/model/stages/140_primary_roads.js
//
// Stage 140: Primary roads (routed on Voronoi planar graph).
// Extracted from generate.js without functional changes.
// Critical: preserves snap order because splitEdges=true mutates the graph.

import { snapPointToGraph } from "../mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "../routing/shortest_path.js";
import { makeRoadWeightFn } from "../routing/weights.js";
import { buildBlockedEdgeSet } from "../routing/blocked_edges.js";

/**
 * @param {object} args
 * @returns {object} { primaryRoads, gateForRoad }
 */
export function runPrimaryRoadsStage({
  ctx,
  vorGraph,
  waterModel,
  anchors,
  waterKind,
  primaryGateWarped,
  gatesWarped,
}) {
  // ---------------- Primary roads (routed on Voronoi planar graph) ----------------
  const roadWeight = makeRoadWeightFn({
    graph: vorGraph,
    waterModel,
    anchors,
    params: ctx.params,
  });

  // Snap endpoints in a stable order (mutates graph if splitEdges=true).
  const snapCfg = { graph: vorGraph, maxSnapDist: 40, splitEdges: true };

  const gateForRoad = primaryGateWarped || (Array.isArray(gatesWarped) ? gatesWarped[0] : null);

  const nGate = gateForRoad ? snapPointToGraph({ point: gateForRoad, ...snapCfg }) : null;
  const nPlaza = anchors.plaza ? snapPointToGraph({ point: anchors.plaza, ...snapCfg }) : null;
  const nCitadel = anchors.citadel ? snapPointToGraph({ point: anchors.citadel, ...snapCfg }) : null;
  const nDocks = anchors.docks ? snapPointToGraph({ point: anchors.docks, ...snapCfg }) : null;

  // Debug: log once after snapping begins, to confirm flags and blocking are active.
  let __loggedRoutingFlagsOnce = false;

  function routeNodesOrFallback(nA, nB, pA, pB) {
    if (nA == null || nB == null) return [pA, pB];

    const blocked = buildBlockedEdgeSet(vorGraph, ctx.params);

    if (ctx.params?.warpFort?.debug && !__loggedRoutingFlagsOnce && vorGraph && Array.isArray(vorGraph.edges)) {
      __loggedRoutingFlagsOnce = true;

      let activeEdges = 0;
      let waterEdges = 0;
      let citadelEdges = 0;

      for (const e of vorGraph.edges) {
        if (!e || e.disabled) continue;
        activeEdges += 1;
        if (e.flags && e.flags.isWater) waterEdges += 1;
        if (e.flags && e.flags.nearCitadel) citadelEdges += 1;
      }

      const blockedCount = blocked ? blocked.size : 0;

      console.info("[Routing] flags+blocked (post-snap)", {
        activeEdges,
        waterEdges,
        citadelEdges,
        blockedCount,
        hardAvoidWater: Boolean(ctx.params.roadHardAvoidWater),
        hardAvoidCitadel: Boolean(ctx.params.roadHardAvoidCitadel),
        waterKind,
      });
    }

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

  const primaryRoads = [];

  // Gate → Plaza
  if (gateForRoad && anchors.plaza) {
    primaryRoads.push(routeNodesOrFallback(nGate, nPlaza, gateForRoad, anchors.plaza));
  }

  // Plaza → Citadel
  if (anchors.plaza && anchors.citadel) {
    primaryRoads.push(routeNodesOrFallback(nPlaza, nCitadel, anchors.plaza, anchors.citadel));
  }

  // Plaza → Docks
  if (anchors.plaza && anchors.docks) {
    primaryRoads.push(routeNodesOrFallback(nPlaza, nDocks, anchors.plaza, anchors.docks));
  }

  return { primaryRoads, gateForRoad };
}
