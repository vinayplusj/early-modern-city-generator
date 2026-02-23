// docs/src/model/mesh/voronoi_planar_graph/snap.js
// Quarantined on 23 Feb 2026

import {
  isFiniteNumber,
  isFinitePoint,
  quantKey,
  sortAdjacencyDeterministic,
} from "./util.js";

/**
 * Snap a point to the nearest graph node. Optionally split an edge if no node is close.
 */
export function snapPointToGraph({ point, graph, maxSnapDist = 40, splitEdges = false }) {
  if (!isFinitePoint(point)) return null;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.adj)) {
    throw new Error("snapPointToGraph: invalid graph");
  }
  if (!isFiniteNumber(maxSnapDist) || maxSnapDist <= 0) {
    throw new Error("snapPointToGraph: maxSnapDist must be a positive finite number");
  }

  const { nodes, edges, adj } = graph;

  // 1) Nearest node
  let bestNode = null;
  let bestD = Infinity;

  for (const n of nodes) {
    const d = Math.hypot(n.x - point.x, n.y - point.y);
    if (d < bestD - 1e-12) {
      bestD = d;
      bestNode = n.id;
    } else if (Math.abs(d - bestD) <= 1e-12 && bestNode != null && n.id < bestNode) {
      bestNode = n.id;
    }
  }

  if (bestNode != null && bestD <= maxSnapDist) return bestNode;
  if (!splitEdges) return bestNode;

  // 2) Find nearest edge, project, split.
  let bestEdgeId = null;
  let bestEdgeDist = Infinity;
  let bestProj = null;

  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (!a || !b) continue;

    const ax = a.x, ay = a.y;
    const bx = b.x, by = b.y;

    const vx = bx - ax;
    const vy = by - ay;
    const wx = point.x - ax;
    const wy = point.y - ay;

    const vv = vx * vx + vy * vy;
    if (!isFiniteNumber(vv) || vv <= 0) continue;

    let t = (wx * vx + wy * vy) / vv;
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    const px = ax + vx * t;
    const py = ay + vy * t;
    const d = Math.hypot(point.x - px, point.y - py);

    if (d < bestEdgeDist - 1e-12) {
      bestEdgeDist = d;
      bestEdgeId = e.id;
      bestProj = { x: px, y: py, t };
    } else if (Math.abs(d - bestEdgeDist) <= 1e-12 && bestEdgeId != null && e.id < bestEdgeId) {
      bestEdgeId = e.id;
      bestProj = { x: px, y: py, t };
    }
  }

  if (bestEdgeId == null || !bestProj) return bestNode;
  if (bestEdgeDist > maxSnapDist * 2.5) return bestNode;

  // Create the new node (merged by eps quantization)
  const newNodeId = (function addNodeAt(p) {
    const eps = graph.eps;
    const key = quantKey(p.x, p.y, eps);

    let reuse = null;
    for (const n of nodes) {
      if (quantKey(n.x, n.y, eps) === key) {
        reuse = n.id;
        break;
      }
    }
    if (reuse != null) return reuse;

    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y });
    while (adj.length < id + 1) adj.push([]);
    return id;
  })(bestProj);

  const edge = edges[bestEdgeId];
  if (!edge) return newNodeId;
  if (newNodeId === edge.a || newNodeId === edge.b) return newNodeId;

  if (!edge.disabled) {
    edge.disabled = true;
    adj[edge.a] = adj[edge.a].filter((x) => x.edgeId !== edge.id);
    adj[edge.b] = adj[edge.b].filter((x) => x.edgeId !== edge.id);
  }

  function addEdgeUndirected(lo, hi, parentFlags) {
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);

    const na = nodes[a];
    const nb = nodes[b];
    if (!na || !nb) return;

    const length = Math.hypot(nb.x - na.x, nb.y - na.y);
    if (!isFiniteNumber(length) || length <= 0) return;

    const id = edges.length;
    edges.push({
      id,
      a,
      b,
      length,
      flags: parentFlags ? { ...parentFlags } : { isWater: false, nearCitadel: false },
    });

    while (adj.length < Math.max(a, b) + 1) adj.push([]);
    adj[a].push({ to: b, edgeId: id });
    adj[b].push({ to: a, edgeId: id });
  }

  const parentFlags = (edge.flags && typeof edge.flags === "object") ? { ...edge.flags } : null;
  addEdgeUndirected(edge.a, newNodeId, parentFlags);
  addEdgeUndirected(newNodeId, edge.b, parentFlags);

  sortAdjacencyDeterministic(adj);

  return newNodeId;
}
