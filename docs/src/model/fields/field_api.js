// docs/src/model/fields/field_api.js
//
// Milestone 4.8: Field sampling API.
//
// Provides:
// - sampleScalar(p, fieldName, opts)
// - sampleVector(p, fieldName, opts)
//
// This file is intentionally conservative and deterministic.
// It does NOT guess spatial indexing. It requires meshAccess to provide
// a deterministic point-to-face mapping when sampling by point.
//
// Expected meshAccess hooks (you will add when ready):
// - pointToFaceId(p) -> faceId
//
// Optional (future, for better interpolation):
// - faceTriangulation(faceId) -> [{a:vertexId,b:vertexId,c:vertexId, ax,ay,bx,by,cx,cy}, ...]
// - vertexXY(vertexId) -> {x,y}
//
// For now:
// - sampleScalar prefers face fields if present.
// - If only a vertex field exists, it reduces over the face boundary vertices.
// - sampleVector supports a derived "to_plaza" vector using anchors (no mesh needed).

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function isFiniteXY(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return (Number(id) | 0);
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

/**
 * Deterministic reduction of a vertex field over a face boundary.
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {object} args.vertexFieldRecord - {values:Float64Array, min:number, max:number, spec:{...}}
 * @param {number|string} args.faceId
 * @param {"min"|"mean"|"max"} args.mode
 * @param {function(number|string): number} args.vertexIdToIndex - maps vertexId -> dense index in vertexFieldRecord.values
 */
function reduceVertexFieldOverFaceBoundary(args) {
  const ma = args.meshAccess;
  assert(typeof ma.faceBoundaryVertexIds === "function", "meshAccess.faceBoundaryVertexIds(faceId) is required to sample a vertex field by point.");
  const boundary = ma.faceBoundaryVertexIds(args.faceId);
  assert(Array.isArray(boundary) && boundary.length >= 3, "faceBoundaryVertexIds(faceId) must return an array of >= 3 vertex ids.");

  const values = args.vertexFieldRecord.values;
  const mode = args.mode || "min";

  let acc = 0;
  let count = 0;
  let bestMin = Infinity;
  let bestMax = -Infinity;

  for (let i = 0; i < boundary.length; i++) {
    const vId = boundary[i];
    const idx = args.vertexIdToIndex(vId);
    const v = values[idx];
    assert(Number.isFinite(v), "Vertex field values must be finite.");

    if (v < bestMin) bestMin = v;
    if (v > bestMax) bestMax = v;

    acc += v;
    count++;
  }

  if (mode === "min") return bestMin;
  if (mode === "max") return bestMax;
  return acc / count;
}

/**
 * Build a dense index mapping for vertex ids for use with vertex-domain fields.
 * Deterministic as long as meshAccess.iterVertexIds is stable.
 *
 * @param {object} meshAccess
 * @returns {function(number|string): number} vertexIdToIndex
 */
export function makeVertexIdToIndex(meshAccess) {
  assert(meshAccess && typeof meshAccess.getVertexCount === "function", "makeVertexIdToIndex requires meshAccess.getVertexCount().");
  const n = meshAccess.getVertexCount();

  const ids = [];
  if (typeof meshAccess.iterVertexIds === "function") {
    for (const vId of meshAccess.iterVertexIds()) ids.push(toIntId(vId, "vertex"));
  } else {
    for (let i = 0; i < n; i++) ids.push(i);
  }

  assert(ids.length === n, `iterVertexIds length ${ids.length} does not match vertexCount ${n}.`);

  const map = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    assert(!map.has(id), `Duplicate vertex id in iterVertexIds: ${id}`);
    map.set(id, i);
  }

  return function vertexIdToIndex(vId) {
    const id = toIntId(vId, "vertex");
    const idx = map.get(id);
    assert(idx != null, `Unknown vertex id: ${id}`);
    return idx;
  };
}

