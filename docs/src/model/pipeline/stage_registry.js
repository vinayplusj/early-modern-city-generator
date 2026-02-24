// docs/src/model/pipeline/stage_registry.js
//
// Phase 1 stage registry.
// Purpose: centralize stage ordering WITHOUT changing stage code.
// Contract (Phase 4.6+): stages read inputs from `env` (runtime) and publish outputs to `env.ctx.state`.
// No stage-to-stage data is passed via `env.*`.

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
      const { ctx, cx, cy, baseR, bastionCount, gateCount } = env;

      const fort = runFortificationsStage(ctx, env.rng.fort, cx, cy, baseR, bastionCount, gateCount);

      ctx.state.fortifications = fort;
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

      // Canonical outputs used later
      ctx.state.primaryGate = nt.primaryGate;
      ctx.state.bastionWarpInputs = {
        bastionsForWarp: nt.bastionsForWarp,
        bastionPolys: nt.bastionPolys,
      };

      // Preserve existing ctx write (legacy)
      ctx.primaryGate = nt.primaryGate;
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

      ctx.state.outerBoundary = outerBoundary;
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

      const waterModel = runWaterStage({
        waterKind: env.waterKind,
        rng: env.rng.water,
        outerBoundary,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
      });

      ctx.state.waterModel = waterModel;
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
      const anchors = runAnchorsStage(ctx);
      ctx.state.anchors = anchors;
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
      const waterModel = ctx.state.waterModel;

      if (!wards) throw new Error("[EMCG] Stage 70 requires ctx.state.wards (Stage 50 output).");
      if (!anchors) throw new Error("[EMCG] Stage 70 requires ctx.state.anchors (Stage 60 output).");
      if (!outerBoundary) throw new Error("[EMCG] Stage 70 requires ctx.state.outerBoundary (Stage 30 output).");
      if (!waterModel) throw new Error("[EMCG] Stage 70 requires ctx.state.waterModel (Stage 40 output).");

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

      ctx.state.routingMesh = {
        vorGraph: meshOut.vorGraph,
        waterModel: meshOut.waterModel,
      };

      // Keep waterModel fresh
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

      ctx.state.ringsPreWarp = ringsOut;
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

      const districts = runDistrictsStage(wards.wardsWithRoles, env.cx, env.cy);
      ctx.state.districts = districts;
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

      const citadel = runCitadelStage(env.rng.anchors, anchors, env.baseR);

      ctx.state.citadel = citadel;
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

      ctx.state.warp = warpOut;

      // Canonical convenience aliases
      ctx.state.warpWall = warpOut?.warpWall ?? null;
      ctx.state.warpOutworks = warpOut?.warpOutworks ?? null;
      ctx.state.wallForDraw = warpOut?.wallForDraw ?? null;
      ctx.state.wallCurtainForDraw = warpOut?.wallCurtainForDraw ?? null;
    },
  },

  {
    id: 120,
    name: "warpDependentFortGeometry",
    run(env) {
      const ctx = env.ctx;

      const fort = ctx.state.fortifications;
      if (!fort) {
        throw new Error("[EMCG] Stage 120 requires ctx.state.fortifications (Stage 10 output).");
      }

      const warp = ctx.state.warp;
      if (!warp) {
        throw new Error("[EMCG] Stage 120 requires ctx.state.warp (Stage 110 output).");
      }

      const warpWall = warp?.warpWall ?? null;
      if (!warpWall) {
        throw new Error("[EMCG] Stage 120 requires warp.warpWall (Stage 110 output).");
      }

      const wallWarped = (Array.isArray(warpWall.wallWarped)) ? warpWall.wallWarped : null;

      const gatesOriginal = fort.gates;
      const primaryGate = ctx.state.primaryGate ?? null;

      const fortGeom = runWarpDependentFortGeometryStage({
        ctx,
        cx: env.cx,
        cy: env.cy,
        wallR: fort.wallR,
        wallBase: fort.wallBase,
        wallWarped,
        warpWall,
        gates: gatesOriginal,
        primaryGate,
      });

      ctx.state.fortGeometryWarped = fortGeom;
      ctx.state.rings = { ring: fortGeom.ring, ring2: fortGeom.ring2 };

      // Keep anchors canonical updated
      ctx.state.anchors.gates = fortGeom.gatesWarped;
      ctx.state.anchors.primaryGate = fortGeom.primaryGateWarped;
    },
  },

  {
    id: 130,
    name: "docks",
    run(env) {
      const ctx = env.ctx;

      const fort = ctx.state.fortifications;
      const anchors = ctx.state.anchors;
      const outerBoundary = ctx.state.outerBoundary;
      const waterModel = ctx.state.waterModel;
      const newTown = ctx.state.newTown;
      const fortGeom = ctx.state.fortGeometryWarped;

      if (!anchors) throw new Error("[EMCG] Stage 130 requires ctx.state.anchors (Stage 60 output).");
      if (!outerBoundary) throw new Error("[EMCG] Stage 130 requires ctx.state.outerBoundary (Stage 30 output).");
      if (!waterModel) throw new Error("[EMCG] Stage 130 requires ctx.state.waterModel (Stage 70 output).");
      if (!newTown) throw new Error("[EMCG] Stage 130 requires ctx.state.newTown (Stage 20 output).");
      if (!fort) throw new Error("[EMCG] Stage 130 requires ctx.state.fortifications (Stage 10 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 130 requires ctx.state.fortGeometryWarped (Stage 120 output).");

      const docks = runDocksStage({
        hasDock: env.hasDock,
        anchors,
        newTown: newTown.newTown,
        outerBoundary,
        wallBase: fortGeom.wallBaseForDraw,
        centre: fort.centre,
        waterModel,
        width: env.width,
        height: env.height,
      });

      ctx.state.docks = docks;

      // Canonical anchor mutation
      anchors.docks = docks;
      ctx.state.anchors = anchors;
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
      if (!routingMesh.vorGraph) throw new Error("[EMCG] Stage 140 missing routingMesh.vorGraph.");
      if (!anchors.plaza) throw new Error("[EMCG] Stage 140 missing anchors.plaza.");
      if (!anchors.citadel) throw new Error("[EMCG] Stage 140 missing anchors.citadel.");

      const primaryOut = runPrimaryRoadsStage({
        ctx,
        vorGraph: routingMesh.vorGraph,
        waterModel: ctx.state.waterModel,
        anchors,
        waterKind: ctx.params.waterKind,
        primaryGateWarped: anchors?.primaryGate || null,
        gatesWarped: anchors?.gates || [],
      });
      
      if (!primaryOut || typeof primaryOut !== "object") {
        throw new Error("[EMCG] Stage 140 produced invalid output (expected object).");
      }
      
      const { primaryRoads, primaryRoadsMeta, snappedNodes, gateForRoad } = primaryOut;
      
      if (!Array.isArray(primaryRoads) || primaryRoads.length === 0) {
        throw new Error("[EMCG] Stage 140 produced invalid primaryRoads after stage-level fallback.");
      }
      if (!Array.isArray(primaryRoadsMeta)) {
        throw new Error("[EMCG] Stage 140 invariant failed: primaryRoadsMeta must be an array.");
      }
      ctx.state.primaryRoads = primaryRoads;
      ctx.state.primaryRoadsMeta = Array.isArray(primaryRoadsMeta) ? primaryRoadsMeta : [];
      ctx.state.primaryRoadsSnappedNodes = snappedNodes || { gate: null, plaza: null, citadel: null, docks: null };
      ctx.state.primaryRoadsGateForRoad = gateForRoad || null;
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

      const bastionsSafe = warp?.bastionPolysWarpedSafe;
      const wallForOutworks = warp?.wallForDraw;

      if (!Array.isArray(bastionsSafe)) {
        throw new Error("[EMCG] Stage 150 requires bastionPolysWarpedSafe (Stage 110 output).");
      }
      if (!Array.isArray(wallForOutworks) || wallForOutworks.length < 3) {
        throw new Error("[EMCG] Stage 150 requires wallForOutworks polyline (Stage 110 output).");
      }

      const outworks = runOutworksStage({
        gatesWarped: fortGeom.gatesWarped,
        primaryGateWarped: fortGeom.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        fortR: fortGeom.fortR,
        ditchWidth: fortGeom.ditchWidth,
        glacisWidth: fortGeom.glacisWidth,
        newTown: newTown.newTown,
        bastionCount: env.bastionCount ?? ctx.params.bastions,
        bastionPolysWarpedSafe: bastionsSafe,
        wallForOutworks,
        warpOutworks: warp?.warpOutworks ?? null,
        warpDebugEnabled: Boolean(ctx.params.warpDebugEnabled),
      });

      if (outworks != null && !Array.isArray(outworks)) {
        throw new Error("[EMCG] Stage 150 produced invalid outworks (expected array or null).");
      }

      ctx.state.outworks = outworks;
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
      const citadel = ctx.state.citadel;

      if (!anchors) throw new Error("[EMCG] Stage 160 requires ctx.state.anchors (Stage 60 output).");
      if (!wards) throw new Error("[EMCG] Stage 160 requires ctx.state.wards (Stage 50 output).");
      if (!fort) throw new Error("[EMCG] Stage 160 requires ctx.state.fortifications (Stage 10 output).");
      if (!fortGeom) throw new Error("[EMCG] Stage 160 requires ctx.state.fortGeometryWarped (Stage 120 output).");

      const marketOut = runMarketStage({
        anchors,
        wardsWithRoles: wards.wardsWithRoles,
        wallBaseForDraw: fortGeom.wallBaseForDraw,
        centre: fort.centre,
        primaryGateWarped: fortGeom.primaryGateWarped,
        cx: env.cx,
        cy: env.cy,
        baseR: env.baseR,
        footprint: fort.footprint,
        width: env.width,
        height: env.height,
        citadel,
        minWallClear: ctx.params.minWallClear,
      });

      ctx.state.market = marketOut;
      ctx.state.landmarks = marketOut.landmarks;

      // Canonical anchor mutation
      anchors.market = marketOut.marketAnchor;
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
      if (!rings) throw new Error("[EMCG] Stage 170 requires ctx.state.rings (Stage 120 output).");

      const roadsOut = runRoadGraphAndBlocksStage({
        ctx,
        vorGraph: routingMesh.vorGraph,
        waterModel: routingMesh.waterModel,
        anchors,
        waterKind: env.waterKind,
        rng: env.rng.global,
        primaryRoads,
        gatesWarped: fortGeom.gatesWarped,
        ring: rings.ring,
        ring2: rings.ring2,
        squareCentre: anchors.plaza,
        citCentre: anchors.citadel,
        newTown: newTown.newTown,
        districts,
        wardsWithRoles: wards.wardsWithRoles,
      });

      if (!roadsOut || typeof roadsOut !== "object") {
        throw new Error("[EMCG] Stage 170 produced invalid output (expected object).");
      }
      if (!roadsOut.roadGraph) {
        throw new Error("[EMCG] Stage 170 produced missing roadGraph.");
      }
      if (!Array.isArray(roadsOut.blocks)) {
        throw new Error("[EMCG] Stage 170 produced invalid blocks (expected array).");
      }

      ctx.state.roadGraph = roadsOut.roadGraph;
      ctx.state.blocks = roadsOut.blocks;
      ctx.state.secondaryRoadsLegacy = roadsOut.secondaryRoadsLegacy;
      ctx.state.roadPolylines = roadsOut.polylines;
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

        primaryRoads: primaryRoads ?? null,

        anchors,

        wallBase: ctx.state.fortifications?.wallBase ?? null,
        outerBoundary: ctx.state.outerBoundary ?? null,

        width: env.width,
        height: env.height,
        hasDock: env.hasDock,
      });
    },
  },
];
