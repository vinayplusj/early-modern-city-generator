// docs/src/model/districts_voronoi.js
//
// Voronoi-region driven districts.
//
// This version replaces the convex hull district polygon with a true merged outline:
// - Collect all edges of member ward polygons.
// - Cancel internal shared edges (appear twice).
// - Stitch remaining edges into boundary loops.
// - Use the largest loop as district.polygon (debug draw + angle span source).
//
// Notes:
// - This is a deterministic "union boundary extraction" tailored to Voronoi partitions.
// - It is not a full polygon boolean with robust hole handling.
// - Multiple disjoint components are supported; we keep the largest as polygon for now.

import { centroid as polyCentroid, pointInPolyOrOn } from "../geom/poly.js";

function wrapAngle(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

function titleCase(s) {
  const t = String(s || "").replace(/_/g, " ");
  return t
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function roleToKind(role) {
  // Preserve fine-grained roles on districts, but normalise the inner label.
  if (role === "inner") return "inner_ward";
  return role;
}

function minimalCoveringArc(angles) {
  // Return [a0, a1] such that the circular interval covers all angles,
  // with minimal span (complement of the largest gap).
  if (!Array.isArray(angles) || angles.length === 0) return [0, 0];

  const A = angles
    .filter((x) => Number.isFinite(x))
    .map(wrapAngle)
    .sort((a, b) => a - b);

  if (A.length === 0) return [0, 0];
  if (A.length === 1) return [A[0], A[0]];

  let bestGap = -Infinity;
  let bestIdx = 0;
  const TWO_PI = Math.PI * 2;

  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = A[(i + 1) % A.length];
    const gap = (b - a + TWO_PI) % TWO_PI;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  // Largest gap is between A[bestIdx] -> A[bestIdx+1].
  // Covering arc is the complement: start at next angle, end at this angle.
  const start = A[(bestIdx + 1) % A.length];
  const end = A[bestIdx];
  return [start, end];
}

function districtAnglesFromPoly(poly, centre) {
  if (!poly || poly.length < 3) return [0, 0];
  const angles = [];
  for (const p of poly) {
    angles.push(Math.atan2(p.y - centre.y, p.x - centre.x));
  }
  return minimalCoveringArc(angles);
}

function polyArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function bboxOfPolys(polys) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    for (const p of poly) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function makeQuantiser(bbox) {
  // Deterministic quantisation epsilon derived from local scale.
  // Used only for hashing edges so shared borders cancel out.
  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  // Slightly larger than before to tolerate clip / float drift.
  // Still small relative to map scale.
  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  function keyOf(p) {
    const qx = Math.round(p.x * inv);
    const qy = Math.round(p.y * inv);
    return `${qx},${qy}`;
  }

  return { eps, keyOf };
}

function undirectedEdgeKey(aKey, bKey) {
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function angleBetween(u, v) {
  // Returns signed angle from u to v in (-pi, pi].
  const cross = u.x * v.y - u.y * v.x;
  const dot = u.x * v.x + u.y * v.y;
  return Math.atan2(cross, dot);
}

function vec(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function mergeOutlineFromWardPolys(polys) {
  // Returns boundary loops as arrays of points (each loop is closed implicitly).
  //
  // Robust, deterministic outline extraction for partitions:
  // 1) Count undirected edges across member ward polygons (after quantisation).
  // 2) Keep only edges with count === 1 (union boundary).
  // 3) Build undirected adjacency (degree ~2 on valid boundaries).
  // 4) Stitch loops by walking unused edges.

  const bbox = bboxOfPolys(polys);
  if (!bbox) return { loops: [], eps: 0 };

  const Q = makeQuantiser(bbox);

  // Representative point for each point key.
  const repPoint = new Map();
  function rememberPoint(k, p) {
    if (!repPoint.has(k)) repPoint.set(k, { x: p.x, y: p.y });
  }

  // Map undirected edge key -> count, plus endpoints.
  const edgeCount = new Map(); // k -> { count, aKey, bKey }
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length < 3) continue;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;

      const aKey = Q.keyOf(a);
      const bKey = Q.keyOf(b);
      if (aKey === bKey) continue;

      rememberPoint(aKey, a);
      rememberPoint(bKey, b);

      const k = undirectedEdgeKey(aKey, bKey);
      const rec = edgeCount.get(k);
      if (rec) {
        rec.count += 1;
      } else {
        edgeCount.set(k, { count: 1, aKey, bKey });
      }
    }
  }

  // Boundary edges: count === 1.
  const boundaryEdges = [];
  for (const rec of edgeCount.values()) {
    if (rec.count === 1) boundaryEdges.push(rec);
  }

  if (boundaryEdges.length === 0) return { loops: [], eps: Q.eps };

  // Build undirected adjacency: key -> Set(neighbourKey)
  const adj = new Map();
  function addAdj(u, v) {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u).add(v);
  }

  // Track edge usage while stitching.
  const unusedEdges = new Set(); // stores undirectedEdgeKey(u,v)

  for (const e of boundaryEdges) {
    addAdj(e.aKey, e.bKey);
    addAdj(e.bKey, e.aKey);
    unusedEdges.add(undirectedEdgeKey(e.aKey, e.bKey));
  }

  // Deterministic vertex ordering for choosing start points.
  function sortedKeys(m) {
    return Array.from(m.keys()).sort((a, b) => String(a).localeCompare(String(b)));
  }

  function nextNeighbour(curr, prev) {
    // Follow the boundary by taking an unused neighbour edge.
    // Prefer the neighbour that is not prev (degree-2 walk), but still handle branching.
    const nbrs = adj.get(curr);
    if (!nbrs || nbrs.size === 0) return null;

    const ordered = Array.from(nbrs).sort((a, b) => String(a).localeCompare(String(b)));

    // First try: neighbour != prev with unused edge.
    for (const n of ordered) {
      if (n === prev) continue;
      const ek = undirectedEdgeKey(curr, n);
      if (unusedEdges.has(ek)) return n;
    }

    // Fallback: allow returning to prev if it is the only remaining unused edge.
    for (const n of ordered) {
      const ek = undirectedEdgeKey(curr, n);
      if (unusedEdges.has(ek)) return n;
    }

    return null;
  }

  const loops = [];
  const safetyMax = 200000;

  // Stitch until no unused boundary edges remain.
  while (unusedEdges.size > 0) {
    // Pick a deterministic starting edge: smallest vertex key that still has an unused incident edge.
    let start = null;
    for (const k of sortedKeys(adj)) {
      const nbrs = adj.get(k);
      if (!nbrs) continue;
      for (const n of nbrs) {
        if (unusedEdges.has(undirectedEdgeKey(k, n))) {
          start = k;
          break;
        }
      }
      if (start) break;
    }
    if (!start) break;

    // Start walking from start -> first available neighbour.
    const nbrs0 = Array.from(adj.get(start) || []).sort((a, b) => String(a).localeCompare(String(b)));
    let first = null;
    for (const n of nbrs0) {
      if (unusedEdges.has(undirectedEdgeKey(start, n))) {
        first = n;
        break;
      }
    }
    if (!first) {
      // No usable edges incident to start; should not happen if start selection was correct.
      break;
    }

    const loopKeys = [start];
    let prev = start;
    let curr = first;

    // Consume the first edge.
    unusedEdges.delete(undirectedEdgeKey(prev, curr));
    loopKeys.push(curr);

    for (let step = 0; step < safetyMax; step++) {
      const nxt = nextNeighbour(curr, prev);
      if (!nxt) break;

      // If we are closing the loop, do it and stop.
      if (nxt === start) {
        unusedEdges.delete(undirectedEdgeKey(curr, nxt));
        break;
      }

      // Consume and advance.
      unusedEdges.delete(undirectedEdgeKey(curr, nxt));
      prev = curr;
      curr = nxt;
      loopKeys.push(curr);
    }

    // Convert keys to points.
    const loop = loopKeys
      .map((k) => repPoint.get(k))
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

    if (loop.length >= 3) {
      // Remove consecutive duplicates.
      const cleaned = [];
      for (const p of loop) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) cleaned.push(p);
      }
      if (cleaned.length >= 3) loops.push(cleaned);
    }
  }

  return { loops, eps: Q.eps };
}

