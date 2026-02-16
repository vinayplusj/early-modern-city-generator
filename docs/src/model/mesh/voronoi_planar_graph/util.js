// docs/src/model/mesh/voronoi_planar_graph/util.js

export function isFiniteNumber(x) {
  return Number.isFinite(x);
}

export function isFinitePoint(p) {
  return p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

export function quantKey(x, y, eps) {
  const qx = Math.round(x / eps);
  const qy = Math.round(y / eps);
  return `${qx},${qy}`;
}

export function wardPoly(ward) {
  if (Array.isArray(ward)) return ward;
  if (!ward || typeof ward !== "object") return null;

  if (Array.isArray(ward.poly)) return ward.poly;
  if (Array.isArray(ward.pts)) return ward.pts;
  if (Array.isArray(ward.points)) return ward.points;

  return null;
}

export function ensureAdjSize(adj, n) {
  while (adj.length < n) adj.push([]);
}

export function midpointOfEdge(nodes, e) {
  const a = nodes[e.a];
  const b = nodes[e.b];
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

export function pointDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function sortAdjacencyDeterministic(adj) {
  for (const list of adj) {
    list.sort((u, v) => (u.to - v.to) || (u.edgeId - v.edgeId));
  }
}

export function pointToSegmentDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const vv = vx * vx + vy * vy;
  if (!isFiniteNumber(vv) || vv <= 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = (wx * vx + wy * vy) / vv;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const px = a.x + vx * t;
  const py = a.y + vy * t;
  return Math.hypot(p.x - px, p.y - py);
}

export function pointToPolylineDistance(p, polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return Infinity;

  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

    const d = pointToSegmentDistance(p, a, b);
    if (d < best) best = d;
  }
  return best;
}
