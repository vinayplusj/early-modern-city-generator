// docs/src/model/generate.js
//
// City model generator (Milestone 3.5 + 3.6 debug blocks).
// This module assembles the full "model" object consumed by rendering.
//
// Key invariants:
// - Deterministic: same seed -> same city.
// - No external deps.
// - All per-run arrays (polylines, landmarks, etc.) are created INSIDE generate().
// - Rendering remains read-only; all logic here or in geom/roads modules.

import { mulberry32 } from "../rng/mulberry32.js";
import {
  add,
  mul,
  vec,
  len,
  clampPointToCanvas,
} from "../geom/primitives.js";
import {
  pointInPolyOrOn
} from "../geom/poly.js";

import { createCtx } from "./ctx.js";
import { runPipeline } from "./pipeline/run_pipeline.js";
import { runFortificationsStage } from "./stages/10_fortifications.js";
import { runNewTownStage } from "./stages/20_new_town.js";
import { runOuterBoundaryStage } from "./stages/30_outer_boundary.js";
import { runWaterStage } from "./stages/40_water.js";
import { runWardsStage } from "./stages/50_wards.js";
import { runAnchorsStage } from "./stages/60_anchors.js";
import { runRoutingMeshStage } from "./stages/70_routing_mesh.js";
import { runInnerRingsStage } from "./stages/80_inner_rings.js";
import { runDistrictsStage } from "./stages/90_districts.js";
import { runCitadelStage } from "./stages/100_citadel.js";
import { runWarpFieldStage } from "./stages/110_warp_field.js";
import { runWarpDependentFortGeometryStage } from "./stages/120_warp_dependent_fort_geometry.js";
import { runDocksStage } from "./stages/130_docks.js";
import { runPrimaryRoadsStage } from "./stages/140_primary_roads.js";
import { runOutworksStage } from "./stages/150_outworks.js";
import { runMarketStage } from "./stages/160_market.js";
import { runRoadGraphAndBlocksStage } from "./stages/170_road_graph_and_blocks.js";
import { runDebugInvariantsStage } from "./stages/900_debug_invariants.js";
import { assembleModel } from "./assemble_model.js";

const WARP_FORT = {
  enabled: true,
  debug: true,

  samples: 720,
  smoothRadius: 10,
  maxStep: 1.5,

  maxOut: 40,
  maxIn: 100,

  bandInner: 0,
  bandOuter: 0,
  bandThickness: 120,

  defaultFortOffset: 0,
  newTownFortOffset: 30,
  outerWardFortOffset: 10,
  citadelFortOffset: -10,

  targetMargin: 0,

  // Bastion protection
  bastionLockPad: 0.12,
  bastionLockFeather: 0.10,

  // Option A: blocks outward bulge near bastion tips only
  bastionClearHalfWidth: 0.05,
  bastionClearFeather: 0.06,
};

// ---------------- Build / version stamp ----------------
// Update this string when you make meaningful changes.
export const GENERATOR_BUILD = {
  version: "Logs for loops",
  buildDate: "2026-02-18",
  commit: "manual",
};

let __buildLogged = false;

function logBuildOnce(seed, width, height, site) {
  if (__buildLogged) return;
  __buildLogged = true;

  // Allow index.html (or other code) to override this at runtime if desired.
  const build = globalThis.__EMCG_BUILD__ || GENERATOR_BUILD;

  console.info("[EMCG] Generator build:", build);
  console.info("[EMCG] First run params:", { seed, width, height, site });
}

