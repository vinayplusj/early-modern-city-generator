// docs/src/model/mesh/loops_from_polys.js
//
// Build boundary loops from a set of closed polygon rings by edge cancellation.

// Note: these tiny index helpers are used in districts.js beyond buildLoopsFromPolys,
// so they are exported here for a clean extraction without behavioural changes.
export function cyclicDistance(a, b, n) {
  return (b - a + n) % n;
}

export function nextIndex(i, n) {
  return (i + 1) % n;
}

export function prevIndex(i, n) {
  return (i - 1 + n) % n;
}

export function polyArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function bboxOfPolys(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

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

export function makeQuantiser(bbox) {
  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  function keyOf(p) {
    const qx = Math.round(p.x * inv);
    const qy = Math.round(p.y * inv);
    return `${qx},${qy}`;
  }

  return { eps, keyOf };
}

export function undirectedEdgeKey(aKey, bKey) {
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

export function buildLoopsFromPolys(polys) {
  const bbox = bboxOfPolys(polys);
  if (!bbox) return [];

  const Q = makeQuantiser(bbox);
  const repPoint = new Map();

  function rememberPoint(k, p) {
    if (!repPoint.has(k)) repPoint.set(k, { x: p.x, y: p.y });
  }

  const edgeCount = new Map();
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
      if (rec) rec.count += 1;
      else edgeCount.set(k, { count: 1, aKey, bKey });
    }
  }

  const boundaryEdges = [];
  for (const rec of edgeCount.values()) {
    if (rec.count === 1) boundaryEdges.push(rec);
  }

  if (boundaryEdges.length === 0) return [];

  const adj = new Map();
  function addAdj(u, v) {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u).add(v);
  }

  const unusedEdges = new Set();
  for (const e of boundaryEdges) {
    addAdj(e.aKey, e.bKey);
    addAdj(e.bKey, e.aKey);
    unusedEdges.add(undirectedEdgeKey(e.aKey, e.bKey));
  }

  function sortedKeys(m) {
    return Array.from(m.keys()).sort((a, b) => String(a).localeCompare(String(b)));
  }

  function nextNeighbour(curr, prev) {
    const nbrs = adj.get(curr);
    if (!nbrs || nbrs.size === 0) return null;

    const ordered = Array.from(nbrs).sort((a, b) => String(a).localeCompare(String(b)));

    for (const n of ordered) {
      if (n === prev) continue;
      const ek = undirectedEdgeKey(curr, n);
      if (unusedEdges.has(ek)) return n;
    }
    for (const n of ordered) {
      const ek = undirectedEdgeKey(curr, n);
      if (unusedEdges.has(ek)) return n;
    }
    return null;
  }

  const loops = [];
  const safetyMax = 200000;

  while (unusedEdges.size > 0) {
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

    const nbrs0 = Array.from(adj.get(start) || []).sort((a, b) => String(a).localeCompare(String(b)));
    let first = null;
    for (const n of nbrs0) {
      if (unusedEdges.has(undirectedEdgeKey(start, n))) {
        first = n;
        break;
      }
    }
    if (!first) break;

    const loopKeys = [start];
    let prev = start;
    let curr = first;

    unusedEdges.delete(undirectedEdgeKey(prev, curr));
    loopKeys.push(curr);

    for (let step = 0; step < safetyMax; step++) {
      const nxt = nextNeighbour(curr, prev);
      if (!nxt) break;
      if (nxt === start) {
        unusedEdges.delete(undirectedEdgeKey(curr, nxt));
        break;
      }
      unusedEdges.delete(undirectedEdgeKey(curr, nxt));
      prev = curr;
      curr = nxt;
      loopKeys.push(curr);
    }

    const loop = loopKeys
      .map((k) => repPoint.get(k))
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

    if (loop.length >= 3) {
      const cleaned = [];
      for (const p of loop) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) cleaned.push(p);
      }
      if (cleaned.length >= 3) loops.push(cleaned);
    }
  }

  return loops;
}

export function mergeOutlineFromPolys(polys) {
  const bbox = bboxOfPolys(polys);
  if (!bbox) return { loops: [], eps: 0 };
  const Q = makeQuantiser(bbox);
  const loops = buildLoopsFromPolys(polys);
  return { loops, eps: Q.eps };
}

export function pickLargestLoop(loops) {
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
