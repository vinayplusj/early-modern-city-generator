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

import { polar, add, mul, normalize, perp } from "../geom/primitives.js";
import { centroid, pointInPoly, pointInPolyOrOn } from "../geom/poly.js";
import { offsetRadial } from "../geom/offset.js";
import { convexHull } from "../geom/hull.js";
import { polyIntersectsPoly, polyIntersectsPolyBuffered } from "../geom/intersections.js";

import { buildRoadGraphWithIntersections } from "../roads/graph.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
  generateRoadsToCentre,
  generateSecondaryRoads,
  generateNewTownGrid,
  makeRavelin,
  minDistPointToPoly,
  routeGateToSquareViaRing,
} from "./features.js";

import { closestPointOnPolyline } from "../geom/nearest.js";

// Milestone 3.6: blocks extraction (faces) - debug use
import { extractBlocksFromRoadGraph } from "../roads/blocks.js";
import { buildRadialDistricts, assignBlocksToDistricts } from "./districts.js";


function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function safeMarketNudge({
  squareCentre,
  marketCentre,
  centre,
  primaryGate,
  cx,
  cy,
  baseR,
  footprint,
  wallBase,
}) {
  if (!squareCentre || !marketCentre) return marketCentre;

  // Minimum separation distance
  const minSep = baseR * 0.04;
  const minSep2 = minSep * minSep;

  if (dist2(squareCentre, marketCentre) >= minSep2) return marketCentre;

  const inside = (p) =>
    (!footprint || footprint.length < 3 || pointInPoly(p, footprint)) &&
    (!wallBase || wallBase.length < 3 || pointInPoly(p, wallBase));

  // Preferred direction: perpendicular to gate->centre axis
  let out = null;
  if (primaryGate) {
    out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
  } else if (centre) {
    out = normalize({ x: squareCentre.x - centre.x, y: squareCentre.y - centre.y });
  } else {
    out = { x: 1, y: 0 };
  }

  const side = normalize(perp(out));
  const step = minSep;

  const c1 = add(squareCentre, mul(side, step));
  if (inside(c1)) return c1;

  const c2 = add(squareCentre, mul(side, -step));
  if (inside(c2)) return c2;

  // Fallback: try a few angles around the square
  const tries = 10;
  for (let i = 0; i < tries; i++) {
    const ang = (i / tries) * Math.PI * 2;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const c = add(squareCentre, mul(dir, step));
    if (inside(c)) return c;
  }

  return marketCentre;
}

