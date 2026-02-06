import { dist2 } from "../geom/primitives.js";

function snapKey(x, y, eps) {
  return `${Math.round(x / eps)}|${Math.round(y / eps)}`;
}

export function buildRoadGraph(polylines, eps = 2.0) {
  let nextId = 1;
  const nodes = [];
  const edges = [];
  const buckets = new Map();

  function getNodeById(id) {
    return nodes[id - 1];
  }

  function getOrCreateNode(p, kind = "junction") {
    const k = snapKey(p.x, p.y, eps);
    const list = buckets.get(k) || [];

    for (const id of list) {
      const n = getNodeById(id);
      if (dist2(n, p) <= eps * eps) {
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
    edges.push({ a: aId, b: bId, kind, width });
  }

  for (const pl of polylines) {
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
