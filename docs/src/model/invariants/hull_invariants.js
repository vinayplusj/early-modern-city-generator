// docs/src/model/invariants/hull_invariants.js
// Milestone 4.9 hull-model publication, proof, and geometry-contract checks.

import { countMissingWardIds, pushIfFalse } from "./invariant_utils.js";

function isBoolResult(value) {
  return !!(value && typeof value === "object" && typeof value.ok === "boolean");
}

function polyPointCount(poly) {
  return Array.isArray(poly) ? poly.length : 0;
}

function hasPolygon(poly) {
  return Array.isArray(poly) && poly.length >= 3;
}

export function resolveHullBundle({
  hullModel,
  coreSet,
  innerHullModel,
  outerHullModel,
  hullProofs,
  citadelFit,
  coastGeometry,
}) {
  const model = (hullModel && typeof hullModel === "object") ? hullModel : null;

  return {
    hullModel: model,
    coreSet: coreSet || model?.coreSet || null,
    innerHullModel: innerHullModel || model?.innerHull || null,
    outerHullModel: outerHullModel || model?.outerHull || null,
    hullProofs: hullProofs || model?.hullProofs || null,
    citadelFit: citadelFit || model?.citadelFit || null,
    coastGeometry: coastGeometry || model?.coastGeometry || null,
  };
}

