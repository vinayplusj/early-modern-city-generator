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

import { polar, add, mul, normalize } from "../geom/primitives.js";
import { centroid, pointInPoly } from "../geom/poly.js";
import { offsetRadial } from "../geom/offset.js";
import { convexHull } from "../geom/hull.js";

import { buildRoadGraphWithIntersections } from "../roads/graph.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
  generateRoadsToCentre,
  makeRavelin,
  minDistPointToPoly,
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

export function generate(seed, bastionCount, gateCount, width, height) {
  // ---- Debug (safe to keep; remove later if desired) ----
  console.count("generate() calls");
  const runId = `${seed}-${Date.now()}`;
  console.log("RUN START", runId);

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

  if (WARP_FORT.debug) {
    console.log("BASTIONS COUNT", bastions?.length ?? 0);
  
    const b0 = bastions?.[0];
    console.log("BASTION[0] KEYS", b0 ? Object.keys(b0) : null);
  
    console.log("BASTION[0].shoulders", b0?.shoulders ?? null);
    console.log("BASTION[0].ptsLen", Array.isArray(b0?.pts) ? b0.pts.length : null);
  
    // Quick summary across all bastions
    let withShoulders = 0;
    let validShoulders = 0;
  
    for (const b of bastions || []) {
      if (b && "shoulders" in b) withShoulders++;
      if (Array.isArray(b?.shoulders) && b.shoulders.length >= 2) validShoulders++;
    }
  
    console.log("BASTION SHOULDERS SUMMARY", { withShoulders, validShoulders });
  }


  const ditchWidth = wallR * 0.035;
  const glacisWidth = wallR * 0.08;

  const ditchOuter = offsetRadial(wallBase, cx, cy, ditchWidth);
  const ditchInner = offsetRadial(wallBase, cx, cy, ditchWidth * 0.35);
  const glacisOuter = offsetRadial(wallBase, cx, cy, ditchWidth + glacisWidth);

  const centre = centroid(footprint);
  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Start with the full bastioned wall.
  let wallFinal = wall;
  let bastionPolys = bastions.map((b) => b.pts);

  // ---------------- New Town placement ----------------
  const placed = placeNewTown({
    rng,
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
  wallFinal = (placed.wallFinal && Array.isArray(placed.wallFinal)) ? placed.wallFinal : wallFinal;
  bastionPolys = (placed.bastionPolys && Array.isArray(placed.bastionPolys)) ? placed.bastionPolys : bastionPolys;

  console.log(
  "BASTION POLYS AFTER NEW TOWN",
  (bastionPolys || []).filter(p => Array.isArray(p) && p.length >= 3).length,
  "/",
  bastionPolys?.length ?? 0
);


  console.log("NewTown placement stats", placed.stats);

  // ---------------- Overall boundary ----------------
  const outerBoundary = convexHull([
    ...footprint,
    ...((newTown && newTown.poly && newTown.poly.length >= 3) ? newTown.poly : []),
  ]);

  // ---------------- Inner rings ----------------
  const ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  const ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);

  // ---------------- Districts (needed for warp + roles) ----------------
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
  let citCentre = null;
  let citadel = null;

  for (let tries = 0; tries < 40; tries++) {
    const citAng = rng() * Math.PI * 2;
    const candidate = polar(cx, cy, citAng, wallR * 0.72);

    const wallForGap = (wallFinal && Array.isArray(wallFinal) && wallFinal.length >= 3)
      ? wallFinal
      : wallBase;
    
    const gap = minDistPointToPoly(candidate, wallForGap);

    if (gap < citSize * 1.8) continue;

    citCentre = candidate;
    citadel = generateBastionedWall(rng, citCentre.x, citCentre.y, citSize, 5).wall;
    break;
  }

  if (!citCentre) {
    citCentre = polar(cx, cy, rng() * Math.PI * 2, wallR * 0.65);
    citadel = generateBastionedWall(rng, citCentre.x, citCentre.y, citSize, 5).wall;
  }

  // ---------------- Anchors (square + market) ----------------
  function placeSquare() {
    if (!primaryGate) return centre;

    const out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
    const candidate = add(centre, mul(out, baseR * 0.1));

    if (!pointInPoly(candidate, footprint)) return centre;
    if (!pointInPoly(candidate, wallBase)) return centre;

    return candidate;
  }

  const squareCentre = placeSquare();

  // Roles depend on square + citadel.
  assignDistrictRoles(
  districts,
  cx,
  cy,
  { squareCentre, citCentre, primaryGate },
  {
    INNER_COUNT: 3,
    NEW_TOWN_COUNT: 1,
    OUTER_WARD_COUNT: 2,
  }
);

// Optional safety net
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

    if (WARP_FORT.debug) console.log("DISTRICT KINDS POST-RETAG", districts.map(x => x.kind));
    return;
  }
}


  if (WARP_FORT.debug) console.log("DISTRICT KINDS POST-ROLES", districts.map(d => d.kind));

  // ---------------- Warp field ----------------
  const fortCentre = { x: cx, y: cy };
  const warp = buildFortWarp({
    enabled: WARP_FORT.enabled,
    centre: fortCentre,
    wallPoly: wallFinal,
    districts,
    bastions,          // NEW
    params: WARP_FORT,
  });

  const wallWarped = (warp && warp.wallWarped) ? warp.wallWarped : null;

  const wallForDraw = wallWarped || wallFinal;
  
  const gatesWarped = wallWarped ? snapGatesToWall(gates, cx, cy, wallWarped) : gates;
  
  const primaryGateWarped = (primaryGate && wallWarped)
    ? snapGatesToWall([primaryGate], cx, cy, wallWarped)[0]
    : primaryGate;

  // ---------------- Outworks ----------------
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
        bastionPolys,
        wallForOutworks
      )
    )
    .filter(Boolean);

  let marketCentre = computeInitialMarketCentre({
    squareCentre,
    primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase,
  });

  marketCentre = safeMarketNudge({
    squareCentre,
    marketCentre,
    centre,
    primaryGate: primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase,
  });

  const landmarks = [
    { id: "square", pointOrPolygon: squareCentre, kind: "main_square", label: "Main Square" },
    { id: "market", pointOrPolygon: marketCentre, kind: "market", label: "Market" },
    { id: "citadel", pointOrPolygon: citadel, kind: "citadel", label: "Citadel" },
  ];

  // Legacy primary roads kept for compatibility
  const roads = generateRoadsToCentre(gatesWarped, squareCentre);
  const avenue = [squareCentre, citCentre];

  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;
  const { polylines, secondaryRoads: secondaryRoadsLegacy } = buildRoadPolylines({
    rng,
    gatesWarped,
    ring,
    ring2,
    squareCentre,
    citCentre,
    newTown,
  });

  console.log("RUN POLYLINES FINAL", runId, polylines.length);

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

  console.log("BLOCK COUNTS", {
    blocks: blocks?.length || 0,
    firstArea: blocks?.[0]?._debug?.absArea || 0,
  });

  console.log("MODEL COUNTS", {
    seed,
    newTownStreets: newTown?.streets?.length || 0,
    roadNodes: roadGraph?.nodes?.length || 0,
    roadEdges: roadGraph?.edges?.length || 0,
  });

  return {
    footprint,
    cx,
    cy,

    // Walls + moatworks
    wallBase,
    wall: wallForDraw,
    bastionPolys,
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

    // Anchors
    centre,
    squareR: baseR * 0.055,
    squareCentre,
    marketCentre,
    citCentre,
    citadel,
    avenue,
    primaryGate: primaryGateWarped,

    // Roads
    roads, // legacy
    ring,
    ring2,
    secondaryRoads: secondaryRoadsLegacy, // legacy
    roadGraph,

    // New Town
    newTown,

    // District-ish boundary
    outerBoundary,

    // Markers
    gatesOriginal: gates,
    landmarks,
  };
}