function pickLargestLoop(loops) {
  if (!Array.isArray(loops) || loops.length === 0) return null;
  let best = null;
  let bestAbsArea = -Infinity;
  for (const l of loops) {
    const a = Math.abs(polyArea(l));
    if (a > bestAbsArea) {
      bestAbsArea = a;
      best = l;
    }
  }
  return best;
}

export function buildVoronoiDistrictsFromWards({ wards, centre }) {
  if (!Array.isArray(wards) || wards.length === 0) return [];
  if (!centre || !Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return [];

  // Group wards by role.
  const groups = new Map();
  for (const w of wards) {
    const role = String(w?.role || "").trim() || "plains";
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(w);
  }

  // Stable role ordering for deterministic district ordering.
  const ROLE_ORDER = [
    "plaza",
    "citadel",
    "inner",
    "new_town",
    "slums",
    "farms",
    "plains",
    "woods",
  ];

  const roles = Array.from(groups.keys()).sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a);
    const ib = ROLE_ORDER.indexOf(b);
    const da = ia >= 0 ? ia : 999;
    const db = ib >= 0 ? ib : 999;
    if (da !== db) return da - db;
    return String(a).localeCompare(String(b));
  });

  const districts = [];

  for (const role of roles) {
    const members = groups.get(role) || [];

    const polys = [];
    for (const w of members) {
      const poly = w?.poly;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      polys.push(poly);
    }

    if (polys.length === 0) continue;

    // True merged outline from boundary edges (union boundary extraction).
    const { loops, eps } = mergeOutlineFromWardPolys(polys);
    const outer = pickLargestLoop(loops);

    if (!outer || outer.length < 3) continue;

    const [a0, a1] = districtAnglesFromPoly(outer, centre);
    const kind = roleToKind(role);

    districts.push({
      id: `d_${kind}`,
      kind,
      name: titleCase(kind),

      // Debug polygon: now a merged outline instead of a convex hull.
      polygon: outer,

      // Traceability.
      memberWardIds: members.map((w) => w.id),

      // Warp compatibility.
      startAngle: a0,
      endAngle: a1,

      // Debug-only extras.
      _debug: {
        role,
        unionEps: eps,
        componentCount: loops.length,
        components: loops, // full set, for future hole/component rendering
      },
    });
  }

  return districts;
}

