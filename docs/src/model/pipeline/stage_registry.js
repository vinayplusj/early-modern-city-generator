// docs/src/model/pipeline/stage_registry.js
//
// Phase 1 stage registry.
// Purpose: centralize stage ordering WITHOUT changing stage code.
// Contract: each stage runner mutates the `env` object only.
// Later phases will replace env mutation with strict input/output contracts.

import { runFortificationsStage } from "../stages/10_fortifications.js";
import { runNewTownStage } from "../stages/20_new_town.js";
import { runOuterBoundaryStage } from "../stages/30_outer_boundary.js";
import { runWaterStage } from "../stages/40_water.js";
import { runWardsStage } from "../stages/50_wards.js";
import { runAnchorsStage } from "../stages/60_anchors.js";
import { runRoutingMeshStage } from "../stages/70_routing_mesh.js";
import { runInnerRingsStage } from "../stages/80_inner_rings.js";
import { runDistrictsStage } from "../stages/90_districts.js";
import { runCitadelStage } from "../stages/100_citadel.js";
import { runWarpFieldStage } from "../stages/110_warp_field.js";
import { runWarpDependentFortGeometryStage } from "../stages/120_warp_dependent_fort_geometry.js";
import { runDocksStage } from "../stages/130_docks.js";
import { runPrimaryRoadsStage } from "../stages/140_primary_roads.js";
import { runOutworksStage } from "../stages/150_outworks.js";
import { runMarketStage } from "../stages/160_market.js";
import { runRoadGraphAndBlocksStage } from "../stages/170_road_graph_and_blocks.js";
import { runDebugInvariantsStage } from "../stages/900_debug_invariants.js";

