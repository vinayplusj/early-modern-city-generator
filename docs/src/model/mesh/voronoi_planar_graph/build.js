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
  }

  for (const w of wards) {
    const poly = wardPoly(w);
    if (!Array.isArray(poly) || poly.length < 3) continue;

    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const a = getNodeId(p0);
      const b = getNodeId(p1);
      addUndirectedEdge(a, b);
    }
  }

  sortAdjacencyDeterministic(adj);

  applyDeterministicEdgeFlags({ edges, nodes, waterModel, anchors, params });

  return { eps, nodes, edges, adj };
}