export function assignBlocksToDistrictsByWards({ blocks, wards, districts }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  if (!Array.isArray(wards) || wards.length === 0) return blocks;
  if (!Array.isArray(districts) || districts.length === 0) return blocks;

  const roleToDistrictId = new Map();
  for (const d of districts) {
    const role = String(d?._debug?.role || "").trim();
    if (role) roleToDistrictId.set(role, d.id);
    const kind = String(d?.kind || "").trim();
    if (kind) roleToDistrictId.set(kind, d.id);
  }

  // Precompute ward centroids for fallback.
  const wardCentroids = wards.map((w) => {
    const c =
      w?.centroid && Number.isFinite(w.centroid.x)
        ? w.centroid
        : (Array.isArray(w?.poly) ? polyCentroid(w.poly) : null);
    return { id: w.id, role: w.role, poly: w.poly, centroid: c };
  });

  function findWardForPoint(p) {
    // First pass: containment.
    for (const w of wardCentroids) {
      if (!Array.isArray(w.poly) || w.poly.length < 3) continue;
      if (pointInPolyOrOn(p, w.poly, 1e-6)) return w;
    }

    // Fallback: nearest centroid.
    let best = null;
    let bestD = Infinity;

    for (const w of wardCentroids) {
      const c = w.centroid;
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = w;
      }
    }
    return best;
  }

  for (const b of blocks) {
    if (!b || !Array.isArray(b.polygon) || b.polygon.length < 3) continue;

    const c = polyCentroid(b.polygon);
    if (!c) continue;

    const w = findWardForPoint(c);
    const role = String(w?.role || "").trim() || "plains";
    const kind = roleToKind(role);

    b.districtId =
      roleToDistrictId.get(role) ||
      roleToDistrictId.get(kind) ||
      `d_${kind}`;
  }

  return blocks;
}
