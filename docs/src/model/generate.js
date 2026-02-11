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

import { add, mul, normalize } from "../geom/primitives.js";
import { centroid, pointInPoly, pointInPolyOrOn } from "../geom/poly.js";

import { offsetRadial } from "../geom/offset.js";
import { convexHull } from "../geom/hull.js";

import { buildRoadGraphWithIntersections } from "../roads/graph.js";

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
import { assignWardRoles } from "./wards/ward_roles.js";

import {
  ensureInside,
  pushAwayFromWall,
  enforceMinSeparation,
} from "./anchors/anchor_constraints.js";

import { buildWaterModel } from "./water.js";

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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampPointToCanvas(p, w, h, pad = 8) {
  if (!p) return p;
  return {
    x: clamp(p.x, pad, w - pad),
    y: clamp(p.y, pad, h - pad),
  };
}
        
function isPoint(p) {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  }
  
function wardCentroid(w) {
    if (!w) return null;
  
    if (isPoint(w.centroid)) return w.centroid;
  
    const poly =
      (Array.isArray(w.polygon) && w.polygon.length >= 3) ? w.polygon :
      (Array.isArray(w.poly) && w.poly.length >= 3) ? w.poly :
      null;
  
    if (poly) {
      const c = centroid(poly);
      if (isPoint(c)) return c;
    }
  
    if (isPoint(w.site)) return w.site;
    if (isPoint(w.seed)) return w.seed;
    if (isPoint(w.point)) return w.point;
    if (isPoint(w.center)) return w.center;
    if (isPoint(w.centre)) return w.centre;
  
    return null;
  }

