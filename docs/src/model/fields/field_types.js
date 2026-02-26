// docs/src/model/fields/field_types.js
// Shared, dependency-free types and helpers for deterministic scalar fields over CityMesh.
//
// This file is intentionally small and stable. It should not import from other modules.

export const FieldDomain = Object.freeze({
  FACE: "face",
  VERTEX: "vertex",
});

/**
 * @typedef {object} ScalarFieldSpec
 * @property {string} name               - Unique field name (registry key).
 * @property {"face"|"vertex"} domain    - Field domain.
 * @property {number} [version]          - Integer >= 1. Defaults to 1.
 * @property {string} [units]            - Optional units label.
 * @property {string} [description]      - Optional short description.
 * @property {string} [source]           - Optional provenance string (for audits).
 */

/**
 * @typedef {object} ScalarFieldRecord
 * @property {object} spec
 * @property {Float64Array} values
 * @property {number} min
 * @property {number} max
 */

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Computes min/max and asserts all values are finite.
 * @param {Float64Array} arr
 * @returns {{min:number, max:number}}
 */
export function computeMinMax(arr) {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    assert(Number.isFinite(v), `Field value is not finite at index ${i}: ${v}`);
    if (v < min) min = v;
    if (v > max) max = v;
  }

  assert(min !== Infinity, "Field array is empty; cannot compute min/max.");
  return { min, max };
}

/**
 * Defensive, frozen spec normalisation.
 * @param {ScalarFieldSpec} spec
 * @returns {Readonly<ScalarFieldSpec>}
 */
export function freezeScalarFieldSpec(spec) {
  const s = {
    name: String(spec.name),
    domain: String(spec.domain),
    version: spec.version == null ? 1 : Number(spec.version),
    units: spec.units == null ? "" : String(spec.units),
    description: spec.description == null ? "" : String(spec.description),
    source: spec.source == null ? "" : String(spec.source),
  };

  assert(s.name.length > 0, "Field spec.name must be a non-empty string.");
  assert(s.domain === FieldDomain.FACE || s.domain === FieldDomain.VERTEX, `Invalid field spec.domain: ${s.domain}`);
  assert(Number.isFinite(s.version) && s.version >= 1, `Field spec.version must be >= 1; got ${s.version}`);

  return Object.freeze(s);
}

/**
 * Returns the expected array length for a field domain.
 * @param {"face"|"vertex"} domain
 * @param {{faceCount:number, vertexCount:number}} sizes
 */
export function expectedLengthForDomain(domain, sizes) {
  if (domain === FieldDomain.FACE) return sizes.faceCount;
  if (domain === FieldDomain.VERTEX) return sizes.vertexCount;
  throw new Error(`Unknown field domain: ${String(domain)}`);
}
