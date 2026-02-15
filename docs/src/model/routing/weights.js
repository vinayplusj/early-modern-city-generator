// docs/src/model/routing/weights.js
//
// Deterministic edge weight functions for routing on the Voronoi planar graph.
//
// Current scope (Milestone 5 foundation):
// - Roads: distance-only by default, with optional deterministic penalties for water and citadel.
// - Rivers: placeholder export (not yet wired) to keep module boundary stable.
//
// Design goals:
// - Deterministic: no randomness, stable tie-breaking is handled in shortest_path.js.
// - Composable: weights depend only on (edgeId, fromNode, toNode) and captured config.
// - Safe defaults: if water/citadel data is missing, the weight reduces to edge length.
//
// NOTE: This module assumes the graph edge objects look like:
//   { id, a, b, length, disabled?, flags? }
// where flags may include:
//   flags.isWater       boolean
//   flags.nearCitadel   boolean
//
// If you do not set flags yet, you still get deterministic distance-only routing.

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

function clampNonNegative(x) {
  if (!isFiniteNumber(x) || x < 0) return 0;
  return x;
}

/**
 * Create a deterministic weight function for roads.
 *
 * @param {Object} args
 * @param {Object} args.graph
 * @param {Object} args.waterModel - optional; not used unless graph flags are set
 * @param {Object} args.anchors - optional; not used unless graph flags are set
 * @param {Object} args.params - optional; may include road penalty tuning
 *
 * Supported params (all optional):
 * - params.roadWaterPenalty (default 5000): added if edge.flags.isWater === true
 * - params.roadCitadelPenalty (default 1500): added if edge.flags.nearCitadel === true
 * - params.roadDisabledPenalty (default Infinity): used if edge.disabled
 *
 * @returns {(edgeId:number, fromNode:number, toNode:number)=>number}
 */
export function makeRoadWeightFn({ graph, waterModel, anchors, params } = {}) {
  if (!graph || !Array.isArray(graph.edges)) {
    throw new Error("makeRoadWeightFn: graph with edges[] is required");
  }

  const p = params && typeof params === "object" ? params : {};

  const roadWaterPenalty =
    isFiniteNumber(p.roadWaterPenalty) ? p.roadWaterPenalty : 5000;

  const roadCitadelPenalty =
    isFiniteNumber(p.roadCitadelPenalty) ? p.roadCitadelPenalty : 1500;

  // If you want to hard-block certain edges, do it via blockedEdgeIds in dijkstra().
  // This penalty is just a safety fallback.
  const roadDisabledPenalty =
    isFiniteNumber(p.roadDisabledPenalty) ? p.roadDisabledPenalty : Infinity;

  return (edgeId /*, fromNode, toNode */) => {
    const e = graph.edges[edgeId];
    if (!e) return Infinity;

    if (e.disabled) return roadDisabledPenalty;

    // Base cost: geometric length.
    const base = isFiniteNumber(e.length) ? e.length : Infinity;
    if (!isFiniteNumber(base)) return Infinity;

    const flags = (e.flags && typeof e.flags === "object") ? e.flags : null;

    let cost = base;

    // Optional penalties if flags exist. If flags do not exist, these contribute 0.
    if (flags && flags.isWater) {
      cost += clampNonNegative(roadWaterPenalty);
    }
    if (flags && flags.nearCitadel) {
      cost += clampNonNegative(roadCitadelPenalty);
    }

    return cost;
  };
}

/**
 * Create a deterministic weight function for rivers.
 *
 * Not yet wired into generate.js. Export exists to stabilize API.
 *
 * Recommended future behaviour:
 * - Prefer flowing "downhill" (requires a height field or surrogate like radius-to-centre).
 * - Avoid fortified core (strong penalty for nearCitadel).
 * - Allow crossing water edges (rivers *are* water), but avoid unnatural loops.
 *
 * @param {Object} args
 * @param {Object} args.graph
 * @param {Object} args.params - optional
 * @returns {(edgeId:number, fromNode:number, toNode:number)=>number}
 */
export function makeRiverWeightFn({ graph, params } = {}) {
  if (!graph || !Array.isArray(graph.edges)) {
    throw new Error("makeRiverWeightFn: graph with edges[] is required");
  }

  // Minimal placeholder: distance-only.
  // You will replace this once you define a height/slope model.
  return (edgeId /*, fromNode, toNode */) => {
    const e = graph.edges[edgeId];
    if (!e || e.disabled) return Infinity;
    const base = isFiniteNumber(e.length) ? e.length : Infinity;
    return base;
  };
}
