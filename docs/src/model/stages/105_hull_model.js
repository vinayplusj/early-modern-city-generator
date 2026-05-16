// docs/src/model/stages/105_hull_model.js
//
// Stage 105: canonical hull model orchestration.
//
// This file is intentionally thin. Hull-domain logic lives in ../hull/*.js.

import { assert } from "../util/assert.js";
import { buildCoreSet } from "../hull/core_set.js";
import { buildHullModel } from "../hull/hull_model.js";
import { buildHullProofs } from "../hull/hull_proofs.js";
import { buildOptimisedInnerHullModel } from "../hull/inner_hull_refine.js";
import { buildOptimisedOuterHullModel } from "../hull/outer_hull_refine.js";
import { buildCitadelFit } from "../hull/citadel_fit.js";
import { buildCoastGeometry } from "../hull/coast_geometry.js";

export function runHullModelStage({ ctx, cx, cy }) {
  assert(ctx && ctx.state, "runHullModelStage: missing ctx.state.");

  const wardsState = ctx.state.wards;
  const anchors = ctx.state.anchors;
  const citadel = ctx.state.citadel;
  const waterModel = ctx.state.waterModel;

  assert(wardsState?.fortHulls, "[EMCG][105] Missing ctx.state.wards.fortHulls.");
  assert(anchors, "[EMCG][105] Missing ctx.state.anchors.");

  const fortHulls = wardsState.fortHulls;
  const coreSet = buildCoreSet({ wardsState, anchors, citadel });

  const legacyInnerHullModel = buildHullModel(
    "innerHull",
    fortHulls.innerHull,
    coreSet.coreIdsForHull,
    coreSet.coreWardIds,
    { objective: { mode: "legacy_core_union_outer_loop" } }
  );

  // First pass: build outer hull against the legacy inner hull.
  // The accepted inner hull then uses this outer constraint.
  const outerHullModelPass1 = buildOptimisedOuterHullModel({
    ctx,
    cx,
    cy,
    wardsState,
    coreSet,
    legacyHull: fortHulls.outerHull,
    innerHullModel: legacyInnerHullModel,
  });

  const innerHullModel = buildOptimisedInnerHullModel({
    cx,
    cy,
    wardsState,
    anchors,
    citadel,
    coreSet,
    legacyHull: fortHulls.innerHull,
    outerHullModel: outerHullModelPass1,
  });

  // Second pass: rebuild the outer hull against the accepted inner hull.
  // This ensures the final outer model is tested against the final inner model,
  // not only the legacy inner shape.
  const outerHullModel = buildOptimisedOuterHullModel({
    ctx,
    cx,
    cy,
    wardsState,
    coreSet,
    legacyHull: fortHulls.outerHull,
    innerHullModel,
  });

  const hullProofs = buildHullProofs({
    cx,
    cy,
    wardsState,
    coreSet,
    innerHullModel,
    outerHullModel,
  });

  const citadelFit = buildCitadelFit({
    citadel,
    wardsState,
    coreSet,
    innerHullModel,
    anchors,
  });

  if (Array.isArray(citadelFit?.poly) && citadelFit.poly.length >= 3) {
    ctx.state.citadel = citadelFit.poly;
  }

  const coastGeometry = buildCoastGeometry({
    waterModel,
    outerBoundary: ctx.state.outerBoundary ?? null,
    waterIntent: ctx.state.waterIntent ?? null,
    cx,
    cy,
  });

  const hullModel = {
    coreSet,
    innerHull: innerHullModel,
    outerHull: outerHullModel,
    hullProofs,
    citadelFit,
    coastGeometry,
  };

  ctx.state.hullModel = hullModel;

  // Canonical aliases for later stages.
  ctx.state.coreSet = coreSet;
  ctx.state.innerHullModel = innerHullModel;
  ctx.state.outerHullModel = outerHullModel;
  ctx.state.hullProofs = hullProofs;
  ctx.state.citadelFit = citadelFit;
  ctx.state.coastGeometry = coastGeometry;

  return hullModel;
}

export default runHullModelStage;
