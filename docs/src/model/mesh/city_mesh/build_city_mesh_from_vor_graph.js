// docs/src/model/mesh/build_city_mesh_from_vor_graph.js
//
// Build a DCEL-like CityMesh from the existing Voronoi planar graph (vorGraph).
// This file is designed for Milestone 4.7:
// - Stable ids
// - Deterministic construction order
// - Face loops + boundary loops
// - Strict invariants (throw on failure)
//
// Assumed vorGraph shape (current repo convention):
// - vorGraph.nodes: Array<{ id?: number, x:number, y:number }>
// - vorGraph.edges: Array<{ id?: number, a:number, b:number, disabled?: boolean }>
// - vorGraph.cells: Array<{ id?: number, nodeIds:number[], edgeIds:number[], disabled?: boolean }>
// - vorGraph.edgeCells: Array<Array<number>>   // incident cell ids per edge id
//
// Note: This adapter does not change behaviour. It creates a topology layer only.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function segDist2(p, a, b) {
  // squared distance from p to segment ab
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  let t = 0;
  if (ab2 > 0) t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const qx = a.x + t * abx;
  const qy = a.y + t * aby;
  const dx = p.x - qx;
  const dy = p.y - qy;
  return dx * dx + dy * dy;
}

function polygonAreaSigned(points) {
  // signed area (shoelace), points assumed closed by caller if needed
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return 0.5 * s;
}

function polygonCentroid(points) {
  // centroid of a simple polygon, robust enough for our binding choices
  const a = polygonAreaSigned(points);
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) {
    // fallback: average
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
    }
    const n = points.length || 1;
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  let fsum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    fsum += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  const inv = 1 / (3 * fsum);
  return { x: cx * inv, y: cy * inv };
}

/**
 * @typedef {object} CityVertex
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number|null} outgoing  // one halfEdge id that leaves this vertex (optional)
 */

/**
 * @typedef {object} CityHalfEdge
 * @property {number} id
 * @property {number} origin          // vertex id
 * @property {number} to              // vertex id
 * @property {number} edgeId          // undirected edge id from vorGraph
 * @property {number} face            // face id (cell id)
 * @property {number|null} twin       // halfEdge id, null on boundary
 * @property {number} next            // halfEdge id
 * @property {number} prev            // halfEdge id
 * @property {number|null} boundaryLoop // boundaryLoop id if boundary, else null
 */

/**
 * @typedef {object} CityFace
 * @property {number} id
 * @property {number} anyHalfEdge     // one halfEdge id on this face
 * @property {number[]} halfEdges     // ordered loop of halfEdge ids
 * @property {number[]} vertexIds     // ordered boundary vertex ids (same order)
 * @property {number[]} edgeIds       // ordered undirected edge ids (same order)
 */

/**
 * @typedef {object} CityBoundaryLoop
 * @property {number} id
 * @property {number[]} halfEdges     // ordered boundary halfEdge ids
 * @property {number[]} vertexIds     // ordered boundary vertex ids
 * @property {{x:number,y:number}[]} polygon // vertex coords, ordered
 * @property {number} areaAbs
 * @property {{x:number,y:number}} centroid
 */

/**
 * @typedef {object} CityMesh
 * @property {CityVertex[]} vertices
 * @property {CityHalfEdge[]} halfEdges
 * @property {CityFace[]} faces
 * @property {CityBoundaryLoop[]} boundaryLoops
 * @property {object} edgeToHalfEdges      // edgeId -> [heIdA, heIdB?]
 * @property {object} meta
 */

function assertVorGraph(vorGraph) {
  assert(vorGraph && typeof vorGraph === "object", "[CityMesh] build: vorGraph is required.");
  assert(Array.isArray(vorGraph.nodes), "[CityMesh] build: vorGraph.nodes must be an array.");
  assert(Array.isArray(vorGraph.edges), "[CityMesh] build: vorGraph.edges must be an array.");
  assert(Array.isArray(vorGraph.cells), "[CityMesh] build: vorGraph.cells must be an array.");
  assert(Array.isArray(vorGraph.edgeCells), "[CityMesh] build: vorGraph.edgeCells must be an array.");
}

function assertFaceCellShape(cell, faceId) {
  assert(cell && typeof cell === "object", `[CityMesh] build: cell ${faceId} missing.`);
  assert(Array.isArray(cell.nodeIds), `[CityMesh] build: cell ${faceId} missing nodeIds.`);
  assert(Array.isArray(cell.edgeIds), `[CityMesh] build: cell ${faceId} missing edgeIds.`);
  assert(cell.nodeIds.length === cell.edgeIds.length, `[CityMesh] build: cell ${faceId} nodeIds/edgeIds length mismatch.`);
  assert(cell.nodeIds.length >= 3, `[CityMesh] build: cell ${faceId} must have >= 3 vertices.`);
}

