// docs/src/model/mesh/voronoi_planar_graph/build.js

import {
  isFiniteNumber,
  isFinitePoint,
  quantKey,
  wardPoly,
  ensureAdjSize,
  sortAdjacencyDeterministic,
} from "./util.js";

import { applyDeterministicEdgeFlags } from "./water_flags.js";

/**
 * Build a planar graph from ward polygons.
 */
export function buildVoronoiPlanarGraph({ wards, eps = 1e-3, waterModel = null, anchors = null, params = null }) {
  if (!Array.isArray(wards)) {
    throw new Error("buildVoronoiPlanarGraph: wards must be an array");
  }
  if (!isFiniteNumber(eps) || eps <= 0) {
    throw new Error("buildVoronoiPlanarGraph: eps must be a positive finite number");
  }

  const nodes = [];
  const nodeKeyToId = new Map();

  const edgeKeyToId = new Map();
  const edges = [];
  const adj = [];
  // New topology outputs
  const cells = [];      // one per ward polygon (if valid)
  const edgeCells = [];  // edgeId -> [cellId] or [cellIdA, cellIdB]

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
    if (a == null || b == null) return null;
    if (a === b) return null;

    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo}-${hi}`;

    let edgeId = edgeKeyToId.get(key);
    if (edgeId == null) {
      const na = nodes[lo];
      const nb = nodes[hi];
      if (!na || !nb) return null;

      const length = Math.hypot(nb.x - na.x, nb.y - na.y);
      if (!isFiniteNumber(length) || length <= 0) return null;

      edgeId = edges.length;
      edges.push({
        id: edgeId,
        a: lo,
        b: hi,
        length,
        flags: { isWater: false, nearCitadel: false },
      });

      edgeKeyToId.set(key, edgeId);

      ensureAdjSize(adj, Math.max(lo, hi) + 1);
      adj[lo].push({ to: hi, edgeId });
      adj[hi].push({ to: lo, edgeId });
    }
    return edgeId;
  }

  for (let wardId = 0; wardId < wards.length; wardId++) {
    const w = wards[wardId];
    const poly = wardPoly(w);
    if (!Array.isArray(poly) || poly.length < 3) continue;
  
    // Build one mesh cell per ward polygon, preserving polygon order.
    // cellId is assigned only if the cell validates.
    const pendingNodeIds = [];
    const pendingEdgeIds = [];
    let valid = true;
  
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
  
      const a = getNodeId(p0);
      const b = getNodeId(p1);
      const edgeId = addUndirectedEdge(a, b);
  
      if (a == null || b == null || edgeId == null) {
        valid = false;
        break;
      }
  
      // Boundary order invariant:
      // edgeIds[i] corresponds to nodeIds[i] -> nodeIds[(i+1)%n]
      pendingNodeIds.push(a);
      pendingEdgeIds.push(edgeId);
    }
  
    // Validate basic cell topology before assigning cellId.
    if (!valid || pendingNodeIds.length < 3 || pendingEdgeIds.length !== pendingNodeIds.length) {
      console.warn("[voronoi_planar_graph] skipped malformed cell", {
        wardId,
        valid,
        nodeCount: pendingNodeIds.length,
        edgeCount: pendingEdgeIds.length,
      });
      continue;
    }
  
    const cellId = cells.length;
  
    cells.push({
      id: cellId,
      wardId,              // source ward index (stable mapping)
      nodeIds: pendingNodeIds,
      edgeIds: pendingEdgeIds,
    });
  
    // Record edge -> incident cells (max 2 for planar Voronoi edges).
    for (const edgeId of pendingEdgeIds) {
      let inc = edgeCells[edgeId];
      if (!Array.isArray(inc)) {
        inc = [];
        edgeCells[edgeId] = inc;
      }
  
      // Avoid duplicate registration if quantisation creates repeated edge usage in one cell.
      if (inc.includes(cellId)) continue;
  
      if (inc.length < 2) {
        inc.push(cellId);
      } else {
        // Keep running, but surface topology anomalies caused by degeneracy / quantisation.
        console.warn("[voronoi_planar_graph] edge has >2 incident cells", {
          edgeId,
          wardId,
          cellId,
          incident: inc.slice(),
        });
      }
    }
  }

  sortAdjacencyDeterministic(adj);
  // Populate per-edge incident cell slots.
  // NOTE: These are incident slots, not geometric left/right by edge direction (yet).
  for (const e of edges) {
    const inc = Array.isArray(edgeCells[e.id]) ? edgeCells[e.id] : [];
    e.leftCell = (inc[0] ?? null);
    e.rightCell = (inc[1] ?? null);
  }
  applyDeterministicEdgeFlags({ edges, nodes, waterModel, anchors, params });
  let edge0 = 0, edge1 = 0, edge2 = 0, edgeGt2 = 0;
  for (let i = 0; i < edges.length; i++) {
    const n = Array.isArray(edgeCells[i]) ? edgeCells[i].length : 0;
    if (n === 0) edge0++;
    else if (n === 1) edge1++;
    else if (n === 2) edge2++;
    else edgeGt2++;
  }
  
  if (edgeGt2 > 0) {
    console.warn("[voronoi_planar_graph] edge incidence summary", {
      cells: cells.length,
      edges: edges.length,
      edge0,
      edge1,
      edge2,
      edgeGt2,
    });
  }
  return { eps, nodes, edges, adj, cells, edgeCells };
}
