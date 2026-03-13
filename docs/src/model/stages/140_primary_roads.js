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
import { buildBlockedEdgeSet } from "../routing/blocked_edges.js";
import { buildRoutingCostInputs } from "../roads/routing_cost_inputs.js";
import { applyDeterministicEdgeFlags } from "../mesh/voronoi_planar_graph/water_flags.js";
import { isFinitePoint } from "../../geom/primitives.js";

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
  gatePortals,
  boundaryExits,
}) {
  // ---------------- Road weight + blocking (FIELDS ONLY) ----------------
  const costInputs = buildRoutingCostInputs(ctx);
  
  
  /**
   * Weight function for Dijkstra.
   * This must be deterministic and must not depend on raw geometry layers (water polys, wall polys, etc).
   *
   * Supports both common call conventions:
   * - weightFn(u, step) where step = { to, edgeId, ... }
   * - weightFn(edgeId) where edgeId is a number
   */
  function roadWeight(arg0, arg1) {
    let edgeId = null;
    let u = null;
    let v = null;
  
    // Convention A: (u, step)
    if (Number.isInteger(arg0) && arg1 && typeof arg1 === "object" && Number.isInteger(arg1.edgeId)) {
      u = arg0;
      v = arg1.to;
      edgeId = arg1.edgeId;
    }
    // Convention B: (edgeId)
    else if (Number.isInteger(arg0) && arg1 == null) {
      edgeId = arg0;
    }
    // Convention C: (step) alone
    else if (arg0 && typeof arg0 === "object" && Number.isInteger(arg0.edgeId)) {
      edgeId = arg0.edgeId;
      v = arg0.to;
    }
  
    if (edgeId == null) return 1; // safe fallback; should not happen
  
    const e = graph.edges[edgeId];
    if (!e || e.disabled) return Infinity;
  
    // Edge length: prefer explicit fields if present; otherwise fall back to 1.
    // (Graph implementations vary: len, length, w, weight are common.)
    let edgeLen =
      (Number.isFinite(e.len) ? e.len :
      Number.isFinite(e.length) ? e.length :
      Number.isFinite(e.w) ? e.w :
      Number.isFinite(e.weight) ? e.weight :
      1);
  
    // If we know both endpoints, shape cost by vertex penalties.
    // If u or v is unknown (because of a different dijkstra signature),
    // fall back to a constant multiplier (still deterministic).
    let penalty = 1;
    if (Number.isInteger(u) && Number.isInteger(v)) {
      const pu = costInputs.vertexPenalty(u);
      const pv = costInputs.vertexPenalty(v);
      penalty = 0.5 * (pu + pv);
    }
  
    return edgeLen * penalty;
  }

  // ---------------- Snap endpoints (stable order; splitEdges mutates graph) ----------------
  const snapCfg = { graph, maxSnapDist: 40, splitEdges: true };
  
  const gateForRoad = (isFinitePoint(primaryGateWarped))
    ? primaryGateWarped
    : (Array.isArray(gatesWarped) && isFinitePoint(gatesWarped[0]) ? gatesWarped[0] : null);
  const primaryGateId =
    Array.isArray(gatesWarped) &&
    isFinitePoint(primaryGateWarped)
      ? gatesWarped.findIndex(g =>
          isFinitePoint(g) &&
          Math.hypot(g.x - primaryGateWarped.x, g.y - primaryGateWarped.y) <= 1e-6
        )
      : -1;

  const primaryGatePortal =
    Array.isArray(gatePortals) &&
    primaryGateId >= 0 &&
    primaryGateId < gatePortals.length
      ? gatePortals[primaryGateId]
      : null;

  const primaryBoundaryExit =
    Array.isArray(boundaryExits) &&
    primaryGateId >= 0 &&
    primaryGateId < boundaryExits.length
      ? boundaryExits[primaryGateId]
      : null;  
  // Snap in a fixed order regardless of parameter values (do not reorder lightly).
  const nGate = gateForRoad ? snapPointToGraph({ point: gateForRoad, ...snapCfg }) : null;
  const nPlaza = isFinitePoint(anchors?.plaza) ? snapPointToGraph({ point: anchors.plaza, ...snapCfg }) : null;
  const nCitadel = isFinitePoint(anchors?.citadel) ? snapPointToGraph({ point: anchors.citadel, ...snapCfg }) : null;
  const nDocks = isFinitePoint(anchors?.docks) ? snapPointToGraph({ point: anchors.docks, ...snapCfg }) : null;
  
  const snappedNodes = { gate: nGate, plaza: nPlaza, citadel: nCitadel, docks: nDocks };
  
  // Re-apply deterministic edge flags after snapping, because splitEdges mutates graph (new edges).
  applyDeterministicEdgeFlags({
    edges: graph.edges,
    nodes: graph.nodes,
    waterModel,
    anchors,
    params: ctx.params,
  });
  
  // Blocked edges are a function of graph flags and hard-avoid params. Compute after flags are up to date.
  const blocked = buildBlockedEdgeSet(graph, ctx.params);

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
        portalGateId: null,
        boundaryExitId: null,
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
        portalGateId: null,
        boundaryExitId: null,
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
      portalGateId: null,
      boundaryExitId: null,
    };
  }

  // ---------------- Intent graph (Milestone 5 direction) ----------------
  const intents = [];

  // Gate → Plaza
  if (gateForRoad && isFinitePoint(anchors?.plaza)) {
    const meta = routeIntent({
      intentId: "gate_plaza",
      from: "gate",
      to: "plaza",
      fromPoint: gateForRoad,
      toPoint: anchors.plaza,
      startNode: nGate,
      goalNode: nPlaza,
    });
  
    if (meta) {
      meta.portalGateId = primaryGatePortal?.gateId ?? null;
      meta.boundaryExitId = primaryBoundaryExit?.exitId ?? null;
      intents.push(meta);
    }
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
  for (const m of primaryRoadsMeta) {
    if (m && typeof m === "object") {
      m.costModel = {
        type: "fields_only_v1",
        weights: costInputs.weights,
        hasFields: costInputs.has,
      };
    }
  }

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

  if (ctx?.state) {
    ctx.state.primaryRoadsMeta = Array.isArray(primaryRoadsMeta) ? primaryRoadsMeta : [];
    ctx.state.primaryRoadsSnappedNodes = snappedNodes || { gate: null, plaza: null, citadel: null, docks: null };
    ctx.state.primaryRoadsGateForRoad = gateForRoad || null;
    ctx.state.primaryGatePortal = primaryGatePortal || null;
    ctx.state.primaryBoundaryExit = primaryBoundaryExit || null;
  }

  return {
    primaryRoads,
    primaryRoadsMeta,
    gateForRoad,
    snappedNodes,
    primaryGatePortal: primaryGatePortal || null,
    primaryBoundaryExit: primaryBoundaryExit || null,
  };
}
