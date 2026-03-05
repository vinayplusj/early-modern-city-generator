// docs/src/rng/rng_fork.js
import { mulberry32 } from "./mulberry32.js";

/**
 * FNV-1a 32-bit hash, deterministic across platforms.
 * Returns an unsigned 32-bit integer.
 */
export function fnv1a32(str) {
  let h = 0x811c9dc5; // offset basis
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 with 32-bit overflow
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministically derive a new mulberry32 RNG from a root seed and a label.
 * The label must be stable, and should be a short stage name.
 */
export function rngFork(rootSeed, label) {
  const s = String(rootSeed) + "|" + String(label);
  const forkSeed = fnv1a32(s);
  return mulberry32(forkSeed);
}
