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
// Determinism guarantees:
// - All source vertex id sets are normalised (int-cast, sorted ascending, de-duplicated).
// - Field specs are added in a stable order.
// - Output metadata records both source sets and failures to resolve optional sources (no silent drops).
//
// Bounded ranges:
// - FieldRegistry computes (min,max) per field and provides get01() for stable [0,1] normalisation.
// - This stage publishes those bounds in ctx.state.fieldsMeta for downstream consumers and audits.
//
// Outputs:
// - ctx.state.fields (FieldRegistry)
// - ctx.state.fieldsMeta (object; includes FieldRegistry.meta() plus stage-level provenance)
// - ctx.state.fieldsMeta.wardIdToFaceId

import { computeAllFields } from "../fields/compute_fields.js";
import { makeMeshAccessFromCityMesh } from "../fields/mesh_access_from_city_mesh.js";
import {
  getPlazaSourceVertexIds,
  getWallSourceVertexIds,
  getWaterSourceVertexIds,
  deriveVertexIdsFromGraphEdgeIds,
} from "../fields/field_sources.js";

import {
  makeDistanceToPlazaVertexSpec,
  makeDistanceToWallVertexSpec,
  makeDistanceToWaterVertexSpec,
} from "../fields/distance_fields.js";

import {
  assert,
  computeFieldStats,
  normaliseSourceIds,
  resolveOptionalSources,
  buildWardIdToFaceIdMap,
  assertStrictAscendingIntIds,
  pickFirstPresent,
} from "../fields/fields_stage_utils.js";
import { deriveBaseFaceFields } from "../fields/derive_face_fields.js";

/**
 * Resolve a deterministic plaza source vertex id.
 *
 * Preferred: use field_sources.js (requires meshAccess.vertexXY).
 * Fallback: look for a precomputed plaza vertex id in state (if you already have one).
 */
