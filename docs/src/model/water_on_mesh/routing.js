// docs/src/model/water_on_mesh/routing.js

import { isFiniteNumber, finitePoint, dist2, uniqueConsecutiveNodes, stitchPolylines } from "./util.js";

export function makeLengthOnlyWeightFn(graph) {
  return (edgeId) => {
    const e = graph.edges[edgeId];
    if (!e || e.disabled) return Infinity;
    const base = isFiniteNumber(e.length) ? e.length : Infinity;
    return base;
  };
}

function findEdgeIdBetween(graph, u, v) {
  const nbrs = graph.adj[u] || [];
  let best = -1;
  for (const step of nbrs) {
    if (step && step.to === v && Number.isInteger(step.edgeId)) {
      if (best < 0 || step.edgeId < best) best = step.edgeId;
    }
  }
  return best;
}

function collectEdgeIdsFromNodePath(graph, nodePath) {
  const out = [];
  if (!Array.isArray(nodePath) || nodePath.length < 2) return out;
  for (let i = 1; i < nodePath.length; i++) {
    const u = nodePath[i - 1];
    const v = nodePath[i];
    if (!Number.isInteger(u) || !Number.isInteger(v)) continue;
    const edgeId = findEdgeIdBetween(graph, u, v);
    if (edgeId >= 0) out.push(edgeId);
  }
  return out;
}

export function snapPolylineToNodes({ graph, polyline, snapPointToGraph, snapCfg }) {
  const nodes = [];
  if (!Array.isArray(polyline)) return nodes;
  for (const p of polyline) {
    if (!finitePoint(p)) continue;
    const nodeId = snapPointToGraph({ point: p, ...snapCfg });
    nodes.push(nodeId);
  }
  return uniqueConsecutiveNodes(nodes);
}

export function routeNodesAsPolyline({
  graph,
  snappedNodes,
  dijkstra,
  pathNodesToPolyline,
  weightFn,
  blockedEdgeIds,
}) {
  if (!Array.isArray(snappedNodes) || snappedNodes.length < 2) return { polyline: [], usedEdgeIds: [] };

  const segPolys = [];
  const usedEdgeIds = [];

  for (let i = 1; i < snappedNodes.length; i++) {
    const a = snappedNodes[i - 1];
    const b = snappedNodes[i];
    if (a == null || b == null || a === b) continue;

    const nodePath = dijkstra({
      graph,
      startNode: a,
      goalNode: b,
      weightFn,
      blockedEdgeIds,
    });

    if (!Array.isArray(nodePath) || nodePath.length < 2) continue;

    const poly = pathNodesToPolyline({ graph, nodePath });
    if (Array.isArray(poly) && poly.length >= 2) {
      segPolys.push(poly);
      usedEdgeIds.push(...collectEdgeIdsFromNodePath(graph, nodePath));
    }
  }

  return { polyline: stitchPolylines(segPolys), usedEdgeIds };
}
