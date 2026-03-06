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
import { clampPolylineInsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";
import { dist } from "../../geom/primitives.js";
import {
  pointInPoly,
  signedArea,
  centroid,
  areaAbs, 
  closestPointOnSegment,
  pointSegmentDistance,
} from "../../geom/poly.js";

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

function pointAtDistanceOnPoly(poly, dist) {
  // Walk edges until we reach the requested distance along the perimeter.
  let remaining = dist;

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

  // Fallback: if numerical drift, return first vertex.
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

    // Push slightly inward toward centroid so the seed is inside after clipping.
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

  // NEW: add a boundary seed ring to reduce skewed outer cells
  if (p.boundarySeedCount > 0) {
    const ring = buildBoundarySeeds({
      footprintPoly,
      count: p.boundarySeedCount,
      inset: p.boundaryInset,
    });
    for (const s of ring) wardSeeds.push(s);
  }

  // Build Voronoi over a padded bounding box.
  const bbox = computeBBox(footprintPoly, p.bboxPadding);

  const coords = wardSeeds.map((s) => [s.x, s.y]);
  const delaunay = Delaunay.from(coords);
  const voronoi = delaunay.voronoi([bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);

  /** @type {Ward[]} */
  const wards = [];

  for (let id = 0; id < wardSeeds.length; id++) {
    const seed = wardSeeds[id];

    // d3-delaunay returns a flat array [x0,y0,x1,y1,...] or null
    const cell = voronoi.cellPolygon(id);

    /** @type {Point[]|null} */
    let poly = null;

    if (cell && cell.length >= 4) {
      poly = [];
      // cellPolygon returns an array of [x, y] points and it repeats the first point at the end.
      // We remove the last point if it is a duplicate of the first.
      for (let i = 0; i < cell.length; i++) {
        const pt = cell[i];
        poly.push({ x: pt[0], y: pt[1] });
      }
      poly = dropClosingPoint(poly);

      if (p.clipToFootprint) {
        poly = tryClipToFootprint(poly, footprintPoly, p);
      
        // Debug-only invariant: detect any remaining boundary-chord segments.
        if (p.debugWardClip && Array.isArray(poly) && poly.length >= 3) {
          assertWardEdgesInsideFootprint({ wardId: id, poly, footprintPoly });
        }
      }
    }

    // After dropClosingPoint and optional clipping, require at least a triangle.
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
  const seedCount = clampInt(params?.seedCount ?? 34, 3, 400);

  return {
    seedCount,
    spiralScale: numberOr(params?.spiralScale, 24),
    jitterRadius: numberOr(params?.jitterRadius, 10),
    jitterAngle: numberOr(params?.jitterAngle, 0.25),
    bboxPadding: numberOr(params?.bboxPadding, 250),
    clipToFootprint: Boolean(params?.clipToFootprint ?? false),
    debugWardClip: Boolean(params?.debugWardClip ?? false),
    wardClipMaxSegLen: numberOr(params?.wardClipMaxSegLen, 10),

    // NEW: add one deterministic “ring” of seeds near the boundary
    boundarySeedCount: clampInt(params?.boundarySeedCount ?? 0, 0, 400),
    boundaryInset: numberOr(params?.boundaryInset, 6), // world units (pixels)
  };
}

function numberOr(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
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

function dropClosingPoint(poly) {
  if (poly.length < 3) return poly;

  const a = poly[0];
  const b = poly[poly.length - 1];

  if (almostEqual(a.x, b.x) && almostEqual(a.y, b.y)) {
    return poly.slice(0, poly.length - 1);
  }
  return poly;
}

function almostEqual(a, b) {
  return Math.abs(a - b) <= 1e-9;
}

/* --------------------------- Polygon operations --------------------------- */

/**
 * Ray casting point-in-polygon.
 * Works for simple polygons. Treats boundary as inside.
 */
function assertWardEdgesInsideFootprint({ wardId, poly, footprintPoly, maxFails = 3 }) {
  if (!Array.isArray(poly) || poly.length < 3) return;
  if (!Array.isArray(footprintPoly) || footprintPoly.length < 3) return;

  let fails = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };

    // Treat boundary as inside (pointInPoly already does boundary-as-inside).
    if (!pointInPoly(mid, footprintPoly)) {
      fails += 1;

      // Log a small, deterministic payload. Avoid printing large arrays.
      console.warn("[EMCG] ward clip invariant failed: edge midpoint outside footprint", {
        wardId,
        edgeIndex: i,
        mid,
      });

      if (fails >= maxFails) break;
    }
  }
}
/**
 * Project an outside point to the nearest point on the polygon boundary, then
 * nudge slightly inward along an estimated inward normal.
 * This keeps seed count stable and deterministic.
 */
function projectPointToPolyInterior(p, poly) {
  const nearest = nearestPointOnPoly(p, poly);

  // Estimate inward direction by moving towards polygon centroid.
  const c = centroid(poly);
  const dx = c.x - nearest.x;
  const dy = c.y - nearest.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Small nudge inward.
  const eps = 1e-3;

  const nudged = {
    x: nearest.x + (dx / len) * eps,
    y: nearest.y + (dy / len) * eps,
  };

  // If something went wrong, fall back to nearest boundary point.
  return pointInPoly(nudged, poly) ? nudged : nearest;
}

function nearestPointOnPoly(p, poly) {
  let best = null;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestPointOnSegment(p, a, b);
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = q;
    }
  }

  return best || { x: poly[0].x, y: poly[0].y };
}

