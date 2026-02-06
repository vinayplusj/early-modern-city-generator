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

// ---------- Small utils ----------
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function snapKey(x, y, eps) {
  return `${Math.round(x / eps)}|${Math.round(y / eps)}`;
}

function samePoint(a, b, eps) {
  return dist2(a, b) <= eps * eps;
}

// ---------- Segment intersection (proper crossing) ----------
// Returns { p, t, u } where:
// - p is intersection point
// - t is parameter along AB (0..1)
// - u is parameter along CD (0..1)
// Returns null if no proper intersection.
//
// Important: We exclude endpoint-only touches by using a small margin.
function segmentIntersectionPoint(a, b, c, d, eps = 1e-9) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };

  const rxs = r.x * s.y - r.y * s.x;
  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const qpxr = qpx * r.y - qpy * r.x;

  // Parallel or collinear
  if (Math.abs(rxs) < eps) {
    return null;
  }

  const t = (qpx * s.y - qpy * s.x) / rxs;
  const u = qpxr / rxs;

  // Proper intersection inside both segments.
  // Exclude near-endpoint hits to reduce double-splitting noise.
  const margin = 1e-6;
  if (t <= margin || t >= 1 - margin || u <= margin || u >= 1 - margin) return null;

  return { p: { x: a.x + t * r.x, y: a.y + t * r.y }, t, u };
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
  // 1) Flatten to segments
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
        // Only keep endpoint nodeKinds on the original first/last segment endpoints.
        // When split, all new interior points become junctions.
        nodeKindA: (i === 0 && pl.nodeKindA) ? pl.nodeKindA : "junction",
        nodeKindB: (i === pts.length - 2 && pl.nodeKindB) ? pl.nodeKindB : "junction",
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

  // Pairwise intersections
  for (let i = 0; i < segs.length; i++) {
    const si = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const sj = segs[j];

      // Quick reject: shared endpoints (do not treat as intersection)
      if (samePoint(si.a, sj.a, eps) || samePoint(si.a, sj.b, eps) || samePoint(si.b, sj.a, eps) || samePoint(si.b, sj.b, eps)) {
        continue;
      }

      const hit = segmentIntersectionPoint(si.a, si.b, sj.a, sj.b);
      if (!hit) continue;

      splits[i].push(hit.t);
      splits[j].push(hit.u);
    }
  }

  // 3) Split each segment
  const out = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const ts = splits[i];

    // No splits
    if (!ts || ts.length === 0) {
      out.push({
        points: [s.a, s.b],
        kind: s.kind,
        width: s.width,
        nodeKindA: s.nodeKindA,
        nodeKindB: s.nodeKindB,
      });
      continue;
    }

    // Sort and unique split params (within tolerance)
    ts.sort((x, y) => x - y);
    const uniq = [];
    const tol = 1e-6;
    for (const t of ts) {
      if (uniq.length === 0 || Math.abs(t - uniq[uniq.length - 1]) > tol) uniq.push(t);
    }

    // Build split points
    const pts = [s.a];
    for (const t of uniq) pts.push(lerpPoint(s.a, s.b, t));
    pts.push(s.b);

    // Emit sub-segments
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];

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

  // 4) Snap/merge endpoints to stable coordinates (eps bucket)
  // This prevents almost-identical float intersection points from creating duplicate nodes.
  const snapped = [];
  const canonical = new Map(); // key -> point

  function snapPoint(p) {
    const k = snapKey(p.x, p.y, eps);
    const existing = canonical.get(k);
    if (existing) return existing;

    // If the bucket exists but is empty, just set this as canonical.
    canonical.set(k, p);
    return p;
  }

  for (const s of out) {
    const a = snapPoint(s.points[0]);
    const b = snapPoint(s.points[1]);

    // Drop tiny segments
    if (dist2(a, b) <= (eps * eps) * 0.01) continue;

    snapped.push({
      points: [a, b],
      kind: s.kind,
      width: s.width,
      nodeKindA: s.nodeKindA,
      nodeKindB: s.nodeKindB,
    });
  }

  return snapped;
}

// ---------- Build road graph (existing behaviour, with stable imports) ----------
//
// Builds a graph from polylines, snapping nodes with eps.
// If you have already split segments, call splitPolylinesAtIntersections() first,
// then pass the result into buildRoadGraph().
export function buildRoadGraph(polylines, eps = 2.0) {
  let nextId = 1;
  const nodes = [];
  const edges = [];
  const buckets = new Map(); // key -> [nodeIds]

  function getNodeById(id) {
    return nodes[id - 1];
  }

  function getOrCreateNode(p, kind = "junction") {
    const k = snapKey(p.x, p.y, eps);
    const list = buckets.get(k) || [];

    for (const id of list) {
      const n = getNodeById(id);
      if (dist2(n, p) <= eps * eps) {
        // Upgrade kind if the existing node is generic.
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
    // Lazily create a set only when needed
    if (!addEdge._set) addEdge._set = new Set();
    if (addEdge._set.has(key)) return;
    addEdge._set.add(key);

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
