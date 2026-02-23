// docs/src/geom/angle_sector.js
//
// Angle + sector helpers (radians).
// Extracted from: docs/src/model/districts.js
//
// Behaviour: extraction only (no logic changes).
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

/**
 * Angle from centre (cx,cy) to point p, in radians.
 * @param {number} cx
 * @param {number} cy
 * @param {{x:number,y:number}} p
 * @returns {number}
 */
export function angle(cx, cy, p) {
  return Math.atan2(p.y - cy, p.x - cx);
}

/**
 * Normalise angle to [0, 2π).
 * @param {number} a
 * @returns {number}
 */
export function normAngle(a) {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x < 0) x += twoPi;
  return x;
}

/**
 * Test if angle a lies within sector [a0, a1] going CCW, handling wrap.
 * Inputs are assumed already normalised with normAngle.
 *
 * @param {number} a
 * @param {number} a0
 * @param {number} a1
 * @returns {boolean}
 */
export function inSector(a, a0, a1) {
  if (a0 <= a1) return a >= a0 && a <= a1;
  // wrapped: [a0, 2π) U [0, a1]
  return a >= a0 || a <= a1;
}

/**
 * Sort angles ascending in [0, 2π).
 * @param {number[]} angles
 * @returns {number[]}
 */
export function sortAngles(angles) {
  if (!Array.isArray(angles)) return [];
  return angles.slice().sort((a, b) => a - b);
}
