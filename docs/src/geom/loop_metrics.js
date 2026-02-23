// docs/src/geom/loop_metrics.js
//
// Loop and polygon metric helpers.
// Extracted from: docs/src/model/districts.js
//
// Behaviour: extraction only (no logic changes).
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

import { segIntersect } from "./poly.js";

export function polyAreaSigned(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function loopBBox(loop) {
  if (!Array.isArray(loop) || loop.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function loopPerimeter(loop) {
  if (!Array.isArray(loop) || loop.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    sum += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return sum;
}

export function loopMinMaxEdge(loop) {
  if (!Array.isArray(loop) || loop.length < 2) return { minEdgeLen: 0, maxEdgeLen: 0 };
  let minEdgeLen = Infinity;
  let maxEdgeLen = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    minEdgeLen = Math.min(minEdgeLen, d);
    maxEdgeLen = Math.max(maxEdgeLen, d);
  }
  if (!Number.isFinite(minEdgeLen)) minEdgeLen = 0;
  return { minEdgeLen, maxEdgeLen };
}

export function loopSelfIntersectionCount(loop) {
  if (!Array.isArray(loop) || loop.length < 4) return 0;

  let count = 0;

  for (let i = 0; i < loop.length; i++) {
    const a0 = loop[i];
    const a1 = loop[(i + 1) % loop.length];

    for (let j = i + 1; j < loop.length; j++) {
      // Skip adjacent edges and the same edge.
      if (j === i) continue;
      if (j === (i + 1) % loop.length) continue;
      if ((i === 0) && (j === loop.length - 1)) continue;

      const b0 = loop[j];
      const b1 = loop[(j + 1) % loop.length];

      // Skip adjacent edges.
      if (b1 === a0 || b0 === a1) continue;

      if (segIntersect(a0, a1, b0, b1)) count++;
    }
  }

  return count;
}

export function loopMetrics(loop) {
  const areaSigned = polyAreaSigned(loop);
  const areaAbs = Math.abs(areaSigned);

  const bbox = loopBBox(loop);
  const perimeter = loopPerimeter(loop);
  const { minEdgeLen, maxEdgeLen } = loopMinMaxEdge(loop);

  const dx = bbox ? (bbox.maxX - bbox.minX) : 0;
  const dy = bbox ? (bbox.maxY - bbox.minY) : 0;
  const diag = Math.hypot(dx, dy);

  const selfIntersections = loopSelfIntersectionCount(loop);

  return {
    n: Array.isArray(loop) ? loop.length : 0,
    areaSigned,
    areaAbs,
    perimeter,
    minEdgeLen,
    maxEdgeLen,
    bbox,
    diag,
    selfIntersections,
  };
}
