import { assert } from "./assert.js";

export function toIntId(id, label = "id") {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label}: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} string: "${id}"`);
    return Number(id) | 0;
  }
  throw new Error(`Unsupported ${label} type: ${typeof id}`);
}

export function clampInt(value, min, max, fallback) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function isFiniteNonNegInt(n) {
  return Number.isFinite(n) && (n | 0) === n && n >= 0;
}
