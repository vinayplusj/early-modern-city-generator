// docs/src/model/fields/mesh_access_from_city_mesh.js
//
// Adapter to expose stable counts and deterministic traversals from CityMesh,
// without importing mesh internals.
//
// Added for Milestone 4.8:
// - vertexNeighboursWeighted(vId): deterministic weighted neighbours for Dijkstra
// - faceBoundaryVertexIds(faceId): deterministic boundary vertex loop for face-derived fields
//
// This module is intentionally conservative:
// - It does NOT mutate the mesh.
// - It only reads properties/methods.
// - It throws with clear messages if it cannot infer required structures.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFiniteNonNegInt(n) {
  return Number.isFinite(n) && (n | 0) === n && n >= 0;
}

function getArrayLen(obj, propName) {
  const v = obj[propName];
  if (Array.isArray(v) || (v && typeof v.length === "number")) return v.length | 0;
  return null;
}

function tryCallCountFn(obj, fnName) {
  const fn = obj[fnName];
  if (typeof fn !== "function") return null;
  const n = fn.call(obj);
  if (!Number.isFinite(n)) return null;
  return n | 0;
}

function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    // Accept strictly-integer strings only.
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return (Number(id) | 0);
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

function getXYFromVertex(v) {
  // Common shapes: {x,y} OR {p:{x,y}} OR {pos:{x,y}}
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y };
  if (v && v.p && Number.isFinite(v.p.x) && Number.isFinite(v.p.y)) return { x: v.p.x, y: v.p.y };
  if (v && v.pos && Number.isFinite(v.pos.x) && Number.isFinite(v.pos.y)) return { x: v.pos.x, y: v.pos.y };
  return null;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pickArrayOrNull(obj, a, b) {
  if (Array.isArray(obj[a])) return obj[a];
  if (Array.isArray(obj[b])) return obj[b];
  return null;
}

function buildIdIndexMap(arr, label) {
  // Returns Map<intId, index> if elements have .id, else null.
  if (!arr || arr.length === 0) return null;
  const e0 = arr[0];
  if (!e0 || (typeof e0.id !== "number" && typeof e0.id !== "string")) return null;

  const map = new Map();
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    assert(e && (typeof e.id === "number" || typeof e.id === "string"), `${label}[${i}] missing .id`);
    const id = toIntId(e.id, label);
    assert(!map.has(id), `Duplicate ${label} id: ${id}`);
    map.set(id, i);
  }
  return map;
}

function resolveById(arr, idIndexMap, id, label) {
  const intId = toIntId(id, label);
  if (idIndexMap) {
    const idx = idIndexMap.get(intId);
    assert(idx != null, `Unknown ${label} id: ${intId}`);
    return arr[idx];
  }
  // Fallback: assume ids are dense indices.
  assert(intId >= 0 && intId < arr.length, `Out-of-range ${label} index: ${intId}`);
  return arr[intId];
}

function getHalfEdgesArray(cityMesh) {
  // Common shapes
  const hes =
    pickArrayOrNull(cityMesh, "halfEdges", "_halfEdges") ??
    pickArrayOrNull(cityMesh, "half_edges", "_half_edges") ??
    null;

  return hes;
}

function getFacesArray(cityMesh) {
  return pickArrayOrNull(cityMesh, "faces", "_faces");
}

function getVerticesArray(cityMesh) {
  return pickArrayOrNull(cityMesh, "vertices", "_vertices");
}

function getHalfEdgeOriginId(he) {
  // Common fields: origin, from, v0, a
  if (he && (he.origin != null)) return he.origin;
  if (he && (he.from != null)) return he.from;
  if (he && (he.v0 != null)) return he.v0;
  if (he && (he.a != null)) return he.a;
  return null;
}

function getHalfEdgeDestId(he, halfEdgesById) {
  // Common fields: to, dest, v1, b
  if (he && (he.to != null)) return he.to;
  if (he && (he.dest != null)) return he.dest;
  if (he && (he.v1 != null)) return he.v1;
  if (he && (he.b != null)) return he.b;

  // DCEL-style: dest = he.twin.origin
  if (he && he.twin != null) {
    const twin = resolveHalfEdge(he.twin, halfEdgesById);
    const o = getHalfEdgeOriginId(twin);
    if (o != null) return o;
  }
  return null;
}

