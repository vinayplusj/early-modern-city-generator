// docs/src/model/invariants/invariant_utils.js
// Shared helpers for Stage 900 invariant checks.

import { finitePointOrNull } from "../../geom/primitives.js";

export function resolveDockPoint(anchors) {
  if (finitePointOrNull(anchors?.docks)) {
    return anchors.docks;
  }

  if (finitePointOrNull(anchors?.docks?.docks)) {
    return anchors.docks.docks;
  }

  if (finitePointOrNull(anchors?.docks?.anchor)) {
    return anchors.docks.anchor;
  }

  if (finitePointOrNull(anchors?.docks?.point)) {
    return anchors.docks.point;
  }

  return null;
}

export function inferWaterKind({ params, waterModel }) {
  if (params && typeof params.waterKind === "string" && params.waterKind.length > 0) {
    return params.waterKind;
  }
  if (waterModel && typeof waterModel.kind === "string" && waterModel.kind.length > 0) {
    return waterModel.kind;
  }
  return "none";
}

export function pushIfFalse(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function countMissingWardIds(result) {
  return Array.isArray(result?.missingWardIds) ? result.missingWardIds.length : 0;
}
