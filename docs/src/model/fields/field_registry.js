// docs/src/model/fields/field_registry.js
// A deterministic registry for scalar fields over CityMesh domains (faces or vertices).
// - Enforces domain length contracts
// - Stores Float64Array values with min/max metadata
// - Provides stable normalised [0,1] accessors with clamping
//
// This module is intentionally dependency-free.

const DOMAIN_FACE = "face";
const DOMAIN_VERTEX = "vertex";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function computeMinMax(arr) {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    // Enforce numeric + finite deterministically
    assert(Number.isFinite(v), `Field value is not finite at index ${i}: ${v}`);
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Empty arrays should never happen for mesh domains
  assert(min !== Infinity, "Field array is empty; cannot compute min/max.");
  return { min, max };
}

function expectedLengthForDomain(domain, sizes) {
  if (domain === DOMAIN_FACE) return sizes.faceCount;
  if (domain === DOMAIN_VERTEX) return sizes.vertexCount;
  throw new Error(`Unknown field domain: ${String(domain)}`);
}

function freezeSpec(spec) {
  // Defensive copy + freeze to avoid hidden coupling.
  const s = {
    name: String(spec.name),
    domain: String(spec.domain),
    version: spec.version == null ? 1 : Number(spec.version),
    units: spec.units == null ? "" : String(spec.units),
    description: spec.description == null ? "" : String(spec.description),
    // Optional provenance
    source: spec.source == null ? "" : String(spec.source),
  };
  assert(s.name.length > 0, "Field spec.name must be a non-empty string.");
  assert(s.domain === DOMAIN_FACE || s.domain === DOMAIN_VERTEX, `Invalid field spec.domain: ${s.domain}`);
  assert(Number.isFinite(s.version) && s.version >= 1, `Field spec.version must be >= 1; got ${s.version}`);
  return Object.freeze(s);
}

export class FieldRegistry {
  /**
   * @param {{faceCount:number, vertexCount:number}} sizes
   */
  constructor(sizes) {
    assert(sizes && Number.isFinite(sizes.faceCount) && Number.isFinite(sizes.vertexCount), "sizes must include faceCount and vertexCount.");
    assert(sizes.faceCount >= 0 && sizes.vertexCount >= 0, "faceCount and vertexCount must be >= 0.");
    this._sizes = Object.freeze({ faceCount: sizes.faceCount | 0, vertexCount: sizes.vertexCount | 0 });
    this._fields = new Map(); // name -> { spec, values, min, max }
  }

  get sizes() {
    return this._sizes;
  }

  /**
   * Add a scalar field.
   * @param {object} spec
   * @param {Float64Array|Array<number>} values
   * @returns {object} frozen field record
   */
  add(spec, values) {
    const frozenSpec = freezeSpec(spec);
    const name = frozenSpec.name;

    assert(!this._fields.has(name), `Field already exists: ${name}`);

    let arr;
    if (values instanceof Float64Array) {
      // Copy defensively to prevent external mutation.
      arr = new Float64Array(values);
    } else if (Array.isArray(values)) {
      arr = new Float64Array(values.length);
      for (let i = 0; i < values.length; i++) arr[i] = values[i];
    } else {
      throw new Error(`Field values must be Float64Array or Array<number>; got ${typeof values}`);
    }

    const expectedLen = expectedLengthForDomain(frozenSpec.domain, this._sizes);
    assert(arr.length === expectedLen, `Field "${name}" length ${arr.length} does not match expected ${expectedLen} for domain ${frozenSpec.domain}.`);

    const mm = computeMinMax(arr);
    const record = Object.freeze({
      spec: frozenSpec,
      values: arr,
      min: mm.min,
      max: mm.max,
    });

    this._fields.set(name, record);
    return record;
  }

  has(name) {
    return this._fields.has(name);
  }

  /**
   * @param {string} name
   * @returns {{spec:object, values:Float64Array, min:number, max:number}}
   */
  get(name) {
    const rec = this._fields.get(name);
    assert(!!rec, `Missing field: ${name}`);
    return rec;
  }

  /**
   * Returns the raw scalar value.
   * @param {string} name
   * @param {number} idx
   */
  getValue(name, idx) {
    const rec = this.get(name);
    const i = idx | 0;
    assert(i >= 0 && i < rec.values.length, `Index out of range for field "${name}": ${idx}`);
    return rec.values[i];
  }

  /**
   * Returns a stable [0,1] normalised value with clamping.
   * If max == min, returns 0 everywhere.
   * @param {string} name
   * @param {number} idx
   */
  get01(name, idx) {
    const rec = this.get(name);
    const v = this.getValue(name, idx);

    const min = rec.min;
    const max = rec.max;
    const den = max - min;

    if (den <= 0) return 0;
    return clamp01((v - min) / den);
  }

  /**
   * Deterministic list of field names in insertion order.
   * Prefer explicit ordering where fields are added in a stable sequence.
   */
  names() {
    return Array.from(this._fields.keys());
  }

  /**
   * Deterministic snapshot of metadata for debugging and audits.
   * Values are not included.
   */
  meta() {
    const out = [];
    for (const [name, rec] of this._fields.entries()) {
      out.push({
        name,
        domain: rec.spec.domain,
        version: rec.spec.version,
        units: rec.spec.units,
        min: rec.min,
        max: rec.max,
      });
    }
    return out;
  }

  /**
   * Validate basic invariants over all fields.
   * Throws on the first failure.
   */
  assertValid() {
    for (const [name, rec] of this._fields.entries()) {
      const expectedLen = expectedLengthForDomain(rec.spec.domain, this._sizes);
      assert(rec.values.length === expectedLen, `Field "${name}" length mismatch during validation.`);
      // Re-check min/max consistency in a deterministic way.
      const mm = computeMinMax(rec.values);
      assert(mm.min === rec.min && mm.max === rec.max, `Field "${name}" min/max mismatch during validation.`);
    }
  }
}

export const FieldDomain = Object.freeze({
  FACE: DOMAIN_FACE,
  VERTEX: DOMAIN_VERTEX,
});
