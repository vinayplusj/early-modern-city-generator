// docs/src/model/fields/derive_face_fields.js
//
// Helper for Stage 075: derive face-domain distance fields from vertex-domain distance fields
// using deterministic boundary reduction.
//
// Contract:
// - This is optional. If meshAccess lacks face boundary accessors, it will skip and record a reason.
// - It never changes vertex fields.
// - It updates `fields` by adding face fields, and annotates `stageMeta` (if provided).
//
// Hidden coupling:
// - meshAccess.faceBoundaryVertexIds(faceId) must be deterministic for a given CityMesh.
// - face ids must be stable (no reindexing between stages).

import { deriveFaceFieldFromBoundaryVertices } from "../fields/distance_fields.js";
import { computeMinMax, formatErr, assert } from "../fields/fields_stage_utils.js";

function pickDeterministicProbeFaceId(meshAccess) {
  // Prefer faceId = 0 when a faceCount is available. This avoids reliance on iterator ordering.
  if (typeof meshAccess.faceCount === "function") {
    const n = meshAccess.faceCount();
    if (Number.isFinite(n) && n > 0) return 0;
  }

  // Fallback to the first iterated face id, but record that this depends on iterator ordering.
  if (typeof meshAccess.iterFaceIds === "function") {
    const it = meshAccess.iterFaceIds();
    const first = it.next();
    if (!first.done) return first.value;
  }

  return null;
}

function canDeriveFaceFields(meshAccess, stageMeta) {
  if (typeof meshAccess.faceBoundaryVertexIds !== "function") {
    if (stageMeta) stageMeta.derivedFaceFieldsDisabledReason = "meshAccess.faceBoundaryVertexIds is not available.";
    return { ok: false, probeFaceId: null };
  }

  const probeFaceId = pickDeterministicProbeFaceId(meshAccess);
  if (probeFaceId == null) {
    if (stageMeta) stageMeta.derivedFaceFieldsDisabledReason = "No face ids available (faceCount=0 or iterFaceIds missing/empty).";
    return { ok: false, probeFaceId: null };
  }

  try {
    const boundary = meshAccess.faceBoundaryVertexIds(probeFaceId);
    if (!Array.isArray(boundary) || boundary.length === 0) {
      if (stageMeta) stageMeta.derivedFaceFieldsDisabledReason = `Boundary probe returned empty for probeFaceId=${probeFaceId}.`;
      return { ok: false, probeFaceId };
    }
    if (stageMeta) stageMeta.derivedFaceFieldsProbeFaceId = probeFaceId;
    return { ok: true, probeFaceId };
  } catch (e) {
    if (stageMeta) stageMeta.derivedFaceFieldsDisabledReason = formatErr(e);
    return { ok: false, probeFaceId };
  }
}

function addFaceFieldMinFromVertexField({ fields, meshAccess, vertexFieldName, faceFieldName, description, stageMeta }) {
  const vRec = fields.get(vertexFieldName);
  assert(vRec && vRec.values, `Missing vertex field required for derivation: ${vertexFieldName}`);

  const faceVals = deriveFaceFieldFromBoundaryVertices({
    meshAccess,
    vertexValues: vRec.values,
    mode: "min",
  });

  fields.add(
    {
      name: faceFieldName,
      domain: "face",
      version: 1,
      units: "map_units",
      description,
      source: `deriveFaceFieldFromBoundaryVertices(min) from ${vertexFieldName}`,
    },
    faceVals
  );

  const fRec = fields.get(faceFieldName);
  const mm = computeMinMax(fRec.values);

  if (stageMeta) {
    stageMeta.derived = stageMeta.derived || [];
    stageMeta.fieldStats = stageMeta.fieldStats || {};
    stageMeta.derived.push(faceFieldName);
    stageMeta.fieldStats[faceFieldName] = {
      min: mm.min,
      max: mm.max,
      domain: "face",
      units: "map_units",
    };
  }
}

/**
 * Derive base face fields for plaza/wall/water distance fields.
 *
 * @param {object} args
 * @param {object} args.fields FieldRegistry
 * @param {object} args.meshAccess mesh access adapter from makeMeshAccessFromCityMesh
 * @param {object} [args.stageMeta] optional stage meta accumulator (will be mutated)
 * @returns {object} result { derivedNames: string[], skipped: boolean, skippedReason: string|null, probeFaceId: number|null }
 */
export function deriveBaseFaceFields({ fields, meshAccess, stageMeta = null }) {
  assert(fields, "deriveBaseFaceFields: missing fields.");
  assert(meshAccess, "deriveBaseFaceFields: missing meshAccess.");

  const res = canDeriveFaceFields(meshAccess, stageMeta);

  const out = {
    derivedNames: [],
    skipped: !res.ok,
    skippedReason: res.ok ? null : (stageMeta && stageMeta.derivedFaceFieldsDisabledReason) ? stageMeta.derivedFaceFieldsDisabledReason : "Face derivation disabled.",
    probeFaceId: res.probeFaceId,
  };

  if (!res.ok) {
    if (stageMeta) stageMeta.derivedFaceFieldsSkipped = true;
    return out;
  }

  // Always derive plaza face field if plaza vertex field exists.
  if (fields.has("distance_to_plaza_vertex")) {
    addFaceFieldMinFromVertexField({
      fields,
      meshAccess,
      vertexFieldName: "distance_to_plaza_vertex",
      faceFieldName: "distance_to_plaza_face",
      description: "Boundary-min of distance_to_plaza_vertex.",
      stageMeta,
    });
    out.derivedNames.push("distance_to_plaza_face");
  }

  // Derive wall face field if wall vertex field exists.
  if (fields.has("distance_to_wall_vertex")) {
    addFaceFieldMinFromVertexField({
      fields,
      meshAccess,
      vertexFieldName: "distance_to_wall_vertex",
      faceFieldName: "distance_to_wall_face",
      description: "Boundary-min of distance_to_wall_vertex.",
      stageMeta,
    });
    out.derivedNames.push("distance_to_wall_face");
  }

  // Derive water face field if water vertex field exists.
  if (fields.has("distance_to_water_vertex")) {
    addFaceFieldMinFromVertexField({
      fields,
      meshAccess,
      vertexFieldName: "distance_to_water_vertex",
      faceFieldName: "distance_to_water_face",
      description: "Boundary-min of distance_to_water_vertex.",
      stageMeta,
    });
    out.derivedNames.push("distance_to_water_face");
  }

  // Keep out.derivedNames in sync with stageMeta.derived (if provided).
  return out;
}

export default deriveBaseFaceFields;
