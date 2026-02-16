// docs/src/model/stages/20_new_town.js
//
// Stage 20: New Town placement.
// Extracted from generate.js without functional changes.

import { placeNewTown } from "../generate_helpers/new_town.js";

/**
 * @param {object} args
 * @returns {object} stage outputs
 */
export function runNewTownStage({
  ctx,
  gates,
  bastions,
  cx,
  cy,
  wallR,
  baseR,
  ditchOuter,
  wallBase,
  ditchWidth,
  glacisWidth,
  wallFinal,
  bastionPolys,
  warpDebugEnabled,
}) {
  // ---------------- New Town placement ----------------
  const placed = placeNewTown({
    rng: ctx.rng.newTown,
    gates,
    bastions,
    cx,
    cy,
    wallR,
    baseR,
    ditchOuter,
    wallBase,
    ditchWidth,
    glacisWidth,
    wallFinal,
    bastionPolys,
  });

  let newTown = placed.newTown;
  const primaryGate = placed.primaryGate;

  // Keep the same fallback logic.
  const wallFinalOut = (placed.wallFinal && Array.isArray(placed.wallFinal)) ? placed.wallFinal : wallFinal;
  const bastionPolysOut = (placed.bastionPolys && Array.isArray(placed.bastionPolys)) ? placed.bastionPolys : bastionPolys;

  if (warpDebugEnabled) {
    const okLen =
      Array.isArray(bastionPolysOut) &&
      Array.isArray(bastions) &&
      bastionPolysOut.length === bastions.length;

    if (!okLen) {
      throw new Error("bastionPolys length must match bastions length");
    }
  }

  const hitBastionSet = new Set(placed.hitBastions || []);
  const bastionsForWarp = (bastions || []).filter((_, i) => !hitBastionSet.has(i));

  return {
    placed,
    newTown,
    primaryGate,
    wallFinal: wallFinalOut,
    bastionPolys: bastionPolysOut,
    bastionsForWarp,
  };
}
