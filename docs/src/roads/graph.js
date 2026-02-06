// docs/src/roads/graph.js
//
// Milestone 3.4
// - Build a road graph from polylines
// - Split segments at intersections (proper crossings) before graph construction
// - Snap/merge nearby points using eps
//
// Notes:
// - This implementation focuses on proper intersections (X-crossings).
// - Collinear overlaps are ignored for now (stable first pass for Milestone 3.4).
// - IMPORTANT: edge dedupe state must be per-run, otherwise later regenerations can silently drop edges.

console.count("buildRoadGraphWithIntersections() calls");
import {
  segmentProperIntersectionPoint,
  buildSplitPointsOnSegment,
  makePointSnapper,
  samePoint,
  dist2,
} from "../geom/intersections.js";

// ---------- Small utils ----------
function snapKey(x, y, eps) {
  return `${Math.round(x / eps)}|${Math.round(y / eps)}`;
}

function bboxOfSeg(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function bboxesOverlap(A, B, pad = 0) {
  return !(
    A.maxX + pad < B.minX ||
    A.minX - pad > B.maxX ||
    A.maxY + pad < B.minY ||
    A.minY - pad > B.maxY
  );
}

// ---------- Splitting logic ----------
//
// Input: polylines like:
//   { points:[p0,p1,...], kind, width, nodeKindA, nodeKindB }
// Output: array of "segment polylines" (each has exactly 2 points) with same style metadata.
//
// Steps:
// 1) Convert all polylines into raw segments (with style metadata).
// 2) Find pairwise intersections.
// 3) For each segment, collect split parameters t in (0,1).
// 4) Split segments into smaller segments.
// 5) Snap endpoints by eps to keep graph stable.
export function splitPolylinesAtIntersections(polylines, eps = 2.0) {
  // 1) Flatten to raw segments
  const segs = [];
  for (const pl of polylines || []) {
    const pts = pl.points || [];
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({
        a: pts[i],
        b: pts[i + 1],
        kind: pl.kind || "secondary",
        width: pl.width || 1.0,
        // Keep endpoint nodeKinds only at the original endpoints.
        nodeKindA: (i === 0 && pl.nodeKindA) ? pl.nodeKindA : "junction",
        nodeKindB: (i === pts.length - 2 && pl.nodeKindB) ? pl.nodeKindB : "junction",
        _bbox: null, // computed lazily
      });
    }
  }

  if (segs.length <= 1) {
    return segs.map(s => ({
      points: [s.a, s.b],
      kind: s.kind,
      width: s.width,
      nodeKindA: s.nodeKindA,
      nodeKindB: s.nodeKindB,
    }));
  }

  // 2) Collect split parameters per segment
  const splits = new Array(segs.length);
  for (let i = 0; i < splits.length; i++) splits[i] = [];

  // Precompute bboxes once (speed + stability)
  for (const s of segs) s._bbox = bboxOfSeg(s.a, s.b);

  // Pairwise proper intersections
  // Use a small numeric epsilon for intersection math, but keep snapping eps for merging.
  const I_EPS = 1e-9;

  for (let i = 0; i < segs.length; i++) {
    const si = segs[i];

    for (let j = i + 1; j < segs.length; j++) {
      const sj = segs[j];

      // Fast reject: bbox does not overlap (pad a bit for safety)
      if (!bboxesOverlap(si._bbox, sj._bbox, 0.0)) continue;

      // Do not split when sharing endpoints (already connected)
      if (
        samePoint(si.a, sj.a, eps) ||
        samePoint(si.a, sj.b, eps) ||
        samePoint(si.b, sj.a, eps) ||
        samePoint(si.b, sj.b, eps)
      ) {
        continue;
      }

      const hit = segmentProperIntersectionPoint(si.a, si.b, sj.a, sj.b, I_EPS);
      if (!hit) continue;

      splits[i].push(hit.t);
      splits[j].push(hit.u);
    }
  }

  // 3) Split each segment and snap points
  const snap = makePointSnapper(eps);
  const out = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const ts = splits[i];

    const pts = buildSplitPointsOnSegment(s.a, s.b, ts, 1e-6);

    for (let k = 0; k < pts.length - 1; k++) {
      const a = snap(pts[k]);
      const b = snap(pts[k + 1]);

      // Drop tiny segments
      if (dist2(a, b) <= (eps * eps) * 0.01) continue;

      const nkA = (k === 0) ? s.nodeKindA : "junction";
      const nkB = (k === pts.length - 2) ? s.nodeKindB : "junction";

      out.push({
        points: [a, b],
        kind: s.kind,
        width: s.width,
        nodeKindA: nkA,
        nodeKindB: nkB,
      });
    }
  }

  return out;
}

// ---------- Build road graph ----------
//
// Builds a graph from polylines, snapping nodes with eps.
// If you have already split segments, call splitPolylinesAtIntersections() first,
// then pass the result into buildRoadGraph().
export function buildRoadGraph(polylines, eps = 2.0) {
  let nextId = 1;
  const nodes = [];
  const edges = [];
  const buckets = new Map(); // key -> [nodeIds]

  // IMPORTANT: per-run edge dedupe (no static state)
  const edgeSet = new Set();

  function getNodeById(id) {
    return nodes[id - 1];
  }

  function getOrCreateNode(p, kind = "junction") {
    const k = snapKey(p.x, p.y, eps);
    const list = buckets.get(k) || [];

    for (const id of list) {
      const n = getNodeById(id);
      if (dist2(n, p) <= eps * eps) {
        // Upgrade kind if existing node is generic.
        if (n.kind === "junction" && kind !== "junction") n.kind = kind;
        return n.id;
      }
    }

    const node = { id: nextId++, x: p.x, y: p.y, kind };
    nodes.push(node);
    list.push(node.id);
    buckets.set(k, list);
    return node.id;
  }

  function addEdge(aId, bId, kind, width) {
    if (aId === bId) return;

    // Prevent duplicate edges (unordered)
    const lo = Math.min(aId, bId);
    const hi = Math.max(aId, bId);
    const key = `${lo}|${hi}|${kind}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    edges.push({ a: aId, b: bId, kind, width });
  }

  for (const pl of polylines || []) {
    const points = pl.points;
    if (!points || points.length < 2) continue;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const aKind = (i === 0 && pl.nodeKindA) ? pl.nodeKindA : "junction";
      const bKind = (i === points.length - 2 && pl.nodeKindB) ? pl.nodeKindB : "junction";

      const aId = getOrCreateNode(a, aKind);
      const bId = getOrCreateNode(b, bKind);

      addEdge(aId, bId, pl.kind || "secondary", pl.width || 1.0);
    }
  }

  return { nodes, edges };
}

// Convenience wrapper: split + build
export function buildRoadGraphWithIntersections(polylines, eps = 2.0) {
  const split = splitPolylinesAtIntersections(polylines, eps);
  return buildRoadGraph(split, eps);
}
