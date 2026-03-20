// docs/src/model/stages/25_footprint.js
//
// Milestone 4.8: explicit footprint stage.
//
// Purpose:
// - Build canonical corridor intent after Stage 20 new-town placement exists.
// - Build the stretched footprint from gates + water intent + new-town intent.
// - Publish the result back into ctx.state.fortifications so existing stages keep working.
//
// Ordering assumptions:
// - Stage 10 has already created ctx.state.fortifications with at least gates.
// - Stage 20 has already created ctx.state.newTown and may provide newTown.orientation.out.
// - Stage 05 has already published ctx.state.waterIntent.
//
// Hidden coupling preserved intentionally:
// - Stage 30 reads ctx.state.fortifications.footprint.
// - Later assembly/render code reads fortifications.centre and fortifications.corridorIntent.
// - This stage overwrites the footprint-related keys on ctx.state.fortifications.

import { centroid } from "../../geom/poly.js";
import { normalize } from "../../geom/primitives.js";
import { buildCorridorIntent, generateFootprint } from "../features.js";
import { rngFork } from "../rng/rng_fork.js";

function isFiniteDir(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y);
}

function unitOrNull(v) {
  if (!isFiniteDir(v)) return null;
  const n = normalize(v);
  if (!isFiniteDir(n)) return null;
  const m = Math.hypot(n.x, n.y);
  if (!Number.isFinite(m) || m <= 1e-9) return null;
  return n;
}

function resolveNewTownDir(ctx, cx, cy) {
  const explicit = unitOrNull(ctx?.state?.newTownIntent?.dir);
  if (explicit) return explicit;

  const out = unitOrNull(ctx?.state?.newTown?.newTown?.orientation?.out);
  if (out) return out;

  const g = ctx?.state?.newTown?.primaryGate || ctx?.state?.primaryGate || null;
  if (g && Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(cx) && Number.isFinite(cy)) {
    return unitOrNull({ x: g.x - cx, y: g.y - cy });
  }

  return null;
}

function applyWaterCorridorModes(corridorIntent, waterIntent) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return corridorIntent;

  const kind = waterIntent && typeof waterIntent.kind === "string" ? waterIntent.kind : "none";

  if (kind === "coast") {
    for (const c of corridorIntent.corridors) {
      if (!c || c.kind !== "water") continue;
      c.mode = "halfplane";
      c.weight = Math.max(c.weight ?? 0, 1.9);
    }
  } else if (kind === "river") {
    for (const c of corridorIntent.corridors) {
      if (!c || c.kind !== "water") continue;
      c.mode = "axis";
      c.weight = Math.max(c.weight ?? 0, 1.6);
    }
  }

  return corridorIntent;
}

function getStretchParams(ctx) {
  ctx.params = ctx.params || {};

  if (ctx.params.footprintStretchStrength == null) ctx.params.footprintStretchStrength = 0.35;
  if (ctx.params.footprintStretchWidthRad == null) ctx.params.footprintStretchWidthRad = Math.PI / 10;
  if (ctx.params.footprintStretchClampMin == null) ctx.params.footprintStretchClampMin = 0.90;
  if (ctx.params.footprintStretchClampMax == null) ctx.params.footprintStretchClampMax = 1.55;

  return {
    stretchStrength: ctx.params.footprintStretchStrength,
    stretchWidthRad: ctx.params.footprintStretchWidthRad,
    stretchClamp: {
      min: ctx.params.footprintStretchClampMin,
      max: ctx.params.footprintStretchClampMax,
    },
  };
}

export function runFootprintStage({ ctx, cx, cy, baseR, seed = null } = {}) {
  if (!ctx) throw new Error("[EMCG] Stage 25 requires ctx.");
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(baseR)) {
    throw new Error("[EMCG] Stage 25 requires finite cx, cy, and baseR.");
  }

  ctx.state = ctx.state || {};

  const fort = ctx.state.fortifications;
  if (!fort) {
    throw new Error("[EMCG] Stage 25 requires ctx.state.fortifications (Stage 10 output).");
  }
  if (!Array.isArray(fort.gates)) {
    throw new Error("[EMCG] Stage 25 requires ctx.state.fortifications.gates.");
  }

  const rootSeed = Number.isFinite(seed) ? seed : ctx.seed;
  if (!Number.isFinite(rootSeed)) {
    throw new Error("[EMCG] Stage 25 requires a finite seed.");
  }

  const corridorCentre = { x: cx, y: cy };
  const waterDir = unitOrNull(ctx.state.waterIntent && ctx.state.waterIntent.dir);
  const newTownDir = resolveNewTownDir(ctx, cx, cy);

  const corridorIntent = buildCorridorIntent(corridorCentre, fort.gates, waterDir, newTownDir);
  applyWaterCorridorModes(corridorIntent, ctx.state.waterIntent || null);

  const stretch = getStretchParams(ctx);
  const rng = rngFork(rootSeed, "stage:footprint");

  const footprint = generateFootprint(rng, cx, cy, baseR, 22, {
    corridors: corridorIntent.corridors,
    stretchStrength: stretch.stretchStrength,
    stretchWidthRad: stretch.stretchWidthRad,
    stretchClamp: stretch.stretchClamp,
  });

  const centre = centroid(footprint);

  fort.footprint = footprint;
  fort.centre = centre;
  fort.corridorIntent = corridorIntent;
  fort.corridorCentre = corridorCentre;

  // Canonical top-level aliases for diagnostics and later stages.
  ctx.state.corridorIntent = corridorIntent;
  ctx.state.footprint = footprint;

  if (!ctx.state.newTownIntent) {
    ctx.state.newTownIntent = newTownDir
      ? { dir: newTownDir, source: "stage:25:resolved-new-town" }
      : null;
  }

  return {
    footprint,
    centre,
    corridorIntent,
    corridorCentre,
  };
}
