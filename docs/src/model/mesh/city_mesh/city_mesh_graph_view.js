// docs/src/model/mesh/city_mesh/city_mesh_graph_view.js
//
// Build a "graph-shaped view" from CityMesh that preserves the interface used by
// existing routing code (nodes/edges/adj/cells/edgeCells).
//
// Purpose (Milestone 4.7):
// - Migrate all current vorGraph consumers to use CityMesh-derived topology
//   with minimal code churn.
// - Keep determinism: stable ids, stable adjacency ordering, stable incident face lists.
//
// Contract:
// - Node ids and edge ids are integers and are used as indices in arrays where possible.
// - Adj entries are sorted deterministically by (to asc, edgeId asc).
// - Cells preserve their boundary nodeIds and edgeIds in deterministic loop order.
//
// Important:
// - This view is meant to be MUTABLE because existing code (snapPointToGraph with splitEdges)
//   mutates nodes/edges/adj. If want immutability later, clone it at call sites.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ensureArraySize(arr, n, fillFn) {
  while (arr.length < n) arr.push(fillFn ? fillFn(arr.length) : undefined);
  return arr;
}

function sortAdjacencyDeterministic(adj) {
  if (!Array.isArray(adj)) return;
  for (let i = 0; i < adj.length; i++) {
    const list = adj[i];
    if (!Array.isArray(list) || list.length <= 1) continue;
    list.sort((a, b) => {
      const ta = a?.to ?? 0;
      const tb = b?.to ?? 0;
      if (ta !== tb) return ta - tb;
      const ea = a?.edgeId ?? 0;
      const eb = b?.edgeId ?? 0;
      return ea - eb;
    });
  }
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function polygonAreaAbs(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(0.5 * s);
}

/**
 * Build graph view from CityMesh.
 * @param {object} cityMesh
 * @param {object} [opts]
 * @param {number} [opts.eps] - optional epsilon to store on graph view (used by snap).
 * @returns {object} graphView with { nodes, edges, adj, cells, edgeCells, eps }
 */
export function makeGraphViewFromCityMesh(cityMesh, opts = {}) {
  assert(cityMesh && typeof cityMesh === "object", "[GraphView] cityMesh is required.");
  assert(Array.isArray(cityMesh.vertices), "[GraphView] cityMesh.vertices must be an array.");
  assert(Array.isArray(cityMesh.halfEdges), "[GraphView] cityMesh.halfEdges must be an array.");
  assert(Array.isArray(cityMesh.faces), "[GraphView] cityMesh.faces must be an array.");

  const eps = Number.isFinite(opts.eps) ? opts.eps : (Number.isFinite(cityMesh?.meta?.eps) ? cityMesh.meta.eps : 1e-3);

  // ---- Nodes ----
  // Prefer "id as index" arrays. Ensure size = maxId+1.
  let maxNodeId = -1;
  for (const v of cityMesh.vertices) if (v && Number.isInteger(v.id) && v.id > maxNodeId) maxNodeId = v.id;

  const nodes = ensureArraySize([], maxNodeId + 1, () => null);
  for (const v of cityMesh.vertices) {
    if (!v || !Number.isInteger(v.id)) continue;
    nodes[v.id] = { id: v.id, x: v.x, y: v.y };
  }

  // ---- Undirected edges derived from CityMesh half-edges ----
  // CityMesh half-edges reference an undirected edgeId (from vorGraph). Keep that id.
  let maxEdgeId = -1;
  for (const he of cityMesh.halfEdges) {
    if (!he || !Number.isInteger(he.edgeId)) continue;
    if (he.edgeId > maxEdgeId) maxEdgeId = he.edgeId;
  }

  const edges = ensureArraySize([], maxEdgeId + 1, () => null);
  const edgeCells = ensureArraySize([], maxEdgeId + 1, () => []);

  // To fill endpoints (a,b) for each undirected edge, use the first half-edge that references it.
  // Deterministic because we iterate halfEdges in id order.
  for (let heId = 0; heId < cityMesh.halfEdges.length; heId++) {
    const he = cityMesh.halfEdges[heId];
    if (!he) continue;
    const edgeId = he.edgeId;
    if (!Number.isInteger(edgeId) || edgeId < 0) continue;

    // endpoints are origin/to, but store undirected (a,b) as sorted ids
    const a = Math.min(he.origin, he.to);
    const b = Math.max(he.origin, he.to);

    if (!edges[edgeId]) {
      const na = nodes[a];
      const nb = nodes[b];
      const length = (na && nb)
        ? Math.hypot(nb.x - na.x, nb.y - na.y)
        : 0;

      edges[edgeId] = {
        id: edgeId,
        a,
        b,
        length,
        disabled: false,
        flags: { isWater: false, nearCitadel: false },
      };
    }

    // incident face tracking (0..2) deterministically
    const faceId = he.face;
    if (Number.isInteger(faceId)) {
      const inc = edgeCells[edgeId];
      if (Array.isArray(inc) && !inc.includes(faceId)) inc.push(faceId);
    }
  }

  // Deterministic face ordering for edgeCells
  for (let i = 0; i < edgeCells.length; i++) {
    const inc = edgeCells[i];
    if (!Array.isArray(inc)) continue;
    inc.sort((a, b) => a - b);
  }

  // ---- Adjacency ----
  // Build undirected adjacency from edges.
  const adj = ensureArraySize([], nodes.length, () => []);
  for (const e of edges) {
    if (!e || e.disabled) continue;
    const a = e.a;
    const b = e.b;
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (!adj[a]) adj[a] = [];
    if (!adj[b]) adj[b] = [];
    adj[a].push({ to: b, edgeId: e.id });
    adj[b].push({ to: a, edgeId: e.id });
  }
  sortAdjacencyDeterministic(adj);

  // ---- Cells (faces) ----
  // We preserve boundary nodeIds and edgeIds from CityMesh.faces.
  // Use face.id as index when possible.
  let maxFaceId = -1;
  for (const f of cityMesh.faces) if (f && Number.isInteger(f.id) && f.id > maxFaceId) maxFaceId = f.id;

  const cells = ensureArraySize([], maxFaceId + 1, () => null);

  for (const f of cityMesh.faces) {
    if (!f || !Number.isInteger(f.id)) continue;

    // Derive nodeIds in node-index space: cityMesh vertex ids already match node ids (by construction).
    const nodeIds = Array.isArray(f.vertexIds) ? f.vertexIds.slice() : [];

    // Edge ids are already undirected edge ids.
    const edgeIds = Array.isArray(f.edgeIds) ? f.edgeIds.slice() : [];

    // Compute polygon area (use node coords); useful as stable hinting later.
    const poly = nodeIds.map((nid) => nodes[nid]).filter(Boolean);
    const areaAbs = (poly.length >= 3) ? polygonAreaAbs(poly) : 0;

    cells[f.id] = {
      id: f.id,
      nodeIds,
      edgeIds,
      areaAbs,
      disabled: false,
    };
  }

  // ---- Extra: edge lookup helpers (optional) ----
  // Some code may want to quickly resolve an edge between two nodes; provide a map.
  const edgeByPair = new Map();
  for (const e of edges) {
    if (!e) continue;
    edgeByPair.set(pairKey(e.a, e.b), e.id);
  }

  return {
    eps,
    nodes,
    edges,
    adj,
    cells,
    edgeCells,
    edgeByPair, // optional convenience
    __source: "CityMesh",
  };
}
