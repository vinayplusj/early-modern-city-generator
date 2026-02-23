// docs/src/model/mesh/loops_from_polys.js
//
// Build boundary loops from a set of closed polygon rings by edge cancellation.
// Extracted from: docs/src/model/districts.js
//
// Behaviour: extraction only (no logic changes).
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

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

export function buildLoopsFromPolys(polys) {
  // Edge-cancellation union boundary via quantised point keys.
  // Returns all boundary loops (outer + holes, if any).
  const bbox = (() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      for (const p of poly) {
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  })();

  if (!bbox) return [];

  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  const keyOf = (p) => `${Math.round(p.x * inv)},${Math.round(p.y * inv)}`;
  const eKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const rep = new Map();       // pointKey -> representative {x,y}
  const edgeCount = new Map(); // edgeKey -> count

  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length < 3) continue;

    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (!p || !q) continue;

      const kp = keyOf(p);
      const kq = keyOf(q);

      if (!rep.has(kp)) rep.set(kp, p);
      if (!rep.has(kq)) rep.set(kq, q);

      const ek = eKey(kp, kq);
      edgeCount.set(ek, (edgeCount.get(ek) || 0) + 1);
    }
  }

  // Boundary edges: those that appear exactly once.
  const adj = new Map(); // pointKey -> Set<pointKey>

  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };

  for (const [ek, c] of edgeCount.entries()) {
    if (c !== 1) continue;
    const [a, b] = ek.split("|");
    addAdj(a, b);
    addAdj(b, a);
  }

  // Walk adjacency to build loops.
  const visitedEdge = new Set();
  const loops = [];

  const edgeVisitedKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const nextNeighbour = (curr, prev) => {
    const nbs = adj.get(curr);
    if (!nbs || nbs.size === 0) return null;
    if (!prev) return nbs.values().next().value;

    // Prefer neighbour that is not the previous point.
    for (const nb of nbs) {
      if (nb !== prev) return nb;
    }
    // Fallback: only neighbour is prev.
    return prev;
  };

  for (const [start, nbs] of adj.entries()) {
    for (const nb of nbs) {
      const e0 = edgeVisitedKey(start, nb);
      if (visitedEdge.has(e0)) continue;

      const loopKeys = [start, nb];
      visitedEdge.add(e0);

      let prev = start;
      let curr = nb;

      for (let guard = 0; guard < 200000; guard++) {
        const nxt = nextNeighbour(curr, prev);
        if (!nxt) break;

        const ek = edgeVisitedKey(curr, nxt);
        if (visitedEdge.has(ek)) {
          // If we close back to start, finish the loop.
          if (nxt === start) {
            if (loopKeys[loopKeys.length - 1] !== start) loopKeys.push(start);
          }
          break;
        }

        visitedEdge.add(ek);

        if (nxt === start) {
          if (loopKeys[loopKeys.length - 1] !== start) loopKeys.push(start);
          break;
        }

        prev = curr;
        curr = nxt;
        loopKeys.push(curr);
      }

      const loop = loopKeys.map((k) => rep.get(k)).filter(Boolean);
      if (loop.length >= 4) loops.push(loop);
    }
  }

  return loops;
}
