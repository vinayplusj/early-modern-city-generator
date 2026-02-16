// docs/src/model/stages/900_debug_invariants.js
//
// Stage 900: Debug invariants and diagnostics.
// Extracted from generate.js without functional changes.

import { finitePointOrNull, clampPointToCanvas } from "../../geom/primitives.js";
import { pointInPolyOrOn } from "../../geom/poly.js";
import { isInsidePolyOrSkip } from "../geom/is_inside_poly_or_skip.js";

/**
 * @param {object} args
 */
export function runDebugInvariantsStage({
  debugEnabled,
  vorGraph,
  primaryRoads,
  anchors,
  wallBase,
  outerBoundary,
  width,
  height,
  hasDock,
  waterModel,
}) {
  if (!debugEnabled) return;

  const bad = [];

  console.info("[Routing] vorGraph", {
    nodes: vorGraph?.nodes?.length,
    edges: vorGraph?.edges?.length,
    primaryRoads: primaryRoads?.length,
  });

  if (vorGraph && Array.isArray(vorGraph.edges)) {
    let waterEdges = 0;
    let citadelEdges = 0;
    let activeEdges = 0;

    for (const e of vorGraph.edges) {
      if (!e || e.disabled) continue;
      activeEdges += 1;
      if (e.flags && e.flags.isWater) waterEdges += 1;
      if (e.flags && e.flags.nearCitadel) citadelEdges += 1;
    }

    console.info("[Routing] edge flags", { activeEdges, waterEdges, citadelEdges });
  }

  const plazaOk =
    finitePointOrNull(anchors.plaza) &&
    isInsidePolyOrSkip(anchors.plaza, wallBase) &&
    (anchors.plaza.x >= 0 && anchors.plaza.x <= width && anchors.plaza.y >= 0 && anchors.plaza.y <= height);

  const citadelOk =
    finitePointOrNull(anchors.citadel) &&
    isInsidePolyOrSkip(anchors.citadel, wallBase) &&
    (anchors.citadel.x >= 0 && anchors.citadel.x <= width && anchors.citadel.y >= 0 && anchors.citadel.y <= height);

  const marketOk =
    finitePointOrNull(anchors.market) &&
    isInsidePolyOrSkip(anchors.market, wallBase) &&
    (anchors.market.x >= 0 && anchors.market.x <= width && anchors.market.y >= 0 && anchors.market.y <= height);

  let docksOk = true;
  if (hasDock) {
    docksOk =
      (anchors.docks === null) ||
      (finitePointOrNull(anchors.docks) &&
        !pointInPolyOrOn(anchors.docks, wallBase, 1e-6) &&
        isInsidePolyOrSkip(anchors.docks, outerBoundary) &&
        (anchors.docks.x >= 0 && anchors.docks.x <= width && anchors.docks.y >= 0 && anchors.docks.y <= height));
  }

  if (!plazaOk) bad.push("plaza");
  if (!citadelOk) bad.push("citadel");
  if (!marketOk) bad.push("market");
  if (!docksOk) bad.push("docks");

  if (bad.length) {
    console.warn("ANCHOR INVARIANTS FAILED", bad, {
      plaza: anchors.plaza,
      citadel: anchors.citadel,
      market: anchors.market,
      docks: anchors.docks,
      hasDock,
      water: waterModel?.kind,
    });
  }
}
