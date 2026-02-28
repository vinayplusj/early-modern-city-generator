// docs/src/model/mesh/voronoi_planar_graph/snap.js

import {
  isFiniteNumber,
  isFinitePoint,
  quantKey,
  sortAdjacencyDeterministic,
} from "./util.js";

function buildNodeIndexById(nodes) {
  const m = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || !Number.isInteger(n.id)) continue;
    if (!m.has(n.id)) m.set(n.id, i);
  }
  return m;
}

function buildEdgeIndexById(edges) {
  const m = new Map();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e || !Number.isInteger(e.id)) continue;
    if (!m.has(e.id)) m.set(e.id, i);
  }
  return m;
}

function getById(arr, id, indexById) {
  // Fast path when id equals index
  const direct = arr[id];
  if (direct && direct.id === id) return direct;

  const idx = indexById.get(id);
  if (idx == null) return null;
  return arr[idx] || null;
}

/**
 * Snap a point to the nearest graph node. Optionally split an edge if no node is close.
 *
 * Contract:
 * - This function may mutate graph.nodes/graph.edges/graph.adj when splitEdges is true.
 * - Therefore, do not pass an immutable view object.
 */
export function snapPointToGraph({ point, graph, maxSnapDist = 80, splitEdges = false }) {
  if (!isFinitePoint(point)) return null;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.adj)) {
    throw new Error("snapPointToGraph: invalid graph");
  }
  if (!isFiniteNumber(maxSnapDist) || maxSnapDist <= 0) {
    throw new Error("snapPointToGraph: maxSnapDist must be a positive finite number");
  }

  const { nodes, edges, adj } = graph;

  const nodeIndexById = buildNodeIndexById(nodes);
  const edgeIndexById = buildEdgeIndexById(edges);

  // 1) Nearest node (deterministic tie-break by smaller node id)
  let bestNode = null;
  let bestD = Infinity;

  for (const n of nodes) {
    if (!n) continue;
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
    if (!e || e.disabled) continue;

    const a = getById(nodes, e.a, nodeIndexById);
    const b = getById(nodes, e.b, nodeIndexById);
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

  // Create the new node (merged by eps quantisation)
  const newNodeId = (function addNodeAt(p) {
    const eps = isFiniteNumber(graph.eps) ? graph.eps : 1e-3;
    const key = quantKey(p.x, p.y, eps);

    let reuse = null;
    for (const n of nodes) {
      if (!n) continue;
      if (quantKey(n.x, n.y, eps) === key) {
        reuse = n.id;
        break;
      }
    }
    if (reuse != null) return reuse;

    // New node id: choose next integer >= nodes.length but also > max existing id
    let maxId = -1;
    for (const n of nodes) {
      if (!n || !Number.isInteger(n.id)) continue;
      if (n.id > maxId) maxId = n.id;
    }
    const id = Math.max(nodes.length, maxId + 1);

    nodes.push({ id, x: p.x, y: p.y });
    while (adj.length < id + 1) adj.push([]);
    return id;
  })(bestProj);

  const edge = getById(edges, bestEdgeId, edgeIndexById);
  if (!edge) return newNodeId;
  if (newNodeId === edge.a || newNodeId === edge.b) return newNodeId;

  if (!edge.disabled) {
    edge.disabled = true;
    if (adj[edge.a]) adj[edge.a] = adj[edge.a].filter((x) => x.edgeId !== edge.id);
    if (adj[edge.b]) adj[edge.b] = adj[edge.b].filter((x) => x.edgeId !== edge.id);
  }

  function addEdgeUndirected(lo, hi, parentFlags) {
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);

    const na = getById(nodes, a, nodeIndexById);
    const nb = getById(nodes, b, nodeIndexById);
    if (!na || !nb) return;

    const length = Math.hypot(nb.x - na.x, nb.y - na.y);
    if (!isFiniteNumber(length) || length <= 0) return;

    let maxEdgeId = -1;
    for (const e of edges) {
      if (!e || !Number.isInteger(e.id)) continue;
      if (e.id > maxEdgeId) maxEdgeId = e.id;
    }
    const id = Math.max(edges.length, maxEdgeId + 1);

    edges.push({
      id,
      a,
      b,
      length,
      flags: parentFlags ? { ...parentFlags } : { isWater: false, nearCitadel: false },
    });

    while (adj.length < Math.max(a, b) + 1) adj.push([]);
    if (!adj[a]) adj[a] = [];
    if (!adj[b]) adj[b] = [];
    adj[a].push({ to: b, edgeId: id });
    adj[b].push({ to: a, edgeId: id });
  }

  const parentFlags = (edge.flags && typeof edge.flags === "object") ? { ...edge.flags } : null;
  addEdgeUndirected(edge.a, newNodeId, parentFlags);
  addEdgeUndirected(newNodeId, edge.b, parentFlags);

  sortAdjacencyDeterministic(adj);

  return newNodeId;
}
