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
  normalize,
  finitePointOrNull,
  vec,
  len,
  safeNormalize,
  clampPointToCanvas,
} from "../geom/primitives.js";
import {
  centroid,
  pointInPolyOrOn,
  supportPoint,
  pushOutsidePoly,
  snapPointToPolyline,
} from "../geom/poly.js";

import { offsetRadial } from "../geom/offset.js";
import { convexHull } from "../geom/hull.js";

import { buildRoadGraphWithIntersections } from "../roads/graph.js";
import { assignWardRoles, wardCentroid } from "./wards/ward_roles.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
  makeRavelin,
} from "./features.js";

// Milestone 3.6: blocks extraction (faces) - debug use
import { extractBlocksFromRoadGraph } from "../roads/blocks.js";

// Change 3: Voronoi-driven districts (role-grouped wards) replace radial sector districts.
import {
  buildVoronoiDistrictsFromWards,
  assignBlocksToDistrictsByWards,
} from "./districts_voronoi.js";

import { snapGatesToWall } from "./generate_helpers/snap.js";
import { safeMarketNudge, computeInitialMarketCentre } from "./generate_helpers/market.js";
import { placeNewTown } from "./generate_helpers/new_town.js";

import { buildFortWarp, clampPolylineRadial } from "./generate_helpers/warp_stage.js";
import { buildRoadPolylines } from "./generate_helpers/roads_stage.js";
import { buildWardsVoronoi } from "./wards/wards_voronoi.js";

import {
  ensureInside,
  pushAwayFromWall,
} from "./anchors/anchor_constraints.js";

import { buildWaterModel } from "./water.js";
import { buildAnchors } from "./stages/anchors.js";
import { buildDocks } from "./stages/docks.js";
import { createCtx } from "./ctx.js";
import { warpPolylineRadial } from "./warp.js";
import { buildVoronoiPlanarGraph, snapPointToGraph } from "./mesh/voronoi_planar_graph.js";
import { dijkstra, pathNodesToPolyline } from "./routing/shortest_path.js";
import { makeRoadWeightFn } from "./routing/weights.js";


