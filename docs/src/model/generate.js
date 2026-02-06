// src/model/generate.js
//
// City model generator (Milestone 3.4 entry point).
// This module is responsible for assembling the full "model" object consumed by rendering.
//
// Notes:
// - This is a direct ES-module translation of your current monolithic generate() function.
// - It depends on geometry + feature modules.
// - Milestone 3.4 (road intersection splitting) will be added in the road-graph builder; this file
//   already centralizes polylines so the splitter can be plugged in cleanly.

import { mulberry32 } from "../rng/mulberry32.js";

import { clamp, polar, add, mul, normalize, perp } from "../geom/primitives.js";
import { centroid, pointInPoly, pointInPolyOrOn } from "../geom/poly.js";
import { offsetRadial } from "../geom/offset.js";
import { convexHull } from "../geom/hull.js";
import {
  polyIntersectsPoly,
  polyIntersectsPolyBuffered
} from "../geom/intersections.js";

import { buildRoadGraph } from "../roads/graph.js";

import {
  generateFootprint,
  generateBastionedWall,
  pickGates,
  generateRoadsToCentre,
  generateSecondaryRoads,
  generateNewTownGrid,
  makeRavelin,
  minDistPointToPoly,
  routeGateToSquareViaRing
} from "./features.js";
import { closestPointOnPolyline } from "../geom/nearest.js";


/**
 * Generate a full city model.
 * @param {number} seed
 * @param {number} bastionCount
 * @param {number} gateCount
 * @param {number} width
 * @param {number} height
 * @returns {object} model
 */
export function generate(seed, bastionCount, gateCount, width, height) {
  const rng = mulberry32(seed);

  const cx = width * 0.5;
  const cy = height * 0.55;
  const baseR = Math.min(width, height) * 0.33;

  const footprint = generateFootprint(rng, cx, cy, baseR, 22);

  const wallR = baseR * 0.78;

  const { base: wallBase, wall, bastions } =
    generateBastionedWall(rng, cx, cy, wallR, bastionCount);

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
  let bastionPolys = bastions.map(b => b.pts);

  // ---------------- New Town placement ----------------
  function placeNewTown() {
    const startOffset0 = (ditchWidth + glacisWidth) * 1.60;

    // Try gates in order, then try a few scaled variants.
    const scales = [1.0, 0.92, 0.84, 0.76];
    const offsetMul = [1.00, 1.12, 1.25];

    for (const g of gates) {
      for (const om of offsetMul) {
        for (const s of scales) {
          const nt = generateNewTownGrid(g, cx, cy, wallR, baseR, startOffset0 * om, s);
          if (!nt || !nt.poly || nt.poly.length < 3) continue;

          // Strong: keep entire New Town outside the ditch outer.
          const outsideDitch = nt.poly.every(p => !pointInPoly(p, ditchOuter));
          if (!outsideDitch) continue;

          // Avoid intersecting wall base edges.
          if (polyIntersectsPoly(nt.poly, wallBase)) continue;

          return { newTown: nt, primaryGate: g };
        }
      }
    }

    return { newTown: null, primaryGate: gates[0] || null };
  }

  const placed = placeNewTown();
  let newTown = placed.newTown;
  const primaryGate = placed.primaryGate;

  // If New Town overlaps bastions, flatten bastions (hide bastions, keep town).
  // (This is still a failsafe. Ideally, placement avoids it.)
  if (newTown && newTown.poly && newTown.poly.length >= 3) {
    const bastionsFinal = bastions.map(b => {
      const hit =
        polyIntersectsPolyBuffered(b.pts, newTown.poly, 1.5) ||
        pointInPolyOrOn(centroid(b.pts), newTown.poly, 1.5);

      return hit ? { ...b, pts: b.shoulders } : b;
    });

    wallFinal = bastionsFinal.flatMap(b => b.pts);
    bastionPolys = bastionsFinal.map(b => b.pts);
  }

  // ---------------- Outworks ----------------
  const ravelins = gates
    .map(g => makeRavelin(
      g, cx, cy, wallR,
      ditchWidth, glacisWidth,
      newTown ? newTown.poly : null,
      bastionCount
    ))
    .filter(Boolean);

  const outerBoundary = convexHull([
    ...footprint,
    ...(newTown ? newTown.poly : []),
  ]);

  // ---------------- Inner rings ----------------
  const ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  const ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);

  // ---------------- Citadel ----------------
  const citSize = baseR * 0.10;
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

  // ---------------- Milestone 3.3 anchors ----------------
  function placeSquare() {
    if (!primaryGate) return centre;

    const out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
    const candidate = add(centre, mul(out, baseR * 0.10));

    // Keep it inside footprint and inside wallBase.
    if (!pointInPoly(candidate, footprint)) return centre;
    if (!pointInPoly(candidate, wallBase)) return centre;

    return candidate;
  }

  const squareCentre = placeSquare();

  const marketCentre = (() => {
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

  const landmarks = [
    { id: "square", pointOrPolygon: squareCentre, kind: "main_square", label: "Main Square" },
    { id: "market", pointOrPolygon: marketCentre, kind: "market", label: "Market" },
    { id: "citadel", pointOrPolygon: citadel, kind: "citadel", label: "Citadel" },
  ];

  // Primary roads now go to the square (not the old centre).
  const roads = generateRoadsToCentre(gates, squareCentre);
  const avenue = [squareCentre, citCentre];

  // Secondary roads
  const secondaryRoads = generateSecondaryRoads(rng, gates, ring, ring2);

  // ---------------- Road polylines -> road graph ----------------
  // Milestone 3.4 will split intersections in buildRoadGraph, but this file stays stable.
  const polylines = [];

  // Gate -> ring -> square (primary), to avoid cutting through bastions
  for (const g of gates) {
    const path = routeGateToSquareViaRing(g, ring, squareCentre); // [gate, snap, square]

    // gate -> ring snap
    polylines.push({
      points: [path[0], path[1]],
      kind: "primary",
      width: 2.2,
      nodeKindA: "gate",
      nodeKindB: "junction",
    });

    // ring snap -> square
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
  for (const r of (secondaryRoads || [])) {
    polylines.push({ points: r, kind: "secondary", width: 1.25 });
  }

  // New Town streets
  if (newTown && newTown.streets) {
    for (const seg of newTown.streets) {
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
      // Fallback if ring is missing for any reason
      polylines.push({ points: newTown.mainAve, kind: "primary", width: 2.0 });
    }
  }

  const roadGraph = buildRoadGraph(polylines, 2.0);

  return {
    footprint,
    cx, cy,
    wallBase,
    wall: wallFinal,
    gates,

    centre, // keep original centre for reference
    squareR: baseR * 0.055,

    roads,
    ring,
    ring2,
    secondaryRoads,

    citCentre,
    citadel,
    avenue,

    roadGraph,
    landmarks,
    squareCentre,
    marketCentre,
    primaryGate,
    newTown,

    outerBoundary,
    ditchOuter,
    ditchInner,
    glacisOuter,

    ditchWidth,
    glacisWidth,
    ravelins,

    bastionPolys,
  };
}
