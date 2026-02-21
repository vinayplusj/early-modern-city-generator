// docs/src/model/stages/70_routing_mesh.js
//
// Stage 70: Voronoi planar graph (routing mesh) and water snapping to mesh.
// Extracted from generate.js without functional changes.

import { buildVoronoiPlanarGraph } from "../mesh/voronoi_planar_graph.js";
import { buildWaterOnMesh } from "../water_on_mesh.js";
import { snapPointToGraph } from "../mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "../routing/shortest_path.js";


const VOR_EPS = 1e-3;
function writeMeshToCtx(ctx, vorGraph, waterModel) {
  if (!ctx) return;

  // Be defensive: if ctx.mesh does not exist yet, create the expected shape.
  // (Once ctx.js is updated, this is mostly a safety net.)
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

  ctx.mesh.graph = vorGraph || null;
  ctx.mesh.nodes = vorGraph?.nodes ?? null;
  ctx.mesh.edges = vorGraph?.edges ?? null;
  ctx.mesh.adj = vorGraph?.adj ?? null;
  ctx.mesh.cells = vorGraph?.cells ?? null;
  ctx.mesh.edgeCells = vorGraph?.edgeCells ?? null;

  // Water model snapped to mesh (or null if no water)
  ctx.mesh.water = waterModel ?? null;
}
/**
 * @param {object} args
 * @returns {object} { vorGraph, waterModel }
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
  // Persist canonical routing mesh on ctx (backward-compatible with return value).
  // This is the final graph (post-water rebuild if water exists).
  writeMeshToCtx(ctx, vorGraph, waterModel);
  return { vorGraph, waterModel };
}
