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
  buildCorridorIntent,
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
  const wallR = baseR * 0.78;

  const { base: wallBase, wall, bastions } = generateBastionedWall(
    rng,
    cx,
    cy,
    wallR,
    bastionCount
  );

  // Pick gates first, so we can build corridor intent deterministically.
  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Corridor intent for Milestone 5A.
  // Use the stage centre (cx, cy) here, not footprint centroid, so intent is defined
  // before the footprint exists and does not depend on its later wobble.
  const corridorCentre = { x: cx, y: cy };
  const corridorIntent = buildCorridorIntent(corridorCentre, gates, null, null);

  // Stretched footprint along corridor directions.
  // Bounded and deterministic: generateFootprint clamps the radial multiplier.
  const footprint = generateFootprint(rng, cx, cy, baseR, 22, {
    corridors: corridorIntent.corridors,
    stretchStrength: 0.35,
    stretchWidthRad: Math.PI / 10,
    stretchClamp: { min: 0.90, max: 1.55 },
  });

  // Centre used by later stages remains the footprint centroid.
  const centre = centroid(footprint);

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
    corridorIntent,
    corridorCentre,
  };
}
