// docs/src/model/stages/075_fields.js
//
// Milestone 4.8: Deterministic fields over the mesh.
//
// This stage computes base distance fields on the CityMesh vertex graph.
// Safe rollout strategy:
// - Always compute distance_to_plaza_vertex (if plaza source can be resolved deterministically).
// - Compute wall/water fields only when their sources are explicitly available.
// - Optionally derive face fields via deterministic boundary reduction.
//
// Outputs:
// - ctx.state.fields (FieldRegistry)
// - ctx.state.fieldsMeta (debug metadata)

import { computeAllFields } from "../fields/compute_fields.js";
import { makeMeshAccessFromCityMesh } from "../fields/mesh_access_from_city_mesh.js";

import {
  getPlazaSourceVertexIds,
  getWallSourceVertexIds,
  getWaterSourceVertexIds,
} from "../fields/field_sources.js";

import {
  makeDistanceToPlazaVertexSpec,
  makeDistanceToWallVertexSpec,
  makeDistanceToWaterVertexSpec,
  deriveFaceFieldFromBoundaryVertices,
} from "../fields/distance_fields.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return (Number(id) | 0);
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

/**
 * Resolve a deterministic plaza source vertex id.
 *
 * Preferred: use field_sources.js (requires meshAccess.vertexXY).
 * Fallback: look for a precomputed plaza vertex id in state (if you already have one).
 */
function resolvePlazaSources({ ctx, meshAccess }) {
  const anchors = ctx.state.anchors;

  // Preferred path (requires vertexXY + iterVertexIds)
  if (typeof meshAccess.vertexXY === "function" && typeof meshAccess.iterVertexIds === "function" && anchors && anchors.plaza) {
    return getPlazaSourceVertexIds({ meshAccess, anchors });
  }

  // Fallback path: accept an explicit plaza vertex id if your pipeline already computes it.
  // These are speculative but safe to check; if none exist we throw with a clear message.
  const candidates = [
    ctx.state.plazaVertexId,
    anchors && anchors.plazaVertexId,
    ctx.state.routingMesh && ctx.state.routingMesh.plazaVertexId,
    ctx.state.routingMesh && ctx.state.routingMesh.anchors && ctx.state.routingMesh.anchors.plazaVertexId,
  ].filter((v) => v != null);

  if (candidates.length > 0) {
    return [toIntId(candidates[0], "vertex")];
  }

  throw new Error(
    "Fields stage cannot resolve plaza sources deterministically. " +
      "Either expose meshAccess.vertexXY(vId) so getPlazaSourceVertexIds(...) can pick the nearest vertex to anchors.plaza, " +
      "or provide an explicit ctx.state.(plazaVertexId) (or anchors.plazaVertexId) computed earlier in the pipeline."
  );
}

/**
 * Stage entry point expected by stage_registry.js.
 * Inputs:
 * - ctx.state.routingMesh.cityMesh
 * - ctx.state.anchors.plaza (preferred for plaza source selection)
 */
export function runFieldsStage(env) {
  assert(env && env.ctx && env.ctx.state, "runFieldsStage: missing env.ctx.state.");
  const ctx = env.ctx;

  const routingMesh = ctx.state.routingMesh;
  assert(routingMesh, "runFieldsStage: missing ctx.state.routingMesh. Wire this stage after Stage 70.");
  assert(routingMesh.cityMesh, "runFieldsStage: missing ctx.state.routingMesh.cityMesh (Stage 70 output).");

  const cityMesh = routingMesh.cityMesh;
  const meshAccess = makeMeshAccessFromCityMesh(cityMesh);

  // ------------------------------------------------------------
  // 1) Resolve source vertex sets (plaza required, others optional)
  // ------------------------------------------------------------

  const plazaSources = resolvePlazaSources({ ctx, meshAccess });

  // Wall and water are optional for now. They become required once you expose bindings.
  let wallSources = null;
  let waterSources = null;

  try {
    wallSources = getWallSourceVertexIds({
      meshAccess,
      // Optional caller-provided list if you already have it in state:
      wallVertexIds: ctx.state.wallSourceVertexIds || (ctx.state.fortifications && ctx.state.fortifications.wallSourceVertexIds),
    });
  } catch (e) {
    wallSources = null;
  }

  try {
    waterSources = getWaterSourceVertexIds({
      meshAccess,
      // Optional caller-provided list if you already have it in state:
      waterVertexIds: ctx.state.waterSourceVertexIds || (ctx.state.waterModel && ctx.state.waterModel.waterSourceVertexIds),
    });
  } catch (e) {
    waterSources = null;
  }

  // ---------------------------------------------
  // 2) Build compute specs (deterministic ordering)
  // ---------------------------------------------

  const computeSpecs = [];
  computeSpecs.push(makeDistanceToPlazaVertexSpec(plazaSources));

  if (wallSources && wallSources.length > 0) computeSpecs.push(makeDistanceToWallVertexSpec(wallSources));
  if (waterSources && waterSources.length > 0) computeSpecs.push(makeDistanceToWaterVertexSpec(waterSources));

  // ---------------------------------------
  // 3) Compute vertex fields into the registry
  // ---------------------------------------

  const fields = computeAllFields({
    cityMesh,
    meshAccess,
    anchors: ctx.state.anchors,
    water: ctx.state.waterModel,
    walls: ctx.state.fortifications,
    params: ctx.params,
    computeSpecs,
  });

  // ------------------------------------------------------
  // 4) (Optional) Derive face fields by boundary reduction
  // ------------------------------------------------------
  // We do this in-stage (not inside compute_fields.js) to avoid changing compute_fields.js.

  // Derive face fields only if meshAccess.faceBoundaryVertexIds is available.
  if (typeof meshAccess.faceBoundaryVertexIds === "function") {
    // plaza face field always
    {
      const rec = fields.get("distance_to_plaza_vertex");
      const faceVals = deriveFaceFieldFromBoundaryVertices({
        meshAccess,
        vertexValues: rec.values,
        mode: "min",
      });
      fields.add(
        {
          name: "distance_to_plaza_face",
          domain: "face",
          version: 1,
          units: "map_units",
          description: "Boundary-min of distance_to_plaza_vertex.",
          source: "deriveFaceFieldFromBoundaryVertices(min)",
        },
        faceVals
      );
    }

    // wall face field if available
    if (fields.has("distance_to_wall_vertex")) {
      const rec = fields.get("distance_to_wall_vertex");
      const faceVals = deriveFaceFieldFromBoundaryVertices({
        meshAccess,
        vertexValues: rec.values,
        mode: "min",
      });
      fields.add(
        {
          name: "distance_to_wall_face",
          domain: "face",
          version: 1,
          units: "map_units",
          description: "Boundary-min of distance_to_wall_vertex.",
          source: "deriveFaceFieldFromBoundaryVertices(min)",
        },
        faceVals
      );
    }

    // water face field if available
    if (fields.has("distance_to_water_vertex")) {
      const rec = fields.get("distance_to_water_vertex");
      const faceVals = deriveFaceFieldFromBoundaryVertices({
        meshAccess,
        vertexValues: rec.values,
        mode: "min",
      });
      fields.add(
        {
          name: "distance_to_water_face",
          domain: "face",
          version: 1,
          units: "map_units",
          description: "Boundary-min of distance_to_water_vertex.",
          source: "deriveFaceFieldFromBoundaryVertices(min)",
        },
        faceVals
      );
    }
  }

  // ----------------
  // 5) Publish output
  // ----------------
  ctx.state.fields = fields;
  ctx.state.fieldsMeta = fields.meta();
}

export default runFieldsStage;
