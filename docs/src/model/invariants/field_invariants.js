// docs/src/model/invariants/field_invariants.js
// Milestone 4.8 field completeness checks.

import { pushIfFalse } from "./invariant_utils.js";

function getFieldStageMeta(fieldsMeta) {
  if (!fieldsMeta || typeof fieldsMeta !== "object") return null;
  if (!fieldsMeta.stage || typeof fieldsMeta.stage !== "object") return null;
  return fieldsMeta.stage;
}

function getFieldStatsMap(fieldsMeta) {
  const stageMeta = getFieldStageMeta(fieldsMeta);
  if (!stageMeta || !stageMeta.fieldStats || typeof stageMeta.fieldStats !== "object") return null;
  return stageMeta.fieldStats;
}

function hasFiniteBounds(stats, fieldName) {
  if (!stats || typeof stats !== "object") return false;
  const rec = stats[fieldName];
  if (!rec || typeof rec !== "object") return false;
  return Number.isFinite(rec.min) && Number.isFinite(rec.max);
}

function hasDerivedField(stageMeta, fieldName) {
  const derived = Array.isArray(stageMeta?.derived) ? stageMeta.derived : [];
  return derived.includes(fieldName);
}

function isCompleteWardFaceMap(fieldsMeta) {
  const map = fieldsMeta?.wardIdToFaceId;
  if (!Array.isArray(map) || map.length === 0) return false;

  for (let i = 0; i < map.length; i++) {
    const faceId = map[i];
    if (!Number.isInteger(faceId) || faceId < 0) return false;
  }

  return true;
}

function getWardFaceMissingCount(fieldsMeta) {
  const map = fieldsMeta?.wardIdToFaceId;
  if (!Array.isArray(map)) return null;

  let missing = 0;
  for (let i = 0; i < map.length; i++) {
    const faceId = map[i];
    if (!Number.isInteger(faceId) || faceId < 0) missing++;
  }

  return missing;
}

