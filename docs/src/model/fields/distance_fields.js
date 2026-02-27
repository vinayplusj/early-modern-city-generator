// docs/src/model/fields/distance_fields.js
//
// Milestone 4.8: Base distance fields (vertex-domain) + deterministic face derivations.
//
// This module computes:
// - distance_to_plaza_vertex
// - distance_to_wall_vertex
// - distance_to_water_vertex
// and provides helpers to derive face fields from vertex fields.
//
// It relies on meshAccess providing:
// - getVertexCount()
// - getFaceCount()
// - iterVertexIds() (recommended; else assumes dense 0..N-1)
// - iterFaceIds() (recommended; else assumes dense 0..N-1)
// - vertexNeighboursWeighted(vId)  (required for Dijkstra)
// - faceBoundaryVertexIds(faceId)  (required for face derivation)
//
// It does NOT mutate cityMesh.

import { dijkstraVertexDistances } from "./dijkstra_vertex_distances.js";
import { FieldDomain } from "./field_types.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

function buildVertexIdIndex(meshAccess) {
  const n = meshAccess.getVertexCount();
  const ids = [];
  if (typeof meshAccess.iterVertexIds === "function") {
    for (const vId of meshAccess.iterVertexIds()) ids.push(toIntId(vId, "vertex"));
  } else {
    for (let i = 0; i < n; i++) ids.push(i);
  }
  assert(ids.length === n, `iterVertexIds length ${ids.length} does not match vertexCount ${n}.`);

  const idToIndex = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    assert(!idToIndex.has(id), `Duplicate vertex id in iterVertexIds: ${id}`);
    idToIndex.set(id, i);
  }
  return { ids, idToIndex };
}

function buildFaceIdIndex(meshAccess) {
  const n = meshAccess.getFaceCount();
  const ids = [];
  if (typeof meshAccess.iterFaceIds === "function") {
    for (const fId of meshAccess.iterFaceIds()) ids.push(toIntId(fId, "face"));
  } else {
    for (let i = 0; i < n; i++) ids.push(i);
  }
  assert(ids.length === n, `iterFaceIds length ${ids.length} does not match faceCount ${n}.`);

  const idToIndex = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    assert(!idToIndex.has(id), `Duplicate face id in iterFaceIds: ${id}`);
    idToIndex.set(id, i);
  }
  return { ids, idToIndex };
}

/**
 * Deterministically choose the nearest vertex id to a point.
 * Tie-break: smaller vertex id wins.
 *
 * meshAccess must provide:
 * - iterVertexIds()
 * - vertexXY(vId) => {x,y}   (you will add this later)
 *
 * For now this helper is UNUSED until you provide vertexXY in meshAccess.
 */
export function pickNearestVertexId(meshAccess, p) {
  assert(typeof meshAccess.iterVertexIds === "function", "pickNearestVertexId requires meshAccess.iterVertexIds().");
  assert(typeof meshAccess.vertexXY === "function", "pickNearestVertexId requires meshAccess.vertexXY(vId).");

  let bestId = null;
  let bestD2 = Infinity;

  for (const vIdRaw of meshAccess.iterVertexIds()) {
    const vId = toIntId(vIdRaw, "vertex");
    const xy = meshAccess.vertexXY(vId);
    assert(xy && Number.isFinite(xy.x) && Number.isFinite(xy.y), "meshAccess.vertexXY(vId) must return finite x,y.");

    const dx = xy.x - p.x;
    const dy = xy.y - p.y;
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2 || (d2 === bestD2 && (bestId == null || vId < bestId))) {
      bestD2 = d2;
      bestId = vId;
    }
  }

  assert(bestId != null, "pickNearestVertexId failed to select a vertex.");
  return bestId;
}

/**
 * Compute a vertex-distance field via multi-source Dijkstra.
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {Array<number|string>} args.sourceVertexIds
 * @param {number} [args.maxDistance]
 * @returns {Float64Array} length = vertexCount, ordered by meshAccess.iterVertexIds() or [0..N-1]
 */
export function computeVertexDistanceField(args) {
  assert(args && args.meshAccess, "computeVertexDistanceField requires args.meshAccess.");
  assert(Array.isArray(args.sourceVertexIds) && args.sourceVertexIds.length > 0, "computeVertexDistanceField requires non-empty sourceVertexIds.");

  return dijkstraVertexDistances({
    meshAccess: args.meshAccess,
    sources: args.sourceVertexIds,
    maxDistance: args.maxDistance,
  });
}

/**
 * Derive a face scalar field from a vertex scalar field using a deterministic reduction
 * over the face boundary loop vertex ids.
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {Float64Array} args.vertexValues - length = vertexCount, in the same order as iterVertexIds
 * @param {"min"|"mean"|"max"} args.mode
 * @returns {Float64Array} length = faceCount, in the same order as iterFaceIds
 */
