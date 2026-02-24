// docs/src/model/pipeline/run_pipeline.js
//
// Pipeline runner for the city generator.
// Phase 1: pipeline owns the stage order, but stages keep their current signatures.
// This preserves behaviour while moving orchestration out of generate.js.

import { mulberry32 } from "../../rng/mulberry32.js";
import { rngFork } from "../../rng/rng_fork.js";
import { assembleModel } from "../assemble_model.js";
import { PIPELINE_STAGES } from "./stage_registry.js";

function isPoint(p) {
  return Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function runPipeline(ctx) {
  // Legacy containers that some stages still write into.
  ctx.geom = ctx.geom || {};
  ctx.mesh = ctx.mesh || {};

  const seed = ctx.seed;
  const width = ctx.canvas.w;
  const height = ctx.canvas.h;

  const waterKind = (ctx.site && typeof ctx.site.water === "string") ? ctx.site.water : "none";
  const hasDock = Boolean(ctx.site && ctx.site.hasDock) && waterKind !== "none";

  const bastionCount = ctx.params.bastions;
  const gateCount = ctx.params.gates;

  // Guard: warp params must exist before Stage 110.
  const warpFortParams = ctx.params.warpFortParams;
  if (!warpFortParams || !Number.isFinite(warpFortParams.samples) || warpFortParams.samples <= 0) {
    throw new Error(
      "[EMCG] Missing or invalid ctx.params.warpFortParams.samples. " +
      "Set ctx.params.warpFortParams before calling runPipeline()."
    );
  }

  // Reset per run for Phase 2 contracts.
  ctx.state = {};

  // Deterministic frame (preserves prior behaviour).
  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

  // Keep these on ctx for legacy consumers.
  ctx.canvas.cx = cx;
  ctx.canvas.cy = cy;
  ctx.params.baseR = baseR;

  // Phase 2: stable per-stage RNG streams.
  // Stages may read ctx.rng.<label> (legacy) or env.rng.<label>.
  const rngGlobal = mulberry32(seed);
  const rng = {
    global: rngGlobal,
    fort: rngFork(seed, "stage:fort"),
    wards: rngFork(seed, "stage:wards"),
    anchors: rngFork(seed, "stage:anchors"),
    newTown: rngFork(seed, "stage:newTown"),
    water: rngFork(seed, "stage:water"),
    warp: rngFork(seed, "stage:warp"),
    outworks: rngFork(seed, "stage:outworks"),
    roads: rngFork(seed, "stage:roads"),
    market: rngFork(seed, "stage:market"),
  };

  // Legacy location for older stage code.
  ctx.rng = rng;

  const debug = {};

  const env = {
    ctx,
    seed,
    width,
    height,
    waterKind,
    hasDock,
    bastionCount,
    gateCount,
    rng, // object of streams (preferred)
    debug,
    cx,
    cy,
    baseR,
  };

  // Timings audit (optional).
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
      ms: Math.round((t1 - t0) * 1000) / 1000,
    });
  }

  const S = ctx.state;

  // ---- Required Phase 2 outputs ----
  if (!S.fortifications) throw new Error("[EMCG] Missing ctx.state.fortifications (Stage 10 output).");
  if (!S.newTown) throw new Error("[EMCG] Missing ctx.state.newTown (Stage 20 output).");
  if (!S.outerBoundary) throw new Error("[EMCG] Missing ctx.state.outerBoundary (Stage 30 output).");
  if (!S.waterModel) throw new Error("[EMCG] Missing ctx.state.waterModel (Stage 40 output).");
  if (!S.wards) throw new Error("[EMCG] Missing ctx.state.wards (Stage 50 output).");
  if (!S.anchors) throw new Error("[EMCG] Missing ctx.state.anchors (Stage 60 output).");
  if (!S.routingMesh || !S.routingMesh.vorGraph) {
    throw new Error("[EMCG] Missing ctx.state.routingMesh.vorGraph (Stage 70 output).");
  }
  if (!S.districts) throw new Error("[EMCG] Missing ctx.state.districts (Stage 90 output).");
  if (!S.warp) throw new Error("[EMCG] Missing ctx.state.warp (Stage 110 output).");
  if (!S.fortGeometryWarped) {
    throw new Error("[EMCG] Missing ctx.state.fortGeometryWarped (Stage 120 output).");
  }
  if (!S.rings) throw new Error("[EMCG] Missing ctx.state.rings (Stage 120 output).");
  if (!S.primaryRoads || !Array.isArray(S.primaryRoads) || S.primaryRoads.length === 0) {
    throw new Error("[EMCG] Missing ctx.state.primaryRoads (Stage 140 output).");
  }

  const fort = S.fortifications;
  const fortGeom = S.fortGeometryWarped;
  const warp = S.warp;
  const anchors = S.anchors;

  // Roads and avenue
  const roads = S.primaryRoads;
  const avenue = (roads.length >= 2) ? roads[1] : [anchors.plaza, anchors.citadel];
  // Stage 140 enriched outputs (optional, forward-compatible with Milestone 5)
  const primaryRoadsMeta = Array.isArray(S.primaryRoadsMeta) ? S.primaryRoadsMeta : null;
  const primaryRoadsSnappedNodes = S.primaryRoadsSnappedNodes || null;
  const primaryRoadsGateForRoad = S.primaryRoadsGateForRoad || null;

  // Draw geometry should come from Stage 110.
  const wallCurtainForDraw = warp.wallCurtainForDraw ?? null;
  const wallForDraw = warp.wallForDraw ?? null;

  if (!Array.isArray(wallCurtainForDraw) || wallCurtainForDraw.length < 3) {
    throw new Error("[EMCG] Stage 110 missing warp.wallCurtainForDraw (expected closed polyline).");
  }
  if (!Array.isArray(wallForDraw) || wallForDraw.length < 3) {
    throw new Error("[EMCG] Stage 110 missing warp.wallForDraw (expected closed polyline).");
  }
  if (!Array.isArray(warp.bastionPolysWarpedSafe)) {
    throw new Error("[EMCG] Stage 110 missing warp.bastionPolysWarpedSafe (expected array).");
  }
  if (!warp.warpWall) {
    throw new Error("[EMCG] Stage 110 missing warp.warpWall (required for Stage 120).");
  }

  const centre = isPoint(fort.centre) ? fort.centre : { x: cx, y: cy };

  return assembleModel({
    // Core frame
    footprint: fort.footprint,
    cx: centre.x,
    cy: centre.y,
    centre,
    baseR,
    debug,

    // Walls + moatworks
    wallBase: fort.wallBase,
    wallCurtainForDraw,
    wallForDraw,
    bastionPolysWarpedSafe: warp.bastionPolysWarpedSafe,
    bastionHull: warp.bastionHullWarpedSafe ?? null,
    gatesWarped: fortGeom.gatesWarped,
    ravelins: S.outworks ?? null,
    ditchOuter: fortGeom.ditchOuter,
    ditchInner: fortGeom.ditchInner,
    glacisOuter: fortGeom.glacisOuter,
    ditchWidth: fortGeom.ditchWidth,
    glacisWidth: fortGeom.glacisWidth,

    // Districts / blocks
    districts: S.districts,
    blocks: S.blocks ?? null,
    warpWall: warp.warpWall ?? null,
    warpOutworks: warp.warpOutworks ?? null,
    fortHulls: S.wards?.fortHulls ?? null,
    wardsWithRoles: S.wards?.wardsWithRoles ?? null,
    wardSeeds: S.wards?.wardSeeds ?? null,
    wardRoleIndices: S.wards?.wardRoleIndices ?? null,
    vorGraph: S.routingMesh.vorGraph,
    mesh: S.routingMesh,

    // Anchors
    citadel: S.citadel ?? null,
    avenue,
    primaryGateWarped: fortGeom.primaryGateWarped,

    // Site / water
    site: { water: waterKind, hasDock },
    waterModel: S.routingMesh.waterModel ?? S.waterModel,

    // Roads
    roads,
    primaryRoads: roads,
    primaryRoadsMeta,
    primaryRoadsSnappedNodes,
    primaryRoadsGateForRoad,
    ring: S.rings.ring,
    ring2: S.rings.ring2,
    secondaryRoads: S.secondaryRoadsLegacy ?? null,
    secondaryRoadsLegacy: S.secondaryRoadsLegacy ?? null,
    roadGraph: S.roadGraph ?? null,

    // New Town / boundary / markers
    newTown: S.newTown.newTown,
    outerBoundary: S.outerBoundary,
    gatesOriginal: fort.gates,
    landmarks: S.landmarks ?? null,
    anchors,
  });
}
