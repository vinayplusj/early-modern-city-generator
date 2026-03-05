// docs/src/model/stages/10_fortifications.js
//
// Stage 10: Footprint + main fortifications.
// Extracted from generate.js without functional changes.
//
import { centroid } from "../../geom/poly.js";
import { offsetRadial } from "../../geom/offset.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
  buildCorridorIntent,
} from "../features.js";

export function runFortificationsStage(ctx, rng, cx, cy, baseR, bastionCount, gateSpec) {
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

  // Gate selection: gateSpec may be a number or "low" | "medium" | "high".
  // pickGates is responsible for feasibility caps and warnings.
  const gates = pickGates(rng, wallBase, gateSpec, bastionCount);

  // Corridor intent for Milestone 4.8.
  // Use the stage centre (cx, cy) here, not footprint centroid, so intent is defined
  // before the footprint exists and does not depend on its later wobble.
  // Corridor intent for Milestone 5A (footprint stretch along corridors).
  const corridorCentre = { x: cx, y: cy };
  
  ctx.state = ctx.state || {};
  
  // Prefer derived water intent (from Stage 40) when available.
  // Fallback to stored base water intent, and only create it if missing.
  let waterDir =
    (ctx.state.waterIntentDerived && ctx.state.waterIntentDerived.dir) ? ctx.state.waterIntentDerived.dir :
    (ctx.state.waterIntent && ctx.state.waterIntent.dir) ? ctx.state.waterIntent.dir :
    null;
  
  if (!waterDir) {
    // First pass only: create a stable water axis so Stage 10 can stretch before Stage 40 runs.
    // Use the stage RNG passed into this function. It is already deterministic for the seed.
    const ang = rng() * Math.PI * 2;
    waterDir = { x: Math.cos(ang), y: Math.sin(ang) };
    ctx.state.waterIntent = { dir: waterDir };
  }
  
  // Now build corridor intent with gates + water axis.
  const corridorIntent = buildCorridorIntent(corridorCentre, gates, waterDir, null);
  // If water is a coast, prefer a one-sided bulge toward the sea.
  // This activates the "halfplane" mode in _corridorFactorAtAngle.
  const waterKind =
    (ctx.state.waterIntentDerived && ctx.state.waterIntentDerived.kind) ? ctx.state.waterIntentDerived.kind :
    (ctx.state.waterModel && ctx.state.waterModel.kind) ? ctx.state.waterModel.kind :
    null;
  
  if (waterKind === "coast" && corridorIntent && Array.isArray(corridorIntent.corridors)) {
    for (const c of corridorIntent.corridors) {
      if (c && c.kind === "water") {
        c.mode = "halfplane";
        // Coast tends to strongly shape the town edge.
        c.weight = Math.max(c.weight ?? 0, 1.9);
      }
    }
  }
  
  // Rivers should elongate along the axis but not create a one-sided bulge.
  if (waterKind === "river" && corridorIntent && Array.isArray(corridorIntent.corridors)) {
    for (const c of corridorIntent.corridors) {
      if (c && c.kind === "water") {
        c.mode = "axis";
        c.weight = Math.max(c.weight ?? 0, 1.6);
      }
    }
  }
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
  // Required anchor constraints (anchors stage depends on these).
  ctx.params = ctx.params || {};
  ctx.params.baseR = baseR;

  // Anchor placement needs a minimum clearance from the wall features.
  ctx.params.minWallClear = ditchWidth * 1.25;

  // Keep anchor separation stable and always satisfiable.
  // This mirrors prior intent: scale with ditchWidth but clamp to sane bounds.
  if (ctx.params.minAnchorSep == null) {
    ctx.params.minAnchorSep = Math.max(ditchWidth * 3.0, Math.min(baseR * 0.14, wallR * 0.22));
  }

  // Existing code expects this sometimes for padding logic.
  if (ctx.params.canvasPad == null) ctx.params.canvasPad = 10;

  // Optional audit visibility (only if you want it; safe to keep).
  if (ctx.params.footprintStretchStrength == null) ctx.params.footprintStretchStrength = 0.35;
  if (ctx.params.footprintStretchWidthRad == null) ctx.params.footprintStretchWidthRad = Math.PI / 10;
  if (ctx.params.footprintStretchClampMin == null) ctx.params.footprintStretchClampMin = 0.90;
  if (ctx.params.footprintStretchClampMax == null) ctx.params.footprintStretchClampMax = 1.55;
  
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
