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
  
      // Canonical Phase 2 output
      ctx.state.fortifications = fort;
  
      // Bridge outputs (keep until every downstream stage reads ctx.state.fortifications)
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
      ctx.state.bastionWarpInputs = {
        bastionsForWarp: nt.bastionsForWarp,
        bastionPolys: nt.bastionPolys,
      };
      env.newTown = nt.newTown;
      env.primaryGate = nt.primaryGate;
      ctx.primaryGate = nt.primaryGate;

      // Bridge until Stage 110 reads fort.wallFinal only
      env.wallFinal = nt.wallFinal;
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
    },
  },

  {
    id: 60,
    name: "anchors",
    run(env) {
      const ctx = env.ctx;
      env.anchors = runAnchorsStage(ctx);
      ctx.state.anchors = env.anchors;
    },
  },

  {
    id: 70,
    name: "routingMesh",
    run(env) {
      const ctx = env.ctx;
    
      const wards = ctx.state.wards;
      const anchors = ctx.state.anchors;
      const outerBoundary = ctx.state.outerBoundary;
      const waterModel = ctx.state.waterModel; // set by Stage 40
    
      if (!wards) {
        throw new Error("[EMCG] Stage 70 requires ctx.state.wards (Stage 50 output).");
      }
      if (!anchors) {
        throw new Error("[EMCG] Stage 70 requires ctx.state.anchors (Stage 60 output).");
      }
      if (!outerBoundary) {
        throw new Error("[EMCG] Stage 70 requires ctx.state.outerBoundary (Stage 30 output).");
      }
      if (!waterModel) {
        throw new Error("[EMCG] Stage 70 requires ctx.state.waterModel (Stage 40 output).");
      }
    
      const meshOut = runRoutingMeshStage({
        ctx,
        wardsWithRoles: wards.wardsWithRoles,
        anchors,
        waterKind: env.waterKind,
        waterModel,
        outerBoundary,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
      });
    
      // Preserve existing ctx writes (existing behaviour)
      ctx.mesh = ctx.mesh || {};
      ctx.mesh.vorGraph = meshOut.vorGraph;
    
      // Canonical Phase 2 output
      ctx.state.routingMesh = {
        vorGraph: meshOut.vorGraph,
        waterModel: meshOut.waterModel,
      };
    
      // Also keep canonical waterModel fresh (Stage 140 expects env.waterModel now, but
      // later we will migrate it to ctx.state.routingMesh.waterModel).
      ctx.state.waterModel = meshOut.waterModel;
    },
  },

