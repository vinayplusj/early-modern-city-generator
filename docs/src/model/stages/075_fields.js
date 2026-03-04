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

function normaliseSourceIds(ids, label) {
  assert(Array.isArray(ids), `${label} sources must be an array.`);
  const arr = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) arr[i] = toIntId(ids[i], label);
  // Sort + de-dupe to remove any accidental order sensitivity.
  arr.sort((a, b) => a - b);
  const out = [];
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (prev === null || v !== prev) out.push(v);
    prev = v;
  }
  return out;
}

function formatErr(e) {
  if (!e) return "Unknown error";
  const msg = (e && e.message) ? e.message : String(e);
  return msg;
}

function resolveOptionalSources({ label, resolveFn }) {
  try {
    const ids = resolveFn();
    if (!ids || ids.length === 0) return { ids: null, error: `${label} sources resolved to an empty set.` };
    return { ids: normaliseSourceIds(ids, label), error: null };
  } catch (e) {
    return { ids: null, error: formatErr(e) };
  }
}
function buildWardIdToFaceIdMap({ ctx, routingMesh, meshAccess }) {
  const vorGraph = routingMesh && routingMesh.vorGraph;
  if (!vorGraph || !Array.isArray(vorGraph.cells)) {
    return { map: null, meta: null, error: "Missing routingMesh.vorGraph.cells (Stage 70 output not persisted)." };
  }

  const wardCount =
    (ctx.state.wards && Array.isArray(ctx.state.wards) && ctx.state.wards.length) ? (ctx.state.wards.length | 0) : null;

  // Determine required length if wardCount is not available.
  let maxWardId = -1;
  for (let i = 0; i < vorGraph.cells.length; i++) {
    const c = vorGraph.cells[i];
    if (!c || c.disabled) continue;
    const wId = toIntId(c.wardId, "ward");
    if (wId > maxWardId) maxWardId = wId;
  }

  const n = (wardCount != null) ? wardCount : (maxWardId + 1);
  const faceIdByWardId = new Array(n);
  for (let i = 0; i < n; i++) faceIdByWardId[i] = -1;

  let assigned = 0;

  for (let cellIndex = 0; cellIndex < vorGraph.cells.length; cellIndex++) {
    const c = vorGraph.cells[cellIndex];
    if (!c || c.disabled) continue;

    const wardId = toIntId(c.wardId, "ward");

    // In this repo, CityMesh face id is the VorGraph cell id.
    // build.js sets cell.id = cells.length, so this is stable.
    const faceId = (c.id != null) ? toIntId(c.id, "face") : (cellIndex | 0);

    if (wardCount != null) {
      assert(wardId >= 0 && wardId < n, `wardId out of range: ${wardId} (wardCount=${n})`);
    } else {
      assert(wardId >= 0 && wardId < n, `wardId out of inferred range: ${wardId} (n=${n})`);
    }

    assert(faceIdByWardId[wardId] === -1, `Duplicate wardId mapping: wardId=${wardId} already mapped to faceId=${faceIdByWardId[wardId]}`);

    // Sanity check: face id should exist on the mesh.
    // meshAccess.resolveFace(...) is not guaranteed, so use faceCount bounds where possible.
    if (typeof meshAccess.faceCount === "function") {
      const fc = meshAccess.faceCount();
      assert(faceId >= 0 && faceId < fc, `Mapped faceId out of range: faceId=${faceId} (faceCount=${fc})`);
    }

    faceIdByWardId[wardId] = faceId;
    assigned++;
  }

  // Count missing ward ids (should be zero in normal runs).
  let missing = 0;
  for (let i = 0; i < faceIdByWardId.length; i++) if (faceIdByWardId[i] === -1) missing++;

  const meta = {
    wardCount: n,
    assigned,
    missing,
    source: "routingMesh.vorGraph.cells[*].{wardId,id}",
  };

  // If wardCount is known, missing mappings are a hard error (hidden coupling / incomplete graph).
  if (wardCount != null) {
    assert(missing === 0, `Ward→face mapping incomplete: missing=${missing} of wardCount=${n}`);
  }

  return { map: faceIdByWardId, meta, error: null };
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
    const ids = getPlazaSourceVertexIds({ meshAccess, anchors });
    assert(ids && ids.length > 0, "Plaza sources resolved to an empty set.");
    return normaliseSourceIds(ids, "plaza");
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
  const wardFaceMapRes = buildWardIdToFaceIdMap({ ctx, routingMesh, meshAccess });
  stageMeta.wardToFace = wardFaceMapRes.meta;
  stageMeta.wardToFaceError = wardFaceMapRes.error;
  
  // ------------------------------------------------------------
  // 1) Resolve source vertex sets (plaza required, others optional)
  // ------------------------------------------------------------

  const plazaSources = resolvePlazaSources({ ctx, meshAccess });
  stageMeta.sources.plaza = plazaSources;
  const wallPolylineForFields =
    (ctx.state.warp && ctx.state.warp.wallCurtainForDraw) ||
    (ctx.state.warp && ctx.state.warp.wallForDraw) ||
    (ctx.state.fortGeometryWarped && ctx.state.fortGeometryWarped.wallCurtainForDraw) ||
    (ctx.state.fortifications && ctx.state.fortifications.wallCurtainForDraw) ||
    (ctx.state.fortifications && ctx.state.fortifications.wallCurtain) ||
    (ctx.state.fortifications && ctx.state.fortifications.wall) ||
    null;

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

        // New deterministic fallback: polyline -> sampled points -> nearest vertices.
        wallPolyline: wallPolylineForFields,
        wallSampleStep: wallSampleStepForFields,
      }),
  });
  stageMeta.sources.wallPolylineUsed = !!wallPolylineForFields;
  stageMeta.sources.wallSampleStep = wallSampleStepForFields;
  stageMeta.sources.wall = wallRes.ids;
  stageMeta.sourceErrors.wall = wallRes.error;

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
      (ctx.state.routingMesh && ctx.state.routingMesh.waterModel) ? ctx.state.routingMesh.waterModel :
      (ctx.state.waterModel ? ctx.state.waterModel : null);

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

      // Persist for downstream determinism + debugging.
      ctx.state.waterSourceVertexIds = waterVertexIdsDerived;
      if (ctx.state.waterModel && typeof ctx.state.waterModel === "object") {
        ctx.state.waterModel.waterSourceVertexIds = waterVertexIdsDerived;
      }
      if (ctx.state.routingMesh && ctx.state.routingMesh.waterModel) {
        ctx.state.routingMesh.waterModel.waterSourceVertexIds = waterVertexIdsDerived;
      }
    }
  } catch (e) {
    // Keep silent here; resolveOptionalSources will record the main error path.
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

  stageMeta.sources.water = waterRes.ids;
  stageMeta.sourceErrors.water = waterRes.error;
  stageMeta.sources.waterDerivedFromEdges = !!(waterVertexIdsDerived && waterVertexIdsDerived.length);

  // ---------------------------------------------
  // 2) Build compute specs (deterministic ordering)
  // ---------------------------------------------

  const computeSpecs = [];
  computeSpecs.push(makeDistanceToPlazaVertexSpec(plazaSources));

  if (wallRes.ids && wallRes.ids.length > 0) computeSpecs.push(makeDistanceToWallVertexSpec(wallRes.ids));
  if (waterRes.ids && waterRes.ids.length > 0) computeSpecs.push(makeDistanceToWaterVertexSpec(waterRes.ids));

  stageMeta.computeSpecNames = computeSpecs.map((s) => String(s && s.name));

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
  //
  // IMPORTANT:
  // Some CityMesh variants do not provide a DCEL-style per-face boundary pointer.
  // Our meshAccess.faceBoundaryVertexIds(faceId) helper may throw in those cases.
  // Face fields are useful, but they are not required to proceed with Milestone 4.8,
  // so we only derive them if we can prove the helper works without throwing.
  
  let canDeriveFaceFields = false;
  if (typeof meshAccess.faceBoundaryVertexIds === "function") {
    try {
      // Probe exactly one face id in a deterministic way.
      // If this throws, we disable face derivation entirely.
      if (typeof meshAccess.iterFaceIds === "function") {
        const it = meshAccess.iterFaceIds();
        const first = it.next();
        if (!first.done) {
          const faceId = first.value;
          const b = meshAccess.faceBoundaryVertexIds(faceId);
          if (Array.isArray(b) && b.length > 0) canDeriveFaceFields = true;
        }
      }
    } catch (e) {
      canDeriveFaceFields = false;
      stageMeta.derivedFaceFieldsDisabledReason = formatErr(e);
    }
  }
  
  if (canDeriveFaceFields) {
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
      stageMeta.derived.push("distance_to_plaza_face");
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
      stageMeta.derived.push("distance_to_wall_face");
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
      stageMeta.derived.push("distance_to_water_face");
    }
  } else {
    // Record for debugging without failing the run.
    stageMeta.derivedFaceFieldsSkipped = true;
  }

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
