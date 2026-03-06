// docs/src/model/routing/blocked_edges.js
//
// Build a set of edge IDs that should be treated as blocked for routing.
// This is used by primary road routing on the Voronoi planar graph.
//
// Water contract (Milestone 5 direction):
// - If params.roadHardAvoidWater is true, edges flagged as water are blocked
//   UNLESS explicitly allowed as crossings (bridge/ford).
// - Today the repo has no bridge/ford generator yet, so by default all water edges
//   will be blocked when hardAvoidWater is enabled.
// - Future stages can enable crossings by setting either:
//   - edge.flags.allowWaterCrossing = true, or
//   - edge.flags.isBridge = true / edge.flags.isFord = true, or
//   - params.roadAllowWaterCrossingEdgeIds = [edgeId, ...] (deterministic allowlist)

function toIdSet(maybeIds) {
  if (!maybeIds) return null;
  if (maybeIds instanceof Set) return maybeIds;
  if (Array.isArray(maybeIds)) return new Set(maybeIds);
  return null;
}

function edgeAllowsWaterCrossing(e, allowSet) {
  if (!e) return false;
  if (allowSet && allowSet.has(e.id)) return true;

  const f = e.flags || {};
  return Boolean(f.allowWaterCrossing || f.isBridge || f.isFord);
}

export function buildBlockedEdgeSet(graph, params) {
  const p = (params && typeof params === "object") ? params : {};
  const hardWater = Boolean(p.roadHardAvoidWater);
  const hardCitadel = Boolean(p.roadHardAvoidCitadel);

  if (!hardWater && !hardCitadel) return null;

  const allowCrossingSet = toIdSet(p.roadAllowWaterCrossingEdgeIds);

  const blocked = new Set();

  for (const e of graph?.edges || []) {
    if (!e || e.disabled) continue;

    const f = e.flags || {};

    // Hard water barrier: block water edges unless explicitly allowed.
    if (hardWater && f.isWater) {
      if (!edgeAllowsWaterCrossing(e, allowCrossingSet)) {
        blocked.add(e.id);
      }
    }

    // Citadel hard avoid stays unchanged.
    if (hardCitadel && f.nearCitadel) blocked.add(e.id);
  }

  return blocked;
}
