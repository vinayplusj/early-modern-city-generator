// docs/src/model/stages/10_fortifications.js
//
// Stage 10: Footprint + main fortifications.
// Extracted from generate.js without functional changes.

import { centroid } from "../../geom/poly.js";
import { offsetRadial } from "../../geom/offset.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
} from "../features.js";

/**
 * @param {object} ctx
 * @param {function} rng - seeded RNG function (mulberry32(seed)) from generate.js
 * @param {number} cx
 * @param {number} cy
 * @param {number} baseR
 * @param {number} bastionCount
 * @param {number} gateCount
 * @returns {object} stage outputs (see below)
 */
export function runFortificationsStage(ctx, rng, cx, cy, baseR, bastionCount, gateCount) {
  ctx.geom = ctx.geom || {};
  // ---------------- Footprint + main fortifications ----------------
  const footprint = generateFootprint(rng, cx, cy, baseR, 22);
  const wallR = baseR * 0.78;

  const { base: wallBase, wall, bastions } = generateBastionedWall(
    rng,
    cx,
    cy,
    wallR,
    bastionCount
  );

  let ditchWidth = wallR * 0.035;
  let glacisWidth = wallR * 0.08;

  // Keep separation proportional, but bounded so it is always satisfiable.
  ctx.params.baseR = baseR;
  ctx.params.minWallClear = ditchWidth * 1.25;
  ctx.params.minAnchorSep = Math.max(ditchWidth * 3.0, Math.min(baseR * 0.14, wallR * 0.22));
  ctx.params.canvasPad = 10;

  // Routing tuning
  ctx.params.roadWaterPenalty = 5000;
  ctx.params.roadCitadelPenalty = 1500;
  ctx.params.roadWaterClearance = 20;
  ctx.params.roadCitadelAvoidRadius = 80;

  // Hard avoid toggles (safe defaults)
  ctx.params.roadHardAvoidWater = true;
  ctx.params.roadHardAvoidCitadel = false;

  ctx.geom.wallBase = wallBase;

  let ditchOuter = offsetRadial(wallBase, cx, cy, ditchWidth);
  let ditchInner = offsetRadial(wallBase, cx, cy, ditchWidth * 0.35);
  let glacisOuter = offsetRadial(wallBase, cx, cy, ditchWidth + glacisWidth);

  const centre = centroid(footprint);
  ctx.geom.centre = centre;
  ctx.geom.footprint = footprint;

  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Start with the full bastioned wall.
  const wallFinal = wall;
  const bastionPolys = bastions.map((b) => b.pts);

  return {
    footprint,
    wallR,
    wallBase,
    wallFinal,
    bastions,
    bastionPolys,
    gates,

    ditchWidth,
    glacisWidth,
    ditchOuter,
    ditchInner,
    glacisOuter,

    centre,
  };
}
