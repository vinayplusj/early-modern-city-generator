// docs/src/model/invariants/fort_hull_diagnostics.js
// Legacy fort hull diagnostics retained from Stage 900.

import { pointInPolyOrOn } from "../../geom/poly.js";

export function checkFortHullDiagnostics({ errors, cx, cy, fortHulls }) {
  console.info("[Hulls] gate", {
    cx,
    cy,
    cxFinite: Number.isFinite(cx),
    cyFinite: Number.isFinite(cy),
    hasFortHulls: !!fortHulls,
  });

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

    const centreInInner =
      Array.isArray(innerOuterLoop) && innerOuterLoop.length >= 3
        ? pointInPolyOrOn(centre, innerOuterLoop, 1e-6)
        : null;

    const centreInOuter =
      Array.isArray(outerOuterLoop) && outerOuterLoop.length >= 3
        ? pointInPolyOrOn(centre, outerOuterLoop, 1e-6)
        : null;

    console.info("[Hulls] centre containment", { centreInInner, centreInOuter });

    if (centreInOuter === false) {
      errors.push("Hull invalid: centre is outside outer hull");
    }
    if (centreInInner === false) {
      errors.push("Hull suspicious: centre is outside inner hull");
    }

    if (
      Array.isArray(innerOuterLoop) &&
      innerOuterLoop.length >= 3 &&
      Array.isArray(outerOuterLoop) &&
      outerOuterLoop.length >= 3
    ) {
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
        errors.push(`Hull invalid: inner hull not contained in outer hull (sampled fails=${fails}/${samples})`);
      } else {
        console.info("[Hulls] inner outerLoop containment sampled OK", { samples });
      }
    }
  }
}
