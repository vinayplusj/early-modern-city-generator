// docs/src/model/stages/70_routing_mesh.js
//
// Stage 70: Voronoi planar graph (routing mesh) and water snapping to mesh.
// Milestone 4.7: Build CityMesh from the final vorGraph, assert invariants, and publish a graph view.
// Extracted from generate.js without functional changes (geometry behaviour unchanged).

import { buildVoronoiPlanarGraph } from "../mesh/voronoi_planar_graph.js";
import { buildWaterOnMesh } from "../water_on_mesh.js";
import { snapPointToGraph } from "../mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "../routing/shortest_path.js";
import { bindOuterBoundaryToCityMesh } from "../mesh/city_mesh/bind_outer_boundary.js";
import { buildCityMeshFromVorGraph } from "../mesh/city_mesh/build_city_mesh_from_vor_graph.js";
import { assertCityMesh } from "../mesh/city_mesh/invariants.js";
import { makeGraphViewFromCityMesh } from "../mesh/city_mesh/city_mesh_graph_view.js";

const VOR_EPS = 1e-3;

function writeMeshToCtx(ctx, graph, waterModel) {
  if (!ctx) return;

  if (!ctx.mesh) {
    ctx.mesh = {
      graph: null,
      nodes: null,
      edges: null,
      adj: null,
      cells: null,
      edgeCells: null,
      water: null,
      routes: null,
      regions: null,
      blocks: null,
      parcels: null,
    };
  }

  ctx.mesh.graph = graph || null;
  ctx.mesh.nodes = graph?.nodes ?? null;
  ctx.mesh.edges = graph?.edges ?? null;
  ctx.mesh.adj = graph?.adj ?? null;
  ctx.mesh.cells = graph?.cells ?? null;
  ctx.mesh.edgeCells = graph?.edgeCells ?? null;
  ctx.mesh.water = waterModel ?? null;
}

/**
 * @param {object} args
 * @returns {object} { vorGraph, waterModel, cityMesh, graph }
 */
export function runRoutingMeshStage({
  ctx,
  wardsWithRoles,
  anchors,
  waterKind,
  waterModel,
  outerBoundary,
  cx,
  cy,
  baseR,
}) {
  // Pass 1: build graph for snapping water to edges (flags do not matter yet).
  let vorGraph = buildVoronoiPlanarGraph({
    wards: wardsWithRoles,
    eps: VOR_EPS,
    waterModel: null,
    anchors,
    params: ctx.params,
  });

  // Snap river/coast to mesh edges (exact edge id sets stored on waterModel.mesh).
  if (waterKind !== "none" && waterModel && waterModel.kind !== "none") {
    waterModel = buildWaterOnMesh({
      rng: ctx.rng.water,
      siteWater: waterKind,
      outerBoundary,
      cx,
      cy,
      baseR,
      wards: wardsWithRoles,
      graph: vorGraph,
      waterModel,
      params: ctx.params,

      // Required routing helpers (buildWaterOnMesh still expects these)
      dijkstra,
      pathNodesToPolyline,
      snapPointToGraph,
    });

    // Pass 2: rebuild graph so edge.flags.isWater is driven by waterModel.mesh edge ids.
    vorGraph = buildVoronoiPlanarGraph({
      wards: wardsWithRoles,
      eps: VOR_EPS,
      waterModel,
      anchors,
      params: ctx.params,
    });
  }

  // Milestone 4.7: Build CityMesh from the final graph and assert topology invariants.
  const cityMesh = buildCityMeshFromVorGraph(vorGraph);
  assertCityMesh(cityMesh);

  // Graph view: same shape as legacy vorGraph consumers expect.
  // Note: This view is mutable (snapPointToGraph may split edges).
  const graph = makeGraphViewFromCityMesh(cityMesh, { eps: VOR_EPS });
  const boundaryBinding = bindOuterBoundaryToCityMesh({ cityMesh, outerBoundary });
  // Persist routing mesh on ctx for debugging / legacy inspection.
  // This is now the graph view (CityMesh-derived).
  writeMeshToCtx(ctx, graph, waterModel);

  return { vorGraph, waterModel, cityMesh, graph, boundaryBinding };
}
