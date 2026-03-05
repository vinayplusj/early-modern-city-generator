// docs/src/model/util/stats.js
//
// Small numeric helpers used across model stages.

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;

  // Copy + numeric sort (do not mutate caller).
  const a = values.slice().sort((x, y) => x - y);
  const n = a.length;
  const mid = (n / 2) | 0;

  if (n % 2 === 1) return a[mid];
  return 0.5 * (a[mid - 1] + a[mid]);
}