export function checkFieldInvariants({ errors, fieldsMeta, wardFieldMeta, waterKind }) {
  if (!fieldsMeta) {
    console.warn("[Fields] fieldsMeta not provided to Stage 900; skipping 4.8 field closure checks");
    return;
  }

  const hasWater = waterKind !== "none";
  const stageMeta = getFieldStageMeta(fieldsMeta);
  const fieldStats = getFieldStatsMap(fieldsMeta);

  pushIfFalse(
    errors,
    !!stageMeta,
    "Milestone 4.8 invalid: fieldsMeta.stage is missing"
  );

  if (stageMeta) {
    const requiredFields = stageMeta.requiredFields || {};
    const computedFields = stageMeta.computedFields || {};

    pushIfFalse(
      errors,
      requiredFields.plaza === true,
      "Milestone 4.8 invalid: requiredFields.plaza must be true"
    );

    pushIfFalse(
      errors,
      requiredFields.wall === true,
      "Milestone 4.8 invalid: requiredFields.wall must be true"
    );

    if (hasWater) {
      pushIfFalse(
        errors,
        requiredFields.water === true,
        `Milestone 4.8 invalid: requiredFields.water must be true when waterKind=${waterKind}`
      );
    }

    pushIfFalse(
      errors,
      computedFields.plaza === true,
      "Milestone 4.8 invalid: distance_to_plaza_vertex was not computed"
    );

    pushIfFalse(
      errors,
      computedFields.wall === true,
      "Milestone 4.8 invalid: distance_to_wall_vertex was not computed"
    );

    if (hasWater) {
      pushIfFalse(
        errors,
        computedFields.water === true,
        `Milestone 4.8 invalid: distance_to_water_vertex was not computed when waterKind=${waterKind}`
      );
    }

    const sourceResolution = stageMeta.sourceResolution || {};
    const wallSourceMethod = sourceResolution.wall?.method || null;
    const waterSourceMethod = sourceResolution.water?.method || null;

    pushIfFalse(
      errors,
      !!wallSourceMethod && wallSourceMethod !== "unavailable",
      "Milestone 4.8 invalid: wall source resolution is unavailable"
    );

    if (hasWater) {
      pushIfFalse(
        errors,
        !!waterSourceMethod && waterSourceMethod !== "unavailable",
        "Milestone 4.8 invalid: water source resolution is unavailable"
      );
    }

    pushIfFalse(
      errors,
      hasDerivedField(stageMeta, "distance_to_plaza_face"),
      "Milestone 4.8 invalid: distance_to_plaza_face was not derived"
    );

    pushIfFalse(
      errors,
      hasDerivedField(stageMeta, "distance_to_wall_face"),
      "Milestone 4.8 invalid: distance_to_wall_face was not derived"
    );

    if (hasWater) {
      pushIfFalse(
        errors,
        hasDerivedField(stageMeta, "distance_to_water_face"),
        `Milestone 4.8 invalid: distance_to_water_face was not derived when waterKind=${waterKind}`
      );
    }

    const wardToFaceCompleteness = stageMeta.wardToFaceCompleteness || null;

    pushIfFalse(
      errors,
      isCompleteWardFaceMap(fieldsMeta),
      `Milestone 4.8 invalid: fieldsMeta.wardIdToFaceId is incomplete (missing=${getWardFaceMissingCount(fieldsMeta) ?? "unknown"})`
    );

    pushIfFalse(
      errors,
      wardToFaceCompleteness?.complete === true,
      `Milestone 4.8 invalid: wardToFaceCompleteness.complete must be true (missing=${wardToFaceCompleteness?.missingWardFaceCount ?? "unknown"})`
    );
  }

  pushIfFalse(
    errors,
    !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_plaza_vertex"),
    "Milestone 4.8 invalid: distance_to_plaza_vertex is missing finite bounds"
  );

  pushIfFalse(
    errors,
    !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_wall_vertex"),
    "Milestone 4.8 invalid: distance_to_wall_vertex is missing finite bounds"
  );

  if (hasWater) {
    pushIfFalse(
      errors,
      !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_water_vertex"),
      `Milestone 4.8 invalid: distance_to_water_vertex is missing finite bounds when waterKind=${waterKind}`
    );
  }

  pushIfFalse(
    errors,
    !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_plaza_face"),
    "Milestone 4.8 invalid: distance_to_plaza_face is missing finite bounds"
  );

  pushIfFalse(
    errors,
    !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_wall_face"),
    "Milestone 4.8 invalid: distance_to_wall_face is missing finite bounds"
  );

  if (hasWater) {
    pushIfFalse(
      errors,
      !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_water_face"),
      `Milestone 4.8 invalid: distance_to_water_face is missing finite bounds when waterKind=${waterKind}`
    );
  }

  pushIfFalse(
    errors,
    !!wardFieldMeta,
    "Milestone 4.8 invalid: wardFieldMeta is missing"
  );

  if (wardFieldMeta) {
    pushIfFalse(
      errors,
      wardFieldMeta.preferFace === true,
      "Milestone 4.8 invalid: wardFieldMeta.preferFace must be true"
    );

    pushIfFalse(
      errors,
      Number.isInteger(wardFieldMeta.mapped) && wardFieldMeta.mapped > 0,
      "Milestone 4.8 invalid: wardFieldMeta.mapped must be a positive integer"
    );

    pushIfFalse(
      errors,
      wardFieldMeta.missing === 0,
      `Milestone 4.8 invalid: wardFieldMeta.missing must be 0, got ${wardFieldMeta.missing}`
    );

    pushIfFalse(
      errors,
      wardFieldMeta.fieldsUsed?.plaza === "distance_to_plaza_face",
      "Milestone 4.8 invalid: wards must use distance_to_plaza_face"
    );

    pushIfFalse(
      errors,
      wardFieldMeta.fieldsUsed?.wall === "distance_to_wall_face",
      "Milestone 4.8 invalid: wards must use distance_to_wall_face"
    );

    if (hasWater) {
      pushIfFalse(
        errors,
        wardFieldMeta.fieldsUsed?.water === "distance_to_water_face",
        `Milestone 4.8 invalid: wards must use distance_to_water_face when waterKind=${waterKind}`
      );
    }
  }
}