{
  id: 80,
  name: "innerRings",
  run(env) {
    const ctx = env.ctx;
    const fort = ctx.state.fortifications;

    if (!fort) {
      throw new Error("[EMCG] Stage 80 requires ctx.state.fortifications (Stage 10 output).");
    }

    const ringsOut = runInnerRingsStage(
      fort.wallBase,
      env.cx,
      env.cy,
      fort.wallR
    );

    // Canonical Phase 2 output
    ctx.state.ringsPreWarp = ringsOut;

    // Bridge outputs
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
      const ctx = env.ctx;
      const anchors = ctx.state.anchors;
  
      if (!anchors) {
        throw new Error("[EMCG] Stage 100 requires ctx.state.anchors (Stage 60 output).");
      }
  
      const citadel = runCitadelStage(env.rng, anchors, env.baseR);
  
      // Canonical output
      ctx.state.citadel = citadel;
  
      // Bridge output (until everything reads ctx.state.citadel)
      env.citadel = citadel;
    },
  },
  
  {
    id: 110,
    name: "warpField",
    run(env) {
      const ctx = env.ctx;
  
      const fort = ctx.state.fortifications;
      const wards = ctx.state.wards;
      const districts = ctx.state.districts;
      const bastionInputs = ctx.state.bastionWarpInputs;
  
      if (!fort) throw new Error("[EMCG] Stage 110 requires ctx.state.fortifications (Stage 10 output).");
      if (!wards) throw new Error("[EMCG] Stage 110 requires ctx.state.wards (Stage 50 output).");
      if (!districts) throw new Error("[EMCG] Stage 110 requires ctx.state.districts (Stage 90 output).");
      if (!bastionInputs) throw new Error("[EMCG] Stage 110 requires ctx.state.bastionWarpInputs (Stage 20 output).");
  
      const warpOut = runWarpFieldStage({
        ctx,
        cx: env.cx,
        cy: env.cy,
  
        wallFinal: fort.wallFinal,
        wallBase: fort.wallBase,
  
        fortHulls: wards.fortHulls,
        districts,
  
        bastionsForWarp: bastionInputs.bastionsForWarp,
        bastionPolys: bastionInputs.bastionPolys,
  
        warpFortParams: ctx.params.warpFortParams,
        warpDebugEnabled: Boolean(ctx.params.warpDebugEnabled),
      });
  
      // Canonical
      ctx.state.warp = warpOut;
  
      // Bridge (keep until Stage 120 and Stage 150 are fully canonical)
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
      const ctx = env.ctx;
      const fort = ctx.state.fortifications;
      const warp = ctx.state.warp;
  
      if (!warp) {
        throw new Error("[EMCG] Stage 120 requires ctx.state.warp (Stage 110 output).");
      }
  
      const warpWall = warp?.warpWall ?? env.warpWall ?? null; // bridge fallback
      const wallWarped = (warpWall && Array.isArray(warpWall.wallWarped)) ? warpWall.wallWarped : null;
  
      const fortGeom = runWarpDependentFortGeometryStage({
        ctx,
        cx: env.cx,
        cy: env.cy,
        wallR: fort.wallR,
        wallBase: fort.wallBase,
        wallWarped,
        warpWall,
        gates: env.gatesOriginal,
        primaryGate: env.primaryGate,
      });
  
      // Canonical
      ctx.state.fortGeometryWarped = fortGeom;
      ctx.state.rings = { ring: fortGeom.ring, ring2: fortGeom.ring2 };
  
      // Bridge outputs (still used by later stages and renderer)
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
  
      // Keep anchors canonical updated (your anchors canonical step)
      ctx.state.anchors.gates = fortGeom.gatesWarped;
      ctx.state.anchors.primaryGate = fortGeom.primaryGateWarped;
    },
  },
  {
    id: 130,
    name: "docks",
    run(env) {
      const ctx = env.ctx;
  
      const anchors = ctx.state.anchors;
      const outerBoundary = ctx.state.outerBoundary;
      const waterModel = ctx.state.waterModel;
      const newTown = ctx.state.newTown;
      const fortGeom = ctx.state.fortGeometryWarped;
  
      if (!anchors) throw new Error("[EMCG] Stage 130 requires ctx.state.anchors (Stage 60 output).");
      if (!outerBoundary) throw new Error("[EMCG] Stage 130 requires ctx.state.outerBoundary (Stage 30 output).");
      if (!waterModel) throw new Error("[EMCG] Stage 130 requires ctx.state.waterModel (Stage 70 output).");
      if (!newTown) throw new Error("[EMCG] Stage 130 requires ctx.state.newTown (Stage 20 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 130 requires ctx.state.fortGeometryWarped (Stage 120 output).");
  
      const docks = runDocksStage({
        hasDock: env.hasDock,
        anchors,
        newTown: newTown.newTown,
        outerBoundary,
        wallBase: fortGeom.wallBaseForDraw,
        centre: (ctx.state.fortifications?.centre ?? env.centre),
        waterModel,
        width: env.width,
        height: env.height,
      });
  
      // Canonical output
      ctx.state.docks = docks;
  
      // Canonical anchor mutation (preferred)
      anchors.docks = docks;
  
    },
  },

  {
    id: 140,
    name: "primaryRoads",
    run(env) {
      const ctx = env.ctx;
    
      const routingMesh = ctx.state.routingMesh;
      const anchors = ctx.state.anchors;
      const fortGeom = ctx.state.fortGeometryWarped;
    
      if (!routingMesh) throw new Error("[EMCG] Stage 140 requires ctx.state.routingMesh (Stage 70 output).");
      if (!anchors) throw new Error("[EMCG] Stage 140 requires ctx.state.anchors (Stage 60 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 140 requires ctx.state.fortGeometryWarped (Stage 120 output).");
    
      if (Boolean(ctx.params.warpDebugEnabled)) {
        console.log("[Stage140] inputs", {
          vorGraphNodes: routingMesh.vorGraph?.nodes?.length,
          vorGraphEdges: routingMesh.vorGraph?.edges?.length,
          plaza: anchors.plaza,
          citadel: anchors.citadel,
          gatesWarpedN: fortGeom.gatesWarped?.length,
          primaryGateWarped: fortGeom.primaryGateWarped,
          waterKind: env.waterKind,
        });
      }
      const primaryOut = runPrimaryRoadsStage({
        ctx,
        vorGraph: routingMesh.vorGraph,
        waterModel: routingMesh.waterModel,
        anchors,
        waterKind: env.waterKind,
        primaryGateWarped: fortGeom.primaryGateWarped,
        gatesWarped: fortGeom.gatesWarped,
      });
      if (!Array.isArray(ctx.state.primaryRoads)) {
        throw new Error("[EMCG] Stage 140 produced invalid primaryRoads.");
      }
      ctx.state.primaryRoads = primaryOut.primaryRoads;
      // Bridge until nothing reads env.primaryRoads
      env.primaryRoads = ctx.state.primaryRoads;
    },
  },

  {
    id: 150,
    name: "outworks",
    run(env) {
      const ctx = env.ctx;
    
      const fortGeom = ctx.state.fortGeometryWarped;
      const warp = ctx.state.warp;
      const newTown = ctx.state.newTown;
    
      if (!fortGeom) throw new Error("[EMCG] Stage 150 requires ctx.state.fortGeometryWarped (Stage 120 output).");
      if (!warp) throw new Error("[EMCG] Stage 150 requires ctx.state.warp (Stage 110 output).");
      if (!newTown) throw new Error("[EMCG] Stage 150 requires ctx.state.newTown (Stage 20 output).");
    
      const outworks = runOutworksStage({
        gatesWarped: fortGeom.gatesWarped,
        primaryGateWarped: fortGeom.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        fortR: fortGeom.fortR ?? env.fortR,
        ditchWidth: fortGeom.ditchWidth ?? env.ditchWidth,
        glacisWidth: fortGeom.glacisWidth ?? env.glacisWidth,
        newTown: newTown.newTown,
        bastionCount: env.bastionCount ?? ctx.params.bastions,
        bastionPolysWarpedSafe: warp.bastionPolysWarpedSafe ?? env.bastionPolysWarpedSafe,
        wallForOutworks: warp.wallForDraw ?? env.wallForDraw,
        warpOutworks: warp.warpOutworks ?? env.warpOutworks ?? null,
        warpDebugEnabled: Boolean(ctx.params.warpDebugEnabled),
      });
      if (outworks != null && !Array.isArray(outworks)) {
        throw new Error("[EMCG] Stage 150 produced invalid outworks (expected array or null).");
      }
      // Canonical output
      ctx.state.outworks = outworks;

      // Bridge output (until renderer / assemble stops reading env.ravelins)
      env.ravelins = outworks;
    },
  },
  {
    id: 160,
    name: "market",
    run(env) {
      const ctx = env.ctx;
  
      const anchors = ctx.state.anchors;
      const wards = ctx.state.wards;
      const fort = ctx.state.fortifications;
      const fortGeom = ctx.state.fortGeometryWarped;
      const citadel = ctx.state.citadel ?? env.citadel;
  
      if (!anchors) throw new Error("[EMCG] Stage 160 requires ctx.state.anchors (Stage 60 output).");
      if (!wards) throw new Error("[EMCG] Stage 160 requires ctx.state.wards (Stage 50 output).");
      if (!fort) throw new Error("[EMCG] Stage 160 requires ctx.state.fortifications (Stage 10 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 160 requires ctx.state.fortGeometryWarped (Stage 120 output).");
  
      const marketOut = runMarketStage({
        anchors,
        wardsWithRoles: wards.wardsWithRoles,
        wallBaseForDraw: fortGeom.wallBaseForDraw,
        centre: fort.centre ?? env.centre,
        primaryGateWarped: fortGeom.primaryGateWarped ?? env.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
        footprint: fort.footprint,
        width: env.width,
        height: env.height,
        citadel,
        minWallClear: ctx.params.minWallClear,
      });
  
      // Canonical
      ctx.state.market = marketOut;
      ctx.state.landmarks = marketOut.landmarks;
  
      // Canonical anchor mutation
      anchors.market = marketOut.marketAnchor;
  
      // Bridges (until assemble/run_pipeline fully stops reading env.*)
      env.marketCentre = marketOut.marketCentre;
      env.landmarks = marketOut.landmarks;
    },
  },

  {
    id: 170,
    name: "roadGraphAndBlocks",
    run(env) {
      const ctx = env.ctx;
  
      const routingMesh = ctx.state.routingMesh;
      const anchors = ctx.state.anchors;
      const primaryRoads = ctx.state.primaryRoads;
      const districts = ctx.state.districts;
      const wards = ctx.state.wards;
      const fortGeom = ctx.state.fortGeometryWarped;
      const newTown = ctx.state.newTown;
      const rings = ctx.state.rings;
  
      if (!routingMesh) throw new Error("[EMCG] Stage 170 requires ctx.state.routingMesh (Stage 70 output).");
      if (!anchors) throw new Error("[EMCG] Stage 170 requires ctx.state.anchors (Stage 60 output).");
      if (!primaryRoads) throw new Error("[EMCG] Stage 170 requires ctx.state.primaryRoads (Stage 140 output).");
      if (!districts) throw new Error("[EMCG] Stage 170 requires ctx.state.districts (Stage 90 output).");
      if (!wards) throw new Error("[EMCG] Stage 170 requires ctx.state.wards (Stage 50 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 170 requires ctx.state.fortGeometryWarped (Stage 120 output).");
      if (!newTown) throw new Error("[EMCG] Stage 170 requires ctx.state.newTown (Stage 20 output).");
  
      const roadsOut = runRoadGraphAndBlocksStage({
        ctx,
        vorGraph: routingMesh.vorGraph,
        waterModel: routingMesh.waterModel,
        anchors,
        waterKind: env.waterKind,
        rng: env.rng,
        primaryRoads,
        gatesWarped: fortGeom.gatesWarped,
        ring: rings?.ring ?? env.ring,
        ring2: rings?.ring2 ?? env.ring2,
        squareCentre: anchors.plaza,
        citCentre: anchors.citadel,
        newTown: newTown.newTown,
        districts,
        wardsWithRoles: wards.wardsWithRoles,
      });
  
      env.secondaryRoadsLegacy = roadsOut.secondaryRoadsLegacy;
      env.roadGraph = roadsOut.roadGraph;
      env.blocks = roadsOut.blocks;
  
      ctx.state.roadGraph = roadsOut.roadGraph;
      ctx.state.blocks = roadsOut.blocks;
      ctx.state.secondaryRoadsLegacy = roadsOut.secondaryRoadsLegacy;
    },
  },

