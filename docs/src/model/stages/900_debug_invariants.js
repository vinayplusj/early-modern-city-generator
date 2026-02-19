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
  console.info("[Hulls] gate", {
    cx,
    cy,
    cxFinite: Number.isFinite(cx),
    cyFinite: Number.isFinite(cy),
    hasFortHulls: !!fortHulls,
  });

  // ---------------- Fort hull diagnostics (log-only) ----------------
  if (Number.isFinite(cx) && Number.isFinite(cy) && fortHulls) {
    const centre = { x: cx, y: cy };
  
    const inner = fortHulls?.innerHull || null;
    const outer = fortHulls?.outerHull || null;
  
    const innerOuterLoop = inner?.outerLoop || null;
    const outerOuterLoop = outer?.outerLoop || null;
  
    console.info("[Hulls] summary", {
      inner: {
        loops: inner?.loops?.length,
        holeCount: inner?.holeCount,
        outerLoopIndex: inner?.outerLoopIndex,
        warnings: inner?.warnings?.length,
      },
      outer: {
        loops: outer?.loops?.length,
        holeCount: outer?.holeCount,
        outerLoopIndex: outer?.outerLoopIndex,
        warnings: outer?.warnings?.length,
      },
    });
  
    if (Array.isArray(inner?.warnings) && inner.warnings.length) {
      console.warn("[Hulls] inner warnings", inner.warnings);
    }
    if (Array.isArray(outer?.warnings) && outer.warnings.length) {
      console.warn("[Hulls] outer warnings", outer.warnings);
    }
  
    // Centre containment checks (log-only)
    const centreInInner = Array.isArray(innerOuterLoop) && innerOuterLoop.length >= 3
      ? pointInPolyOrOn(centre, innerOuterLoop, 1e-6)
      : null;
  
    const centreInOuter = Array.isArray(outerOuterLoop) && outerOuterLoop.length >= 3
      ? pointInPolyOrOn(centre, outerOuterLoop, 1e-6)
      : null;
  
    console.info("[Hulls] centre containment", { centreInInner, centreInOuter });
  
    // Inner-in-outer sampling (log-only)
    if (Array.isArray(innerOuterLoop) && innerOuterLoop.length >= 3 &&
        Array.isArray(outerOuterLoop) && outerOuterLoop.length >= 3) {
  
      const n = innerOuterLoop.length;
      const samples = Math.min(8, n);
      let fails = 0;
  
      for (let k = 0; k < samples; k++) {
        const i = Math.floor((k * n) / samples);
        const p = innerOuterLoop[i];
        if (!p) continue;
        if (!pointInPolyOrOn(p, outerOuterLoop, 1e-6)) fails += 1;
      }
  
      if (fails > 0) {
        console.warn("[Hulls] inner outerLoop not fully contained in outer outerLoop (sampled)", {
          samples,
          fails,
        });
      } else {
        console.info("[Hulls] inner outerLoop containment sampled OK", { samples });
      }
    }
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
