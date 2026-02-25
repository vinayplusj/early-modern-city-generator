// docs/src/model/stages/140_primary_roads.js
//
// Stage 140: Primary roads (routed on graph view derived from CityMesh).
//
// Contract (v1, strict):
// - Always returns an object:
//   { primaryRoads, primaryRoadsMeta, gateForRoad, snappedNodes }.
// - primaryRoads is an array of polylines for current rendering.
// - primaryRoadsMeta carries mesh references (nodePath + edgeIds) for Milestone 5+.
//
// Determinism notes:
// - snapPointToGraph({ splitEdges:true }) mutates the graph. Snap order must remain stable.
// - Dijkstra is deterministic given a fixed graph + adjacency ordering.

import { snapPointToGraph } from "../mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "../routing/shortest_path.js";
import { makeRoadWeightFn } from "../routing/weights.js";
import { buildBlockedEdgeSet } from "../routing/blocked_edges.js";

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Convert a nodePath into a deterministic list of edge ids by selecting, for each
 * consecutive (u -> v), the smallest edgeId in graph.adj[u] that reaches v and is not disabled/blocked.
 *
 * This is intentionally local and deterministic. It does not rely on dijkstra returning prevEdge.
 */
function nodePathToEdgeIds(graph, nodePath, blockedEdgeIds) {
  if (!graph || !Array.isArray(graph.adj) || !Array.isArray(graph.edges)) return [];
  if (!Array.isArray(nodePath) || nodePath.length < 2) return [];

  const blocked = blockedEdgeIds instanceof Set ? blockedEdgeIds : null;

  const out = [];
  for (let i = 0; i < nodePath.length - 1; i++) {
    const u = nodePath[i];
    const v = nodePath[i + 1];
    const nbrs = graph.adj[u] || [];

    let bestEdgeId = null;

    for (const step of nbrs) {
      if (!step || step.to !== v) continue;

      const edgeId = step.edgeId;
      const e = graph.edges[edgeId];
      if (!e || e.disabled) continue;
      if (blocked && blocked.has(edgeId)) continue;

      if (bestEdgeId == null || edgeId < bestEdgeId) bestEdgeId = edgeId;
    }

    if (bestEdgeId == null) return out; // partial list beats lying
    out.push(bestEdgeId);
  }

  return out;
}

/**
 * @param {object} args
 * @returns {object}
 * {
 *   primaryRoads: Array<Array<{x:number,y:number}>>,
 *   primaryRoadsMeta: Array<{
 *     intentId: string,
 *     from: string,
 *     to: string,
 *     fromPoint: {x,y},
 *     toPoint: {x,y},
 *     startNode: number|null,
 *     goalNode: number|null,
 *     nodePath: Array<number>|null,
 *     edgeIds: Array<number>,
 *     polyline: Array<{x,y}>
 *   }>,
 *   gateForRoad: {x,y}|null,
 *   snappedNodes: { gate:number|null, plaza:number|null, citadel:number|null, docks:number|null }
 * }
 */