export function generate(seed, bastionCount, gateCount, width, height, site = {}) {
  logBuildOnce(seed, width, height, site);

  const waterKind = (site && typeof site.water === "string") ? site.water : "none";
  const hasDock = Boolean(site && site.hasDock) && waterKind !== "none";

  const ctx = createCtx({
    seed,
    w: width,
    h: height,
    site: { water: waterKind, hasDock },
    params: { bastions: bastionCount, gates: gateCount },
  });

  // Pipeline seam (Phase 1): no-op, preserves existing behaviour.
  runPipeline(ctx);

  const rng = mulberry32(seed);

  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

  // ---------------- Footprint + main fortifications ----------------
  const fort = runFortificationsStage(ctx, rng, cx, cy, baseR, bastionCount, gateCount);

  const footprint = fort.footprint;
  const wallR = fort.wallR;

  const wallBase = fort.wallBase;

  let wallFinal = fort.wallFinal;
  const bastions = fort.bastions;

  let bastionPolys = fort.bastionPolys;
  let bastionPolysWarpedSafe = bastionPolys;

  const gates = fort.gates;

  let ditchWidth = fort.ditchWidth;
  let glacisWidth = fort.glacisWidth;
  let ditchOuter = fort.ditchOuter;
  let ditchInner = fort.ditchInner;
  let glacisOuter = fort.glacisOuter;

  const centre = fort.centre;


  // ---------------- New Town placement ----------------
  const nt = runNewTownStage({
    ctx,
    gates,
    bastions,
    cx,
    cy,
    wallR,
    baseR,
    ditchOuter,
    wallBase,
    ditchWidth,
    glacisWidth,
    wallFinal,
    bastionPolys,
    warpDebugEnabled: WARP_FORT.debug,
  });

  let newTown = nt.newTown;
  const primaryGate = nt.primaryGate;
  ctx.primaryGate = primaryGate;

  wallFinal = nt.wallFinal;
  bastionPolys = nt.bastionPolys;

  const bastionsForWarp = nt.bastionsForWarp;


  // ---------------- Overall boundary ----------------
  const outerBoundary = runOuterBoundaryStage(footprint, newTown);
  ctx.geom.outerBoundary = outerBoundary;
  ctx.geom.cx = cx;
  ctx.geom.cy = cy;
  ctx.geom.wallR = wallR;

  // ---------------- Water (river/coast) ----------------
  // We build an initial geometric water model (legacy), then snap it to the ward mesh
  // edges via , and finally rebuild the routing graph using exact edge
  // ids so roads can hard-block water edges deterministically.
  let waterModel = runWaterStage({
    waterKind,
    ctx,
    outerBoundary,
    cx,
    cy,
    baseR,
  });

  // ---------------- Wards (Voronoi) + deterministic roles ----------------
  const wardsOut = runWardsStage({
    ctx,
    baseR,
    cx,
    cy,
    outerBoundary,
  });

  const wardSeeds = wardsOut.wardSeeds;
  const wardsWithRoles = wardsOut.wardsWithRoles;
  const wardRoleIndices = wardsOut.wardRoleIndices;
  const fortHulls = wardsOut.fortHulls;

  // Build anchors first so we can flag edges near the citadel.
  let anchors = runAnchorsStage(ctx);

  // ---------------- Voronoi planar graph (routing mesh) ----------------
  const meshOut = runRoutingMeshStage({
    ctx,
    wardsWithRoles,
    anchors,
    waterKind,
    waterModel,
    outerBoundary,
    cx,
    cy,
    baseR,
  });

  let vorGraph = meshOut.vorGraph;
  waterModel = meshOut.waterModel;

  ctx.mesh = ctx.mesh || {};
  ctx.mesh.vorGraph = vorGraph;

  // ---------------- Inner rings ----------------
  const ringsOut = runInnerRingsStage(wallBase, cx, cy, wallR);
  let ring = ringsOut.ring;
  let ring2 = ringsOut.ring2;

  // ---------------- Districts (Voronoi role groups) ----------------
  const districts = runDistrictsStage(wardsWithRoles, cx, cy);

  // ---------------- Citadel ----------------
  const citadel = runCitadelStage(rng, anchors, baseR);

  // ---------------- Warp field ----------------
  const warpOut = runWarpFieldStage({
    ctx,
    cx,
    cy,

    wallFinal,
    wallBase,

    fortHulls,
    districts,

    bastionsForWarp,
    bastionPolys,

    warpFortParams: WARP_FORT,
    warpDebugEnabled: WARP_FORT.debug,
  });
  const wallCurtainForDraw = warpOut?.wallCurtainForDraw || null;
  const warpWall = warpOut.warpWall;
  const warpOutworks = warpOut.warpOutworks;

  const wallForDraw = warpOut.wallForDraw;

  bastionPolysWarpedSafe = warpOut.bastionPolysWarpedSafe;

  // Bastion hull is now computed and outer-clamped in Stage 110.
  const bastionHull = warpOut.bastionHullWarpedSafe;
  
  // ---------------- Warp-dependent fort geometry (moatworks + rings) ----------------
  const wallWarped = (warpWall && warpWall.wallWarped) ? warpWall.wallWarped : null;

  const fortGeom = runWarpDependentFortGeometryStage({
    ctx,
    cx,
    cy,
    wallR,
    wallBase,
    wallWarped,
    warpWall,
    gates,
    primaryGate,
  });

  const fortR = fortGeom.fortR;

  ditchWidth = fortGeom.ditchWidth;
  glacisWidth = fortGeom.glacisWidth;

  const wallBaseForDraw = fortGeom.wallBaseForDraw;

  ditchOuter = fortGeom.ditchOuter;
  ditchInner = fortGeom.ditchInner;
  glacisOuter = fortGeom.glacisOuter;

  ring = fortGeom.ring;
  ring2 = fortGeom.ring2;

  const gatesWarped = fortGeom.gatesWarped;
  const primaryGateWarped = fortGeom.primaryGateWarped;

  anchors.gates = gatesWarped;
  anchors.primaryGate = primaryGateWarped;

  // ---------------- Docks ----------------
  anchors.docks = runDocksStage({
    hasDock,
    anchors,
    newTown,
    outerBoundary,
    wallBase: wallBaseForDraw,
    centre,
    waterModel,
    width,
    height,
  });

  // ---------------- Primary roads (routed on Voronoi planar graph) ----------------
  const primaryOut = runPrimaryRoadsStage({
    ctx,
    vorGraph,
    waterModel,
    anchors,
    waterKind,
    primaryGateWarped,
    gatesWarped,
  });

  const primaryRoads = primaryOut.primaryRoads;

  // ---------------- Outworks ----------------
  const wallForOutworks = wallForDraw;

  const ravelins = runOutworksStage({
    gatesWarped,
    primaryGateWarped,
    cx,
    cy,
    fortR,
    ditchWidth,
    glacisWidth,
    newTown,
    bastionCount,
    bastionPolysWarpedSafe,
    wallForOutworks,
    warpOutworks,
    warpDebugEnabled: WARP_FORT.debug,
  });

  const marketOut = runMarketStage({
    anchors,
    wardsWithRoles,
    wallBaseForDraw,
    centre,
    primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    width,
    height,
    citadel,
    minWallClear: ctx.params.minWallClear,
  });

  anchors.market = marketOut.marketAnchor;
  let marketCentre = marketOut.marketCentre;

  const landmarks = marketOut.landmarks;

  // Legacy fields retained, but now sourced from routed primaries.
  const roads = primaryRoads;
  const avenue = (Array.isArray(primaryRoads) && primaryRoads.length >= 2)
    ? primaryRoads[1]
    : [anchors.plaza, anchors.citadel];

  // ---------------- Road polylines -> road graph ----------------
  const squareCentre = anchors.plaza;
  const citCentre = anchors.citadel;

  const roadsOut = runRoadGraphAndBlocksStage({
    ctx,
    vorGraph,
    waterModel,
    anchors,
    waterKind,    
    rng,
    primaryRoads,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
    districts,
    wardsWithRoles,
  });

  // Keep local names consistent with return object.
  const secondaryRoadsLegacy = roadsOut.secondaryRoadsLegacy;
  const roadGraph = roadsOut.roadGraph;
  const blocks = roadsOut.blocks;

  // ---------------- Anchor invariants (debug only) ----------------
  runDebugInvariantsStage({
    debugEnabled: WARP_FORT.debug,
    vorGraph,
    primaryRoads,
    anchors,
    wallBase,
    outerBoundary,
    width,
    height,
    hasDock,
    waterModel,
  });

  return assembleModel({
    footprint,
    cx,
    cy,

    wallBase,
    wallCurtainForDraw, 
    wallForDraw,
    bastionPolysWarpedSafe,
    bastionHull,
    warp: { wall: warpWall, outworks: warpOutworks },
    gatesWarped,
    ravelins,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ditchWidth,
    glacisWidth,

    districts,
    blocks,
    warpWall,
    warpOutworks,
    fortHulls,

    wardsWithRoles,
    wardSeeds,
    wardRoleIndices,

    vorGraph,

    centre,
    baseR,
    citadel,
    avenue,
    primaryGateWarped,

    site: { water: waterKind, hasDock },
    waterModel,

    roads,
    primaryRoads,
    ring,
    ring2,
    secondaryRoadsLegacy,
    roadGraph,

    newTown,
    outerBoundary,

    gatesOriginal: gates,
    landmarks,
    anchors,
  });
}
