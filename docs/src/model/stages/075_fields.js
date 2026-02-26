// docs/src/model/stages/075_fields.js
//
// Milestone 4.8: Deterministic fields over the mesh (stage scaffold).
//
// This stage is intentionally NO-BEHAVIOUR-CHANGE:
// - It computes an empty FieldRegistry (correct domain sizes) and stores it on ctx.state.fields.
// - It also stores ctx.state.fieldsMeta for debugging/audits.
// - Later files will add real computeSpecs (distance-to-plaza/wall/water) and prerequisites.
//
// Wiring:
// - Insert this stage after your CityMesh is created (after the stage that sets ctx.state.cityMesh).
// - Insert it before any stage that will consume fields (roads, role scoring, density).

import { computeAllFields } from "../fields/compute_fields.js";
import { makeMeshAccessFromCityMesh } from "../fields/mesh_access_from_city_mesh.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Stage entry point.
 * Expected inputs:
 * - ctx.state.cityMesh
 *
 * Outputs:
 * - ctx.state.fields (FieldRegistry)
 * - ctx.state.fieldsMeta (array of {name,domain,version,units,min,max})
 */
export function stage_075_fields(ctx) {
  assert(ctx && ctx.state, "stage_075_fields: missing ctx.state.");
  assert(ctx.state.cityMesh, "stage_075_fields: missing ctx.state.cityMesh. Wire this stage after CityMesh construction.");

  const cityMesh = ctx.state.cityMesh;
  const meshAccess = makeMeshAccessFromCityMesh(cityMesh);

  // For now, computeSpecs is empty (no behaviour change).
  // Later: add computeSpecs for distance fields, once their inputs are formalised.
  const fields = computeAllFields({
    cityMesh,
    meshAccess,
    anchors: ctx.state.anchors, // optional
    water: ctx.state.water,     // optional
    walls: ctx.state.walls,     // optional
    params: ctx.params,         // optional
    computeSpecs: [],
  });

  // Attach as first-class output
  ctx.state.fields = fields;
  ctx.state.fieldsMeta = fields.meta();
}

// Provide a default export for stage registries that import default.
export default stage_075_fields;