export function runPrimaryRoadsStage({
  ctx,
  graph,
  waterModel,
  anchors,
  waterKind,
  primaryGateWarped,
  gatesWarped,
}) {
  // ---------------- Road weight + blocking ----------------
  const roadWeight = makeRoadWeightFn({
    graph,
    waterModel,
    anchors,
    params: ctx.params,
  });

  // Blocked edges are a function of graph flags and hard-avoid params. Compute once.
  const blocked = buildBlockedEdgeSet(graph, ctx.params);

  // ---------------- Snap endpoints (stable order; splitEdges mutates graph) ----------------
  const snapCfg = { graph, maxSnapDist: 40, splitEdges: true };

  const gateForRoad = (isFinitePoint(primaryGateWarped))
    ? primaryGateWarped
    : (Array.isArray(gatesWarped) && isFinitePoint(gatesWarped[0]) ? gatesWarped[0] : null);

  // Snap in a fixed order regardless of parameter values (do not reorder lightly).
  const nGate = gateForRoad ? snapPointToGraph({ point: gateForRoad, ...snapCfg }) : null;
  const nPlaza = isFinitePoint(anchors?.plaza) ? snapPointToGraph({ point: anchors.plaza, ...snapCfg }) : null;
  const nCitadel = isFinitePoint(anchors?.citadel) ? snapPointToGraph({ point: anchors.citadel, ...snapCfg }) : null;
  const nDocks = isFinitePoint(anchors?.docks) ? snapPointToGraph({ point: anchors.docks, ...snapCfg }) : null;

  const snappedNodes = { gate: nGate, plaza: nPlaza, citadel: nCitadel, docks: nDocks };

  // Debug: log once after snapping, to confirm flags and blocking are active.
  if (ctx.params?.warpFort?.debug && graph && Array.isArray(graph.edges)) {
    let activeEdges = 0;
    let waterEdges = 0;
    let citadelEdges = 0;

    for (const e of graph.edges) {
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

  // ---------------- Routing helper (returns meta) ----------------
  function routeIntent({ intentId, from, to, fromPoint, toPoint, startNode, goalNode }) {
    if (!isFinitePoint(fromPoint) || !isFinitePoint(toPoint)) return null;

    // If snapping failed, fall back to straight segment (keeps generator alive).
    if (startNode == null || goalNode == null) {
      const polyline = [fromPoint, toPoint];
      return {
        intentId,
        from,
        to,
        fromPoint,
        toPoint,
        startNode,
        goalNode,
        nodePath: null,
        edgeIds: [],
        polyline,
      };
    }

    const nodePath = dijkstra({
      graph,
      startNode,
      goalNode,
      weightFn: roadWeight,
      blockedEdgeIds: blocked,
    });

    if (!Array.isArray(nodePath) || nodePath.length < 2) {
      const polyline = [fromPoint, toPoint];
      return {
        intentId,
        from,
        to,
        fromPoint,
        toPoint,
        startNode,
        goalNode,
        nodePath: null,
        edgeIds: [],
        polyline,
      };
    }

    const polyline = pathNodesToPolyline({ graph, nodePath });
    const edgeIds = nodePathToEdgeIds(graph, nodePath, blocked);

    const safePolyline = (Array.isArray(polyline) && polyline.length >= 2) ? polyline : [fromPoint, toPoint];

    return {
      intentId,
      from,
      to,
      fromPoint,
      toPoint,
      startNode,
      goalNode,
      nodePath,
      edgeIds,
      polyline: safePolyline,
    };
  }

  // ---------------- Intent graph (Milestone 5 direction) ----------------
  const intents = [];

  // Gate → Plaza
  if (gateForRoad && isFinitePoint(anchors?.plaza)) {
    intents.push(routeIntent({
      intentId: "gate_plaza",
      from: "gate",
      to: "plaza",
      fromPoint: gateForRoad,
      toPoint: anchors.plaza,
      startNode: nGate,
      goalNode: nPlaza,
    }));
  }

  // Plaza → Citadel
  if (isFinitePoint(anchors?.plaza) && isFinitePoint(anchors?.citadel)) {
    intents.push(routeIntent({
      intentId: "plaza_citadel",
      from: "plaza",
      to: "citadel",
      fromPoint: anchors.plaza,
      toPoint: anchors.citadel,
      startNode: nPlaza,
      goalNode: nCitadel,
    }));
  }

  // Plaza → Docks
  if (isFinitePoint(anchors?.plaza) && isFinitePoint(anchors?.docks)) {
    intents.push(routeIntent({
      intentId: "plaza_docks",
      from: "plaza",
      to: "docks",
      fromPoint: anchors.plaza,
      toPoint: anchors.docks,
      startNode: nPlaza,
      goalNode: nDocks,
    }));
  }

  const primaryRoadsMeta = intents.filter(Boolean);

  // Legacy output: just the polylines, for render compatibility.
  const primaryRoads = primaryRoadsMeta
    .map((m) => m.polyline)
    .filter((r) => Array.isArray(r) && r.length >= 2 && isFinitePoint(r[0]) && isFinitePoint(r[r.length - 1]));

  // Stage-level deterministic fallback: always provide an avenue if plaza and citadel exist.
  if (primaryRoads.length === 0 && isFinitePoint(anchors?.plaza) && isFinitePoint(anchors?.citadel)) {
    primaryRoads.push([anchors.plaza, anchors.citadel]);
  }

  // Strict stage invariants
  if (!Array.isArray(primaryRoads) || primaryRoads.length === 0) {
    throw new Error("[EMCG] runPrimaryRoadsStage invariant failed: primaryRoads must be non-empty after fallback.");
  }
  if (!Array.isArray(primaryRoadsMeta)) {
    throw new Error("[EMCG] runPrimaryRoadsStage invariant failed: primaryRoadsMeta must be an array.");
  }
  if (!snappedNodes || typeof snappedNodes !== "object") {
    throw new Error("[EMCG] runPrimaryRoadsStage invariant failed: snappedNodes must be an object.");
  }

  return {
    primaryRoads,
    primaryRoadsMeta,
    gateForRoad,
    snappedNodes,
  };
}