function resolvePlazaSources({ ctx, meshAccess }) {
  const anchors = ctx.state.anchors;

  // Preferred path (requires vertexXY + iterVertexIds)
  if (
    typeof meshAccess.vertexXY === "function" &&
    typeof meshAccess.iterVertexIds === "function" &&
    anchors &&
    anchors.plaza
  ) {
    const ids = getPlazaSourceVertexIds({ meshAccess, anchors });
    assert(ids && ids.length > 0, "Plaza sources resolved to an empty set.");
    return normaliseSourceIds(ids, "plaza");
  }

  // Fallback path: accept an explicit plaza vertex id if your pipeline already computes it.
  const candidates = [
    ctx.state.plazaVertexId,
    anchors && anchors.plazaVertexId,
    ctx.state.routingMesh && ctx.state.routingMesh.plazaVertexId,
    ctx.state.routingMesh && ctx.state.routingMesh.anchors && ctx.state.routingMesh.anchors.plazaVertexId,
  ].filter((v) => v != null);

  if (candidates.length > 0) {
    return normaliseSourceIds([candidates[0]], "plaza");
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

  // Deterministic bridge for downstream ward-level consumers:
  // wardId -> CityMesh faceId (via persisted vorGraph).
  const stageMeta = {
    stage: "075_fields",
    version: 1,
    sources: { plaza: null, wall: null, water: null },
    sourceErrors: { wall: null, water: null },
    derived: [],
    computeSpecNames: [],
  };
  stageMeta.sourceResolution = {
    plaza: {
      method: null,               // "nearest_vertex_to_anchor" | "explicit_vertex_id"
      tieBreak: "lowest_vertex_id",
      anchorUsed: null,           // { x, y } if used
      explicitKeyUsed: null,      // "ctx.state.plazaVertexId" etc if used
    },
    wall: {
      method: null,               // "explicit_vertex_ids" | "polyline_sample_nearest_vertices" | "unavailable"
      sampleStep: null,
      polylineKeyUsed: null,      // identifies which state key won (for debugging)
    },
    water: {
      method: null,               // "explicit_vertex_ids" | "edge_ids_to_vertices" | "unavailable"
      edgeCounts: { shoreline: 0, river: 0 },
    },
  };

  const wardFaceMapRes = buildWardIdToFaceIdMap({ ctx, routingMesh, meshAccess });
  stageMeta.wardToFace = wardFaceMapRes.meta;
  stageMeta.wardToFaceError = wardFaceMapRes.error;

  stageMeta.fieldStats = {};
  stageMeta.fieldNorm = {
    schema: "field_norm_v1",
    rule: "01 = clamp((x - min) / (max - min))",
    clamp: true,
    degenerate: "if max==min then 01=0",
  };

  // ------------------------------------------------------------
  // 1) Resolve source vertex sets (plaza required, others optional)
  // ------------------------------------------------------------

  const plazaSources = resolvePlazaSources({ ctx, meshAccess });
  stageMeta.sources.plaza = plazaSources;
  assertStrictAscendingIntIds(plazaSources, "plaza");
  stageMeta.sourceResolution.plaza.method =
    (ctx.state.anchors && ctx.state.anchors.plaza) ? "nearest_vertex_to_anchor" : "explicit_vertex_id";
  stageMeta.sourceResolution.plaza.anchorUsed =
    (ctx.state.anchors && ctx.state.anchors.plaza) ? ctx.state.anchors.plaza : null;
  
  const wallPick = pickFirstPresent([
    ["ctx.state.warp.wallCurtainForDraw", ctx.state.warp && ctx.state.warp.wallCurtainForDraw],
    ["ctx.state.warp.wallForDraw", ctx.state.warp && ctx.state.warp.wallForDraw],
    ["ctx.state.fortGeometryWarped.wallCurtainForDraw", ctx.state.fortGeometryWarped && ctx.state.fortGeometryWarped.wallCurtainForDraw],
    ["ctx.state.fortifications.wallCurtainForDraw", ctx.state.fortifications && ctx.state.fortifications.wallCurtainForDraw],
    ["ctx.state.fortifications.wallCurtain", ctx.state.fortifications && ctx.state.fortifications.wallCurtain],
    ["ctx.state.fortifications.wall", ctx.state.fortifications && ctx.state.fortifications.wall],
  ]);

  const wallPolylineForFields = wallPick.value;
  stageMeta.sourceResolution.wall.polylineKeyUsed = wallPick.key;

  const wallSampleStepForFields =
    (ctx.params && ctx.params.fields && ctx.params.fields.wallSampleStep) || 20;

  const wallRes = resolveOptionalSources({
    label: "wall",
    resolveFn: () =>
      getWallSourceVertexIds({
        meshAccess,

        // If already bound upstream, this still wins.
        wallVertexIds:
          ctx.state.wallSourceVertexIds ||
          (ctx.state.fortifications && ctx.state.fortifications.wallSourceVertexIds),

        // Deterministic fallback: polyline -> sampled points -> nearest vertices.
        wallPolyline: wallPolylineForFields,
        wallSampleStep: wallSampleStepForFields,
      }),
  });

  stageMeta.sources.wallPolylineUsed = !!wallPolylineForFields;
  stageMeta.sources.wallSampleStep = wallSampleStepForFields;
  stageMeta.sources.wall = wallRes.ids;
  stageMeta.sourceErrors.wall = wallRes.error;
  if (wallRes.ids) assertStrictAscendingIntIds(wallRes.ids, "wall");

  const wallVertexIdsExplicit =
    ctx.state.wallSourceVertexIds ||
    (ctx.state.fortifications && ctx.state.fortifications.wallSourceVertexIds) ||
    null;

  stageMeta.sourceResolution.wall.method =
    wallVertexIdsExplicit ? "explicit_vertex_ids" :
    wallPolylineForFields ? "polyline_sample_nearest_vertices" :
    "unavailable";

  stageMeta.sourceResolution.wall.sampleStep = wallSampleStepForFields;

  // Water sources may exist as vertex ids OR as water edge ids (shoreline/river) on the routing graph.
  // Prefer explicit vertex ids; otherwise derive from edge ids deterministically.
  const waterVertexIdsExplicit =
    ctx.state.waterSourceVertexIds ||
    (ctx.state.waterModel && ctx.state.waterModel.waterSourceVertexIds) ||
    (ctx.state.routingMesh && ctx.state.routingMesh.waterModel && ctx.state.routingMesh.waterModel.waterSourceVertexIds) ||
    null;

  let waterVertexIdsDerived = null;
  try {
    const wm =
      (ctx.state.routingMesh && ctx.state.routingMesh.waterModel)
        ? ctx.state.routingMesh.waterModel
        : (ctx.state.waterModel ? ctx.state.waterModel : null);
    stageMeta.sourceResolution.water.edgeCounts = {
      shoreline: (wm && Array.isArray(wm.shorelineEdgeIds)) ? wm.shorelineEdgeIds.length : 0,
      river: (wm && Array.isArray(wm.riverEdgeIds)) ? wm.riverEdgeIds.length : 0,
    };

    const graph = (ctx.state.routingMesh && ctx.state.routingMesh.graph) ? ctx.state.routingMesh.graph : null;

    const edgeIds = []
      .concat((wm && Array.isArray(wm.shorelineEdgeIds)) ? wm.shorelineEdgeIds : [])
      .concat((wm && Array.isArray(wm.riverEdgeIds)) ? wm.riverEdgeIds : []);

    if (!waterVertexIdsExplicit && graph && edgeIds.length > 0) {
      waterVertexIdsDerived = deriveVertexIdsFromGraphEdgeIds({
        graph,
        edgeIds,
        label: "waterEdge",
      });

      // Do not write back into ctx.state here (avoids ordering coupling).
      // Persist only in stageMeta for audits and for downstream consumers that opt in via fieldsMeta.
      stageMeta.sources.waterVertexIdsDerived = waterVertexIdsDerived;
      stageMeta.sources.waterVertexIdsDerivedFrom = {
        shorelineEdgeIds: (wm && Array.isArray(wm.shorelineEdgeIds)) ? wm.shorelineEdgeIds.length : 0,
        riverEdgeIds: (wm && Array.isArray(wm.riverEdgeIds)) ? wm.riverEdgeIds.length : 0,
      };
    }
  } catch (e) {
    waterVertexIdsDerived = null;
  }

  const waterRes = resolveOptionalSources({
    label: "water",
    resolveFn: () =>
      getWaterSourceVertexIds({
        meshAccess,
        waterVertexIds: waterVertexIdsExplicit || waterVertexIdsDerived,
      }),
  });
  stageMeta.sourceResolution.water.method =
    waterVertexIdsExplicit ? "explicit_vertex_ids" :
    (waterVertexIdsDerived && waterVertexIdsDerived.length) ? "edge_ids_to_vertices" :
    "unavailable";
  stageMeta.sources.water = waterRes.ids;
  stageMeta.sourceErrors.water = waterRes.error;
  if (waterRes.ids) assertStrictAscendingIntIds(waterRes.ids, "water");
  stageMeta.sources.waterDerivedFromEdges = !!(waterVertexIdsDerived && waterVertexIdsDerived.length);

  // ---------------------------------------------
  // 2) Build compute specs (deterministic ordering)
  // ---------------------------------------------
  const SPEC_ORDER = ["distance_to_plaza_vertex", "distance_to_wall_vertex", "distance_to_water_vertex"];
  stageMeta.specOrderContract = SPEC_ORDER.slice();

  const computeSpecs = [];
  computeSpecs.push(makeDistanceToPlazaVertexSpec(plazaSources));
  if (wallRes.ids && wallRes.ids.length > 0) computeSpecs.push(makeDistanceToWallVertexSpec(wallRes.ids));
  if (waterRes.ids && waterRes.ids.length > 0) computeSpecs.push(makeDistanceToWaterVertexSpec(waterRes.ids));

  stageMeta.computeSpecNames = computeSpecs.map((s) => String(s && s.name));
  {
    // Ensure deterministic, unique, and expected ordering.
    const names = stageMeta.computeSpecNames;
    const seen = Object.create(null);
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      assert(n && typeof n === "string" && n !== "undefined", `Invalid compute spec name at i=${i}: ${n}`);
      assert(!seen[n], `Duplicate compute spec name: ${n}`);
      seen[n] = true;
    }
    // Ensure plaza spec is always first.
    assert(
      names.length > 0 && names[0] === "distance_to_plaza_vertex",
      `Expected first spec to be distance_to_plaza_vertex, got ${names[0]}`
    );
  }

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

  // Publish bounded ranges for all fields computed so far.
  const meta0 = fields.meta();
  if (meta0 && Array.isArray(meta0.records)) {
    for (let i = 0; i < meta0.records.length; i++) {
      const r = meta0.records[i];
      if (!r || !r.name) continue;

      const rec = fields.get(r.name);
      if (!rec || !rec.values) continue;

      const stats = computeFieldStats(rec.values);
      assert(stats.finiteCount > 0, `Field ${r.name} has no finite values.`);
      assert(stats.min != null && stats.max != null, `Field ${r.name} has null bounds.`);
      assert(Number.isFinite(stats.min) && Number.isFinite(stats.max), `Field ${r.name} has non-finite bounds: ${stats.min}, ${stats.max}`);

      const m = rec.meta || {};
      stageMeta.fieldStats[r.name] = {
        min: stats.min,
        max: stats.max,
        finiteCount: stats.finiteCount,
        nonFiniteCount: stats.nonFiniteCount,
        domain: r.domain || m.domain || null,
        units: r.units || m.units || null,
      };
    }
  }

  // ------------------------------------------------------
  // 4) (Optional) Derive face fields by boundary reduction
  // ------------------------------------------------------
  //
  // This is optional and will be skipped when the mesh access layer does not expose
  // deterministic face boundary vertex ids.

  deriveBaseFaceFields({ fields, meshAccess, stageMeta });
  
  // ----------------
  // 5) Publish output
  // ----------------
  fields.assertValid();

  ctx.state.fields = fields;
  ctx.state.fieldsMeta = {
    schema: "fields_meta_v1",
    stage: stageMeta,
    fields: fields.meta(),

    // For ward-level scoring consumers:
    // Index = wardId, value = CityMesh faceId (or -1 if missing).
    wardIdToFaceId: wardFaceMapRes.map,
  };
}

export default runFieldsStage;