export function checkHullModelInvariants({
  errors,
  waterKind,
  hullModel,
  coreSet,
  innerHullModel,
  outerHullModel,
  hullProofs,
  citadelFit,
  coastGeometry,
}) {
  const hullBundle = resolveHullBundle({
    hullModel,
    coreSet,
    innerHullModel,
    outerHullModel,
    hullProofs,
    citadelFit,
    coastGeometry,
  });

  const hasAnyHull49 =
    !!hullBundle.hullModel ||
    !!hullBundle.coreSet ||
    !!hullBundle.innerHullModel ||
    !!hullBundle.outerHullModel ||
    !!hullBundle.hullProofs ||
    !!hullBundle.citadelFit ||
    !!hullBundle.coastGeometry;

  if (!hasAnyHull49) {
    console.warn("[HullModel] 4.9 outputs not provided to Stage 900; skipping 4.9 publication checks");
    return { hullBundle, hasAnyHull49 };
  }

  const innerRefinement =
    hullBundle.innerHullModel?.refinement ??
    hullBundle.innerHullModel?.diagnostics?.refinement ??
    null;

  const outerRefinement =
    hullBundle.outerHullModel?.refinement ??
    hullBundle.outerHullModel?.diagnostics?.refinement ??
    null;

  const innerObjectiveMode = hullBundle.innerHullModel?.objective?.mode ?? null;
  const outerObjectiveMode = hullBundle.outerHullModel?.objective?.mode ?? null;

  console.info("[HullModel] summary", {
    hasHullModel: !!hullBundle.hullModel,
    hasCoreSet: !!hullBundle.coreSet,
    hasInnerHullModel: !!hullBundle.innerHullModel,
    hasOuterHullModel: !!hullBundle.outerHullModel,
    hasHullProofs: !!hullBundle.hullProofs,
    hasCitadelFit: !!hullBundle.citadelFit,
    hasCoastGeometry: !!hullBundle.coastGeometry,

    innerPointCount: polyPointCount(hullBundle.innerHullModel?.poly),
    outerPointCount: polyPointCount(hullBundle.outerHullModel?.poly),

    innerObjectiveMode,
    outerObjectiveMode,

    innerRefinementAttempted: innerRefinement?.attempted ?? null,
    innerRefinementAccepted: innerRefinement?.accepted ?? null,
    outerRefinementAttempted: outerRefinement?.attempted ?? null,
    outerRefinementAccepted: outerRefinement?.accepted ?? null,

    citadelFitMode: hullBundle.citadelFit?.fitMode ?? null,
    coastFitMode: hullBundle.coastGeometry?.fitMode ?? null,
  });

  // ---- Required 4.9 publications ----
  pushIfFalse(errors, !!hullBundle.hullModel, "Milestone 4.9 invalid: hullModel is missing");
  pushIfFalse(errors, !!hullBundle.coreSet, "Milestone 4.9 invalid: coreSet is missing");
  pushIfFalse(errors, !!hullBundle.innerHullModel, "Milestone 4.9 invalid: innerHullModel is missing");
  pushIfFalse(errors, !!hullBundle.outerHullModel, "Milestone 4.9 invalid: outerHullModel is missing");
  pushIfFalse(errors, !!hullBundle.hullProofs, "Milestone 4.9 invalid: hullProofs is missing");
  pushIfFalse(errors, !!hullBundle.citadelFit, "Milestone 4.9 invalid: citadelFit is missing");

  // ---- Core set contract ----
  if (hullBundle.coreSet) {
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.coreSet.coreWardIds),
      "Milestone 4.9 invalid: coreSet.coreWardIds must be an array"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.coreSet.innerWardIds),
      "Milestone 4.9 invalid: coreSet.innerWardIds must be an array"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.coreSet.coreIdsForHull),
      "Milestone 4.9 invalid: coreSet.coreIdsForHull must be an array"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.coreSet.outerIdsForHull),
      "Milestone 4.9 invalid: coreSet.outerIdsForHull must be an array"
    );
  }

  // ---- Inner hull contract ----
  if (hullBundle.innerHullModel) {
    pushIfFalse(
      errors,
      hasPolygon(hullBundle.innerHullModel.poly),
      "Milestone 4.9 invalid: innerHullModel.poly is missing or too short"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.innerHullModel.memberWardIds),
      "Milestone 4.9 invalid: innerHullModel.memberWardIds must be an array"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.innerHullModel.sourceWardIds),
      "Milestone 4.9 invalid: innerHullModel.sourceWardIds must be an array"
    );

    pushIfFalse(
      errors,
      innerRefinement && innerRefinement.attempted === true,
      "Milestone 4.9 invalid: inner hull refinement was not attempted"
    );

    const innerKnownMode =
      innerObjectiveMode === "radial_star_profile_inside_legacy" ||
      innerObjectiveMode === "legacy_core_union_outer_loop";

    pushIfFalse(
      errors,
      innerKnownMode,
      `Milestone 4.9 invalid: unexpected inner hull objective mode: ${innerObjectiveMode}`
    );

    if (innerRefinement && innerRefinement.attempted === true && innerRefinement.accepted !== true) {
      console.warn("[HullModel] inner hull refinement fell back to legacy hull", {
        reason: innerRefinement.reason ?? "unknown",
      });
    }
  }

  // ---- Outer hull contract ----
  if (hullBundle.outerHullModel) {
    pushIfFalse(
      errors,
      hasPolygon(hullBundle.outerHullModel.poly),
      "Milestone 4.9 invalid: outerHullModel.poly is missing or too short"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.outerHullModel.memberWardIds),
      "Milestone 4.9 invalid: outerHullModel.memberWardIds must be an array"
    );
    pushIfFalse(
      errors,
      Array.isArray(hullBundle.outerHullModel.sourceWardIds),
      "Milestone 4.9 invalid: outerHullModel.sourceWardIds must be an array"
    );

    pushIfFalse(
      errors,
      outerRefinement && outerRefinement.attempted === true,
      "Milestone 4.9 invalid: outer hull refinement was not attempted"
    );

    const outerKnownMode =
      outerObjectiveMode === "ring1_plus_new_town_lobes_inside_legacy" ||
      outerObjectiveMode === "legacy_core_plus_ring1_outer_loop";

    pushIfFalse(
      errors,
      outerKnownMode,
      `Milestone 4.9 invalid: unexpected outer hull objective mode: ${outerObjectiveMode}`
    );

    if (outerRefinement && outerRefinement.attempted === true && outerRefinement.accepted !== true) {
      console.warn("[HullModel] outer hull refinement fell back to legacy hull", {
        reason: outerRefinement.reason ?? "unknown",
      });
    }
  }

  // ---- Hull proof contract ----
  if (hullBundle.hullProofs) {
    const proofs = hullBundle.hullProofs;

    pushIfFalse(
      errors,
      isBoolResult(proofs.centreInInnerHull),
      "Milestone 4.9 invalid: hullProofs.centreInInnerHull is missing or malformed"
    );
    pushIfFalse(
      errors,
      isBoolResult(proofs.centreInOuterHull),
      "Milestone 4.9 invalid: hullProofs.centreInOuterHull is missing or malformed"
    );
    pushIfFalse(
      errors,
      isBoolResult(proofs.innerHullInsideOuterHullSampled),
      "Milestone 4.9 invalid: hullProofs.innerHullInsideOuterHullSampled is missing or malformed"
    );
    pushIfFalse(
      errors,
      isBoolResult(proofs.coreMembersInsideInnerHull),
      "Milestone 4.9 invalid: hullProofs.coreMembersInsideInnerHull is missing or malformed"
    );
    pushIfFalse(
      errors,
      isBoolResult(proofs.claimedOuterMembersInsideOuterHull),
      "Milestone 4.9 invalid: hullProofs.claimedOuterMembersInsideOuterHull is missing or malformed"
    );

    if (isBoolResult(proofs.centreInInnerHull)) {
      pushIfFalse(errors, proofs.centreInInnerHull.ok === true, "Milestone 4.9 invalid: centreInInnerHull proof failed");
    }
    if (isBoolResult(proofs.centreInOuterHull)) {
      pushIfFalse(errors, proofs.centreInOuterHull.ok === true, "Milestone 4.9 invalid: centreInOuterHull proof failed");
    }
    if (isBoolResult(proofs.innerHullInsideOuterHullSampled)) {
      pushIfFalse(
        errors,
        proofs.innerHullInsideOuterHullSampled.ok === true,
        `Milestone 4.9 invalid: innerHullInsideOuterHullSampled proof failed (fails=${proofs.innerHullInsideOuterHullSampled.fails ?? "?"})`
      );
    }
    if (isBoolResult(proofs.coreMembersInsideInnerHull)) {
      pushIfFalse(
        errors,
        proofs.coreMembersInsideInnerHull.ok === true,
        `Milestone 4.9 invalid: coreMembersInsideInnerHull proof failed (missing=${countMissingWardIds(proofs.coreMembersInsideInnerHull)})`
      );
    }
    if (isBoolResult(proofs.claimedOuterMembersInsideOuterHull)) {
      pushIfFalse(
        errors,
        proofs.claimedOuterMembersInsideOuterHull.ok === true,
        `Milestone 4.9 invalid: claimedOuterMembersInsideOuterHull proof failed (missing=${countMissingWardIds(proofs.claimedOuterMembersInsideOuterHull)})`
      );
    }
  }

  // ---- Citadel fit contract ----
  if (hullBundle.citadelFit) {
    const requireCitadelPoly = hullBundle.coreSet?.hasCitadelGeometry === true;
    const fitMode = hullBundle.citadelFit.fitMode ?? null;

    const allowedCitadelFitMode =
      fitMode === "radial_ward_fit" ||
      fitMode === "legacy_fallback";

    pushIfFalse(
      errors,
      allowedCitadelFitMode,
      `Milestone 4.9 invalid: unexpected citadelFit.fitMode: ${fitMode}`
    );

    if (requireCitadelPoly) {
      pushIfFalse(
        errors,
        hasPolygon(hullBundle.citadelFit.poly),
        "Milestone 4.9 invalid: citadelFit.poly is missing or too short"
      );
    }

    pushIfFalse(
      errors,
      "wardId" in hullBundle.citadelFit,
      "Milestone 4.9 invalid: citadelFit.wardId is missing"
    );

    if (fitMode === "radial_ward_fit") {
      pushIfFalse(
        errors,
        hullBundle.citadelFit.insideCitadelWard !== false,
        "Milestone 4.9 invalid: fitted citadel geometry falls outside the citadel ward"
      );

      pushIfFalse(
        errors,
        hullBundle.citadelFit.insideInnerHull !== false,
        "Milestone 4.9 invalid: fitted citadel geometry falls outside the inner hull"
      );
    }

    if (fitMode === "legacy_fallback") {
      console.warn("[HullModel] citadel fit fell back to legacy geometry", {
        reason: hullBundle.citadelFit.diagnostics?.reason ?? hullBundle.citadelFit.reason ?? "unknown",
      });
    }
  }

  // ---- Coast-neighbour curve contract ----
  if (waterKind === "coast") {
    pushIfFalse(
      errors,
      !!hullBundle.coastGeometry,
      "Milestone 4.9 invalid: coastGeometry is missing for coast water"
    );

    if (hullBundle.coastGeometry) {
      const fitMode = hullBundle.coastGeometry.fitMode ?? null;

      const allowedCoastFitMode =
        fitMode === "outer_boundary_neighbour_curve" ||
        fitMode === "water_model_curve_fallback" ||
        fitMode === "water_model_shoreline_fallback" ||
        fitMode === "legacy_water_model_curve";

      pushIfFalse(
        errors,
        hullBundle.coastGeometry.kind === "coast_curve",
        "Milestone 4.9 invalid: coastGeometry.kind must be coast_curve"
      );

      pushIfFalse(
        errors,
        Array.isArray(hullBundle.coastGeometry.curve) && hullBundle.coastGeometry.curve.length >= 2,
        "Milestone 4.9 invalid: coastGeometry.curve is missing or too short"
      );

      pushIfFalse(
        errors,
        hullBundle.coastGeometry.diagnostics?.neighboursOuterBoundary === true,
        "Milestone 4.9 invalid: coastGeometry must report neighboursOuterBoundary=true"
      );

      pushIfFalse(
        errors,
        hullBundle.coastGeometry.diagnostics?.intersectsOuterBoundaryAsPolygon === false,
        "Milestone 4.9 invalid: coastGeometry must report intersectsOuterBoundaryAsPolygon=false"
      );

      pushIfFalse(
        errors,
        allowedCoastFitMode,
        `Milestone 4.9 invalid: unexpected coastGeometry.fitMode: ${fitMode}`
      );

      if (fitMode === "outer_boundary_neighbour_curve") {
        pushIfFalse(
          errors,
          hullBundle.coastGeometry.source === "outerBoundary_seaward_segment",
          `Milestone 4.9 invalid: coastGeometry.source must be outerBoundary_seaward_segment when fitMode=${fitMode}`
        );

        pushIfFalse(
          errors,
          hullBundle.coastGeometry.diagnostics?.curveLiesOnOuterBoundary === true,
          "Milestone 4.9 invalid: coastGeometry boundary-neighbour curve must lie on outerBoundary"
        );
      } else {
        console.warn("[HullModel] coast geometry used fallback curve", {
          fitMode,
          source: hullBundle.coastGeometry.source ?? null,
        });
      }
    }
  }

  return { hullBundle, hasAnyHull49 };
}
