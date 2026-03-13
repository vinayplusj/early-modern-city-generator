// docs/src/model/wards/wards_voronoi.js
//
// Purpose
// - Place ward seeds in a spiral with deterministic jitter.
// - Build Voronoi cells from the seeds.
// - Return wards with stable ids and basic geometry fields.
//
// Dependency note (important)
// - This module expects a Delaunay / Voronoi implementation.
// - Recommended: vendor d3-delaunay as an ES module and import it here.
// - If do not have it yet, can still use buildWardSeedsSpiral() and
//   postpone Voronoi polygon creation to the next commit.
//
// Expected params (with defaults below)
// - seedCount: number of wards
// - spiralScale: controls seed spacing
// - jitterRadius: radial jitter in pixels (or the world units)
// - jitterAngle: angular jitter in radians
// - bboxPadding: padding for Voronoi bounding box
// - clipToFootprint: if true, try to clip cells to footprintPoly when a clipper exists

import { Delaunay } from "../../../vendor/d3-delaunay-6.0.4.umd-shim.js";
import { dist } from "../../geom/primitives.js";
import { pointInPoly, centroid, areaAbs } from "../../geom/poly.js";
import { clampInt } from "../util/ids.js";
import { projectPointToPolyInterior, dropClosingPoint, tryClipToFootprint, assertWardEdgesInsideFootprint } from "./ward_shape_utils.js";

/**
 * @typedef {{x:number, y:number}} Point
 * @typedef {{id:number, seed:Point, poly:Point[]|null, centroid:Point|null, area:number|null, distToCentre:number}} Ward
 */

/**
 * Build seeds using a spiral (golden angle) with deterministic jitter.
 * Seeds are projected into the footprint if they fall outside.
 *
 * @param {object} args
 * @param {() => number} args.rng - Deterministic RNG that returns [0,1).
 * @param {Point} args.centre
 * @param {Point[]} args.footprintPoly - Closed or open polygon, treated as closed.
 * @param {object} args.params
 * @returns {Point[]}
 */
export function buildWardSeedsSpiral({ rng, centre, footprintPoly, params }) {
  const p = normaliseParams(params);

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  /** @type {Point[]} */
  const seeds = [];

  for (let i = 0; i < p.seedCount; i++) {
    const rBase = p.spiralScale * Math.sqrt(i);
    const thetaBase = i * goldenAngle;

    const jr = (rng() - 0.5) * 2 * p.jitterRadius;
    const jt = (rng() - 0.5) * 2 * p.jitterAngle;

    const r = Math.max(0, rBase + jr);
    const theta = thetaBase + jt;

    const candidate = {
      x: centre.x + r * Math.cos(theta),
      y: centre.y + r * Math.sin(theta),
    };

    const inside = pointInPoly(candidate, footprintPoly);
    seeds.push(inside ? candidate : projectPointToPolyInterior(candidate, footprintPoly));
  }

  return seeds;
}

function polyPerimeter(poly) {
  let L = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    L += Math.hypot(dx, dy);
  }
  return L;
}

function pointAtDistanceOnPoly(poly, distAlong) {
  let remaining = distAlong;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);

    if (seg <= 1e-9) continue;

    if (remaining <= seg) {
      const t = remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    remaining -= seg;
  }

  return { x: poly[0].x, y: poly[0].y };
}

function buildBoundarySeeds({ footprintPoly, count, inset }) {
  const poly = Array.isArray(footprintPoly) ? footprintPoly : [];
  if (poly.length < 3 || count <= 0) return [];

  const c = centroid(poly);
  const perim = polyPerimeter(poly);
  if (!Number.isFinite(perim) || perim <= 1e-6) return [];

  const step = perim / count;
  const seeds = [];

  for (let i = 0; i < count; i++) {
    const p = pointAtDistanceOnPoly(poly, i * step);
    const vx = c.x - p.x;
    const vy = c.y - p.y;
    const vlen = Math.hypot(vx, vy) || 1;

    seeds.push({
      x: p.x + (vx / vlen) * inset,
      y: p.y + (vy / vlen) * inset,
    });
  }

  return seeds;
}

/**
 * Build Voronoi wards (seed + polygon + centroid).
 *
 * @param {object} args
 * @param {() => number} args.rng
 * @param {Point} args.centre
 * @param {Point[]} args.footprintPoly
 * @param {object} args.params
 * @returns {{ wardSeeds: Point[], wards: Ward[] }}
 */
export function buildWardsVoronoi({ rng, centre, footprintPoly, params }) {
  const p = normaliseParams(params);

  const wardSeeds = buildWardSeedsSpiral({ rng, centre, footprintPoly, params: p });

  if (p.boundarySeedCount > 0) {
    const ring = buildBoundarySeeds({
      footprintPoly,
      count: p.boundarySeedCount,
      inset: p.boundaryInset,
    });
    for (const s of ring) wardSeeds.push(s);
  }

  const bbox = computeBBox(footprintPoly, p.bboxPadding);
  const coords = wardSeeds.map((s) => [s.x, s.y]);
  const delaunay = Delaunay.from(coords);
  const voronoi = delaunay.voronoi([bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);

  /** @type {Ward[]} */
  const wards = [];

  for (let id = 0; id < wardSeeds.length; id++) {
    const seed = wardSeeds[id];
    const cell = voronoi.cellPolygon(id);

    /** @type {Point[]|null} */
    let poly = null;

    if (cell && cell.length >= 4) {
      poly = [];
      for (let i = 0; i < cell.length; i++) {
        const pt = cell[i];
        poly.push({ x: pt[0], y: pt[1] });
      }
      poly = dropClosingPoint(poly);

      if (p.clipToFootprint) {
        poly = tryClipToFootprint(poly, footprintPoly, p);
        if (p.debugWardClip && Array.isArray(poly) && poly.length >= 3) {
          assertWardEdgesInsideFootprint({ wardId: id, poly, footprintPoly });
        }
      }
    }

    if (!Array.isArray(poly) || poly.length < 3) {
      poly = null;
    }

    const centroidPt = poly ? centroid(poly) : null;
    const area = poly ? areaAbs(poly) : null;

    wards.push({
      id,
      seed,
      poly,
      centroid: centroidPt,
      area,
      distToCentre: dist(seed, centre),
    });
  }

  return { wardSeeds, wards };
}

/* ------------------------- Parameters and helpers ------------------------- */

function normaliseParams(params) {
  const seedCount = clampInt(params?.seedCount ?? 30, 3, 300);

  return {
    seedCount,
    spiralScale: numberOr(params?.spiralScale, 24),
    jitterRadius: numberOr(params?.jitterRadius, 10),
    jitterAngle: numberOr(params?.jitterAngle, 0.25),
    bboxPadding: numberOr(params?.bboxPadding, 250),
    clipToFootprint: Boolean(params?.clipToFootprint ?? false),
    debugWardClip: Boolean(params?.debugWardClip ?? false),
    wardClipMaxSegLen: numberOr(params?.wardClipMaxSegLen, 10),
    boundarySeedCount: clampInt(params?.boundarySeedCount ?? 0, 0, 400),
    boundaryInset: numberOr(params?.boundaryInset, 6),
  };
}

function numberOr(v, d) {
  return Number.isFinite(v) ? v : d;
}

function computeBBox(poly, pad) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}
