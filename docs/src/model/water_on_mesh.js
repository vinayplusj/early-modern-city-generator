// docs/src/model/water_on_mesh.js
//
// Convert water geometry (coastline and rivers) into polylines that lie on the routing mesh edges.
//
// Intent:
// - The "drawn" shoreline (and later, river thalweg) should be a chain of mesh edges.
// - The same edges should be flagged as water so road routing can avoid or penalize them.
//
// Assumptions about the routing mesh graph (vorGraph):
//   graph = { nodes: [{x,y}, ...], edges: [{id,a,b,length,disabled?,flags?}, ...], adj: [ [{to,edgeId}, ...], ... ] }
//
// Assumptions about waterModel:
// - waterModel.kind is one of: "none", "river", "coast", "river+coast" (or similar)
// - coastline polyline lives in one of: waterModel.shoreline, waterModel.coast
// - river polyline lives in: waterModel.river (optional)
//
// This module is deterministic:
// - It snaps points in input order.
// - It routes consecutive snapped points using deterministic Dijkstra.
// - It chooses the smallest edgeId when multiple parallel edges exist.
//
// Exports:
// - buildWaterOnMesh({ graph, waterModel, dijkstra, pathNodesToPolyline, snapPointToGraph, params })
//
// Notes:
// - This file does not import other modules to avoid circular dependencies.
// - You pass in the functions you already have (dijkstra, snapPointToGraph, pathNodesToPolyline).
//

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

function finitePoint(p) {
  return p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clampInt(n, lo, hi) {
  if (!Number.isInteger(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function uniqueConsecutiveNodes(nodes) {
  const out = [];
  let prev = null;
  for (const n of nodes) {
    if (n == null) continue;
    if (prev === null || n !== prev) out.push(n);
    prev = n;
  }
  return out;
}

function polylineLengthSq(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    acc += dist2(a, b);
  }
  return acc;
}

function resamplePolylineUniform(points, targetCount) {
  // Simple, deterministic resampling by arclength.
  // This keeps the coast input stable while giving more snap targets.
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const n = clampInt(targetCount, 2, 2000);

  // Build cumulative distances.
  const cum = [0];
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) {
      cum.push(total);
      continue;
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    total += d;
    cum.push(total);
  }

  if (!(total > 1e-9)) {
    return [points[0], points[points.length - 1]];
  }

  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * total;

    // Find segment.
    let i = 1;
    while (i < cum.length && cum[i] < t) i++;

    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(points.length - 1, i);

    const a = points[i0];
    const b = points[i1];

    if (!finitePoint(a) || !finitePoint(b)) {
      // Fallback: pick the closest finite endpoint.
      out.push(finitePoint(a) ? { x: a.x, y: a.y } : { x: b.x, y: b.y });
      continue;
    }

    const d0 = cum[i0];
    const d1 = cum[i1];
    const u = (d1 > d0) ? (t - d0) / (d1 - d0) : 0;

    out.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    });
  }

  return out;
}

function makeLengthOnlyWeightFn(graph) {
  return (edgeId /*, fromNode, toNode */) => {
    const e = graph.edges[edgeId];
    if (!e || e.disabled) return Infinity;
    const base = isFiniteNumber(e.length) ? e.length : Infinity;
    return base;
  };
}

function findEdgeIdBetween(graph, u, v) {
  // Deterministic edge lookup for consecutive nodes in a nodePath.
  // If multiple edges connect u->v, choose the smallest edgeId.
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

function stitchPolylines(polys) {
  // Concatenate polylines while avoiding duplicate joint points.
  const out = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    if (out.length === 0) {
      out.push(...poly);
      continue;
    }
    const last = out[out.length - 1];
    const first = poly[0];
    if (finitePoint(last) && finitePoint(first) && dist2(last, first) <= 1e-12) {
      out.push(...poly.slice(1));
    } else {
      out.push(...poly);
    }
  }
  return out;
}

function snapPolylineToNodes({ graph, polyline, snapPointToGraph, snapCfg }) {
  const nodes = [];
  if (!Array.isArray(polyline)) return nodes;
  for (const p of polyline) {
    if (!finitePoint(p)) continue;
    const nodeId = snapPointToGraph({ point: p, ...snapCfg });
    nodes.push(nodeId);
  }
  return uniqueConsecutiveNodes(nodes);
}

function routeNodesAsPolyline({
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

    if (!Array.isArray(nodePath) || nodePath.length < 2) {
      // If one segment fails, skip it, but keep determinism.
      continue;
    }

    const poly = pathNodesToPolyline({ graph, nodePath });
    if (Array.isArray(poly) && poly.length >= 2) {
      segPolys.push(poly);
      usedEdgeIds.push(...collectEdgeIdsFromNodePath(graph, nodePath));
    }
  }

  return { polyline: stitchPolylines(segPolys), usedEdgeIds };
}

function applyWaterFlagsToEdges(graph, edgeIds, flagName) {
  if (!graph || !Array.isArray(graph.edges)) return;
  if (!Array.isArray(edgeIds) || edgeIds.length === 0) return;

  for (const id of edgeIds) {
    const e = graph.edges[id];
    if (!e) continue;
    if (!e.flags || typeof e.flags !== "object") e.flags = {};
    e.flags[flagName] = true;
  }
}