export function generate(seed, bastionCount, gateCount, width, height) {
  // ---- Debug (safe to keep; remove later if desired) ----
  console.count("generate() calls");
  const runId = `${seed}-${Date.now()}`;
  console.log("RUN START", runId);

  const rng = mulberry32(seed);

  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

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

  const gates = pickGates(rng, wallBase, gateCount, bastionCount);

  // Start with the full bastioned wall.
  let wallFinal = wall;

  // Keep bastion polys stable, but we will re-set them if we flatten.
  let bastionPolys = bastions.map((b) => b.pts);

  // ---------------- New Town placement ----------------
  function placeNewTown() {
    const startOffset0 = (ditchWidth + glacisWidth) * 1.6;

    // Wider search improves success rate without breaking determinism.
    const scales = [1.0, 0.92, 0.84, 0.76, 0.70, 0.64];
    const offsetMul = [1.0, 1.12, 1.25, 1.40, 1.55, 1.70];

    // Bastion buffer (explicit). 0.0 means strict geometry only.
    const bastionBuffer = 0.0;

    const stats = {
      tried: 0,
      badPoly: 0,
      centroidInsideDitch: 0,
      crossesDitch: 0,
      hitsWallBase: 0,
      ok: 0,
    };

    for (const g of gates) {
      for (const om of offsetMul) {
        for (const s of scales) {
          stats.tried++;

          const nt = generateNewTownGrid(g, cx, cy, wallR, baseR, startOffset0 * om, s);
          if (!nt || !nt.poly || nt.poly.length < 3) {
            stats.badPoly++;
            continue;
          }

          // Robust ditch test: centroid outside + no crossing
          const ntC = centroid(nt.poly);
          if (pointInPoly(ntC, ditchOuter)) {
            stats.centroidInsideDitch++;
            continue;
          }
          if (polyIntersectsPoly(nt.poly, ditchOuter)) {
            stats.crossesDitch++;
            continue;
          }

          // Avoid intersecting wall base edges.
          if (polyIntersectsPoly(nt.poly, wallBase)) {
            stats.hitsWallBase++;
            continue;
          }

          // Collect intersecting bastions (do not reject New Town).
          const hitBastions = [];
          for (let i = 0; i < bastions.length; i++) {
            const b = bastions[i];
            if (!b || !b.pts || b.pts.length < 3) continue;
            if (polyIntersectsPolyBuffered(b.pts, nt.poly, bastionBuffer)) {
              hitBastions.push(i);
            }
          }

          stats.ok++;
          return { newTown: nt, primaryGate: g, hitBastions, stats };
        }
      }
    }

    return { newTown: null, primaryGate: gates[0] || null, hitBastions: [], stats };
  }

  const placed = placeNewTown();
  let newTown = placed.newTown;
  const primaryGate = placed.primaryGate;

  console.log("NewTown placement stats", placed.stats);

  // Targeted bastion removal: if New Town intersects bastion(s),
  // flatten ONLY those specific bastions.
  if (
    newTown &&
    newTown.poly &&
    newTown.poly.length >= 3 &&
    placed.hitBastions &&
    placed.hitBastions.length > 0
  ) {
    const hitSet = new Set(placed.hitBastions);

    const bastionsFinal = bastions.map((b, i) => {
      if (!b || !b.pts || b.pts.length < 3) return b;
      if (hitSet.has(i)) return { ...b, pts: b.shoulders };
      return b;
    });

    wallFinal = bastionsFinal.flatMap((b) => b.pts);
    bastionPolys = bastionsFinal.map((b) => b.pts);
  }

  // ---------------- Outworks ----------------
  const ravelins = gates
    .map((g) =>
      makeRavelin(
        g,
        cx,
        cy,
        wallR,
        ditchWidth,
        glacisWidth,
        newTown ? newTown.poly : null,
        bastionCount
      )
    )
    .filter(Boolean);

  const outerBoundary = convexHull([
    ...footprint,
    ...((newTown && newTown.poly && newTown.poly.length >= 3) ? newTown.poly : []),
  ]);

  // ---------------- Inner rings ----------------
  const ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  const ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);

  // ---------------- Citadel ----------------
  const citSize = baseR * 0.1;
  let citCentre = null;
  let citadel = null;

  for (let tries = 0; tries < 40; tries++) {
    const citAng = rng() * Math.PI * 2;
    const candidate = polar(cx, cy, citAng, wallR * 0.72);

    const gap = minDistPointToPoly(candidate, wallFinal);
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

  let marketCentre = (() => {
    if (!primaryGate) {
      const c0 = add(squareCentre, { x: baseR * 0.07, y: 0 });
      return (pointInPoly(c0, footprint) && pointInPoly(c0, wallBase)) ? c0 : squareCentre;
    }

    const out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
    const side = normalize(perp(out));

    const c1 = add(squareCentre, mul(side, baseR * 0.07));
    if (pointInPoly(c1, footprint) && pointInPoly(c1, wallBase)) return c1;

    const c2 = add(squareCentre, mul(side, -baseR * 0.07));
    if (pointInPoly(c2, footprint) && pointInPoly(c2, wallBase)) return c2;

    return squareCentre;
  })();

  // Nudge if too close to the square
  marketCentre = safeMarketNudge({
    squareCentre,
    marketCentre,
    centre,
    primaryGate,
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

  // Primary roads kept for compatibility
  const roads = generateRoadsToCentre(gates, squareCentre);

  const avenue = [squareCentre, citCentre];

  // Secondary roads
  const secondaryRoads = generateSecondaryRoads(rng, gates, ring, ring2);

  // ---------------- Road polylines -> road graph ----------------
  const ROAD_EPS = 2.0;
  const polylines = [];
  console.log("RUN POLYLINES INIT", runId, polylines.length);

  // Gate -> ring -> square (primary), to avoid cutting through bastions
  for (const g of gates) {
    const path = routeGateToSquareViaRing(g, ring, squareCentre);
    if (!path || path.length < 2) continue;

    if (path.length === 2) {
      polylines.push({
        points: [path[0], path[1]],
        kind: "primary",
        width: 2.5,
        nodeKindA: "gate",
        nodeKindB: "square",
      });
      continue;
    }

    // 3+ points: split at ring snap
    polylines.push({
      points: [path[0], path[1]],
      kind: "primary",
      width: 2.2,
      nodeKindA: "gate",
      nodeKindB: "junction",
    });

    polylines.push({
      points: [path[1], path[2]],
      kind: "primary",
      width: 2.5,
      nodeKindA: "junction",
      nodeKindB: "square",
    });
  }

  // Square -> citadel (primary)
  polylines.push({
    points: [squareCentre, citCentre],
    kind: "primary",
    width: 3.0,
    nodeKindA: "square",
    nodeKindB: "citadel",
  });

  // Secondary roads
  for (const r of secondaryRoads || []) {
    if (!r || r.length < 2) continue;
    polylines.push({ points: r, kind: "secondary", width: 1.25 });
  }

  // New Town streets
  if (newTown && newTown.streets) {
    for (const seg of newTown.streets) {
      if (!seg || seg.length < 2) continue;
      polylines.push({ points: seg, kind: "secondary", width: 1.0 });
    }

    // New Town main avenue: route into the city via the ring, then to the square
    if (newTown.mainAve && ring) {
      const entry = closestPointOnPolyline(newTown.mainAve[0], ring);

      polylines.push({
        points: [newTown.mainAve[0], entry],
        kind: "primary",
        width: 2.0,
        nodeKindA: "junction",
        nodeKindB: "junction",
      });

      polylines.push({
        points: [entry, squareCentre],
        kind: "primary",
        width: 2.2,
        nodeKindA: "junction",
        nodeKindB: "square",
      });
    } else if (newTown.mainAve) {
      polylines.push({ points: newTown.mainAve, kind: "primary", width: 2.0 });
    }
  }

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

  const DISTRICT_COUNT = 8;
  const DISTRICT_JITTER = 0.12;
  const DISTRICT_MIN_SPAN = 0.35;
  
  const districts = buildRadialDistricts(rng, outerBoundary, cx, cy, {
    COUNT: DISTRICT_COUNT,
    JITTER: DISTRICT_JITTER,
    MIN_SPAN: DISTRICT_MIN_SPAN,
  });
  
  assignBlocksToDistricts(blocks, districts, cx, cy)

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
    wall: wallFinal,
    bastionPolys,
    gates,
    ravelins,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ditchWidth,
    glacisWidth,
    districts,
    blocks,
    // Anchors
    centre,
    squareR: baseR * 0.055,
    squareCentre,
    marketCentre,
    citCentre,
    citadel,
    avenue,
    primaryGate,

    // Roads
    roads, // legacy
    ring,
    ring2,
    secondaryRoads, // legacy
    roadGraph,

    // New Town
    newTown,

    // District-ish boundary
    outerBoundary,

    // Milestone 3.6 debug
    blocks,

    // Markers
    landmarks,
  };
}