function resolveHalfEdge(heRef, halfEdgesById) {
  // heRef may be: object, numeric id, or string id
  if (heRef && typeof heRef === "object") return heRef;
  const intId = toIntId(heRef, "halfEdge");
  const he = halfEdgesById.get(intId);
  assert(he, `Unknown halfEdge id: ${intId}`);
  return he;
}

function getHalfEdgeNextRef(he) {
  // Common: next
  if (he && he.next != null) return he.next;
  return null;
}

function getFaceBoundaryHalfEdgeRef(face) {
  // Common: halfEdge, edge, outer, boundary
  if (face && face.halfEdge != null) return face.halfEdge;
  if (face && face.edge != null) return face.edge;
  if (face && face.outer != null) return face.outer;
  if (face && face.boundary != null) return face.boundary;
  return null;
}

/**
 * Create a MeshAccess adapter for fields computation.
 *
 * Required:
 * - getFaceCount(): number
 * - getVertexCount(): number
 *
 * Optional:
 * - iterFaceIds(): Iterable<number> in stable order
 * - iterVertexIds(): Iterable<number> in stable order
 *
 * Added (4.8):
 * - vertexNeighboursWeighted(vId): Iterable<{to:number, w:number}>
 * - faceBoundaryVertexIds(faceId): Iterable<number>
 *
 * @param {any} cityMesh
 * @returns {object} meshAccess
 */
