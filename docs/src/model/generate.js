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
  generateRoadsToCentre,
  makeRavelin,
 } from "./features.js";

// Milestone 3.6: blocks extraction (faces) - debug use
import { extractBlocksFromRoadGraph } from "../roads/blocks.js";
import {
  buildRadialDistricts,
  assignBlocksToDistricts,
  assignDistrictRoles,
} from "./districts.js";

import { snapGatesToWall } from "./generate_helpers/snap.js";
import { safeMarketNudge, computeInitialMarketCentre } from "./generate_helpers/market.js";
import { placeNewTown } from "./generate_helpers/new_town.js";

import { buildFortWarp } from "./generate_helpers/warp_stage.js";
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

function isInsidePolyOrSkip(p, poly) {
  if (!p) return false;
  if (!Array.isArray(poly) || poly.length < 3) return true; // pass-through
  return pointInPolyOrOn(p, poly, 1e-6);
}

export function generate(seed, bastionCount, gateCount, width, height, site = {}) {
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

  const ditchWidth = wallR * 0.035;
  const glacisWidth = wallR * 0.08;
  ctx.params.baseR = baseR;
  ctx.params.minWallClear = ditchWidth * 1.25;
  // Keep separation proportional, but bounded so it is always satisfiable.
  ctx.params.minAnchorSep = Math.max(ditchWidth * 3.0, Math.min(baseR * 0.14, wallR * 0.22));
  ctx.params.canvasPad = 10;

  ctx.geom.wallBase = wallBase;

  const ditchOuter = offsetRadial(wallBase, cx, cy, ditchWidth);
  const ditchInner = offsetRadial(wallBase, cx, cy, ditchWidth * 0.35);
  const glacisOuter = offsetRadial(wallBase, cx, cy, ditchWidth + glacisWidth);

  const centre = centroid(footprint);
  ctx.geom.centre = centre;
  ctx.geom.footprint = footprint;

  let anchors = null;

  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Start with the full bastioned wall.
  let wallFinal = wall;
  let bastionPolys = bastions.map((b) => b.pts);

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
    seedCount: 24,
    spiralScale: baseR * 0.14,
    jitterRadius: baseR * 0.03,
    jitterAngle: 0.25,
    bboxPadding: baseR * 1.2,
    clipToFootprint: true,
  };

  const { wardSeeds, wards } = buildWardsVoronoi({
    rng: ctx.rng.wards,
    centre: { x: cx, y: cy },
    footprintPoly: outerBoundary,
    params: WARDS_PARAMS,
  });

  ctx.wards.seeds = wardSeeds;

  const { wards: wardsWithRoles, indices: wardRoleIndices } = assignWardRoles({
    wards,
    centre: { x: cx, y: cy },
    params: { innerCount: 8 },
  });

  ctx.wards.cells = wardsWithRoles;
  ctx.wards.roleIndices = wardRoleIndices;

  anchors = buildAnchors(ctx);

  // ---------------- Inner rings ----------------
  const ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  const ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);

  // ---------------- Districts ----------------
  const DISTRICT_COUNT = 8;
  const DISTRICT_JITTER = 0.12;
  const DISTRICT_MIN_SPAN = 0.35;

  const districts = buildRadialDistricts(rng, outerBoundary, cx, cy, {
    COUNT: DISTRICT_COUNT,
    JITTER: DISTRICT_JITTER,
    MIN_SPAN: DISTRICT_MIN_SPAN,
  });

  // ---------------- Citadel ----------------
  const citSize = baseR * 0.1;
  const citadel = generateBastionedWall(rng, anchors.citadel.x, anchors.citadel.y, citSize, 5).wall;

  assignDistrictRoles(
    districts,
    cx,
    cy,
    { squareCentre: anchors.plaza, citCentre: anchors.citadel, primaryGate },
    {
      INNER_COUNT: 3,
      NEW_TOWN_COUNT: 1,
      OUTER_WARD_COUNT: 2,
    }
  );

  if (primaryGate && !districts.some(d => d.kind === "new_town")) {
    tagNewTownDistrictByGate(districts, primaryGate, cx, cy);
  }

  function tagNewTownDistrictByGate(districts, gate, cx, cy) {
    if (!gate) return;

    const t = ((Math.atan2(gate.y - cy, gate.x - cx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    for (const d of districts) {
      const a0 = Number.isFinite(d.startAngle) ? d.startAngle : d._debug?.a0;
      const a1 = Number.isFinite(d.endAngle) ? d.endAngle : d._debug?.a1;
      if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;

      const inSector = (a0 <= a1) ? (t >= a0 && t < a1) : (t >= a0 || t < a1);
      if (!inSector) continue;

      if (d.kind === "plaza" || d.kind === "citadel") return;

      d.kind = "new_town";
      d.name = "New Town";

      return;
    }
  }

  // ---------------- Warp field ----------------
  const fortCentre = { x: cx, y: cy };
  const warp = buildFortWarp({
    enabled: WARP_FORT.enabled,
    centre: fortCentre,
    wallPoly: wallFinal,
    districts,
    bastions: bastionsForWarp,
    params: WARP_FORT,
  });

  const wallWarped = (warp && warp.wallWarped) ? warp.wallWarped : null;
  const wallForDraw = wallWarped || wallFinal;

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
  wallBase,
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
  // ---------------- Outworks ----------------

  // Bastion polys may include nulls (flattened to avoid New Town intersections).
  // Invariant: length aligns with bastions, but consumers must handle nulls.
  const bastionPolysSafe = Array.isArray(bastionPolys)
    ? bastionPolys.map((p) => (Array.isArray(p) && p.length >= 3 ? p : null))
    : [];
  
  const wallForOutworks = wallForDraw;
  const ravelins = (gatesWarped || [])
    .filter((g) => !(primaryGateWarped && g.idx === primaryGateWarped.idx))
    .map((g) =>
      makeRavelin(
        g,
        cx,
        cy,
        wallR,
        ditchWidth,
        glacisWidth,
        newTown ? newTown.poly : null,
        bastionCount,
        bastionPolysSafe,
        wallForOutworks
      )
    )
    .filter(Boolean);

  let marketCentre = computeInitialMarketCentre({
    squareCentre: anchors.plaza,
    primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase,
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
    wallBase,
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

  const roads = generateRoadsToCentre(gatesWarped, anchors.plaza);
  const avenue = [anchors.plaza, anchors.citadel];

  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;
  const squareCentre = anchors.plaza;
  const citCentre = anchors.citadel;
  
  const { polylines, secondaryRoads: secondaryRoadsLegacy } = buildRoadPolylines({
    rng,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
  });

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

  assignBlocksToDistricts(blocks, districts, cx, cy);

  // ---------------- Anchor invariants (debug only) ----------------
  if (WARP_FORT.debug) {
    const bad = [];
  
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
    bastionPolys: bastionPolysSafe,
    gates: gatesWarped,
    ravelins,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ditchWidth,
    glacisWidth,

    districts,
    blocks,
    warp,

    wards: wardsWithRoles,
    wardSeeds,
    wardRoleIndices,

    // Anchors
    centre,
    squareR: baseR * 0.055,
    citadel,
    avenue,
    primaryGate: primaryGateWarped,

    site: { water: waterKind, hasDock },
    water: waterModel,

    // Roads
    roads,
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
