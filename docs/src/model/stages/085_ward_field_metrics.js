// docs/src/model/stages/085_ward_field_metrics.js
//
// Milestone 4.8: First consumer adoption (read-only).
// Compute ward-level scalar metrics from deterministic fields.
// Invariants:
// - No geometry changes.
// - No ward role changes.
// - Deterministic for same seed/params.

import { assert } from "../util/assert.js";

function get01Safe(fields, name, idx) {
  if (!fields || !fields.has(name)) return null;
  return fields.get01(name, idx);
}

export function runWardFieldMetricsStage(env) {
  assert(env && env.ctx && env.ctx.state, "runWardFieldMetricsStage: missing env.ctx.state.");
  const ctx = env.ctx;

  const wards = ctx.state.wards;
  const fields = ctx.state.fields;
  const fieldsMeta = ctx.state.fieldsMeta;

  if (!wards || !Array.isArray(wards) || !fields || !fieldsMeta) {
    ctx.state.wardFieldMeta = {
      stage: "085_ward_field_metrics",
      skipped: true,
      reason: "Missing wards or fields or fieldsMeta.",
    };
    return;
  }

  const wardIdToFaceId = Array.isArray(fieldsMeta.wardIdToFaceId) ? fieldsMeta.wardIdToFaceId : null;

  const preferFace = wardIdToFaceId &&
    fields.has("distance_to_plaza_face");

  let mapped = 0;
  let missing = 0;

  for (let i = 0; i < wards.length; i++) {
    const w = wards[i];
    if (!w) continue;

    let faceId = null;
    if (preferFace) {
      const wid = (w.id | 0);
      if (wid >= 0 && wid < wardIdToFaceId.length) {
        const fid = wardIdToFaceId[wid];
        if (Number.isInteger(fid) && fid >= 0) faceId = fid;
      }
    }

    if (preferFace && faceId == null) {
      missing++;
    } else if (preferFace) {
      mapped++;
    }

    // Write metrics. Always write the object shape deterministically.
    w.field = w.field || {};
    if (preferFace && faceId != null) {
      w.field.distPlaza01 = get01Safe(fields, "distance_to_plaza_face", faceId);
      w.field.distWall01 = get01Safe(fields, "distance_to_wall_face", faceId);
      w.field.distWater01 = get01Safe(fields, "distance_to_water_face", faceId);
      w.field._mode = "face";
      w.field._faceId = faceId;
    } else {
      // Vertex-mode metrics are not computed here to avoid introducing centroid->vertex coupling.
      // Keep explicit nulls so downstream code can branch deterministically.
      w.field.distPlaza01 = null;
      w.field.distWall01 = null;
      w.field.distWater01 = null;
      w.field._mode = "none";
      w.field._faceId = null;
    }
  }

  ctx.state.wardFieldMeta = {
    stage: "085_ward_field_metrics",
    preferFace,
    mapped,
    missing,
    fieldsUsed: {
      plaza: preferFace ? "distance_to_plaza_face" : null,
      wall: preferFace && fields.has("distance_to_wall_face") ? "distance_to_wall_face" : null,
      water: preferFace && fields.has("distance_to_water_face") ? "distance_to_water_face" : null,
    },
  };
}

export default runWardFieldMetricsStage;
