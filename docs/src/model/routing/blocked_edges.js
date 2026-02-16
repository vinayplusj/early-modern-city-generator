// docs/src/model/routing/blocked_edges.js
//
// Build a set of edge IDs that should be treated as blocked for routing.
// This is used by primary road routing on the Voronoi planar graph.

export function buildBlockedEdgeSet(graph, params) {
  const p = (params && typeof params === "object") ? params : {};
  const hardWater = Boolean(p.roadHardAvoidWater);
  const hardCitadel = Boolean(p.roadHardAvoidCitadel);

  if (!hardWater && !hardCitadel) return null;

  const blocked = new Set();

  for (const e of graph?.edges || []) {
    if (!e || e.disabled) continue;
    const f = e.flags || {};
    if (hardWater && f.isWater) blocked.add(e.id);
    if (hardCitadel && f.nearCitadel) blocked.add(e.id);
  }

  return blocked;
}