/**
 * Build mesh-aligned coastline and river polylines, and optionally flag edges as water.
 *
 * @param {Object} args
 * @param {Object} args.graph - vorGraph
 * @param {Object} args.waterModel - from water.js
 * @param {Function} args.dijkstra
 * @param {Function} args.pathNodesToPolyline
 * @param {Function} args.snapPointToGraph
 * @param {Object} args.params - optional tuning
 *
 * Supported params (all optional):
 * - params.waterSnapDist (default 60)
 * - params.waterSplitEdges (default true)
 * - params.coastTargetPoints (default 48)
 * - params.riverTargetPoints (default 64)
 * - params.mutateGraphFlags (default true)
 *
 * @returns {Object} newWaterModel
 */
export function buildWaterOnMesh({
  graph,
  waterModel,
  dijkstra,
  pathNodesToPolyline,
  snapPointToGraph,
  params,
} = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.adj)) {
    throw new Error("buildWaterOnMesh: graph with nodes/edges/adj is required");
  }
  if (typeof dijkstra !== "function" || typeof pathNodesToPolyline !== "function" || typeof snapPointToGraph !== "function") {
    throw new Error("buildWaterOnMesh: dijkstra, pathNodesToPolyline, and snapPointToGraph are required");
  }

  const p = (params && typeof params === "object") ? params : {};

  const waterSnapDist = isFiniteNumber(p.waterSnapDist) ? p.waterSnapDist : 60;
  const waterSplitEdges = (p.waterSplitEdges !== false);
  const coastTargetPoints = Number.isInteger(p.coastTargetPoints) ? clampInt(p.coastTargetPoints, 8, 400) : 48;
  const riverTargetPoints = Number.isInteger(p.riverTargetPoints) ? clampInt(p.riverTargetPoints, 8, 600) : 64;
  const mutateGraphFlags = (p.mutateGraphFlags !== false);

  const wm = waterModel && typeof waterModel === "object" ? waterModel : { kind: "none" };
  const kind = (typeof wm.kind === "string") ? wm.kind : "none";

  // Decide canonical input polylines.
  const coastIn = Array.isArray(wm.shoreline) ? wm.shoreline : (Array.isArray(wm.coast) ? wm.coast : null);
  const riverIn = Array.isArray(wm.river) ? wm.river : null;

  const out = {
    ...wm,
    kind,
    // Mesh-aligned outputs:
    shorelineOnMesh: null,
    riverOnMesh: null,
    // Edge id lists (useful for debug and later logic):
    shorelineEdgeIds: [],
    riverEdgeIds: [],
  };

  // If there is no meaningful water geometry, return early.
  const hasCoast = Array.isArray(coastIn) && coastIn.length >= 2 && polylineLengthSq(coastIn) > 1e-6;
  const hasRiver = Array.isArray(riverIn) && riverIn.length >= 2 && polylineLengthSq(riverIn) > 1e-6;

  if (!hasCoast && !hasRiver) {
    return out;
  }

  const snapCfg = {
    graph,
    maxSnapDist: waterSnapDist,
    splitEdges: waterSplitEdges,
  };

  const weightLen = makeLengthOnlyWeightFn(graph);

  // Coastline along mesh edges.
  if (hasCoast) {
    const coastSampled = resamplePolylineUniform(coastIn, coastTargetPoints);
    const coastNodes = snapPolylineToNodes({
      graph,
      polyline: coastSampled,
      snapPointToGraph,
      snapCfg,
    });

    const coastRouted = routeNodesAsPolyline({
      graph,
      snappedNodes: coastNodes,
      dijkstra,
      pathNodesToPolyline,
      weightFn: weightLen,
      blockedEdgeIds: null,
    });

    if (Array.isArray(coastRouted.polyline) && coastRouted.polyline.length >= 2) {
      out.shorelineOnMesh = coastRouted.polyline;
      out.shorelineEdgeIds = coastRouted.usedEdgeIds;
      if (mutateGraphFlags) applyWaterFlagsToEdges(graph, out.shorelineEdgeIds, "isWater");
    }
  }

  // River along mesh edges (same approach, different sampling density).
  // This is safe even if you are not rendering it yet.
  if (hasRiver) {
    const riverSampled = resamplePolylineUniform(riverIn, riverTargetPoints);
    const riverNodes = snapPolylineToNodes({
      graph,
      polyline: riverSampled,
      snapPointToGraph,
      snapCfg,
    });

    const riverRouted = routeNodesAsPolyline({
      graph,
      snappedNodes: riverNodes,
      dijkstra,
      pathNodesToPolyline,
      weightFn: weightLen,
      blockedEdgeIds: null,
    });

    if (Array.isArray(riverRouted.polyline) && riverRouted.polyline.length >= 2) {
      out.riverOnMesh = riverRouted.polyline;
      out.riverEdgeIds = riverRouted.usedEdgeIds;
      if (mutateGraphFlags) applyWaterFlagsToEdges(graph, out.riverEdgeIds, "isWater");
    }
  }

  return out;
}
