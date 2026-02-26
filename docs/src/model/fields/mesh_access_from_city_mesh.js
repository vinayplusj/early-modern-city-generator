// docs/src/model/fields/mesh_access_from_city_mesh.js
//
// Minimal adapter to expose stable counts (and optional stable traversals)
// from the CityMesh implementation without importing mesh internals.
//
// This is intentionally conservative:
// - It does NOT mutate the mesh.
// - It only reads properties/methods.
// - It throws with clear messages if it cannot infer required counts.
//
// Later (once we wire real field computations), we can extend this adapter
// with neighbour iteration and boundary vertex traversal in a deterministic way.

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

/**
 * Create a MeshAccess adapter for fields computation.
 *
 * Required:
 * - getFaceCount(): number
 * - getVertexCount(): number
 *
 * Optional (only provided if they can be inferred safely):
 * - iterFaceIds(): Iterable<number> in stable order
 * - iterVertexIds(): Iterable<number> in stable order
 *
 * NOTE: For stability, iter* prefers explicit id fields if present.
 * If those are not available, it falls back to contiguous indices [0..N-1].
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

  // Some implementations store faces in a Map.
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

  if (vertexCount == null && cityMesh.vertices && typeof cityMesh.vertices.size === "number") {
    vertexCount = cityMesh.vertices.size | 0;
  }

  assert(isFiniteNonNegInt(faceCount), "Could not infer faceCount from cityMesh. Expected faces array, faces Map, or a faceCount/getFaceCount method.");
  assert(isFiniteNonNegInt(vertexCount), "Could not infer vertexCount from cityMesh. Expected vertices array, vertices Map, or a vertexCount/getVertexCount method.");

  const meshAccess = {
    getFaceCount() {
      return faceCount;
    },
    getVertexCount() {
      return vertexCount;
    },
  };

  // --- Optional stable id iterators ---
  // If faces/vertices are arrays and each element has a stable `id`, use that order.
  // Otherwise, return contiguous indices.
  const facesArr = Array.isArray(cityMesh.faces) ? cityMesh.faces : Array.isArray(cityMesh._faces) ? cityMesh._faces : null;
  const vertsArr = Array.isArray(cityMesh.vertices) ? cityMesh.vertices : Array.isArray(cityMesh._vertices) ? cityMesh._vertices : null;

  if (facesArr) {
    const hasId = facesArr.length > 0 && facesArr[0] && (typeof facesArr[0].id === "number" || typeof facesArr[0].id === "string");
    if (hasId) {
      meshAccess.iterFaceIds = function* iterFaceIds() {
        // Preserve array order; caller ensures mesh construction order is deterministic.
        for (let i = 0; i < facesArr.length; i++) yield facesArr[i].id;
      };
    } else {
      meshAccess.iterFaceIds = function* iterFaceIds() {
        for (let i = 0; i < faceCount; i++) yield i;
      };
    }
  }

  if (vertsArr) {
    const hasId = vertsArr.length > 0 && vertsArr[0] && (typeof vertsArr[0].id === "number" || typeof vertsArr[0].id === "string");
    if (hasId) {
      meshAccess.iterVertexIds = function* iterVertexIds() {
        for (let i = 0; i < vertsArr.length; i++) yield vertsArr[i].id;
      };
    } else {
      meshAccess.iterVertexIds = function* iterVertexIds() {
        for (let i = 0; i < vertexCount; i++) yield i;
      };
    }
  }

  return meshAccess;
}
