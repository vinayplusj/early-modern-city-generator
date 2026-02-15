// docs/src/model/routing/shortest_path.js
//
// Deterministic shortest-path routing for the Voronoi planar graph.
//
// Intended use:
// - Roads and rivers are routed as shortest paths on a planar mesh graph.
// - Weight function controls cost (distance, water penalties, citadel avoidance, etc.).
//
// Exports:
// - dijkstra({ graph, startNode, goalNode, weightFn, blockedEdgeIds })
// - pathNodesToPolyline({ graph, nodePath })
//
// Determinism invariants:
// - If two frontier nodes have equal distance, the smaller node id is chosen first.
// - If two relaxations tie on distance, smaller predecessor node id then smaller edge id wins.
// - Graph adjacency lists should already be sorted by (to, edgeId). This module does not rely
//   on that for correctness, but it helps stable behaviour.

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

function assertGraph(graph) {
  if (!graph || typeof graph !== "object") {
    throw new Error("dijkstra: graph is required");
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.adj)) {
    throw new Error("dijkstra: graph must have nodes, edges, adj arrays");
  }
}

function makeBlockedSet(blockedEdgeIds) {
  if (!blockedEdgeIds) return null;
  if (blockedEdgeIds instanceof Set) return blockedEdgeIds;
  if (Array.isArray(blockedEdgeIds)) return new Set(blockedEdgeIds);
  throw new Error("dijkstra: blockedEdgeIds must be null, an Array, or a Set");
}

/**
 * Deterministic Dijkstra.
 *
 * @param {Object} args
 * @param {Object} args.graph - { nodes, edges, adj }
 * @param {number} args.startNode
 * @param {number} args.goalNode
 * @param {(edgeId:number, fromNode:number, toNode:number)=>number} args.weightFn
 * @param {Array<number>|Set<number>|null} args.blockedEdgeIds
 * @returns {Array<number>|null} nodePath (inclusive start..goal), or null if unreachable
 */
export function dijkstra({ graph, startNode, goalNode, weightFn, blockedEdgeIds = null }) {
  assertGraph(graph);

  const n = graph.nodes.length;
  if (!Number.isInteger(startNode) || startNode < 0 || startNode >= n) {
    throw new Error("dijkstra: startNode out of range");
  }
  if (!Number.isInteger(goalNode) || goalNode < 0 || goalNode >= n) {
    throw new Error("dijkstra: goalNode out of range");
  }
  if (typeof weightFn !== "function") {
    throw new Error("dijkstra: weightFn must be a function(edgeId, fromNode, toNode) => cost");
  }

  const blocked = makeBlockedSet(blockedEdgeIds);

  // Distances and predecessor tracking.
  const dist = new Array(n).fill(Infinity);
  const prevNode = new Array(n).fill(-1);
  const prevEdge = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);

  dist[startNode] = 0;

  // Deterministic priority queue implemented as a simple array.
  // Each push is O(1), pop-min is O(k). Graph is small (hundreds of nodes), OK for now.
  const pq = [];
  pq.push({ node: startNode, d: 0 });

  function push(node, d) {
    pq.push({ node, d });
  }

  function popMin() {
    // Return and remove the entry with minimal (d, node).
    let bestIdx = -1;
    let bestD = Infinity;
    let bestNode = Infinity;

    for (let i = 0; i < pq.length; i++) {
      const it = pq[i];
      const d = it.d;
      const node = it.node;

      if (d < bestD - 1e-12) {
        bestD = d;
        bestNode = node;
        bestIdx = i;
      } else if (Math.abs(d - bestD) <= 1e-12) {
        if (node < bestNode) {
          bestNode = node;
          bestIdx = i;
        }
      }
    }

    if (bestIdx < 0) return null;

    const out = pq[bestIdx];
    // Remove without preserving order (faster) but still deterministic since selection is deterministic.
    pq[bestIdx] = pq[pq.length - 1];
    pq.pop();
    return out;
  }

  while (pq.length) {
    const cur = popMin();
    if (!cur) break;

    const u = cur.node;
    const du = cur.d;

    if (visited[u]) continue;
    visited[u] = true;

    // Early exit
    if (u === goalNode) break;

    // Stale queue entry
    if (du > dist[u] + 1e-12) continue;

    const nbrs = graph.adj[u] || [];
    for (const step of nbrs) {
      const v = step.to;
      const edgeId = step.edgeId;

      if (visited[v]) continue;

      const edge = graph.edges[edgeId];
      if (!edge || edge.disabled) continue; // support splitEdges mutation behaviour
      if (blocked && blocked.has(edgeId)) continue;

      const w = weightFn(edgeId, u, v);
      if (!isFiniteNumber(w) || w < 0) continue;

      const nd = dist[u] + w;

      if (nd < dist[v] - 1e-12) {
        dist[v] = nd;
        prevNode[v] = u;
        prevEdge[v] = edgeId;
        push(v, nd);
      } else if (Math.abs(nd - dist[v]) <= 1e-12) {
        // Tie-break: prefer smaller predecessor node id, then smaller edge id.
        const pu = prevNode[v];
        const pe = prevEdge[v];

        if (pu < 0 || u < pu || (u === pu && edgeId < pe)) {
          prevNode[v] = u;
          prevEdge[v] = edgeId;
          // We can push again; visited check will ignore stale entries.
          push(v, nd);
        }
      }
    }
  }

  if (!visited[goalNode] && goalNode !== startNode) {
    return null;
  }

  // Reconstruct path
  const path = [];
  let cur = goalNode;
  path.push(cur);

  while (cur !== startNode) {
    const p = prevNode[cur];
    if (p < 0) return null;
    cur = p;
    path.push(cur);
  }

  path.reverse();
  return path;
}

/**
 * Convert a node path into a polyline of points {x,y}.
 *
 * @param {Object} args
 * @param {Object} args.graph
 * @param {Array<number>} args.nodePath
 * @returns {Array<{x:number,y:number}>}
 */
export function pathNodesToPolyline({ graph, nodePath }) {
  assertGraph(graph);
  if (!Array.isArray(nodePath) || nodePath.length < 2) return [];

  const out = [];
  for (const nodeId of nodePath) {
    const n = graph.nodes[nodeId];
    if (!n) continue;
    out.push({ x: n.x, y: n.y });
  }

  return out;
}