export function makeMeshAccessFromCityMesh(cityMesh) {
  assert(cityMesh, "makeMeshAccessFromCityMesh requires a cityMesh object.");

  // --- Face count inference (deterministic, explicit-first) ---
  let faceCount =
    tryCallCountFn(cityMesh, "getFaceCount") ??
    tryCallCountFn(cityMesh, "faceCount") ??
    getArrayLen(cityMesh, "faces") ??
    getArrayLen(cityMesh, "_faces") ??
    null;

  // Faces may be a Map.
  if (faceCount == null && cityMesh.faces && typeof cityMesh.faces.size === "number") {
    faceCount = cityMesh.faces.size | 0;
  }

  // --- Vertex count inference ---
  let vertexCount =
    tryCallCountFn(cityMesh, "getVertexCount") ??
    tryCallCountFn(cityMesh, "vertexCount") ??
    getArrayLen(cityMesh, "vertices") ??
    getArrayLen(cityMesh, "_vertices") ??
    null;

  // Vertices may be a Map.
  if (vertexCount == null && cityMesh.vertices && typeof cityMesh.vertices.size === "number") {
    vertexCount = cityMesh.vertices.size | 0;
  }

  assert(
    isFiniteNonNegInt(faceCount),
    "Could not infer faceCount from cityMesh. Expected faces array, faces Map, or a faceCount/getFaceCount method."
  );
  assert(
    isFiniteNonNegInt(vertexCount),
    "Could not infer vertexCount from cityMesh. Expected vertices array, vertices Map, or a vertexCount/getVertexCount method."
  );

  const meshAccess = {
    getFaceCount() {
      return faceCount;
    },
    getVertexCount() {
      return vertexCount;
    },
  };

  // --- Stable arrays (if present) ---
  const facesArr = getFacesArray(cityMesh);
  const vertsArr = getVerticesArray(cityMesh);
  const halfEdgesArr = getHalfEdgesArray(cityMesh);

  // --- Optional stable id iterators ---
  const faceIdToIndex = facesArr ? buildIdIndexMap(facesArr, "face") : null;
  const vertIdToIndex = vertsArr ? buildIdIndexMap(vertsArr, "vertex") : null;

  if (facesArr) {
    if (faceIdToIndex) {
      meshAccess.iterFaceIds = function* iterFaceIds() {
        // Preserve array order (assumes mesh construction order is deterministic).
        for (let i = 0; i < facesArr.length; i++) yield toIntId(facesArr[i].id, "face");
      };
    } else {
      meshAccess.iterFaceIds = function* iterFaceIds() {
        for (let i = 0; i < faceCount; i++) yield i;
      };
    }
  }

  if (vertsArr) {
    if (vertIdToIndex) {
      meshAccess.iterVertexIds = function* iterVertexIds() {
        for (let i = 0; i < vertsArr.length; i++) yield toIntId(vertsArr[i].id, "vertex");
      };
    } else {
      meshAccess.iterVertexIds = function* iterVertexIds() {
        for (let i = 0; i < vertexCount; i++) yield i;
      };
    }
  }
  
  // =========================
  // 4.8: Neighbour traversal
  // =========================

  // We only provide neighbour traversal if we can safely infer half-edges and vertex coordinates.
  // If not available, we still return meshAccess with counts/iterators, and Dijkstra should throw
  // with a clear message when neighbour traversal is requested.

  let halfEdgeIdToIndex = null;
  let halfEdgesById = null;

  if (halfEdgesArr) {
    halfEdgeIdToIndex = buildIdIndexMap(halfEdgesArr, "halfEdge");
    halfEdgesById = new Map();
    if (halfEdgeIdToIndex) {
      for (let i = 0; i < halfEdgesArr.length; i++) {
        const he = halfEdgesArr[i];
        halfEdgesById.set(toIntId(he.id, "halfEdge"), he);
      }
    } else {
      // If there is no .id, fall back to treating array index as id.
      for (let i = 0; i < halfEdgesArr.length; i++) halfEdgesById.set(i, halfEdgesArr[i]);
    }
  }

  // Precompute vertex coords (if possible) for deterministic weights.
  let vertexXY = null; // Array<{x,y}|null> indexed by vertex array index
  if (vertsArr) {
    vertexXY = new Array(vertsArr.length);
    for (let i = 0; i < vertsArr.length; i++) {
      const xy = getXYFromVertex(vertsArr[i]);
      vertexXY[i] = xy;
    }
  }
  
  // --- Required by field_sources.pickNearestVertexId(...) ---
  if (vertsArr && vertexXY) {
    const vertexXYArr = vertexXY;
  
    meshAccess.vertexXY = function vertexXYFn(vIdRaw) {
      const vId = toIntId(vIdRaw, "vertex");
  
      // If vertices have explicit ids, map id -> array index.
      // Otherwise treat vId as the array index.
      const idx = vertIdToIndex ? vertIdToIndex.get(vId) : vId;
  
      assert(Number.isInteger(idx), `meshAccess.vertexXY: cannot map vertex id ${vId} to an index.`);
      assert(idx >= 0 && idx < vertexXYArr.length, `meshAccess.vertexXY: index out of range for vId ${vId} (idx=${idx}).`);
  
      const xy = vertexXYArr[idx];
      assert(xy && Number.isFinite(xy.x) && Number.isFinite(xy.y), `meshAccess.vertexXY: missing/invalid coords for vId ${vId}.`);
      return xy;
    };
  }
  
  function requireHalfEdges() {
    assert(halfEdgesArr && halfEdgesById, "CityMesh halfEdges are required for neighbour traversal, but could not be inferred (expected cityMesh.halfEdges or cityMesh._halfEdges).");
  }

  function requireVertexArray() {
    assert(vertsArr, "CityMesh vertices array is required for neighbour traversal, but could not be inferred (expected cityMesh.vertices or cityMesh._vertices).");
  }

  function requireVertexXY() {
    requireVertexArray();
    // Ensure we have coordinates for all vertices we might use.
    for (let i = 0; i < vertsArr.length; i++) {
      assert(vertexXY[i], `Vertex at index ${i} is missing coordinates (expected {x,y} or {p:{x,y}}).`);
    }
  }

  // Build deterministic adjacency once, if possible.
  let adjacency = null; // Map<intVertexId, Array<{to:intVertexId, w:number}>>

  function buildAdjacencyOnce() {
    if (adjacency) return adjacency;
    requireHalfEdges();
    requireVertexXY();

    adjacency = new Map();

    // Deterministic initialisation: include all vertex ids (even isolated) in stable order.
    if (meshAccess.iterVertexIds) {
      for (const vid of meshAccess.iterVertexIds()) adjacency.set(toIntId(vid, "vertex"), []);
    } else {
      for (let i = 0; i < vertexCount; i++) adjacency.set(i, []);
    }

    // Add undirected edges by iterating half-edges once.
    // To avoid duplicates, only add when (originId <= destId) with a stable tie-break.
    // This ensures determinism even if halfEdges include both directions.
    for (let i = 0; i < halfEdgesArr.length; i++) {
      const he = halfEdgesArr[i];

      const oRaw = getHalfEdgeOriginId(he);
      if (oRaw == null) continue; // skip incomplete halfEdges
      const oId = toIntId(oRaw, "vertex");

      const dRaw = getHalfEdgeDestId(he, halfEdgesById);
      if (dRaw == null) continue;
      const dId = toIntId(dRaw, "vertex");

      if (oId === dId) continue;

      // Resolve vertex array indices for coords.
      // If vertices have explicit ids, map id->index. Else treat id as array index.
      const oi = vertIdToIndex ? vertIdToIndex.get(oId) : oId;
      const di = vertIdToIndex ? vertIdToIndex.get(dId) : dId;

      // If mapping fails, skip (but this should not happen in a valid mesh).
      if (oi == null || di == null) continue;

      const a = vertexXY[oi];
      const b = vertexXY[di];
      if (!a || !b) continue;

      const w = Math.sqrt(dist2(a, b));

      // Canonical add: enforce a stable undirected representation.
      const lo = oId < dId ? oId : dId;
      const hi = oId < dId ? dId : oId;

      // Add both directions once.
      const loList = adjacency.get(lo);
      const hiList = adjacency.get(hi);
      if (!loList || !hiList) continue;

      loList.push({ to: hi, w });
      hiList.push({ to: lo, w });
    }

    // Deterministic sort and dedupe each neighbour list.
    for (const [vid, list] of adjacency.entries()) {
      // Sort by neighbour id then by weight (weight should be identical for duplicates)
      list.sort((a, b) => (a.to - b.to) || (a.w - b.w));

      // Dedupe by neighbour id, keep the smallest weight (stable).
      const deduped = [];
      let lastTo = null;
      for (let k = 0; k < list.length; k++) {
        const item = list[k];
        if (lastTo === item.to) {
          // same neighbour; keep smaller weight (should match)
          const prev = deduped[deduped.length - 1];
          if (item.w < prev.w) prev.w = item.w;
          continue;
        }
        deduped.push({ to: item.to, w: item.w });
        lastTo = item.to;
      }
      adjacency.set(vid, deduped);
    }

    return adjacency;
  }

  meshAccess.vertexNeighboursWeighted = function vertexNeighboursWeighted(vId) {
    const vid = toIntId(vId, "vertex");
    const adj = buildAdjacencyOnce();
    const list = adj.get(vid);
    assert(list, `No adjacency list for vertex id: ${vid}`);
    return list;
  };

  // ==================================
  // 4.8: Face boundary vertex traversal
  // ==================================

  meshAccess.faceBoundaryVertexIds = function faceBoundaryVertexIds(faceId) {
    assert(facesArr, "faceBoundaryVertexIds requires cityMesh.faces (or cityMesh._faces) array.");
    requireHalfEdges();

    const face = resolveById(facesArr, faceIdToIndex, faceId, "face");
    const startRef = getFaceBoundaryHalfEdgeRef(face);
    assert(startRef != null, "Face is missing a boundary half-edge reference (expected face.halfEdge / face.edge / face.outer / face.boundary).");

    const startHE = resolveHalfEdge(startRef, halfEdgesById);
    let he = startHE;

    const out = [];
    const seenHE = new Set();

    // Walk next pointers until we return to start.
    // Hard cap prevents infinite loops in broken meshes.
    const hardCap = halfEdgesArr.length + 5;

    for (let steps = 0; steps < hardCap; steps++) {
      // Detect loops that do not close properly
      const heKey = he && he.id != null ? toIntId(he.id, "halfEdge") : null;
      if (heKey != null) {
        if (seenHE.has(heKey)) {
          // If we hit start again, stop; otherwise broken cycle.
          if (he === startHE) break;
          throw new Error("Face boundary traversal encountered a repeated half-edge before closure. Mesh loop invariant violated.");
        }
        seenHE.add(heKey);
      }

      const oRaw = getHalfEdgeOriginId(he);
      assert(oRaw != null, "Half-edge missing origin while traversing face boundary.");
      out.push(toIntId(oRaw, "vertex"));

      const nextRef = getHalfEdgeNextRef(he);
      assert(nextRef != null, "Half-edge missing .next while traversing face boundary.");
      he = resolveHalfEdge(nextRef, halfEdgesById);

      if (he === startHE) break;
    }

    assert(out.length >= 3, "Face boundary loop must have at least 3 vertices.");

    return out;
  };

  return meshAccess;
}
