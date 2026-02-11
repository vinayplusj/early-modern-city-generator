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
import { centroid, pointInPolyOrOn } from "../geom/poly.js";

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

function supportPoint(poly, dir) {
  if (!Array.isArray(poly) || poly.length < 1) return null;

  let best = poly[0];
  let bestDot = best.x * dir.x + best.y * dir.y;

  for (let i = 1; i < poly.length; i++) {
    const p = poly[i];
    const d = p.x * dir.x + p.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      best = p;
    }
  }
  return best;
}

function finitePointOrNull(p) {
  return (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? p : null;
}

function vec(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function len(v) {
  return Math.hypot(v.x, v.y);
}

function safeNormalize(v, fallback = { x: 1, y: 0 }) {
  const m = len(v);
  if (m > 1e-9) return { x: v.x / m, y: v.y / m };
  return fallback;
}

function isInsidePolyOrSkip(p, poly) {
  if (!p) return false;
  if (!Array.isArray(poly) || poly.length < 3) return true; // treat as pass-through
  return pointInPolyOrOn(p, poly, 1e-6);
}

function pushInsidePoly(p, poly, toward, step = 4, iters = 60) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return p;

  let q = p;
  const dir = safeNormalize(vec(q, toward));

  for (let i = 0; i < iters; i++) {
    if (pointInPolyOrOn(q, poly, 1e-6)) return q;
    q = add(q, mul(dir, step));
  }

  return q;
}

function pushOutsidePoly(p, poly, awayFrom, step = 4, iters = 80) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return p;

  let q = p;
  const dir = safeNormalize(vec(awayFrom, q)); // move away from centre

  for (let i = 0; i < iters; i++) {
    if (!pointInPolyOrOn(q, poly, 1e-6)) return q;
    q = add(q, mul(dir, step));
  }

  return q;
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

  // Keep plaza/citadel tied to their ward regions (not just "inside wall").
  const plazaPoly =
    (plazaWard && Array.isArray(plazaWard.polygon) && plazaWard.polygon.length >= 3) ? plazaWard.polygon :
    (plazaWard && Array.isArray(plazaWard.poly) && plazaWard.poly.length >= 3) ? plazaWard.poly :
    null;
  
  const citadelPoly =
    (citadelWard && Array.isArray(citadelWard.polygon) && citadelWard.polygon.length >= 3) ? citadelWard.polygon :
    (citadelWard && Array.isArray(citadelWard.poly) && citadelWard.poly.length >= 3) ? citadelWard.poly :
    null;
  
  // If a candidate is outside its ward polygon, pull it toward that ward centroid.
  if (plazaPoly && !pointInPolyOrOn(anchors.plaza, plazaPoly, 1e-6)) {
    anchors.plaza = pushInsidePoly(anchors.plaza, plazaPoly, wardCentroid(plazaWard) || centre, 4, 60);
  }
  
  if (citadelPoly && !pointInPolyOrOn(anchors.citadel, citadelPoly, 1e-6)) {
    anchors.citadel = pushInsidePoly(anchors.citadel, citadelPoly, wardCentroid(citadelWard) || centre, 4, 60);
  }

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

  // Final canvas clamp for always-on anchors.
  anchors.plaza = clampPointToCanvas(anchors.plaza, width, height, 10);
  anchors.citadel = clampPointToCanvas(anchors.citadel, width, height, 10);
  
  // After clamping, re-ensure inside wall base so they are never outside.
  anchors.plaza = ensureInside(wallBase, anchors.plaza, anchorCentreHint, 1.0);
  anchors.citadel = ensureInside(wallBase, anchors.citadel, anchorCentreHint, 1.0);
  anchors.plaza = pushAwayFromWall(wallBase, anchors.plaza, MIN_WALL_CLEAR, anchorCentreHint);
  anchors.citadel = pushAwayFromWall(wallBase, anchors.citadel, MIN_WALL_CLEAR, anchorCentreHint);

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
    // Deterministic docks point, created only when the UI enables it.
    // Invariant: anchors.docks is null unless hasDock is true.
    anchors.docks = null;
    
    function snapPointToPolyline(p, line) {
      if (!p || !Array.isArray(line) || line.length < 2) return p;
    
      let best = line[0];
      let bestD2 = Infinity;
    
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        if (!a || !b) continue;
    
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const apx = p.x - a.x;
        const apy = p.y - a.y;
    
        const ab2 = abx * abx + aby * aby;
        let t = 0;
        if (ab2 > 1e-12) {
          t = (apx * abx + apy * aby) / ab2;
          t = Math.max(0, Math.min(1, t));
        }
    
        const cxp = a.x + abx * t;
        const cyp = a.y + aby * t;
    
        const dx = p.x - cxp;
        const dy = p.y - cyp;
        const d2 = dx * dx + dy * dy;
    
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { x: cxp, y: cyp };
        }
      }
    
      return best;
    }
    
    const dockPoly =
      (newTown?.poly && newTown.poly.length >= 3) ? newTown.poly :
      (outerBoundary && outerBoundary.length >= 3) ? outerBoundary :
      null;
    
    if (
      hasDock &&
      dockPoly &&
      anchors.primaryGate &&
      waterModel &&
      waterModel.kind !== "none" &&
      Array.isArray(waterModel.shoreline) &&
      waterModel.shoreline.length >= 2
    ) {
      const raw = { x: anchors.primaryGate.x - centre.x, y: anchors.primaryGate.y - centre.y };
      const dir = (Math.hypot(raw.x, raw.y) > 1e-6) ? normalize(raw) : { x: 1, y: 0 };
    
      const v = supportPoint(dockPoly, dir);
    
      if (v) {
        const snapped = snapPointToPolyline(v, waterModel.shoreline);
    
        const iv = { x: centre.x - snapped.x, y: centre.y - snapped.y };
        const inward = (Math.hypot(iv.x, iv.y) > 1e-6) ? normalize(iv) : { x: 1, y: 0 };
    
        let p = add(snapped, mul(inward, 6));
    
        const MAX_IN_STEPS = 80;
        const IN_STEP = 6;
    
        // 1) Walk inward until inside the overall buildable boundary.
        if (Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
          for (let i = 0; i < MAX_IN_STEPS; i++) {
            if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
            p = add(p, mul(inward, IN_STEP));
          }
        }
    
        // 2) Clamp to visible canvas (coast cases often go off-canvas).
        p = clampPointToCanvas(p, width, height, 10);
    
        // 3) Clamping can move it outside boundary again, so walk inward again.
        if (Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
          for (let i = 0; i < MAX_IN_STEPS; i++) {
            if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
            p = add(p, mul(inward, IN_STEP));
            p = clampPointToCanvas(p, width, height, 10);
          }
        }
    
        // 4) Final clamp so it always remains drawable.
        p = clampPointToCanvas(p, width, height, 10);
    
        anchors.docks = p;
        // Docks must be outside the bastioned fort (wallBase). If not, push outward; if still bad, drop it.
        if (anchors.docks && Array.isArray(wallBase) && wallBase.length >= 3) {
          if (pointInPolyOrOn(anchors.docks, wallBase, 1e-6)) {
            // Push away from city centre until outside wallBase.
            anchors.docks = pushOutsidePoly(anchors.docks, wallBase, centre, 6, 120);
          }
        
          // If it still failed, do not force it. Dock is allowed to be null.
          if (anchors.docks && pointInPolyOrOn(anchors.docks, wallBase, 1e-6)) {
            anchors.docks = null;
          }
        }
        
        // Keep docks on-canvas if it exists.
        if (anchors.docks) {
          anchors.docks = clampPointToCanvas(anchors.docks, width, height, 10);
        }

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
  anchors.market = pushAwayFromWall(wallBase, anchors.market, MIN_WALL_CLEAR, centre);
  
  // If you want market to live in an inner ward region, enforce that intent here.
  if (marketFallback) {
    // If market drifts too far out (or ends up in a non-inner ward), pull toward an inner ward centroid.
    // This is a soft pull that keeps determinism and avoids hard snapping.
    const mv = vec(anchors.market, marketFallback);
    if (len(mv) > baseR * 0.18) {
      anchors.market = add(anchors.market, mul(safeNormalize(mv), baseR * 0.08));
      anchors.market = ensureInside(wallBase, anchors.market, centre, 1.0);
      anchors.market = pushAwayFromWall(wallBase, anchors.market, MIN_WALL_CLEAR, centre);
    }
  }
  
  anchors.market = clampPointToCanvas(anchors.market, width, height, 10);
  
  // Re-ensure inside after clamping.
  anchors.market = ensureInside(wallBase, anchors.market, centre, 1.0);
  anchors.market = pushAwayFromWall(wallBase, anchors.market, MIN_WALL_CLEAR, centre);

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
