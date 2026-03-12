export function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function clampNumber(x, lo, hi) {
  if (!Number.isFinite(x)) return x;
  if (Number.isFinite(lo) && x < lo) return lo;
  if (Number.isFinite(hi) && x > hi) return hi;
  return x;
}

export function almostEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
