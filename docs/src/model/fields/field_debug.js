// docs/src/model/fields/field_debug.js
//
// Milestone 4.8: Deterministic debug utilities for fields.
//
// Provides:
// - hashFloat64Array(values, opts): stable hash for regression tests / golden seeds
// - hashFieldRecord(fieldRecord, opts): hashes a registry record (values + basic meta)
// - makeFaceHeatFromField(fields, faceFieldName): convenience for debug rendering
//
// Design goals:
// - Deterministic across platforms (within reasonable JS floating constraints)
// - Avoid reliance on JSON stringification ordering
// - Avoid huge memory overhead
//
// NOTE:
// Hashing floats bit-exact is risky across minor numeric differences.
// This implementation uses quantisation (default 1e-6) before hashing.
// You can tighten/loosen quantisation based on your observed stability.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function clampInt32(x) {
  return x | 0;
}

function toUint32(x) {
  return x >>> 0;
}

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

/**
 * FNV-1a 32-bit hash update for an unsigned 32-bit chunk.
 * @param {number} h
 * @param {number} x
 * @returns {number}
 */
function fnv1aUpdate32(h, x) {
  // FNV-1a: h ^= x; h *= 16777619
  h ^= (x >>> 0);
  // Multiply in uint32 space:
  h = Math.imul(h, 16777619);
  return h >>> 0;
}

/**
 * Quantise a float deterministically to an integer grid.
 * Default grid is 1e-6 (micro-units).
 *
 * @param {number} v
 * @param {number} q
 * @returns {number} int32-ish
 */
function quantise(v, q) {
  // Handle -0 explicitly to avoid sign-noise.
  if (v === 0) return 0;
  // Round to nearest integer multiple of q.
  const s = v / q;
  // Use Math.round: deterministic in JS for finite values.
  const r = Math.round(s);
  // Clamp to 32-bit int space (still deterministic).
  return clampInt32(r);
}

/**
 * Hash a Float64Array deterministically with quantisation.
 *
 * @param {Float64Array} values
 * @param {object} [opts]
 * @param {number} [opts.quantum=1e-6] - quantisation step
 * @param {number} [opts.seed=2166136261] - initial FNV basis
 * @returns {string} hex string, 8 chars (uint32)
 */
export function hashFloat64Array(values, opts) {
  assert(values instanceof Float64Array, "hashFloat64Array expects a Float64Array.");
  const quantum = opts && isFiniteNumber(opts.quantum) ? Number(opts.quantum) : 1e-6;
  assert(quantum > 0, `quantum must be > 0; got ${quantum}`);

  let h = opts && isFiniteNumber(opts.seed) ? (Number(opts.seed) >>> 0) : 2166136261;

  // Mix length first.
  h = fnv1aUpdate32(h, values.length >>> 0);

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    assert(Number.isFinite(v), `Non-finite value at index ${i}: ${v}`);
    const qv = quantise(v, quantum);
    h = fnv1aUpdate32(h, qv);
  }

  // Return fixed-width hex.
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash a field record from FieldRegistry.get(name).
 * Includes spec name/domain/version and value hash.
 *
 * @param {{spec:object, values:Float64Array, min:number, max:number}} rec
 * @param {object} [opts]
 * @param {number} [opts.quantum=1e-6]
 * @returns {string} stable string id
 */
export function hashFieldRecord(rec, opts) {
  assert(rec && rec.spec && rec.values instanceof Float64Array, "hashFieldRecord expects a FieldRegistry record.");

  const name = String(rec.spec.name || "");
  const domain = String(rec.spec.domain || "");
  const version = rec.spec.version == null ? 1 : Number(rec.spec.version);

  assert(name.length > 0, "Field record spec.name must be non-empty.");
  assert(domain.length > 0, "Field record spec.domain must be non-empty.");
  assert(Number.isFinite(version) && version >= 1, `Field record spec.version must be >= 1; got ${version}`);

  const hv = hashFloat64Array(rec.values, opts);

  // Include min/max in quantised form so changes in range are visible.
  const quantum = opts && isFiniteNumber(opts.quantum) ? Number(opts.quantum) : 1e-6;
  const qMin = quantise(rec.min, quantum);
  const qMax = quantise(rec.max, quantum);

  return `${name}|${domain}|v${version}|min${qMin}|max${qMax}|h${hv}`;
}

/**
 * Convenience: produce an array of face "heat" values from a face-domain field.
 * Useful for debug overlays.
 *
 * @param {object} fields - FieldRegistry
 * @param {string} faceFieldName
 * @param {boolean} [normalise01=true]
 * @returns {Float64Array}
 */
export function makeFaceHeatFromField(fields, faceFieldName, normalise01 = true) {
  assert(fields && typeof fields.get === "function", "makeFaceHeatFromField requires a FieldRegistry-like object.");
  assert(typeof faceFieldName === "string" && faceFieldName.length > 0, "faceFieldName must be a non-empty string.");

  const rec = fields.get(faceFieldName);
  const domain = rec.spec && rec.spec.domain;
  assert(domain === "face", `makeFaceHeatFromField expects a face-domain field; got domain=${String(domain)}`);

  if (!normalise01) return rec.values;

  const out = new Float64Array(rec.values.length);
  const den = rec.max - rec.min;

  if (!(den > 0)) {
    // Degenerate: all same value -> 0 heat
    return out;
  }

  for (let i = 0; i < rec.values.length; i++) {
    const v = rec.values[i];
    const t = (v - rec.min) / den;
    // Clamp, deterministic.
    out[i] = t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  return out;
}
