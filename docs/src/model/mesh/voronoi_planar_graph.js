// docs/src/model/mesh/voronoi_planar_graph.js
//
// Build a deterministic planar graph from Voronoi ward polygons.
// This graph is intended as a routing mesh (Milestone 5 foundation).
//
// Graph model:
// - Nodes: unique Voronoi vertices (merged within eps via quantization).
// - Edges: unique undirected segments between consecutive vertices of ward polygons.
// - Adjacency: node -> [{ to, edgeId }, ...].
//
// Geometry invariants enforced:
// - Points within eps are merged into the same node.
// - No self edges (a !== b).
// - No duplicate undirected edges.
// - Edge lengths are finite.
//
// Determinism invariants:
// - Node IDs assigned in first-seen order of quantized keys.
// - Edge IDs assigned in first-seen order of undirected keys.
// - Adjacency lists sorted by (to, edgeId).
//
// Hidden coupling / ordering assumptions:
// - Wards must be finalized (clipped) before building the graph.
// - Ward polygons should be simple and ordered (no repeated last vertex required).
// - If snapPointToGraph is called with splitEdges=true, the graph is mutated. Snap all
//   endpoints for a stage before routing if you need strict determinism.

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

function isFinitePoint(p) {
  return p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function quantKey(x, y, eps) {
  const qx = Math.round(x / eps);
  const qy = Math.round(y / eps);
  return `${qx},${qy}`;
}

function wardPoly(ward) {
  // Support common shapes used in this repo:
  // - ward.poly (preferred)
  // - ward.pts
  // - ward.points
  // If the ward itself is an array, treat it as a polygon.
  if (Array.isArray(ward)) return ward;
  if (!ward || typeof ward !== "object") return null;

  if (Array.isArray(ward.poly)) return ward.poly;
  if (Array.isArray(ward.pts)) return ward.pts;
  if (Array.isArray(ward.points)) return ward.points;

  return null;
}

function ensureAdjSize(adj, n) {
  while (adj.length < n) adj.push([]);
}

/**
 * Build a planar graph from ward polygons.
 *
 * @param {Object} args
 * @param {Array} args.wards - wards (each has a polygon array: ward.poly / ward.pts / ward.points).
 * @param {number} args.eps - merge tolerance in world units (default 1e-3).
 * @returns {Object} graph
 */
export function buildVoronoiPlanarGraph({ wards, eps = 1e-3 }) {
  if (!Array.isArray(wards)) {
    throw new Error("buildVoronoiPlanarGraph: wards must be an array");
  }
  if (!isFiniteNumber(eps) || eps <= 0) {
    throw new Error("buildVoronoiPlanarGraph: eps must be a positive finite number");
  }

  const nodes = [];
  const nodeKeyToId = new Map();

  // Undirected edge de-dupe: "lo-hi" -> edgeId
  const edgeKeyToId = new Map();
  const edges = [];
  const adj = [];

  function getNodeId(p) {
    if (!isFinitePoint(p)) return null;
    const key = quantKey(p.x, p.y, eps);
    const hit = nodeKeyToId.get(key);
    if (hit != null) return hit;

    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y });
    nodeKeyToId.set(key, id);

    ensureAdjSize(adj, id + 1);
    return id;
  }

  function addUndirectedEdge(a, b) {
    if (a == null || b == null) return;
    if (a === b) return;

    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo}-${hi}`;

    let edgeId = edgeKeyToId.get(key);
    if (edgeId == null) {
      const na = nodes[lo];
      const nb = nodes[hi];
      if (!na || !nb) return;

      const length = Math.hypot(nb.x - na.x, nb.y - na.y);
      if (!isFiniteNumber(length) || length <= 0) return;

      edgeId = edges.length;
      edges.push({ id: edgeId, a: lo, b: hi, length });
      edgeKeyToId.set(key, edgeId);

      // adjacency (both directions)
      ensureAdjSize(adj, Math.max(lo, hi) + 1);
      adj[lo].push({ to: hi, edgeId });
      adj[hi].push({ to: lo, edgeId });
    }
  }

  for (const w of wards) {
    const poly = wardPoly(w);
    if (!Array.isArray(poly) || poly.length < 3) continue;

    // Iterate edges (i -> i+1), including closing edge.
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const a = getNodeId(p0);
      const b = getNodeId(p1);
      addUndirectedEdge(a, b);
    }
  }

  // Sort adjacency for determinism.
  for (const list of adj) {
    list.sort((u, v) => (u.to - v.to) || (u.edgeId - v.edgeId));
  }

  return { eps, nodes, edges, adj };
}

/**
 * Snap a point to the nearest graph node. Optionally split an edge if no node is close.
 *
 * Determinism:
 * - Node nearest by (distance, nodeId) tie-break.
 * - Edge nearest by (distance, edgeId) tie-break.
 *
 * @param {Object} args
 * @param {{x:number,y:number}} args.point
 * @param {Object} args.graph
 * @param {number} args.maxSnapDist - max distance to snap to an existing node.
 * @param {boolean} args.splitEdges - if true, project to nearest edge and split it.
 * @returns {number|null} nodeId
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

  if (bestNode != null && bestD <= maxSnapDist) {
    return bestNode;
  }

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

  // If projection is too far, do not split. Return nearest node (even if far).
  if (bestEdgeDist > maxSnapDist * 2.5) return bestNode;

  // Create the new node (merged by eps quantization)
  const newNodeId = (function addNodeAt(p) {
    const eps = graph.eps;
    const key = quantKey(p.x, p.y, eps);
    // If we can re-use an existing node within eps, do so.
    // We do not have the key->id map here, so do a small scan.
    // Graph sizes are small; this is deterministic.
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

  // If we reused an endpoint, do not split.
  const edge = edges[bestEdgeId];
  if (!edge) return newNodeId;
  if (newNodeId === edge.a || newNodeId === edge.b) return newNodeId;

  // Remove old adjacency links for this edge.
  // (We keep the old edge in edges array but mark as disabled; stable ids.)
  // This avoids re-indexing and preserves determinism.
  // Consumers should ignore disabled edges.
  if (!edge.disabled) {
    edge.disabled = true;

    // Remove from adj lists deterministically (filter by edgeId).
    adj[edge.a] = adj[edge.a].filter((x) => x.edgeId !== edge.id);
    adj[edge.b] = adj[edge.b].filter((x) => x.edgeId !== edge.id);
  }

  // Add two new edges (a-new) and (new-b)
  function addEdgeUndirected(lo, hi) {
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    const length = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y);
    const id = edges.length;
    edges.push({ id, a, b, length });
    while (adj.length < Math.max(a, b) + 1) adj.push([]);
    adj[a].push({ to: b, edgeId: id });
    adj[b].push({ to: a, edgeId: id });
  }

  addEdgeUndirected(edge.a, newNodeId);
  addEdgeUndirected(newNodeId, edge.b);

  // Re-sort adjacency for determinism after mutation.
  for (const list of adj) {
    list.sort((u, v) => (u.to - v.to) || (u.edgeId - v.edgeId));
  }

  return newNodeId;
}
