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
  // Ditch and glacis geometry (used by later stages and rendering).
  // Must be defined before returning.
  const ditchWidth = wallR * 0.035;
  const glacisWidth = wallR * 0.08;

  // Radial offsets from the wall base. These are used as simple, stable approximations.
  // If your original file used a different reference polygon, keep it consistent.
  const ditchOuter = offsetRadial(wallBase, ditchWidth);
  const ditchInner = offsetRadial(wallBase, -ditchWidth * 0.55);
  const glacisOuter = offsetRadial(wallBase, ditchWidth + glacisWidth);
  
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