function undirectedEdgeMatches(e, a, b) {
  if (!e) return false;
  return (e.a === a && e.b === b) || (e.a === b && e.b === a);
}

function assertEdgePlanarity(vorGraph) {
  for (let edgeId = 0; edgeId < vorGraph.edgeCells.length; edgeId++) {
    const inc = vorGraph.edgeCells[edgeId];
    if (!Array.isArray(inc)) continue;
    if (inc.length > 2) {
      throw new Error(`[CityMesh] invariant: edge ${edgeId} has ${inc.length} incident faces (non-planar).`);
    }
  }
}

/**
 * Build CityMesh from vorGraph.
 * @param {object} vorGraph
 * @param {object} [opts]
 * @param {boolean} [opts.includeDisabled=false]
 * @returns {CityMesh}
 */
export function buildCityMeshFromVorGraph(vorGraph, opts = {}) {
  const includeDisabled = Boolean(opts.includeDisabled);

  assertVorGraph(vorGraph);
  assertEdgePlanarity(vorGraph);

  // ---- Vertices ----
  const vertices = vorGraph.nodes.map((n, i) => {
    assert(isFinitePoint(n), `[CityMesh] build: node ${i} must have finite x,y.`);
    const id = Number.isFinite(n.id) ? n.id : i;
    return { id, x: n.x, y: n.y, outgoing: null };
  });

  // Map node index -> vertex id (usually identity, but keep stable if node.id is present)
  const nodeIndexToVertexId = new Array(vertices.length);
  const vertexIdToIndex = new Map();
  for (let i = 0; i < vertices.length; i++) {
    nodeIndexToVertexId[i] = vertices[i].id;
    vertexIdToIndex.set(vertices[i].id, i);
  }

  // ---- Faces + Half-edges (deterministic order: faceId asc, boundary index asc) ----
  const halfEdges = [];
  const faces = [];
  const directedKeyToHalfEdgeId = new Map(); // `${edgeId}|${originV}|${toV}` -> heId
  const edgeToHalfEdges = {}; // edgeId -> array of heIds (0..2), order by heId asc

  let nextHeId = 0;

  for (let faceIndex = 0; faceIndex < vorGraph.cells.length; faceIndex++) {
    const cell = vorGraph.cells[faceIndex];
    const faceId = Number.isFinite(cell?.id) ? cell.id : faceIndex;

    if (!includeDisabled && cell?.disabled) continue;

    assertFaceCellShape(cell, faceId);

    const nodeIds = cell.nodeIds;
    const edgeIds = cell.edgeIds;

    const n = nodeIds.length;

    const faceHalfEdges = new Array(n);

    // Create half-edges for this face
    for (let i = 0; i < n; i++) {
      const aNode = nodeIds[i];
      const bNode = nodeIds[(i + 1) % n];
      const edgeId = edgeIds[i];

      assert(Number.isInteger(aNode) && Number.isInteger(bNode), `[CityMesh] build: face ${faceId} has non-integer node id.`);
      assert(Number.isInteger(edgeId), `[CityMesh] build: face ${faceId} has non-integer edge id.`);
      assert(aNode >= 0 && aNode < vorGraph.nodes.length, `[CityMesh] build: face ${faceId} node id out of range.`);
      assert(bNode >= 0 && bNode < vorGraph.nodes.length, `[CityMesh] build: face ${faceId} node id out of range.`);
      assert(edgeId >= 0 && edgeId < vorGraph.edges.length, `[CityMesh] build: face ${faceId} edge id out of range.`);

      const e = vorGraph.edges[edgeId];
      if (!includeDisabled && e?.disabled) {
        // If a face boundary references a disabled edge, that is a topology error in strict mode.
        throw new Error(`[CityMesh] build: face ${faceId} references disabled edge ${edgeId}.`);
      }

      // Validate edge endpoint compatibility
      assert(
        undirectedEdgeMatches(e, aNode, bNode),
        `[CityMesh] build: face ${faceId} boundary edge ${edgeId} does not match endpoints (${aNode},${bNode}).`
      );

      const originV = nodeIndexToVertexId[aNode];
      const toV = nodeIndexToVertexId[bNode];

      const heId = nextHeId++;
      const he = {
        id: heId,
        origin: originV,
        to: toV,
        edgeId,
        face: faceId,
        twin: null,
        next: -1,
        prev: -1,
        boundaryLoop: null,
      };

      halfEdges.push(he);
      faceHalfEdges[i] = heId;

      // outgoing pointer for vertex (keep first, deterministic since we build in deterministic order)
      const vIdx = vertexIdToIndex.get(originV);
      if (vIdx != null && vertices[vIdx].outgoing == null) vertices[vIdx].outgoing = heId;

      // store directed key for twin linking
      const key = `${edgeId}|${originV}|${toV}`;
      directedKeyToHalfEdgeId.set(key, heId);

      if (!edgeToHalfEdges[edgeId]) edgeToHalfEdges[edgeId] = [];
      edgeToHalfEdges[edgeId].push(heId);
    }

    // Wire next/prev around the face
    for (let i = 0; i < n; i++) {
      const heId = faceHalfEdges[i];
      const he = halfEdges[heId];
      const nextId = faceHalfEdges[(i + 1) % n];
      const prevId = faceHalfEdges[(i - 1 + n) % n];
      he.next = nextId;
      he.prev = prevId;
    }

    // Face record
    const vertexIds = nodeIds.map((nid) => nodeIndexToVertexId[nid]);
    const face = {
      id: faceId,
      anyHalfEdge: faceHalfEdges[0],
      halfEdges: faceHalfEdges,
      vertexIds,
      edgeIds: edgeIds.slice(),
    };
    faces.push(face);
  }

  // Sort edge->halfEdges by heId for determinism
  for (const k of Object.keys(edgeToHalfEdges)) {
    edgeToHalfEdges[k].sort((a, b) => a - b);
  }

  // ---- Twin linking ----
  for (const he of halfEdges) {
    const twinKey = `${he.edgeId}|${he.to}|${he.origin}`;
    const twinId = directedKeyToHalfEdgeId.get(twinKey);
    if (twinId != null) he.twin = twinId;
  }

  // ---- Boundary loops ----
  // A half-edge is boundary if it has no twin.
  const boundaryHalfEdges = [];
  for (const he of halfEdges) {
    if (he.twin == null) boundaryHalfEdges.push(he.id);
  }
  boundaryHalfEdges.sort((a, b) => a - b);

  // Index boundary half-edges by origin for loop walking
  const boundaryOutgoingByOrigin = new Map(); // originV -> [heId...]
  for (const heId of boundaryHalfEdges) {
    const he = halfEdges[heId];
    const list = boundaryOutgoingByOrigin.get(he.origin) || [];
    list.push(heId);
    boundaryOutgoingByOrigin.set(he.origin, list);
  }

  // Deterministic order inside each outgoing list: sort by heId
  for (const [k, list] of boundaryOutgoingByOrigin.entries()) {
    list.sort((a, b) => a - b);
    boundaryOutgoingByOrigin.set(k, list);
  }

  const visitedBoundary = new Set();
  const boundaryLoops = [];

  function angleOf(u, v) {
    // u and v are points
    return Math.atan2(v.y - u.y, v.x - u.x);
  }

  function normAngle(a) {
    // map to [0, 2pi)
    let x = a % (Math.PI * 2);
    if (x < 0) x += Math.PI * 2;
    return x;
  }

  function chooseNextBoundaryHalfEdge(inHeId) {
    // We are at half-edge a->b. At vertex b, choose outgoing boundary he b->c
    // with smallest clockwise turn from direction (a->b) to (b->c).
    const inHe = halfEdges[inHeId];
    const aIdx = vertexIdToIndex.get(inHe.origin);
    const bIdx = vertexIdToIndex.get(inHe.to);
    if (aIdx == null || bIdx == null) return null;

    const a = vertices[aIdx];
    const b = vertices[bIdx];

    const candidates = boundaryOutgoingByOrigin.get(inHe.to) || [];
    if (candidates.length === 0) return null;

    const inAng = angleOf(a, b);

    let best = null;
    let bestTurn = null;

    for (const candId of candidates) {
      if (candId === inHeId) continue;
      const outHe = halfEdges[candId];
      const cIdx = vertexIdToIndex.get(outHe.to);
      if (cIdx == null) continue;
      const c = vertices[cIdx];

      const outAng = angleOf(b, c);

      // clockwise turn amount from inAng to outAng
      // clockwise turn = (inAng - outAng) mod 2pi
      const turn = normAngle(inAng - outAng);

      if (best == null) {
        best = candId;
        bestTurn = turn;
        continue;
      }

      if (turn < bestTurn - 1e-12) {
        best = candId;
        bestTurn = turn;
        continue;
      }

      // tie-break: smaller half-edge id
      if (Math.abs(turn - bestTurn) <= 1e-12 && candId < best) {
        best = candId;
        bestTurn = turn;
      }
    }

    // If all candidates are the same edge or invalid, fallback to smallest id
    if (best == null) best = candidates[0];

    return best;
  }

  let nextLoopId = 0;

  for (const startHeId of boundaryHalfEdges) {
    if (visitedBoundary.has(startHeId)) continue;

    const loopHalfEdges = [];
    const loopVertexIds = [];

    let cur = startHeId;
    let guard = 0;

    while (true) {
      assert(cur != null, "[CityMesh] invariant: boundary loop walk hit null.");
      assert(!visitedBoundary.has(cur), "[CityMesh] invariant: boundary loop revisits edge before closure.");
      visitedBoundary.add(cur);

      const he = halfEdges[cur];
      loopHalfEdges.push(cur);
      loopVertexIds.push(he.origin);

      const next = chooseNextBoundaryHalfEdge(cur);

      guard += 1;
      if (guard > boundaryHalfEdges.length + 5) {
        throw new Error("[CityMesh] invariant: boundary loop walk exceeded guard limit (non-closing loop).");
      }

      if (next === startHeId) {
        // close: include last vertex (origin of start already in list), stop
        break;
      }

      // If we got stuck, allow closure if current ends at start origin by direct segment selection.
      if (next == null) {
        throw new Error("[CityMesh] invariant: boundary loop walk had no outgoing candidate.");
      }

      cur = next;
    }

    // build polygon points from vertex ids
    const polygon = loopVertexIds.map((vid) => {
      const idx = vertexIdToIndex.get(vid);
      assert(idx != null, "[CityMesh] invariant: boundary loop references missing vertex.");
      return { x: vertices[idx].x, y: vertices[idx].y };
    });

    // Invariants: at least 3 edges
    assert(loopHalfEdges.length >= 3, "[CityMesh] invariant: boundary loop too small.");

    const areaSigned = polygonAreaSigned(polygon);
    const areaAbs = Math.abs(areaSigned);
    const centroid = polygonCentroid(polygon);

    const loopId = nextLoopId++;
    for (const heId of loopHalfEdges) {
      halfEdges[heId].boundaryLoop = loopId;
    }

    boundaryLoops.push({
      id: loopId,
      halfEdges: loopHalfEdges,
      vertexIds: loopVertexIds,
      polygon,
      areaAbs,
      centroid,
    });
  }

  // Every boundary half-edge must be assigned to exactly one loop
  for (const heId of boundaryHalfEdges) {
    const he = halfEdges[heId];
    if (he.boundaryLoop == null) {
      throw new Error("[CityMesh] invariant: boundary half-edge not assigned to a loop.");
    }
  }

  // ---- Final strict checks on face loops and twin symmetry ----
  for (const face of faces) {
    assert(face.halfEdges.length >= 3, `[CityMesh] invariant: face ${face.id} has too few half-edges.`);
    // Check loop closure by walking next pointers exactly n steps
    const start = face.anyHalfEdge;
    let cur = start;
    for (let i = 0; i < face.halfEdges.length; i++) {
      const he = halfEdges[cur];
      assert(he && he.face === face.id, `[CityMesh] invariant: face ${face.id} loop walk left face.`);
      cur = he.next;
      assert(cur != null && cur >= 0, `[CityMesh] invariant: face ${face.id} has invalid next pointer.`);
    }
    assert(cur === start, `[CityMesh] invariant: face ${face.id} loop does not close.`);
  }

  for (const he of halfEdges) {
    if (he.twin != null) {
      const t = halfEdges[he.twin];
      assert(t, "[CityMesh] invariant: twin references missing half-edge.");
      assert(t.twin === he.id, "[CityMesh] invariant: twin symmetry failed.");
      assert(t.edgeId === he.edgeId, "[CityMesh] invariant: twin edgeId mismatch.");
      assert(t.origin === he.to && t.to === he.origin, "[CityMesh] invariant: twin direction mismatch.");
    }
  }

  const mesh = {
    vertices,
    halfEdges,
    faces,
    boundaryLoops,
    edgeToHalfEdges,
    meta: {
      source: "vorGraph",
      vertexCount: vertices.length,
      faceCount: faces.length,
      halfEdgeCount: halfEdges.length,
      boundaryLoopCount: boundaryLoops.length,
    },
  };

  return mesh;
}
