// docs/src/roads/blocks.js
//
// Milestone 3.6
// Extract simple "blocks" (faces) from a planar road graph (nodes + edges).
//
// Assumptions:
// - All proper crossings are already split into nodes (Milestone 3.4).
// - No collinear overlap handling yet.
// - Graph is treated as planar for face-walking.
//
// Determinism notes:
// - Neighbour ordering is angle-sorted with explicit ANGLE_EPS tie breaks.
// - Face ordering is stable via sort key.
//

const OUTER_RATIO_MIN = 1.5;

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function centroid(poly) {
  const a = signedArea(poly);
  const absA = Math.abs(a);
  if (absA < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  const k = 1 / (6 * a);
  return { x: cx * k, y: cy * k };
}

function almostEqual(a, b, eps) {
  return Math.abs(a - b) <= eps;
}

function angleBetween(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function dirKey(u, v) {
  return `${u}->${v}`;
}

function samePoint(a, b, eps) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function dedupeConsecutive(poly, eps) {
  if (poly.length < 2) return poly;
  const out = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const p = poly[i];
    const prev = out[out.length - 1];
    if (samePoint(p, prev, eps)) continue;
    out.push(p);
  }
  if (out.length >= 2 && samePoint(out[0], out[out.length - 1], eps)) out.pop();
  return out;
}

function cycleIdsToPoints(ids, nodeById, eps) {
  const pts = [];
  for (const id of ids) {
    const n = nodeById.get(id);
    if (!n) return null;
    pts.push({ x: n.x, y: n.y });
  }
  return dedupeConsecutive(pts, eps);
}

function isValidCycle(ids) {
  if (!ids || ids.length < 3) return false;
  const seen = new Set();
  for (const id of ids) seen.add(id);
  return seen.size >= 3;
}

export function extractBlocksFromRoadGraph(roadGraph, opts = {}) {
  const {
    ANGLE_EPS = 1e-9,
    AREA_EPS = 8.0,
    MAX_FACE_STEPS = 10000,
    POINT_EPS = 1e-9,
  } = opts;

  const nodeById = new Map();
  for (const n of roadGraph.nodes || []) nodeById.set(n.id, n);

  // Build angle-sorted adjacency lists.
  // adj.get(id) -> [{ to, angle }]
  const adj = new Map();
  function ensureAdj(id) {
    if (!adj.has(id)) adj.set(id, []);
    return adj.get(id);
  }

  for (const e of roadGraph.edges || []) {
    const a = e.a;
    const b = e.b;
    const na = nodeById.get(a);
    const nb = nodeById.get(b);
    if (!na || !nb) continue;

    ensureAdj(a).push({ to: b, angle: angleBetween(na, nb) });
    ensureAdj(b).push({ to: a, angle: angleBetween(nb, na) });
  }

  // Deterministic sort with tie-break by to id.
  for (const [, list] of adj.entries()) {
    list.sort((p, q) => {
      if (!almostEqual(p.angle, q.angle, ANGLE_EPS)) return p.angle - q.angle;
      if (p.to < q.to) return -1;
      if (p.to > q.to) return 1;
      return 0;
    });
  }

  // Build "next directed edge" mapping.
  // For each directed edge u->v, at node v find incoming neighbour u in v's list,
  // then take previous (wrap) to keep the face on the left.
  const next = new Map();

  for (const [v, list] of adj.entries()) {
    const deg = list.length;
    if (deg < 2) continue;

    const indexOf = new Map();
    for (let i = 0; i < deg; i++) indexOf.set(list[i].to, i);

    for (let i = 0; i < deg; i++) {
      const u = list[i].to;
      const idxIn = indexOf.get(u);
      if (idxIn == null) continue;

      const idxPrev = (idxIn - 1 + deg) % deg;
      const w = list[idxPrev].to;

      next.set(dirKey(u, v), w); // next is v->w
    }
  }

  const used = new Set();
  const faces = [];

  function walkFace(startU, startV) {
    const cycle = [];
    let u = startU;
    let v = startV;

    for (let steps = 0; steps < MAX_FACE_STEPS; steps++) {
      used.add(dirKey(u, v));
      cycle.push(u);

      const w = next.get(dirKey(u, v));
      if (w == null) return null;

      u = v;
      v = w;

      if (u === startU && v === startV) return cycle;
    }

    return null;
  }

  // Deterministic iteration order: node ids, then angle-sorted neighbours.
  const nodeIds = Array.from(adj.keys()).sort((a, b) => a - b);

  for (const u of nodeIds) {
    const list = adj.get(u) || [];
    for (const d of list) {
      const v = d.to;
      const k = dirKey(u, v);
      if (used.has(k)) continue;

      const cyc = walkFace(u, v);
      if (!cyc) continue;
      if (!isValidCycle(cyc)) continue;

      const poly = cycleIdsToPoints(cyc, nodeById, POINT_EPS);
      if (!poly || poly.length < 3) continue;

      const a = signedArea(poly);
      const absA = Math.abs(a);
      if (absA < AREA_EPS) continue;

      faces.push({
        ids: cyc,
        polygon: poly,
        signedArea: a,
        absArea: absA,
      });
    }
  }

  if (faces.length === 0) return [];

  // Outer face removal with ratio guard.
  let outerIndex = 0;
  let largest = -Infinity;
  let second = -Infinity;

  for (let i = 0; i < faces.length; i++) {
    const a = faces[i].absArea;
    if (a > largest) {
      second = largest;
      largest = a;
      outerIndex = i;
    } else if (a > second) {
      second = a;
    }
  }

  const dropOuter =
    faces.length >= 2 && second > 0 && largest >= second * OUTER_RATIO_MIN;

  const inner = dropOuter ? faces.filter((_, i) => i !== outerIndex) : faces;

  inner.sort((A, B) => {
    if (A.absArea !== B.absArea) return B.absArea - A.absArea;

    const cA = centroid(A.polygon);
    const cB = centroid(B.polygon);

    if (cA.x !== cB.x) return cA.x - cB.x;
    if (cA.y !== cB.y) return cA.y - cB.y;

    const a0 = A.polygon[0];
    const b0 = B.polygon[0];
    if (a0.x !== b0.x) return a0.x - b0.x;
    if (a0.y !== b0.y) return a0.y - b0.y;

    return 0;
  });

  return inner.map((f, i) => ({
    id: `b${i}`,
    polygon: f.polygon,
    districtId: null,
    _debug: {
      absArea: f.absArea,
      signedArea: f.signedArea,
      nodeCycle: f.ids,
    },
  }));
}