function densifyPolyline(poly, maxSegLen) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;

  const out = [];
  const maxL = Number.isFinite(maxSegLen) ? maxSegLen : 10;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    out.push(a);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);

    if (!Number.isFinite(L) || L <= maxL || L <= 1e-9) continue;

    const n = Math.ceil(L / maxL);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + dx * t, y: a.y + dy * t });
    }
  }

  return out;
}

function dropNearDuplicatePoints(poly, eps = 1e-6) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;

  const out = [];
  let prev = null;
  for (const p of poly) {
    if (!prev) {
      out.push(p);
      prev = p;
      continue;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (dx * dx + dy * dy > eps * eps) {
      out.push(p);
      prev = p;
    }
  }

  // If the last point duplicates the first, remove the last.
  if (out.length >= 3) {
    const a = out[0];
    const b = out[out.length - 1];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy <= eps * eps) out.pop();
  }

  return out;
}
/* ---------------------- Optional clipping (safe stub) --------------------- */

/**
 * This tries to clip a cell polygon to the footprint polygon.
 * This function is intentionally conservative because polygon boolean code
 * varies by project. If no clipper exists, it returns the cell polygon.
 *
 * Integration options:
 * - If the project already has a polygon boolean intersection, wire it here.
 * - Until then, keep clipToFootprint = false for Commit 2, and enable it later.
 */
function tryClipToFootprint(cellPoly, footprintPoly, p) {
  if (!Array.isArray(cellPoly) || cellPoly.length < 3) return null;
  if (!Array.isArray(footprintPoly) || footprintPoly.length < 3) return null;

  // We assume the footprint is roughly star-shaped around its centroid, which is
  // true for your “stretched but bounded” outerBoundary.
  const centre = centroid(footprintPoly);

  // Densify first so edges do not “cut chords” outside concave/curvy boundaries.
  // This is deterministic and avoids requiring a full polygon intersection algorithm.
  const maxSegLen = Number.isFinite(p?.wardClipMaxSegLen) ? p.wardClipMaxSegLen : 10; // world units; keep small enough to respect curved boundary detail
  const dense = densifyPolyline(cellPoly, maxSegLen);

  // Clamp each point along rays to stay inside the footprint.
  // Margin 0 keeps it tight; increase slightly if you see boundary grazing issues.
  let clamped = clampPolylineInsidePolyAlongRays(dense, centre, footprintPoly, 0);

  if (!clamped || clamped.length < 3) return null;

  // Remove near-duplicate points introduced by densify + clamp.
  clamped = dropNearDuplicatePoints(clamped, 1e-6);

  if (!clamped || clamped.length < 3) return null;
  return clamped;
}
