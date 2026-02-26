// docs/src/model/fields/compute_fields.js
//
// Milestone 4.8 entry point: compute deterministic scalar fields over CityMesh.
//
// This file is intentionally conservative:
// - It does NOT guess CityMesh internal shape.
// - It requires an explicit "meshAccess" adapter so field computation is stable,
//   auditable, and decoupled from mesh implementation details.
// - For now, it computes no fields by default and returns an empty registry,
//   unless you provide compute callbacks.
//
// Next steps (later files) will provide a concrete meshAccess adapter for your CityMesh.

import { FieldRegistry } from "./field_registry.js";
import { FieldDomain } from "./field_types.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * @typedef {object} MeshAccess
 * @property {function(): number} getFaceCount
 * @property {function(): number} getVertexCount
 *
 * Optional helpers you will likely implement later:
 * @property {function(): Iterable<number>} [iterVertexIds]            - Stable vertex id order
 * @property {function(number): Iterable<{to:number, w:number}>} [vertexNeighboursWeighted]
 * @property {function(): Iterable<number>} [iterFaceIds]              - Stable face id order
 * @property {function(number): Iterable<number>} [faceBoundaryVertexIds]
 */

/**
 * @typedef {object} FieldComputeSpec
 * @property {string} name
 * @property {"face"|"vertex"} domain
 * @property {number} [version]
 * @property {string} [units]
 * @property {string} [description]
 * @property {string} [source]
 * @property {function(object): Float64Array|Array<number>} compute
 */

/**
 * Computes all requested fields and returns a registry.
 *
 * You can call this with an empty computeSpecs array to get an empty registry
 * with correct domain sizes. That is safe and deterministic.
 *
 * @param {object} args
 * @param {any} args.cityMesh
 * @param {MeshAccess} args.meshAccess
 * @param {any} [args.anchors]
 * @param {any} [args.water]
 * @param {any} [args.walls]
 * @param {any} [args.params]
 * @param {Array<FieldComputeSpec>} [args.computeSpecs]
 * @returns {FieldRegistry}
 */
export function computeAllFields(args) {
  assert(args && args.meshAccess, "computeAllFields requires args.meshAccess.");
  const ma = args.meshAccess;

  assert(typeof ma.getFaceCount === "function", "meshAccess.getFaceCount must be a function.");
  assert(typeof ma.getVertexCount === "function", "meshAccess.getVertexCount must be a function.");

  const faceCount = ma.getFaceCount();
  const vertexCount = ma.getVertexCount();

  assert(Number.isFinite(faceCount) && faceCount >= 0, `Invalid faceCount: ${faceCount}`);
  assert(Number.isFinite(vertexCount) && vertexCount >= 0, `Invalid vertexCount: ${vertexCount}`);

  const registry = new FieldRegistry({ faceCount, vertexCount });

  const specs = Array.isArray(args.computeSpecs) ? args.computeSpecs : [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    assert(spec && typeof spec.name === "string" && spec.name.length > 0, `computeSpecs[${i}] is missing a valid name.`);
    assert(spec.domain === FieldDomain.FACE || spec.domain === FieldDomain.VERTEX, `computeSpecs[${i}] has invalid domain: ${spec.domain}`);
    assert(typeof spec.compute === "function", `computeSpecs[${i}] must include a compute(...) function.`);

    const values = spec.compute({
      cityMesh: args.cityMesh,
      meshAccess: ma,
      anchors: args.anchors,
      water: args.water,
      walls: args.walls,
      params: args.params,
    });

    registry.add(
      {
        name: spec.name,
        domain: spec.domain,
        version: spec.version,
        units: spec.units,
        description: spec.description,
        source: spec.source,
      },
      values
    );
  }

  return registry;
}
