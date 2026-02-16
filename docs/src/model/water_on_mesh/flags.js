// docs/src/model/water_on_mesh/flags.js

export function applyWaterFlagsToEdges(graph, edgeIds, flagName) {
  if (!graph || !Array.isArray(graph.edges)) return;
  if (!Array.isArray(edgeIds) || edgeIds.length === 0) return;

  for (const id of edgeIds) {
    const e = graph.edges[id];
    if (!e) continue;
    if (!e.flags || typeof e.flags !== "object") e.flags = {};
    e.flags[flagName] = true;
  }
}