export function generate(seed, bastionCount, gateCount, width, height, site = {}) {
  const waterKind = (site && typeof site.water === "string") ? site.water : "none";
  const hasDock = Boolean(site && site.hasDock) && waterKind !== "none";

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

  const ditchOuter = offsetRadial(wallBase, cx, cy, ditchWidth);
  const ditchInner = offsetRadial(wallBase, cx, cy, ditchWidth * 0.35);
  const glacisOuter = offsetRadial(wallBase, cx, cy, ditchWidth + glacisWidth);

  const centre = centroid(footprint);

  const anchors = {
    centre,        // {x,y}
    plaza: null,   // {x,y}
    citadel: null, // {x,y}
    market: null,  // {x,y}
    docks: null,   // {x,y} or null
    gates: null,   // array of gate points
    primaryGate: null, // single gate point
  };

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

  const hitBastionSet = new Set(placed.hitBastions || []);
  const bastionsForWarp = (bastions || []).filter((_, i) => !hitBastionSet.has(i));

  // ---------------- Overall boundary ----------------
  const outerBoundary = convexHull([
    ...footprint,
    ...((newTown && newTown.poly && newTown.poly.length >= 3) ? newTown.poly : []),
  ]);

    // ---------------- Water (river/coast) ----------------
  const waterModel = (waterKind === "none")
  ? { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null }
  : buildWaterModel({
      rng,
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
    rng,
    centre: { x: cx, y: cy },
    footprintPoly: outerBoundary,
    params: WARDS_PARAMS,
  });

  const { wards: wardsWithRoles, indices: wardRoleIndices } = assignWardRoles({
    wards,
    centre: { x: cx, y: cy },
    params: { innerCount: 8 },
  });

  const plazaWard = wardsWithRoles.find((w) => w.role === "plaza");
  const citadelWard = wardsWithRoles.find((w) => w.role === "citadel");
  

  
  if (!plazaWard) throw new Error("No plaza ward found");
  if (!citadelWard) throw new Error("No citadel ward found");
  
  // Deterministic fallbacks if a ward has no usable polygon.
  const plazaC = wardCentroid(plazaWard) || { x: cx, y: cy };
  const citadelC = wardCentroid(citadelWard) || { x: cx - baseR * 0.12, y: cy + baseR * 0.02 };
  
  anchors.plaza = plazaC;
  anchors.citadel = citadelC;


  // ---------------- Anchor constraints ----------------
  const anchorCentreHint = centre;

  anchors.plaza = ensureInside(wallBase, anchors.plaza, anchorCentreHint, 1.0);
  anchors.citadel = ensureInside(wallBase, anchors.citadel, anchorCentreHint, 1.0);

  const MIN_WALL_CLEAR = ditchWidth * 1.25;
  anchors.plaza = pushAwayFromWall(wallBase, anchors.plaza, MIN_WALL_CLEAR, anchorCentreHint);
  anchors.citadel = pushAwayFromWall(wallBase, anchors.citadel, MIN_WALL_CLEAR, anchorCentreHint);

  const MIN_ANCHOR_SEP = baseR * 0.12;
  {
    const sep = enforceMinSeparation(anchors.plaza, anchors.citadel, MIN_ANCHOR_SEP);
    anchors.plaza = ensureInside(wallBase, sep.a, anchorCentreHint, 1.0);
    anchors.citadel = ensureInside(wallBase, sep.b, anchorCentreHint, 1.0);

    anchors.plaza = pushAwayFromWall(wallBase, anchors.plaza, MIN_WALL_CLEAR, anchorCentreHint);
    anchors.citadel = pushAwayFromWall(wallBase, anchors.citadel, MIN_WALL_CLEAR, anchorCentreHint);
  }

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
  const citCentre = anchors.citadel;
  const citadel = generateBastionedWall(rng, citCentre.x, citCentre.y, citSize, 5).wall;

  const squareCentre = anchors.plaza;

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

  if (WARP_FORT.debug) console.log("DISTRICT KINDS POST-ROLES", districts.map(d => d.kind));

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
    // Deterministic docks point, created only when the UI enables it.
    // Invariant: anchors.docks is null unless hasDock is true.
    anchors.docks = null;
    
    function pickPointOnShoreline(shoreline, dir, width, height, pad = 10) {
      if (!Array.isArray(shoreline) || shoreline.length < 2) return null;
    
      function inCanvas(p) {
        return p && p.x >= pad && p.x <= (width - pad) && p.y >= pad && p.y <= (height - pad);
      }
    
      // Prefer shoreline points that are already visible.
      const candidates = shoreline.filter(inCanvas);
      const pts = (candidates.length >= 2) ? candidates : shoreline;
    
      let best = null;
      let bestDot = -Infinity;
    
      for (const p of pts) {
        const d = p.x * dir.x + p.y * dir.y;
        if (d > bestDot) {
          bestDot = d;
          best = p;
        }
      }
    
      return best;
    }
    
    if (
      hasDock &&
      anchors.primaryGate &&
      waterModel &&
      waterModel.kind !== "none" &&
      Array.isArray(waterModel.shoreline) &&
      waterModel.shoreline.length >= 2
    ) {
      // Stable direction: centre -> primary gate
      const raw = {
        x: anchors.primaryGate.x - centre.x,
        y: anchors.primaryGate.y - centre.y,
      };
    
      const dir = (Math.hypot(raw.x, raw.y) > 1e-6) ? normalize(raw) : { x: 1, y: 0 };
    
      // Pick a point on shoreline in that direction (shore-first).
      const shorePick = pickPointOnShoreline(waterModel.shoreline, dir, width, height, 10);
    
      if (shorePick) {
        // Nudge slightly toward the city centre so the marker does not sit exactly on the water line.
        const iv = { x: centre.x - shorePick.x, y: centre.y - shorePick.y };
        const inward = (Math.hypot(iv.x, iv.y) > 1e-6) ? normalize(iv) : { x: 1, y: 0 };
    
        anchors.docks = add(shorePick, mul(inward, 6));
        
        // After your existing outerBoundary inward stepping:
        // 1) Step inward until inside (or on) the buildable boundary.
        if (anchors.docks && Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
          let p = anchors.docks;
        
          for (let i = 0; i < 40; i++) {
            if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
            p = add(p, mul(inward, 4));
          }
        
          anchors.docks = p;
        }
        
        // 2) Clamp to visible canvas.
        anchors.docks = clampPointToCanvas(anchors.docks, width, height, 10);
        
        // 3) Clamp may move it outside boundary again, so re-step.
        if (anchors.docks && Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
          let p = anchors.docks;
        
          for (let i = 0; i < 40; i++) {
            if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
            p = add(p, mul(inward, 4));
          }
        
          anchors.docks = p;
        }
        
        // 4) Final clamp to guarantee visibility.
        anchors.docks = clampPointToCanvas(anchors.docks, width, height, 10);

      }
    }

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

  anchors.market = marketCentre;

  const landmarks = [
    { id: "square", pointOrPolygon: squareCentre, kind: "main_square", label: "Main Square" },
    { id: "market", pointOrPolygon: marketCentre, kind: "market", label: "Market" },
    { id: "citadel", pointOrPolygon: citadel, kind: "citadel", label: "Citadel" },
  ];

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

    wards: wardsWithRoles,
    wardSeeds,
    wardRoleIndices,

    // Anchors
    centre,
    squareR: baseR * 0.055,
    squareCentre,
    marketCentre,
    citCentre,
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
