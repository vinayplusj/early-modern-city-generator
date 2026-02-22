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

  ctx.state = ctx.state || {};
  ctx.state = {}; // reset per run for Phase 2 contracts
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

  const S = ctx.state;

  // Roads (prefer canonical)
  const roads = S.primaryRoads ?? env.primaryRoads ?? null;

  // Avenue (prefer road[1], else plaza->citadel)
  const avenue =
    (Array.isArray(roads) && roads.length >= 2)
      ? roads[1]
      : [
          S.anchors?.plaza ?? env.anchors?.plaza,
          S.anchors?.citadel ?? env.anchors?.citadel,
        ];

  globalThis.__EMCG_AUDIT__ = globalThis.__EMCG_AUDIT__ || {};
  globalThis.__EMCG_AUDIT__.stageTimings = ctx.audit.stageTimings;

  const fort = S.fortifications;
  const fortGeom = S.fortGeometryWarped;
  if (!fortGeom) {
    throw new Error("[EMCG] Missing ctx.state.fortGeometryWarped (Stage 120 output).");
  }

  const warp = S.warp;
  const outworks = S.outworks;

  return assembleModel({
    footprint: fort?.footprint ?? env.footprint,
    cx: (fort?.centre?.x ?? env.centre?.x ?? env.cx),
    cy: (fort?.centre?.y ?? env.centre?.y ?? env.cy),
    centre: fort?.centre ?? env.centre,
    baseR: env.baseR,
    debug: env.debug,

    wallBase: fort?.wallBase ?? env.wallBase,
    wallCurtainForDraw: env.wallCurtainForDraw,
    wallForDraw: env.wallForDraw,

    bastionPolysWarpedSafe: warp?.bastionPolysWarpedSafe ?? env.bastionPolysWarpedSafe,
    bastionHull: env.bastionHull,

    warp: { wall: env.warpWall, outworks: env.warpOutworks },
    warpWall: env.warpWall,
    warpOutworks: env.warpOutworks,

    ditchOuter: fortGeom.ditchOuter ?? env.ditchOuter,
    ditchInner: fortGeom.ditchInner ?? env.ditchInner,
    glacisOuter: fortGeom.glacisOuter ?? env.glacisOuter,
    ditchWidth: fortGeom.ditchWidth ?? env.ditchWidth,
    glacisWidth: fortGeom.glacisWidth ?? env.glacisWidth,

    gatesOriginal: fort?.gates ?? env.gatesOriginal,
    gatesWarped: fortGeom.gatesWarped,
    primaryGateWarped: fortGeom.primaryGateWarped,

    ravelins: outworks ?? env.ravelins,

    wardSeeds: S.wards?.wardSeeds,
    wardsWithRoles: S.wards?.wardsWithRoles,
    wardRoleIndices: S.wards?.wardRoleIndices,
    fortHulls: S.wards?.fortHulls,
    districts: S.districts,

    vorGraph: S.routingMesh?.vorGraph,
    waterModel: S.routingMesh?.waterModel ?? env.waterModel,

    roads,
    primaryRoads: roads,
    secondaryRoadsLegacy: S.secondaryRoadsLegacy ?? env.secondaryRoadsLegacy,
    roadGraph: S.roadGraph ?? env.roadGraph,
    blocks: S.blocks ?? env.blocks,

    ring: S.rings?.ring ?? env.ring,
    ring2: S.rings?.ring2 ?? env.ring2,
    citadel: S.citadel ?? env.citadel,
    avenue,
    newTown: S.newTown?.newTown ?? env.newTown,
    outerBoundary: S.outerBoundary ?? env.outerBoundary,
    landmarks: S.landmarks ?? env.landmarks,

    anchors: S.anchors,

    site: { water: env.waterKind, hasDock: env.hasDock },
  });
}
