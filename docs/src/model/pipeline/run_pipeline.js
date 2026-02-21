// docs/src/model/pipeline/run_pipeline.js
//
// Pipeline runner for the city generator.
// Phase 1: pipeline owns the stage order, but stages keep their current signatures.
// This preserves behaviour while moving orchestration out of generate.js.

import { mulberry32 } from "../../rng/mulberry32.js";
import { assembleModel } from "../assemble_model.js";
import { PIPELINE_STAGES } from "./stage_registry.js";

export function runPipeline(ctx) {
  const seed = ctx.seed;
  const width = ctx.canvas.w;
  const height = ctx.canvas.h;

  const waterKind = (ctx.site && typeof ctx.site.water === "string") ? ctx.site.water : "none";
  const hasDock = Boolean(ctx.site && ctx.site.hasDock) && waterKind !== "none";

  const bastionCount = ctx.params.bastions;
  const gateCount = ctx.params.gates;
  // Phase 1 guard: warp params must exist before Stage 110.
  // In Phase 2, warp params will live in ctx.params defaults (or a config module).
  const warpFortParams = ctx.params.warpFortParams;
  if (!warpFortParams || !Number.isFinite(warpFortParams.samples) || warpFortParams.samples <= 0) {
    throw new Error(
      "[EMCG] Missing or invalid ctx.params.warpFortParams.samples. " +
      "Set ctx.params.warpFortParams before calling runPipeline()."
    );
  }
  const rng = mulberry32(seed);
  const debug = {};

  // Preserve existing geometry frame.
  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

  // Shared mutable carrier for Phase 1 (later phases replace this with ctx.state outputs).
  const env = {
    ctx,
    seed,
    width,
    height,
    waterKind,
    hasDock,
    bastionCount,
    gateCount,
    rng,
    debug,
    cx,
    cy,
    baseR,
  };

  ctx.audit = ctx.audit || {};
  ctx.audit.stageTimings = ctx.audit.stageTimings || [];
  ctx.audit.stageTimings.length = 0;
  for (const stage of PIPELINE_STAGES) {
    const t0 = performance.now();
    stage.run(env);
    const t1 = performance.now();
  
    ctx.audit.stageTimings.push({
      id: stage.id,
      name: stage.name,
      ms: Math.round((t1 - t0) * 1000) / 1000, // 0.001 ms precision
    });
  }

  const roads = env.primaryRoads;
  const avenue = (Array.isArray(env.primaryRoads) && env.primaryRoads.length >= 2)
    ? env.primaryRoads[1]
    : [env.anchors.plaza, env.anchors.citadel];
  globalThis.__EMCG_AUDIT__ = globalThis.__EMCG_AUDIT__ || {};
  globalThis.__EMCG_AUDIT__.stageTimings = ctx.audit.stageTimings;
  
  return assembleModel({
    footprint: env.footprint,
    cx: (env.centre?.x ?? env.cx),
    cy: (env.centre?.y ?? env.cy),
    debug: env.debug,

    wallBase: env.wallBase,
    wallCurtainForDraw: env.wallCurtainForDraw,
    wallForDraw: env.wallForDraw,
    bastionPolysWarpedSafe: env.bastionPolysWarpedSafe,
    bastionHull: env.bastionHull,
    warp: { wall: env.warpWall, outworks: env.warpOutworks },
    gatesWarped: env.gatesWarped,
    ravelins: env.ravelins,
    ditchOuter: env.ditchOuter,
    ditchInner: env.ditchInner,
    glacisOuter: env.glacisOuter,
    ditchWidth: env.ditchWidth,
    glacisWidth: env.glacisWidth,

    districts: env.districts,
    blocks: env.blocks,
    warpWall: env.warpWall,
    warpOutworks: env.warpOutworks,
    fortHulls: env.fortHulls,

    wardsWithRoles: env.wardsWithRoles,
    wardSeeds: env.wardSeeds,
    wardRoleIndices: env.wardRoleIndices,

    vorGraph: env.vorGraph,

    centre: env.centre,
    baseR: env.baseR,
    citadel: env.citadel,
    avenue,
    primaryGateWarped: env.primaryGateWarped,

    site: { water: env.waterKind, hasDock: env.hasDock },
    waterModel: env.waterModel,

    roads,
    primaryRoads: env.primaryRoads,
    ring: env.ring,
    ring2: env.ring2,
    secondaryRoadsLegacy: env.secondaryRoadsLegacy,
    roadGraph: env.roadGraph,

    newTown: env.newTown,
    outerBoundary: env.outerBoundary,

    gatesOriginal: env.gatesOriginal,
    landmarks: env.landmarks,
    anchors: env.anchors,
  });
}