export const PIPELINE_STAGES = [
  {
    id: 10,
    name: "fortifications",
    run(env) {
      const { ctx, rng, cx, cy, baseR, bastionCount, gateCount } = env;

      const fort = runFortificationsStage(ctx, rng, cx, cy, baseR, bastionCount, gateCount);
      env.ctx.state.fortifications = fort;

      env.fort = fort;
      env.footprint = fort.footprint;
      env.wallR = fort.wallR;

      env.wallBase = fort.wallBase;
      env.wallFinal = fort.wallFinal;

      env.bastions = fort.bastions;
      env.bastionPolys = fort.bastionPolys;
      env.bastionPolysWarpedSafe = fort.bastionPolys;

      env.gatesOriginal = fort.gates;

      env.ditchWidth = fort.ditchWidth;
      env.glacisWidth = fort.glacisWidth;
      env.ditchOuter = fort.ditchOuter;
      env.ditchInner = fort.ditchInner;
      env.glacisOuter = fort.glacisOuter;

      env.centre = fort.centre;
    },
  },

  {
    id: 20,
    name: "newTown",
    run(env) {
      const { ctx, cx, cy, baseR } = env;

      const fort = ctx.state.fortifications;
      if (!fort) {
        throw new Error("[EMCG] Stage 20 requires ctx.state.fortifications (Stage 10 output).");
      }
      const warpFortParams = ctx.params.warpFortParams;
      const warpDebugEnabled = Boolean(ctx.params.warpDebugEnabled);

      const nt = runNewTownStage({
        ctx,
        gates: fort.gates,
        bastions: fort.bastions,
        cx,
        cy,
        wallR: fort.wallR,
        baseR,
        ditchOuter: fort.ditchOuter,
        wallBase: fort.wallBase,
        ditchWidth: fort.ditchWidth,
        glacisWidth: fort.glacisWidth,
        wallFinal: fort.wallFinal,
        bastionPolys: fort.bastionPolys,
        warpDebugEnabled,
      });
      ctx.state.newTown = nt;
      env.newTown = nt.newTown;
      env.primaryGate = nt.primaryGate;
      ctx.primaryGate = nt.primaryGate;

      env.wallFinal = nt.wallFinal;
      env.bastionPolys = nt.bastionPolys;
      env.bastionsForWarp = nt.bastionsForWarp;

      // Keep the warp params in env for later stages (same as previous behaviour).
      env.warpFortParams = warpFortParams;
      env.warpDebugEnabled = warpDebugEnabled;
    },
  },

  {
    id: 30,
    name: "outerBoundary",
    run(env) {
      const ctx = env.ctx;
  
      const fort = ctx.state.fortifications;
      const nt = ctx.state.newTown;
  
      if (!fort) {
        throw new Error("[EMCG] Stage 30 requires ctx.state.fortifications (Stage 10 output).");
      }
      if (!nt) {
        throw new Error("[EMCG] Stage 30 requires ctx.state.newTown (Stage 20 output).");
      }
  
      const outerBoundary = runOuterBoundaryStage(fort.footprint, nt.newTown);
  
      // Canonical Phase 2 output
      ctx.state.outerBoundary = outerBoundary;
  
      // Phase 1 bridge output (keep until Stage 50/70 migrate)
      env.outerBoundary = outerBoundary;
  
      // Preserve existing ctx writes (bridge).
      ctx.geom.outerBoundary = outerBoundary;
      ctx.geom.cx = env.cx;
      ctx.geom.cy = env.cy;
      ctx.geom.wallR = fort.wallR;
    },
  },

  {
    id: 40,
    name: "water",
    run(env) {
      const ctx = env.ctx;
      const outerBoundary = ctx.state.outerBoundary;
    
      if (!outerBoundary) {
        throw new Error("[EMCG] Stage 40 requires ctx.state.outerBoundary (Stage 30 output).");
      }
    
      env.waterModel = runWaterStage({
        waterKind: env.waterKind,
        ctx,
        outerBoundary,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
      });
    
      // Optional canonical output for later migration of Stage 70.
      ctx.state.waterModel = env.waterModel;
    },
  },

  {
    id: 50,
    name: "wards",
    run(env) {
      const ctx = env.ctx;
      const outerBoundary = ctx.state.outerBoundary;
      
      if (!outerBoundary) {
        throw new Error("[EMCG] Stage 50 requires ctx.state.outerBoundary (Stage 30 output).");
      }
      
      const wardsOut = runWardsStage({
        ctx,
        baseR: env.baseR,
        cx: env.cx,
        cy: env.cy,
        outerBoundary,
      });
      ctx.state.wards = wardsOut;
      env.wardSeeds = wardsOut.wardSeeds;
      env.wardsWithRoles = wardsOut.wardsWithRoles;
      env.wardRoleIndices = wardsOut.wardRoleIndices;
      env.fortHulls = wardsOut.fortHulls;
    },
  },

  {
    id: 60,
    name: "anchors",
    run(env) {
      env.anchors = runAnchorsStage(env.ctx);
    },
  },

  {
    id: 70,
    name: "routingMesh",
    run(env) {
      const meshOut = runRoutingMeshStage({
        ctx: env.ctx,
        wardsWithRoles: env.wardsWithRoles,
        anchors: env.anchors,
        waterKind: env.waterKind,
        waterModel: env.waterModel,
        outerBoundary: env.outerBoundary,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
      });

      env.vorGraph = meshOut.vorGraph;
      env.waterModel = meshOut.waterModel;

      env.ctx.mesh = env.ctx.mesh || {};
      env.ctx.mesh.vorGraph = env.vorGraph;
    },
  },

  {
    id: 80,
    name: "innerRings",
    run(env) {
      const ringsOut = runInnerRingsStage(env.wallBase, env.cx, env.cy, env.wallR);
      env.ring = ringsOut.ring;
      env.ring2 = ringsOut.ring2;
    },
  },

  {
    id: 90,
    name: "districts",
    run(env) {
      const ctx = env.ctx;
      const wards = ctx.state.wards;
    
      if (!wards) {
        throw new Error("[EMCG] Stage 90 requires ctx.state.wards (Stage 50 output).");
      }
    
      env.districts = runDistrictsStage(wards.wardsWithRoles, env.cx, env.cy);
    
      // Optional canonical output for later migration of Stage 110/170.
      ctx.state.districts = env.districts;
    },
  },

  {
    id: 100,
    name: "citadel",
    run(env) {
      env.citadel = runCitadelStage(env.rng, env.anchors, env.baseR);
    },
  },

  {
    id: 110,
    name: "warpField",
    run(env) {
      const warpOut = runWarpFieldStage({
        ctx: env.ctx,
        cx: env.cx,
        cy: env.cy,

        wallFinal: env.wallFinal,
        wallBase: env.wallBase,

        fortHulls: env.fortHulls,
        districts: env.districts,

        bastionsForWarp: env.bastionsForWarp,
        bastionPolys: env.bastionPolys,

        warpFortParams: env.ctx.params.warpFortParams,
        warpDebugEnabled: Boolean(env.ctx.params.warpDebugEnabled),
      });

      env.warpOut = warpOut;

      env.wallCurtainForDraw = warpOut?.wallCurtainForDraw || null;
      env.warpWall = warpOut.warpWall;
      env.warpOutworks = warpOut.warpOutworks;

      env.wallForDraw = warpOut.wallForDraw;

      env.bastionPolysWarpedSafe = warpOut.bastionPolysWarpedSafe;
      env.bastionHull = warpOut.bastionHullWarpedSafe;
    },
  },

  {
    id: 120,
    name: "warpDependentFortGeometry",
    run(env) {
      const wallWarped = (env.warpWall && env.warpWall.wallWarped) ? env.warpWall.wallWarped : null;

      const fortGeom = runWarpDependentFortGeometryStage({
        ctx: env.ctx,
        cx: env.cx,
        cy: env.cy,
        wallR: env.wallR,
        wallBase: env.wallBase,
        wallWarped,
        warpWall: env.warpWall,
        gates: env.gatesOriginal,
        primaryGate: env.primaryGate,
      });

      env.fortR = fortGeom.fortR;

      env.ditchWidth = fortGeom.ditchWidth;
      env.glacisWidth = fortGeom.glacisWidth;

      env.wallBaseForDraw = fortGeom.wallBaseForDraw;

      env.ditchOuter = fortGeom.ditchOuter;
      env.ditchInner = fortGeom.ditchInner;
      env.glacisOuter = fortGeom.glacisOuter;

      env.ring = fortGeom.ring;
      env.ring2 = fortGeom.ring2;

      env.gatesWarped = fortGeom.gatesWarped;
      env.primaryGateWarped = fortGeom.primaryGateWarped;

      env.anchors.gates = env.gatesWarped;
      env.anchors.primaryGate = env.primaryGateWarped;
    },
  },

  {
    id: 130,
    name: "docks",
    run(env) {
      env.anchors.docks = runDocksStage({
        hasDock: env.hasDock,
        anchors: env.anchors,
        newTown: env.newTown,
        outerBoundary: env.outerBoundary,
        wallBase: env.wallBaseForDraw,
        centre: env.centre,
        waterModel: env.waterModel,
        width: env.width,
        height: env.height,
      });
    },
  },

  {
    id: 140,
    name: "primaryRoads",
    run(env) {
      const primaryOut = runPrimaryRoadsStage({
        ctx: env.ctx,
        vorGraph: env.vorGraph,
        waterModel: env.waterModel,
        anchors: env.anchors,
        waterKind: env.waterKind,
        primaryGateWarped: env.primaryGateWarped,
        gatesWarped: env.gatesWarped,
      });

      env.primaryRoads = primaryOut.primaryRoads;

    },
  },

  {
    id: 150,
    name: "outworks",
    run(env) {
      env.ravelins = runOutworksStage({
        gatesWarped: env.gatesWarped,
        primaryGateWarped: env.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        fortR: env.fortR,
        ditchWidth: env.ditchWidth,
        glacisWidth: env.glacisWidth,
        newTown: env.newTown,
        bastionCount: env.bastionCount,
        bastionPolysWarpedSafe: env.bastionPolysWarpedSafe,
        wallForOutworks: env.wallForDraw,
        warpOutworks: env.warpOutworks,
        warpDebugEnabled: Boolean(env.ctx.params.warpDebugEnabled),
      });
    },
  },

  {
    id: 160,
    name: "market",
    run(env) {
      const marketOut = runMarketStage({
        anchors: env.anchors,
        wardsWithRoles: env.wardsWithRoles,
        wallBaseForDraw: env.wallBaseForDraw,
        centre: env.centre,
        primaryGateWarped: env.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
        footprint: env.footprint,
        width: env.width,
        height: env.height,
        citadel: env.citadel,
        minWallClear: env.ctx.params.minWallClear,
      });

      env.anchors.market = marketOut.marketAnchor;
      env.marketCentre = marketOut.marketCentre;
      env.landmarks = marketOut.landmarks;
    },
  },

  {
    id: 170,
    name: "roadGraphAndBlocks",
    run(env) {
      const squareCentre = env.anchors.plaza;
      const citCentre = env.anchors.citadel;

      const roadsOut = runRoadGraphAndBlocksStage({
        ctx: env.ctx,
        vorGraph: env.vorGraph,
        waterModel: env.waterModel,
        anchors: env.anchors,
        waterKind: env.waterKind,
        rng: env.rng,
        primaryRoads: env.primaryRoads,
        gatesWarped: env.gatesWarped,
        ring: env.ring,
        ring2: env.ring2,
        squareCentre,
        citCentre,
        newTown: env.newTown,
        districts: env.districts,
        wardsWithRoles: env.wardsWithRoles,
      });

      env.secondaryRoadsLegacy = roadsOut.secondaryRoadsLegacy;
      env.roadGraph = roadsOut.roadGraph;
      env.blocks = roadsOut.blocks;
    },
  },

  {
    id: 900,
    name: "debugInvariants",
    run(env) {
      runDebugInvariantsStage({
        debugEnabled: Boolean(env.ctx.params.warpDebugEnabled),
        debugOut: env.debug,

        cx: env.cx,
        cy: env.cy,
        fortHulls: env.fortHulls,

        vorGraph: env.vorGraph,
        primaryRoads: env.primaryRoads,
        anchors: env.anchors,
        wallBase: env.wallBase,
        outerBoundary: env.outerBoundary,
        width: env.width,
        height: env.height,
        hasDock: env.hasDock,
        waterModel: env.waterModel,
      });
    },
  },
];
