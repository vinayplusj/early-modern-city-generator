// docs/src/model/stages/10_fortifications.js
//
// Stage 10: Fort skeleton and wall geometry.
//
// Milestone 4.8 change:
// - Stage 10 is no longer the canonical footprint stage.
// - It now builds the fort skeleton only.
// - Stage 25 is responsible for corridor intent and stretched footprint.
//
// Safe coupling preserved:
// - Stage 20 still receives gates, bastions, wallR, wallBase, wallFinal,
//   ditch/glacis geometry, and bastionPolys from this stage.
// - Anchor and later stages still rely on baseR / minWallClear / minAnchorSep defaults.

import { centroid } from "../../geom/poly.js";
import { offsetRadial } from "../../geom/offset.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
} from "../features.js";

export function resolveGateSpecFromParams(ctx, gateSpec) {
  let resolved = gateSpec;

  if (resolved == null) {
    resolved = (ctx?.params && ctx.params.gateDensity != null)
      ? ctx.params.gateDensity
      : "medium";
  }

  if (typeof resolved === "string") resolved = resolved.toLowerCase();
  return resolved;
}

function applySharedParamDefaults(ctx, baseR, wallR, ditchWidth) {
  ctx.params = ctx.params || {};

  // Required later by anchors and layout constraints.
  ctx.params.baseR = baseR;
  ctx.params.minWallClear = ditchWidth * 1.25;

  if (ctx.params.minAnchorSep == null) {
    ctx.params.minAnchorSep = Math.max(
      ditchWidth * 3.0,
      Math.min(baseR * 0.14, wallR * 0.22)
    );
  }

  if (ctx.params.canvasPad == null) ctx.params.canvasPad = 10;

  // Keep these visible for diagnostics and for Stage 25 reuse.
  if (ctx.params.footprintStretchStrength == null) ctx.params.footprintStretchStrength = 0.35;
  if (ctx.params.footprintStretchWidthRad == null) ctx.params.footprintStretchWidthRad = Math.PI / 10;
  if (ctx.params.footprintStretchClampMin == null) ctx.params.footprintStretchClampMin = 0.90;
  if (ctx.params.footprintStretchClampMax == null) ctx.params.footprintStretchClampMax = 1.55;
}

export function buildFortSkeleton(ctx, rng, cx, cy, baseR, bastionCount, gateSpec = null) {
  if (!ctx) throw new Error("[EMCG] Stage 10 requires ctx.");
  if (typeof rng !== "function") throw new Error("[EMCG] Stage 10 requires a callable rng.");
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(baseR)) {
    throw new Error("[EMCG] Stage 10 requires finite cx, cy, and baseR.");
  }
  if (!Number.isFinite(bastionCount) || bastionCount < 3) {
    throw new Error("[EMCG] Stage 10 requires bastionCount >= 3.");
  }

  ctx.geom = ctx.geom || {};
  ctx.state = ctx.state || {};

  const wallR = baseR * 0.78;

  const { base: wallBase, wall, bastions } = generateBastionedWall(
    rng,
    cx,
    cy,
    wallR,
    bastionCount
  );

  const resolvedGateSpec = resolveGateSpecFromParams(ctx, gateSpec);
  const gates = pickGates(rng, wallBase, resolvedGateSpec, bastionCount);

  const ditchWidth = wallR * 0.035;
  const glacisWidth = wallR * 0.08;

  const ditchOuter = offsetRadial(wallBase, ditchWidth);
  const ditchInner = offsetRadial(wallBase, -ditchWidth * 0.55);
  const glacisOuter = offsetRadial(wallBase, ditchWidth + glacisWidth);

  applySharedParamDefaults(ctx, baseR, wallR, ditchWidth);

  const wallFinal = wall;
  const bastionPolys = bastions.map((b) => b.pts);

  return {
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
  };
}

export function buildFootprintFromIntent(
  rng,
  cx,
  cy,
  baseR,
  corridorIntent,
  options = {}
) {
  if (typeof rng !== "function") {
    throw new Error("[EMCG] buildFootprintFromIntent requires a callable rng.");
  }
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(baseR)) {
    throw new Error("[EMCG] buildFootprintFromIntent requires finite cx, cy, and baseR.");
  }

  const stretchStrength =
    Number.isFinite(options.stretchStrength) ? options.stretchStrength : 0.35;
  const stretchWidthRad =
    Number.isFinite(options.stretchWidthRad) ? options.stretchWidthRad : Math.PI / 10;
  const stretchClamp = {
    min:
      Number.isFinite(options?.stretchClamp?.min)
        ? options.stretchClamp.min
        : 0.90,
    max:
      Number.isFinite(options?.stretchClamp?.max)
        ? options.stretchClamp.max
        : 1.55,
  };

  const footprint = generateFootprint(rng, cx, cy, baseR, 22, {
    corridors: Array.isArray(corridorIntent?.corridors) ? corridorIntent.corridors : [],
    stretchStrength,
    stretchWidthRad,
    stretchClamp,
  });

  const centre = centroid(footprint);

  return {
    footprint,
    centre,
  };
}

export function runFortificationsStage(ctx, rng, cx, cy, baseR, bastionCount, gateSpec = null) {
  return buildFortSkeleton(ctx, rng, cx, cy, baseR, bastionCount, gateSpec);
}
