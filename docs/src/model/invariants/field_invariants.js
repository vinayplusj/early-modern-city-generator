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

export function checkFieldInvariants({ errors, fieldsMeta, waterKind }) {
  if (!fieldsMeta) {
    console.warn("[Fields] fieldsMeta not provided to Stage 900; skipping 4.8 field closure checks");
    return;
  }

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

    if (waterKind !== "none") {
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

    if (waterKind !== "none") {
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

    if (waterKind !== "none") {
      pushIfFalse(
        errors,
        !!waterSourceMethod && waterSourceMethod !== "unavailable",
        "Milestone 4.8 invalid: water source resolution is unavailable"
      );
    }
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

  if (waterKind !== "none") {
    pushIfFalse(
      errors,
      !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_water_vertex"),
      `Milestone 4.8 invalid: distance_to_water_vertex is missing finite bounds when waterKind=${waterKind}`
    );
  }
}