export function deriveFaceFieldFromBoundaryVertices(args) {
  assert(args && args.meshAccess, "deriveFaceFieldFromBoundaryVertices requires args.meshAccess.");
  const ma = args.meshAccess;

  assert(args.vertexValues instanceof Float64Array, "deriveFaceFieldFromBoundaryVertices requires vertexValues as Float64Array.");
  assert(typeof ma.faceBoundaryVertexIds === "function", "meshAccess.faceBoundaryVertexIds(faceId) is required.");
  const mode = args.mode || "min";
  assert(mode === "min" || mode === "mean" || mode === "max", `Unsupported mode: ${mode}`);

  const { idToIndex: vIdToIdx } = buildVertexIdIndex(ma);
  const { ids: faceIds } = buildFaceIdIndex(ma);

  const out = new Float64Array(faceIds.length);

  for (let fi = 0; fi < faceIds.length; fi++) {
    const faceId = faceIds[fi];
    const b = ma.faceBoundaryVertexIds(faceId);
    assert(Array.isArray(b) && b.length >= 3, `faceBoundaryVertexIds(${faceId}) must return an array of >= 3 vertex ids.`);

    let acc = 0;
    let count = 0;

    let bestMin = Infinity;
    let bestMax = -Infinity;

    for (let k = 0; k < b.length; k++) {
      const vId = toIntId(b[k], "vertex");
      const vIdx = vIdToIdx.get(vId);
      assert(vIdx != null, `Boundary vertex id ${vId} not found in vertex id index.`);
      const v = args.vertexValues[vIdx];
      assert(Number.isFinite(v), "vertexValues must be finite.");

      if (v < bestMin) bestMin = v;
      if (v > bestMax) bestMax = v;

      acc += v;
      count++;
    }

    if (mode === "min") out[fi] = bestMin;
    else if (mode === "max") out[fi] = bestMax;
    else out[fi] = acc / count;
  }

  return out;
}

/**
 * Build computeSpecs entries for base distance fields.
 * This keeps stage code small and keeps naming consistent.
 *
 * NOTE: Plaza / wall / water source selection is intentionally NOT guessed here.
 * You must pass explicit source vertex ids, otherwise this throws.
 */

/**
 * @param {Array<number|string>} sourceVertexIds
 * @returns {object} computeSpec
 */
export function makeDistanceToPlazaVertexSpec(sourceVertexIds) {
  assert(Array.isArray(sourceVertexIds) && sourceVertexIds.length > 0, "makeDistanceToPlazaVertexSpec requires sourceVertexIds.");
  return {
    name: "distance_to_plaza_vertex",
    domain: FieldDomain.VERTEX,
    version: 1,
    units: "map_units",
    description: "Shortest-path distance on the vertex graph to plaza sources.",
    source: "dijkstra(vertexGraph, plazaSources)",
    compute({ meshAccess }) {
      return computeVertexDistanceField({ meshAccess, sourceVertexIds });
    },
  };
}

export function makeDistanceToWallVertexSpec(sourceVertexIds) {
  assert(Array.isArray(sourceVertexIds) && sourceVertexIds.length > 0, "makeDistanceToWallVertexSpec requires sourceVertexIds.");
  return {
    name: "distance_to_wall_vertex",
    domain: FieldDomain.VERTEX,
    version: 1,
    units: "map_units",
    description: "Shortest-path distance on the vertex graph to wall boundary sources.",
    source: "dijkstra(vertexGraph, wallSources)",
    compute({ meshAccess }) {
      return computeVertexDistanceField({ meshAccess, sourceVertexIds });
    },
  };
}

export function makeDistanceToWaterVertexSpec(sourceVertexIds) {
  assert(Array.isArray(sourceVertexIds) && sourceVertexIds.length > 0, "makeDistanceToWaterVertexSpec requires sourceVertexIds.");
  return {
    name: "distance_to_water_vertex",
    domain: FieldDomain.VERTEX,
    version: 1,
    units: "map_units",
    description: "Shortest-path distance on the vertex graph to water-adjacent sources.",
    source: "dijkstra(vertexGraph, waterSources)",
    compute({ meshAccess }) {
      return computeVertexDistanceField({ meshAccess, sourceVertexIds });
    },
  };
}

/**
 * Convenience: derive a face field spec from an existing vertex field.
 *
 * @param {string} vertexFieldName
 * @param {string} faceFieldName
 * @param {"min"|"mean"|"max"} mode
 */
export function makeDerivedFaceFieldSpec(vertexFieldName, faceFieldName, mode) {
  assert(vertexFieldName && faceFieldName, "makeDerivedFaceFieldSpec requires names.");
  return {
    name: faceFieldName,
    domain: FieldDomain.FACE,
    version: 1,
    units: "map_units",
    description: `Derived from ${vertexFieldName} using boundary ${mode}.`,
    source: `deriveFaceFieldFromBoundaryVertices(${vertexFieldName}, ${mode})`,
    compute({ meshAccess, fieldsSoFar }) {
      // Stage code must pass fieldsSoFar (a FieldRegistry) if you want to use this pattern.
      assert(fieldsSoFar && typeof fieldsSoFar.get === "function", "Derived face spec requires fieldsSoFar (FieldRegistry).");
      const rec = fieldsSoFar.get(vertexFieldName);
      return deriveFaceFieldFromBoundaryVertices({ meshAccess, vertexValues: rec.values, mode });
    },
  };
}
