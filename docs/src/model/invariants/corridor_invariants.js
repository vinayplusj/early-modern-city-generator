// docs/src/model/invariants/corridor_invariants.js
// Corridor diagnostics and Milestone 4.8 corridor closure checks.

import { isFinitePoint } from "../../geom/primitives.js";
import { pushIfFalse } from "./invariant_utils.js";

function corridorAngleDeg(dir) {
  const ang = Math.atan2(dir?.y ?? 0, dir?.x ?? 0);
  return Math.round(((ang * 180) / Math.PI) * 10) / 10;
}

function countCorridorsByKind(corridorIntent, kind) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return 0;
  let n = 0;
  for (const c of corridorIntent.corridors) {
    if (c && c.kind === kind) n += 1;
  }
  return n;
}

function everyCorridorHasFiniteDir(corridorIntent) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return false;
  for (const c of corridorIntent.corridors) {
    if (!c || !Number.isFinite(c.dir?.x) || !Number.isFinite(c.dir?.y)) return false;
  }
  return true;
}

function everyCorridorHasFiniteWeight(corridorIntent) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return false;
  for (const c of corridorIntent.corridors) {
    if (!c || !Number.isFinite(c.weight)) return false;
  }
  return true;
}

export function logCorridorDiagnostics({ corridorIntent, params }) {
  if (corridorIntent && Array.isArray(corridorIntent.corridors)) {
    const corridors = corridorIntent.corridors;

    const summary = corridors.map((c) => ({
      kind: c.kind,
      weight: c.weight,
      deg: corridorAngleDeg(c.dir),
      dir: c.dir,
    }));

    console.info("[Corridors] intent", {
      count: corridors.length,
      centre: corridorIntent.centre,
      corridors: summary,
    });
  } else {
    console.info("[Corridors] intent", { count: 0 });
  }

  if (params && typeof params === "object") {
    const stretch = {
      strength: params.footprintStretchStrength,
      widthRad: params.footprintStretchWidthRad,
      clampMin: params.footprintStretchClampMin,
      clampMax: params.footprintStretchClampMax,
    };

    const hasAny =
      stretch.strength != null ||
      stretch.widthRad != null ||
      stretch.clampMin != null ||
      stretch.clampMax != null;

    if (hasAny) {
      console.info("[Footprint] corridor stretch params", stretch);
    }
  }
}

export function checkCorridorInvariants({ errors, corridorIntent, waterKind }) {
  const corridorCount = Array.isArray(corridorIntent?.corridors)
    ? corridorIntent.corridors.length
    : 0;

  const gateCorridorCount = countCorridorsByKind(corridorIntent, "gate");
  const waterCorridorCount = countCorridorsByKind(corridorIntent, "water");
  const newTownCorridorCount = countCorridorsByKind(corridorIntent, "newTown");

  pushIfFalse(
    errors,
    corridorIntent && Array.isArray(corridorIntent.corridors),
    "Milestone 4.8 invalid: missing corridorIntent.corridors"
  );

  if (corridorIntent && Array.isArray(corridorIntent.corridors)) {
    pushIfFalse(
      errors,
      isFinitePoint(corridorIntent.centre),
      "Milestone 4.8 invalid: corridorIntent.centre is missing or non-finite"
    );

    pushIfFalse(
      errors,
      corridorCount > 0,
      "Milestone 4.8 invalid: corridorIntent.corridors is empty"
    );

    pushIfFalse(
      errors,
      gateCorridorCount > 0,
      "Milestone 4.8 invalid: no gate corridors were published"
    );

    pushIfFalse(
      errors,
      everyCorridorHasFiniteDir(corridorIntent),
      "Milestone 4.8 invalid: one or more corridors has a non-finite direction"
    );

    pushIfFalse(
      errors,
      everyCorridorHasFiniteWeight(corridorIntent),
      "Milestone 4.8 invalid: one or more corridors has a non-finite weight"
    );

    if (waterKind !== "none") {
      pushIfFalse(
        errors,
        waterCorridorCount > 0,
        `Milestone 4.8 invalid: waterKind=${waterKind} but no water corridor was published`
      );
    }

    if (newTownCorridorCount === 0) {
      console.warn("[Corridors] no newTown corridor published");
    }
  }
}
