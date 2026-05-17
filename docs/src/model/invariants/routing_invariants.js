// docs/src/model/invariants/routing_invariants.js
// Routing graph diagnostics for Stage 900.

export function logRoutingDiagnostics({ vorGraph, primaryRoads }) {
  console.info("[Routing] vorGraph", {
    nodes: vorGraph?.nodes?.length,
    edges: vorGraph?.edges?.length,
    primaryRoads: primaryRoads?.length,
  });

  if (vorGraph && Array.isArray(vorGraph.edges)) {
    let waterEdges = 0;
    let citadelEdges = 0;
    let activeEdges = 0;

    for (const e of vorGraph.edges) {
      if (!e || e.disabled) continue;
      activeEdges += 1;
      if (e.flags && e.flags.isWater) waterEdges += 1;
      if (e.flags && e.flags.nearCitadel) citadelEdges += 1;
    }

    console.info("[Routing] edge flags", { activeEdges, waterEdges, citadelEdges });
  }
}
