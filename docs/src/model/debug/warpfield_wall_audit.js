// docs/src/model/debug/warpfield_wall_audit.js
//
// Deterministic wall audit for Stage 110 (warpfield).
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// Behaviour: identical to the inlined audit IIFE in Stage 110.
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

import { safeNorm, rayPolyMaxT } from "../../geom/radial_ray_clamp.js";

/**
 * Deterministic WALL audit: verify that wall points remain outside the inner hull
 * along centre rays, with a given margin.
 *
 * This function preserves the original behaviour: it computes belowMin but does not log.
 * (Stage 110 controls logging elsewhere.)
 *
 * @param {object} args
 * @param {boolean} args.debugEnabled
 * @param {Array<{x:number,y:number}>|null} args.wallCurtainForDraw
 * @param {Array<{x:number,y:number}>|null} args.innerHull
 * @param {{x:number,y:number}} args.centre
 * @param {number} args.margin
 * @returns {{belowMin:number}|null}
 */
export function auditWallDeterministicOutsideInnerHull({
  debugEnabled,
  wallCurtainForDraw,
  innerHull,
  centre,
  margin,
}) {
  if (!debugEnabled) return null;
  if (!Array.isArray(wallCurtainForDraw) || wallCurtainForDraw.length < 3) return null;
  if (!Array.isArray(innerHull) || innerHull.length < 3) return null;

  let belowMin = 0;

  for (const p of wallCurtainForDraw) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

    const n = safeNorm(p.x - centre.x, p.y - centre.y);
    if (!n) continue;

    const tBoundary = rayPolyMaxT(centre, { x: n.x, y: n.y }, innerHull);
    if (!Number.isFinite(tBoundary)) continue;

    // Should be >= boundary + margin
    const rMin = tBoundary + margin;
    if (n.m < rMin - 1e-6) belowMin++;
  }

  return { belowMin };
}
