// docs/src/model/stages/900_debug_invariants.js
//
// Stage 900: Debug invariants and diagnostics.
//
// Refactor note:
// - This stage is now a thin orchestrator.
// - Invariant logic lives under docs/src/model/invariants/.
// - The public function signature is unchanged so stage_registry.js does not need to change.

import { inferWaterKind } from "../invariants/invariant_utils.js";
import { logRoutingDiagnostics } from "../invariants/routing_invariants.js";
import {
  logCorridorDiagnostics,
  checkCorridorInvariants,
} from "../invariants/corridor_invariants.js";
import { checkFortHullDiagnostics } from "../invariants/fort_hull_diagnostics.js";
import { checkAnchorInvariants } from "../invariants/anchor_invariants.js";
import { checkFieldInvariants } from "../invariants/field_invariants.js";
import { checkHullModelInvariants } from "../invariants/hull_invariants.js";

/**
 * @param {object} args
 */
export function runDebugInvariantsStage({
  debugEnabled,
  debugOut,

  cx,
  cy,
  fortHulls,

  vorGraph,
  primaryRoads,
  anchors,
  wallBase,
  outerBoundary,
  width,
  height,
  hasDock,
  waterModel,

  // Milestone 4.8+
  corridorIntent,
  params,

  // Optional but strongly recommended for Milestone 4.8 closure
  fieldsMeta,

  // Optional but strongly recommended for Milestone 4.9 publication checks
  hullModel,
  coreSet,
  innerHullModel,
  outerHullModel,
  hullProofs,
  citadelFit,
  coastGeometry,
}) {
  if (!debugEnabled) return;

  const errors = [];
  const waterKind = inferWaterKind({ params, waterModel });

  logRoutingDiagnostics({ vorGraph, primaryRoads });

  logCorridorDiagnostics({ corridorIntent, params });

  checkFortHullDiagnostics({
    errors,
    cx,
    cy,
    fortHulls,
  });

  checkCorridorInvariants({
    errors,
    corridorIntent,
    waterKind,
  });

  checkAnchorInvariants({
    errors,
    anchors,
    wallBase,
    outerBoundary,
    width,
    height,
    hasDock,
    waterModel,
  });

  checkFieldInvariants({
    errors,
    fieldsMeta,
    waterKind,
  });

  const { hullBundle, hasAnyHull49 } = checkHullModelInvariants({
    errors,
    waterKind,
    hullModel,
    coreSet,
    innerHullModel,
    outerHullModel,
    hullProofs,
    citadelFit,
    coastGeometry,
  });

  const ok = errors.length === 0;

  if (debugOut && typeof debugOut === "object") {
    debugOut.invariants = { ok, errors };

    if (corridorIntent) {
      debugOut.corridors = corridorIntent;
    }

    if (params && typeof params === "object") {
      debugOut.footprintStretch = {
        strength: params.footprintStretchStrength,
        widthRad: params.footprintStretchWidthRad,
        clampMin: params.footprintStretchClampMin,
        clampMax: params.footprintStretchClampMax,
      };
    }

    if (fieldsMeta) {
      debugOut.fieldsMeta = fieldsMeta;
    }

    if (hasAnyHull49) {
      debugOut.hullModel = hullBundle.hullModel || null;
      debugOut.coreSet = hullBundle.coreSet || null;
      debugOut.innerHullModel = hullBundle.innerHullModel || null;
      debugOut.outerHullModel = hullBundle.outerHullModel || null;
      debugOut.hullProofs = hullBundle.hullProofs || null;
      debugOut.citadelFit = hullBundle.citadelFit || null;
      debugOut.coastGeometry = hullBundle.coastGeometry || null;
    }
  }
}