{
  id: 900,
  name: "debugInvariants",
  run(env) {
    const ctx = env.ctx;

    const wards = ctx.state.wards;
    const routingMesh = ctx.state.routingMesh;
    const anchors = ctx.state.anchors;
    const primaryRoads = ctx.state.primaryRoads;

    // Debug stage should be tolerant, but enforce minimum required inputs
    if (!wards) throw new Error("[EMCG] Stage 900 requires ctx.state.wards (Stage 50 output).");
    if (!routingMesh) throw new Error("[EMCG] Stage 900 requires ctx.state.routingMesh (Stage 70 output).");
    if (!anchors) throw new Error("[EMCG] Stage 900 requires ctx.state.anchors (Stage 60 output).");

    runDebugInvariantsStage({
      debugEnabled: Boolean(ctx.params.warpDebugEnabled),
      debugOut: env.debug,

      cx: env.cx,
      cy: env.cy,
      fortHulls: wards.fortHulls,

      vorGraph: routingMesh.vorGraph,
      waterModel: routingMesh.waterModel,

      // Prefer canonical primaryRoads; fall back to env for bridge
      primaryRoads: primaryRoads ?? env.primaryRoads,

      anchors,

      // These are still partially env-driven until all fort outputs are migrated
      wallBase: ctx.state.fortifications?.wallBase ?? env.wallBase,
      outerBoundary: ctx.state.outerBoundary ?? env.outerBoundary,

      width: env.width,
      height: env.height,
      hasDock: env.hasDock,
    });
  },
},
];
