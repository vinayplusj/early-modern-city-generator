// docs/src/model/util/angles.js
// Angle helpers (radians).
// Intended for extraction from model/warp.js and related masking code.
//
// Design goals:
// - Deterministic, allocation-free for hot paths.
// - No behaviour assumptions about callers beyond radians.

export const TAU = Math.PI * 2;

/**
 * Wrap an angle (radians) to the interval [-pi, +pi].
 * Uses atan2(sin, cos) for numerical stability.
 */
export function wrapAngle(theta) {
  // Returns in [-pi, +pi], with wrap discontinuity at +/- pi.
  return Math.atan2(Math.sin(theta), Math.cos(theta));
}

/**
 * Signed shortest angular distance from a to b, in [-pi, +pi].
 * Positive means rotating CCW from a reaches b by that amount.
 */
export function angularDistance(a, b) {
  return wrapAngle(b - a);
}

/**
 * Unsigned shortest angular span between a and b, in [0, pi].
 */
export function angularSpan(a, b) {
  return Math.abs(angularDistance(a, b));
}

/**
 * Clamp to [0, 1].
 */
export function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Smoothstep in [0, 1] with zero slope at endpoints.
 * Input is assumed to already be in [0, 1], but is clamped defensively.
 */
export function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Feathered "lock mask" weight around a centre angle.
 *
 * Returns:
 * - 0.0 at the centre within halfWidth (full lock)
 * - 1.0 beyond halfWidth + feather (no lock)
 * - Smooth transition in between.
 *
 * This is useful for multiplying a delta field so it is suppressed near a feature.
 */
export function intervalLockWeight(theta, centreAngle, halfWidth, feather) {
  const w = Math.max(0, halfWidth || 0);
  const f = Math.max(0, feather || 0);

  const d = angularSpan(theta, centreAngle);

  if (d <= w) return 0;
  if (f <= 0) return 1;
  if (d >= w + f) return 1;

  // Map d from [w, w+f] -> [0, 1] and smooth.
  const t = (d - w) / f;
  return smoothstep01(t);
}