const WARP_FORT = {
  enabled: true,
  debug: true,

  samples: 720,
  smoothRadius: 10,
  maxStep: 1.5,

  maxOut: 40,
  maxIn: 20,

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
  version: "evening",
  buildDate: "2026-02-15",
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

function isInsidePolyOrSkip(p, poly) {
  if (!p) return false;
  if (!Array.isArray(poly) || poly.length < 3) return true; // pass-through
  return pointInPolyOrOn(p, poly, 1e-6);
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

  const rng = mulberry32(seed);

  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

  // ---------------- Footprint + main fortifications ----------------
  const footprint = generateFootprint(rng, cx, cy, baseR, 22);
  const wallR = baseR * 0.78;

  const { base: wallBase, wall, bastions } = generateBastionedWall(
    rng,
    cx,
    cy,
    wallR,
    bastionCount
  );

  let ditchWidth = wallR * 0.035;
  let glacisWidth = wallR * 0.08;
  ctx.params.baseR = baseR;
  ctx.params.minWallClear = ditchWidth * 1.25;
  // Keep separation proportional, but bounded so it is always satisfiable.
  ctx.params.minAnchorSep = Math.max(ditchWidth * 3.0, Math.min(baseR * 0.14, wallR * 0.22));
  ctx.params.canvasPad = 10;
  ctx.params.roadWaterPenalty = 5000;      // or larger if you want near-hard avoidance
  ctx.params.roadCitadelPenalty = 1500;    // scale to taste
  ctx.params.roadWaterClearance = 20;
  
  ctx.params.roadCitadelAvoidRadius = 80;

  // Hard avoid toggles (safe defaults)
  ctx.params.roadHardAvoidWater = true;     // roads should not enter water edges
  ctx.params.roadHardAvoidCitadel = false; // start soft; flip to true once you confirm connectivity

  ctx.geom.wallBase = wallBase;

  let ditchOuter = offsetRadial(wallBase, cx, cy, ditchWidth);
  let ditchInner = offsetRadial(wallBase, cx, cy, ditchWidth * 0.35);
  let glacisOuter = offsetRadial(wallBase, cx, cy, ditchWidth + glacisWidth);

  const centre = centroid(footprint);
  ctx.geom.centre = centre;
  ctx.geom.footprint = footprint;

  let anchors = null;

  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Start with the full bastioned wall.
  let wallFinal = wall;
  let bastionPolys = bastions.map((b) => b.pts);
  let bastionPolysWarpedSafe = bastionPolys;

  // ---------------- New Town placement ----------------
  const placed = placeNewTown({
    rng: ctx.rng.newTown,
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
  });

  let newTown = placed.newTown;
  const primaryGate = placed.primaryGate;
  ctx.primaryGate = primaryGate;
  wallFinal = (placed.wallFinal && Array.isArray(placed.wallFinal)) ? placed.wallFinal : wallFinal;
  bastionPolys = (placed.bastionPolys && Array.isArray(placed.bastionPolys)) ? placed.bastionPolys : bastionPolys;

  if (WARP_FORT.debug) {
    const okLen = Array.isArray(bastionPolys) && Array.isArray(bastions) && bastionPolys.length === bastions.length;
    if (!okLen) {
      throw new Error("bastionPolys length must match bastions length");
    }
  }

  const hitBastionSet = new Set(placed.hitBastions || []);
  const bastionsForWarp = (bastions || []).filter((_, i) => !hitBastionSet.has(i));

  // ---------------- Overall boundary ----------------
  const outerBoundary = convexHull([
    ...footprint,
    ...((newTown && newTown.poly && newTown.poly.length >= 3) ? newTown.poly : []),
  ]);
  ctx.geom.outerBoundary = outerBoundary;
  ctx.geom.cx = cx;
  ctx.geom.cy = cy;
  ctx.geom.wallR = wallR;

  // ---------------- Water (river/coast) ----------------
  const waterModel = (waterKind === "none")
    ? { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null }
    : buildWaterModel({
        rng: ctx.rng.water,
        siteWater: waterKind,
        outerBoundary,
        cx,
        cy,
        baseR,
      });

  // ---------------- Wards (Voronoi) + deterministic roles ----------------
  const WARDS_PARAMS = {
    seedCount: 24,                 // spiral seeds (core density)
    spiralScale: baseR * 0.14,
    jitterRadius: baseR * 0.03,
    jitterAngle: 0.25,
    bboxPadding: baseR * 1.2,
    clipToFootprint: true,
  
    // NEW: boundary ring to create more “rings” and reduce skew
    boundarySeedCount: 16,         // start with 16–32; 24 is a good default
    boundaryInset: Math.max(4, baseR * 0.015),
  };

  const { wardSeeds, wards } = buildWardsVoronoi({
    rng: ctx.rng.wards,
    centre: { x: cx, y: cy },
    footprintPoly: outerBoundary,
    params: WARDS_PARAMS,
  });

  ctx.wards.seeds = wardSeeds;

  const {
    wards: wardsWithRoles,
    indices: wardRoleIndices,
    fortHulls,
  } = assignWardRoles({
    wards,
    centre: { x: cx, y: cy },
    params: { innerCount: 8 },
  });

  ctx.wards.cells = wardsWithRoles;
  ctx.wards.roleIndices = wardRoleIndices;
  anchors = buildAnchors(ctx);

    // ---------------- Voronoi planar graph (routing mesh) ----------------
    // Build AFTER wards are finalized (clipped) and roles assigned.
    const vorGraph = buildVoronoiPlanarGraph({
      wards: wardsWithRoles,
      eps: 1e-3,
      waterModel,
      anchors,          // ✅ use anchors so nearCitadel can be flagged
      params: ctx.params,
    });
  
    ctx.mesh = ctx.mesh || {};
    ctx.mesh.vorGraph = vorGraph;

// ---------------- Inner rings ----------------
  let ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  let ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);

  // ---------------- Districts (Voronoi role groups) ----------------
  // Change 3: districts are derived from wardsWithRoles, not from radial sectors.
  const districts = buildVoronoiDistrictsFromWards({
    wards: wardsWithRoles,
    centre: { x: cx, y: cy },
  });

  // ---------------- Citadel ----------------
  const citSize = baseR * 0.1;
  const citadel = generateBastionedWall(rng, anchors.citadel.x, anchors.citadel.y, citSize, 5).wall;

  // ---------------- Warp field ----------------
  // We use TWO warp passes:
  // 1) The curtain wall is pulled toward the INNER hull, but clamped to stay outside it.
  // 2) Bastions / ravelins are pulled toward the OUTER hull, but clamped to stay inside it.
  //
  // This matches the requirement that fortifications fill the “magenta band”:
  //   inner hull < wall < outworks < outer hull

  const fortInnerHull = fortHulls?.innerHull?.outerLoop ?? null;
  const fortOuterHull = fortHulls?.outerHull?.outerLoop ?? null;

  ctx.params.warpFort = WARP_FORT;

  // Pass A: warp the wall toward the inner hull (with clamps).
  const warpWall = buildFortWarp({
    enabled: true,
    centre: { x: cx, y: cy },
    wallPoly: wallFinal,
    targetPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMinPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMaxPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    clampMinMargin: 2,
    clampMaxMargin: 2,
    districts,
    bastions: bastionsForWarp,
    params: ctx.params.warpFort,
  });

  // Pass B: warp outworks toward the outer hull (with clamps).
  const warpOutworks = buildFortWarp({
    enabled: true,
    centre: { x: cx, y: cy },
    wallPoly: wallFinal,
    targetPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    tuningPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    clampMinPoly: (Array.isArray(fortInnerHull) && fortInnerHull.length >= 3) ? fortInnerHull : null,
    clampMaxPoly: (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) ? fortOuterHull : null,
    clampMinMargin: 2,
    clampMaxMargin: 2,
    districts,
    bastions: bastionsForWarp,
    params: ctx.params.warpFort,
  });

  const wallWarped = (warpWall && warpWall.wallWarped) ? warpWall.wallWarped : null;
  const wallForDraw = wallWarped || wallFinal;

      function sampleOnRing(thetas, values, theta) {
    const n = thetas.length;
    if (!n) return null;
    const twoPi = Math.PI * 2;

    let a = theta % twoPi;
    if (a < 0) a += twoPi;

    const step = twoPi / n;
    const i0 = Math.floor(a / step) % n;
    const i1 = (i0 + 1) % n;
    const t0 = i0 * step;
    const u = (a - t0) / step;

    const v0 = values[i0];
    const v1 = values[i1];
    if (!Number.isFinite(v0) && !Number.isFinite(v1)) return null;
    if (!Number.isFinite(v0)) return v1;
    if (!Number.isFinite(v1)) return v0;
    return v0 + (v1 - v0) * u;
  }

  function auditRadialClamp(name, polys, minField, maxField, minMargin, maxMargin) {
    if (!WARP_FORT.debug) return;
    if ((!minField && !maxField) || !Array.isArray(polys)) return;

    let belowMin = 0;
    let aboveMax = 0;
    let total = 0;

    for (const poly of polys) {
      if (!Array.isArray(poly)) continue;
      for (const p of poly) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

        const dx = p.x - cx;
        const dy = p.y - cy;
        const r = Math.hypot(dx, dy);
        if (r < 1e-6) continue;

        const theta = Math.atan2(dy, dx);

        const rMinRaw = minField ? sampleOnRing(minField.thetas, minField.rTarget, theta) : null;
        const rMaxRaw = maxField ? sampleOnRing(maxField.thetas, maxField.rTarget, theta) : null;

        const rMin = Number.isFinite(rMinRaw) ? (rMinRaw + (minMargin || 0)) : null;
        const rMax = Number.isFinite(rMaxRaw) ? (rMaxRaw - (maxMargin || 0)) : null;

        if (Number.isFinite(rMin) && r < rMin - 1e-6) belowMin += 1;
        if (Number.isFinite(rMax) && r > rMax + 1e-6) aboveMax += 1;

        total += 1;
      }
    }

    if (belowMin || aboveMax) {
      console.warn("[FortWarp Audit]", name, { belowMin, aboveMax, total });
    } else {
      console.info("[FortWarp Audit]", name, "OK", { total });
    }
  }

  // Apply outworks warp to bastion polygons (two-target system).
  // Invariant: outworks must remain inside fortOuterHull (clamped by warpOutworks).
  if (warpOutworks?.field && Array.isArray(bastionPolys)) {
    bastionPolysWarpedSafe = bastionPolys.map((poly) => {
      if (!Array.isArray(poly) || poly.length < 3) return poly;
      const warped = warpPolylineRadial(poly, { x: cx, y: cy }, warpOutworks.field, warpOutworks.params);

      // Clamp invariants for outworks:
      // - Outside inner hull (minField + margin)
      // - Inside outer hull (maxField - margin)
      const clamped = clampPolylineRadial(
        warped,
        { x: cx, y: cy },
        warpOutworks.minField,
        warpOutworks.maxField,
        warpOutworks.clampMinMargin,
        warpOutworks.clampMaxMargin
      );

      return clamped;

    });
  } else {
    bastionPolysWarpedSafe = bastionPolys;
  }

  // ---------------- Warp-dependent fort geometry (moatworks + rings) ----------------
  // Keep widths proportional to the *effective* (warped) wall radius.
  const fortR = (warpWall && warpWall.params && Number.isFinite(warpWall.params.bandOuter))
    ? warpWall.params.bandOuter
    : wallR;

  ctx.geom.wallR = fortR;
  ditchWidth = fortR * 0.035;
  glacisWidth = fortR * 0.08;
  ctx.params.minWallClear = ditchWidth * 1.25;

  // IMPORTANT: downstream logic should use a warped version of the base wall for offsets.
  const wallBaseForDraw = (warpWall && warpWall.field)
    ? warpPolylineRadial(wallBase, { x: cx, y: cy }, warpWall.field, warpWall.params)
    : wallBase;

  ctx.geom.wallBase = wallBaseForDraw;

  // Recompute moatworks from the warped base so they match the warped wall.
  ditchOuter = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth);
  ditchInner = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth * 0.35);
  glacisOuter = offsetRadial(wallBaseForDraw, cx, cy, ditchWidth + glacisWidth);

  // Recompute inner rings from the warped base so roads/rings track the warped fort.
  ring = offsetRadial(wallBaseForDraw, cx, cy, -fortR * 0.06);
  ring2 = offsetRadial(wallBaseForDraw, cx, cy, -fortR * 0.13);

  const gatesWarped = wallWarped ? snapGatesToWall(gates, cx, cy, wallWarped) : gates;

  const primaryGateWarped = (primaryGate && wallWarped)
    ? snapGatesToWall([primaryGate], cx, cy, wallWarped)[0]
    : primaryGate;

  anchors.gates = gatesWarped;
  anchors.primaryGate = primaryGateWarped;

  // ---------------- Docks ----------------
  anchors.docks = buildDocks({
    hasDock,
    anchors,
    newTown,
    outerBoundary,
    wallBase: wallBaseForDraw,
    centre,
    waterModel,
    width,
    height,

    add,
    mul,
    normalize,
    clampPointToCanvas,
    pointInPolyOrOn,
    pushOutsidePoly,
    supportPoint,
    snapPointToPolyline,
  });

    // ---------------- Primary roads (routed on Voronoi planar graph) ----------------
  // Routing mesh is the Voronoi planar graph built from ward polygons.
  //
  // Determinism / coupling:
  // - snapPointToGraph with splitEdges=true mutates vorGraph (splits edges).
  // - To keep determinism, snap all endpoints in a fixed order before routing.
  const roadWeight = makeRoadWeightFn({
    graph: vorGraph,
    waterModel,
    anchors,
    params: ctx.params,
  });

  // Snap endpoints in a stable order (mutates graph if splitEdges=true).
  const snapCfg = { graph: vorGraph, maxSnapDist: 40, splitEdges: true };

  const gateForRoad = primaryGateWarped || (Array.isArray(gatesWarped) ? gatesWarped[0] : null);

  const nGate = gateForRoad ? snapPointToGraph({ point: gateForRoad, ...snapCfg }) : null;
  const nPlaza = anchors.plaza ? snapPointToGraph({ point: anchors.plaza, ...snapCfg }) : null;
  const nCitadel = anchors.citadel ? snapPointToGraph({ point: anchors.citadel, ...snapCfg }) : null;
  const nDocks = anchors.docks ? snapPointToGraph({ point: anchors.docks, ...snapCfg }) : null;

  function routeNodesOrFallback(nA, nB, pA, pB) {
    if (nA == null || nB == null) return [pA, pB];
    const nodePath = dijkstra({
      graph: vorGraph,
      startNode: nA,
      goalNode: nB,
      weightFn: roadWeight,
      blockedEdgeIds: roadWeight.blockedEdgeIds || null,
    });
    if (!Array.isArray(nodePath) || nodePath.length < 2) return [pA, pB];
    const poly = pathNodesToPolyline({ graph: vorGraph, nodePath });
    return (Array.isArray(poly) && poly.length >= 2) ? poly : [pA, pB];
  }

  const primaryRoads = [];

  // Gate → Plaza (only one, using primary gate if available)
  if (gateForRoad && anchors.plaza) {
    primaryRoads.push(routeNodesOrFallback(nGate, nPlaza, gateForRoad, anchors.plaza));
  }

  // Plaza → Citadel
  if (anchors.plaza && anchors.citadel) {
    primaryRoads.push(routeNodesOrFallback(nPlaza, nCitadel, anchors.plaza, anchors.citadel));
  }

  // Plaza → Docks (only if docks exists)
  if (anchors.plaza && anchors.docks) {
    primaryRoads.push(routeNodesOrFallback(nPlaza, nDocks, anchors.plaza, anchors.docks));
  }

  // ---------------- Outworks ----------------
  // Bastion polys may include nulls (flattened to avoid New Town intersections).
  // Invariant: length aligns with bastions, but consumers must handle nulls.

  const wallForOutworks = wallForDraw;
  let ravelins = (gatesWarped || [])
    .filter((g) => !(primaryGateWarped && g.idx === primaryGateWarped.idx))
    .map((g) =>
      makeRavelin(
        g,
        cx,
        cy,
        fortR,
        ditchWidth,
        glacisWidth,
        newTown ? newTown.poly : null,
        bastionCount,
        bastionPolysWarpedSafe,
        wallForOutworks
      )
    )
    .filter(Boolean);

    // Milestone 4.5: clamp ravelins with the same two-target constraints as outworks.
    if (warpOutworks?.minField || warpOutworks?.maxField) {
      ravelins = ravelins.map((rv) =>
        clampPolylineRadial(
          rv,
          { x: cx, y: cy },
          warpOutworks.minField,
          warpOutworks.maxField,
          warpOutworks.clampMinMargin,
          warpOutworks.clampMaxMargin
        )
      );
    }

    if (WARP_FORT.debug) {
    auditRadialClamp(
      "WALL",
      [wallForDraw],
      warpWall?.minField,
      warpWall?.maxField,
      warpWall?.clampMinMargin,
      warpWall?.clampMaxMargin
    );

    auditRadialClamp(
      "BASTIONS",
      bastionPolysWarpedSafe,
      warpOutworks?.minField,
      warpOutworks?.maxField,
      warpOutworks?.clampMinMargin,
      warpOutworks?.clampMaxMargin
    );

    auditRadialClamp(
      "RAVELINS",
      ravelins,
      warpOutworks?.minField,
      warpOutworks?.maxField,
      warpOutworks?.clampMinMargin,
      warpOutworks?.clampMaxMargin
    );
  }

  let marketCentre = computeInitialMarketCentre({
    squareCentre: anchors.plaza,
    primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase: wallBaseForDraw,
  });

  marketCentre = safeMarketNudge({
    squareCentre: anchors.plaza,
    marketCentre,
    centre,
    primaryGate: primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase: wallBaseForDraw,
  });

  // ---------------- Market anchor (always-on, always valid) ----------------
  anchors.market = finitePointOrNull(marketCentre);

  // Prefer an inner ward as a fallback source for market location.
  const innerWards = (wardsWithRoles || []).filter((w) => w && w.role === "inner");
  let marketFallback = null;

  for (const w of innerWards) {
    const c = wardCentroid(w);
    if (finitePointOrNull(c)) {
      marketFallback = c;
      break;
    }
  }

  if (!anchors.market) {
    // Last resort: near plaza, but slightly offset.
    anchors.market = add(anchors.plaza, { x: baseR * 0.03, y: -baseR * 0.02 });
  }

  // Ensure it is inside the wall, not near the wall, and on-canvas.
  anchors.market = ensureInside(wallBase, anchors.market, centre, 1.0);
  anchors.market = pushAwayFromWall(wallBase, anchors.market, ctx.params.minWallClear, centre);

  // If you want market to live in an inner ward region, enforce that intent here.
  if (marketFallback) {
    // If market drifts too far out (or ends up in a non-inner ward), pull toward an inner ward centroid.
    // This is a soft pull that keeps determinism and avoids hard snapping.
    const mv = vec(anchors.market, marketFallback);
    if (len(mv) > baseR * 0.18) {
      anchors.market = add(anchors.market, mul(safeNormalize(mv), baseR * 0.08));
      anchors.market = ensureInside(wallBase, anchors.market, centre, 1.0);
      anchors.market = pushAwayFromWall(wallBase, anchors.market, ctx.params.minWallClear, centre);
    }
  }

  anchors.market = clampPointToCanvas(anchors.market, width, height, 10);

  // Re-ensure inside after clamping.
  anchors.market = ensureInside(wallBase, anchors.market, centre, 1.0);
  anchors.market = pushAwayFromWall(wallBase, anchors.market, ctx.params.minWallClear, centre);

  // Keep legacy field aligned with the final anchor.
  marketCentre = anchors.market;

  const landmarks = [
    { id: "square", pointOrPolygon: anchors.plaza, kind: "main_square", label: "Main Square" },
    { id: "market", pointOrPolygon: anchors.market, kind: "market", label: "Market" },
    { id: "citadel", pointOrPolygon: citadel, kind: "citadel", label: "Citadel" },
  ];

  // Legacy fields retained, but now sourced from routed primaries.
  const roads = primaryRoads;
  const avenue = (Array.isArray(primaryRoads) && primaryRoads.length >= 2)
    ? primaryRoads[1]
    : [anchors.plaza, anchors.citadel];


  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;
  const squareCentre = anchors.plaza;
  const citCentre = anchors.citadel;

  const builtRoads = buildRoadPolylines({
    rng,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
  });

  let polylines = builtRoads.polylines;
  const secondaryRoadsLegacy = builtRoads.secondaryRoads;

  // Prepend routed primaries so the road graph and block extraction reflect them.
  if (Array.isArray(primaryRoads) && primaryRoads.length) {
    polylines = [...primaryRoads, ...polylines];
  }

  const roadGraph = buildRoadGraphWithIntersections(polylines, ROAD_EPS);


  // ---------------- Milestone 3.6: blocks (debug) ----------------
  const BLOCKS_ANGLE_EPS = 1e-9;
  const BLOCKS_AREA_EPS = 8.0;
  const BLOCKS_MAX_FACE_STEPS = 10000;

  const blocks = extractBlocksFromRoadGraph(roadGraph, {
    ANGLE_EPS: BLOCKS_ANGLE_EPS,
    AREA_EPS: BLOCKS_AREA_EPS,
    MAX_FACE_STEPS: BLOCKS_MAX_FACE_STEPS,
  });

  // Change 3: Assign blocks by ward containment, then map ward role -> district id.
  assignBlocksToDistrictsByWards({
    blocks,
    wards: wardsWithRoles,
    districts,
  });

  // ---------------- Anchor invariants (debug only) ----------------
  if (WARP_FORT.debug) {
    const bad = [];

    console.info("[Routing] vorGraph", {
      nodes: vorGraph?.nodes?.length,
      edges: vorGraph?.edges?.length,
      primaryRoads: primaryRoads?.length,
    });

        if (vorGraph && Array.isArray(vorGraph.edges)) {
      let waterEdges = 0;
      let citadelEdges = 0;
      let activeEdges = 0;

      for (const e of vorGraph.edges) {
        if (!e || e.disabled) continue;
        activeEdges += 1;
        if (e.flags && e.flags.isWater) waterEdges += 1;
        if (e.flags && e.flags.nearCitadel) citadelEdges += 1;
      }

      console.info("[Routing] edge flags", { activeEdges, waterEdges, citadelEdges });
    }

    const plazaOk =
      finitePointOrNull(anchors.plaza) &&
      isInsidePolyOrSkip(anchors.plaza, wallBase) &&
      (anchors.plaza.x >= 0 && anchors.plaza.x <= width && anchors.plaza.y >= 0 && anchors.plaza.y <= height);

    const citadelOk =
      finitePointOrNull(anchors.citadel) &&
      isInsidePolyOrSkip(anchors.citadel, wallBase) &&
      (anchors.citadel.x >= 0 && anchors.citadel.x <= width && anchors.citadel.y >= 0 && anchors.citadel.y <= height);

    const marketOk =
      finitePointOrNull(anchors.market) &&
      isInsidePolyOrSkip(anchors.market, wallBase) &&
      (anchors.market.x >= 0 && anchors.market.x <= width && anchors.market.y >= 0 && anchors.market.y <= height);

    let docksOk = true;
    if (hasDock) {
      docksOk =
        (anchors.docks === null) ||
        (finitePointOrNull(anchors.docks) &&
          !pointInPolyOrOn(anchors.docks, wallBase, 1e-6) &&
          isInsidePolyOrSkip(anchors.docks, outerBoundary) &&
          (anchors.docks.x >= 0 && anchors.docks.x <= width && anchors.docks.y >= 0 && anchors.docks.y <= height));
    }

    if (!plazaOk) bad.push("plaza");
    if (!citadelOk) bad.push("citadel");
    if (!marketOk) bad.push("market");
    if (!docksOk) bad.push("docks");

    if (bad.length) {
      console.warn("ANCHOR INVARIANTS FAILED", bad, {
        plaza: anchors.plaza,
        citadel: anchors.citadel,
        market: anchors.market,
        docks: anchors.docks,
        hasDock,
        water: waterModel?.kind,
      });
    }
  }

  return {
    footprint,
    cx,
    cy,

    // Walls + moatworks
    wallBase,
    wall: wallForDraw,
    bastionPolys: bastionPolysWarpedSafe,
    gates: gatesWarped,
    ravelins,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ditchWidth,
    glacisWidth,

    districts,
    blocks,
    warp: {
      wall: warpWall ?? null,
      outworks: warpOutworks ?? null,
    },
    fortHulls,

    wards: wardsWithRoles,
    wardSeeds,
    wardRoleIndices,
        mesh: {
      vorGraph,
    },


    // Anchors
    centre,
    squareR: baseR * 0.055,
    citadel,
    avenue,
    primaryGate: primaryGateWarped,

    site: { water: waterKind, hasDock },
    water: waterModel,

    // Roads
    roads,                 // routed primaries
    primaryRoads,          // explicit alias (useful for later stages)
    ring,
    ring2,
    secondaryRoads: secondaryRoadsLegacy,
    roadGraph,

    // New Town
    newTown,

    // District-ish boundary
    outerBoundary,

    // Markers
    gatesOriginal: gates,
    landmarks,
    anchors,
  };
}