/**
 * Sample a scalar field at point p.
 *
 * Deterministic requirements:
 * - meshAccess.pointToFaceId(p) must be deterministic (stable tie-breaks).
 *
 * Behaviour:
 * - If the named field is face-domain, return faceValues[faceIdx].
 * - Else if it is vertex-domain, reduce over the containing face boundary (min/mean/max).
 *
 * @param {object} args
 * @param {{x:number,y:number}} args.p
 * @param {string} args.name
 * @param {object} args.fields - FieldRegistry
 * @param {object} args.meshAccess
 * @param {"min"|"mean"|"max"} [args.vertexReduceMode="min"]
 * @param {function(number|string): number} [args.vertexIdToIndex] - if omitted, it will be built
 * @returns {number}
 */
export function sampleScalar(args) {
  assert(args && args.fields && args.meshAccess, "sampleScalar requires fields and meshAccess.");
  assert(isFiniteXY(args.p), "sampleScalar requires p = {x,y} with finite numbers.");
  assert(typeof args.name === "string" && args.name.length > 0, "sampleScalar requires a non-empty field name.");

  const ma = args.meshAccess;
  assert(typeof ma.pointToFaceId === "function", "sampleScalar requires meshAccess.pointToFaceId(p). Add it when you implement spatial lookup.");

  const faceId = ma.pointToFaceId(args.p);
  const fId = toIntId(faceId, "face");

  const rec = args.fields.get(args.name);
  const domain = rec.spec && rec.spec.domain;

  if (domain === "face") {
    // Face fields are stored in dense face order (iterFaceIds or 0..N-1).
    // We require meshAccess.faceIdToIndex(faceId) OR dense ids for now.
    if (typeof ma.faceIdToIndex === "function") {
      const idx = ma.faceIdToIndex(fId);
      return rec.values[idx];
    }
    // Fallback: assume face id is dense index
    assert(fId >= 0 && fId < rec.values.length, `Face id out of range for face field "${args.name}": ${fId}`);
    return rec.values[fId];
  }

  if (domain === "vertex") {
    const vertexIdToIndex = args.vertexIdToIndex || makeVertexIdToIndex(ma);
    const mode = args.vertexReduceMode || "min";
    return reduceVertexFieldOverFaceBoundary({
      meshAccess: ma,
      vertexFieldRecord: rec,
      faceId: fId,
      mode,
      vertexIdToIndex,
    });
  }

  throw new Error(`Unsupported field domain for "${args.name}": ${String(domain)}`);
}

/**
 * Sample a vector field at point p.
 *
 * v1 support:
 * - name === "to_plaza": returns a unit vector pointing from p to the plaza anchor.
 *   Requires args.anchors.plaza = {x,y}.
 *
 * Future support:
 * - true vector fields stored in FieldRegistry + mesh interpolation.
 *
 * @param {object} args
 * @param {{x:number,y:number}} args.p
 * @param {string} args.name
 * @param {object} [args.anchors] - { plaza?: {x,y} }
 * @returns {{x:number,y:number}}
 */
export function sampleVector(args) {
  assert(args, "sampleVector requires args.");
  assert(isFiniteXY(args.p), "sampleVector requires p = {x,y} with finite numbers.");
  assert(typeof args.name === "string" && args.name.length > 0, "sampleVector requires a non-empty name.");

  const p = args.p;

  if (args.name === "to_plaza") {
    const plaza = args.anchors && args.anchors.plaza;
    assert(plaza && Number.isFinite(plaza.x) && Number.isFinite(plaza.y), 'sampleVector("to_plaza") requires anchors.plaza = {x,y}.');

    const dx = plaza.x - p.x;
    const dy = plaza.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len <= 0) return { x: 0, y: 0 };
    const inv = 1 / len;

    // Clamp to avoid -0 due to float sign noise.
    const vx = dx * inv;
    const vy = dy * inv;
    return { x: vx === 0 ? 0 : vx, y: vy === 0 ? 0 : vy };
  }

  throw new Error(`Unsupported vector field name: ${args.name}`);
}

/**
 * Convenience: normalised scalar sample in [0,1].
 * This uses the field's min/max metadata and clamps.
 *
 * @param {object} args - same as sampleScalar, plus {fields}
 * @returns {number}
 */
export function sampleScalar01(args) {
  const v = sampleScalar(args);
  const rec = args.fields.get(args.name);
  const den = rec.max - rec.min;
  if (den <= 0) return 0;
  return clamp01((v - rec.min) / den);
}
