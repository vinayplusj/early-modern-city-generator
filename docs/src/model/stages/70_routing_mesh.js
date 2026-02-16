// docs/src/model/stages/70_routing_mesh.js
//
// Stage 70: Voronoi planar graph (routing mesh) and water snapping to mesh.
// Extracted from generate.js without functional changes.

import { buildVoronoiPlanarGraph } from "../mesh/voronoi_planar_graph.js";
import { buildWaterOnMesh } from "../water_on_mesh.js";

const VOR_EPS = 1e-3;

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

  return { vorGraph, waterModel };
}
