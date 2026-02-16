// docs/src/model/stages/150_outworks.js
//
// Stage 150: Outworks (ravelins).
// Extracted from generate.js without functional changes.

import { makeRavelin } from "../features.js";
import { clampPolylineRadial } from "../generate_helpers/warp_stage.js";
import { auditRadialClamp } from "../debug/fortwarp_audit.js";

/**
 * @param {object} args
 * @returns {Array<Array<{x:number,y:number}>>} ravelins
 */
export function runOutworksStage({
  gatesWarped,
  primaryGateWarped,
  cx,
  cy,
  fortR,
  ditchWidth,
  glacisWidth,
  newTown,
  bastionCount,
  bastionPolysWarpedSafe,
  wallForOutworks,
  warpOutworks,
  warpDebugEnabled,
}) {
  let ravelins = (gatesWarped || [])
    .filter((g) => !(primaryGateWarped && g.idx === primaryGateWarped.idx))
    .map((g) =>
      makeRavelin(
        g,
        cx,
        cy,
        fortR,
        ditchWidth,
        glacisWidth,
        newTown ? newTown.poly : null,
        bastionCount,
        bastionPolysWarpedSafe,
        wallForOutworks
      )
    )
    .filter(Boolean);

  if (warpOutworks?.minField || warpOutworks?.maxField) {
    ravelins = ravelins.map((rv) =>
      clampPolylineRadial(
        rv,
        { x: cx, y: cy },
        warpOutworks.minField,
        warpOutworks.maxField,
        warpOutworks.clampMinMargin,
        warpOutworks.clampMaxMargin
      )
    );
  }

  if (warpDebugEnabled) {
    auditRadialClamp({
      name: "RAVELINS",
      polys: ravelins,
      minField: warpOutworks?.minField,
      maxField: warpOutworks?.maxField,
      cx,
      cy,
      minMargin: warpOutworks?.clampMinMargin,
      maxMargin: warpOutworks?.clampMaxMargin,
      debugEnabled: true,
    });
  }

  return ravelins;
}
