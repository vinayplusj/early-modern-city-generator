// docs/src/model/generate_helpers/curtain_post_clamp.js
//
// Curtain post-condition clamps (deterministic; no field sampling).
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// Behaviour: identical to the inlined post-clamp block in Stage 110.
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

import { clampPolylineOutsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";
import { clampPolylineToMidBandAlongRays } from "../../geom/radial_midband_clamp.js";

/**
 * Apply hard post-conditions to the warped curtain:
 * 1) Curtain vertices must remain OUTSIDE the inner hull (plus innerMargin).
 * 2) Curtain vertices must remain inside a mid-band between inner and outer hulls,
 *    defined by parameter tMid and midMargin.
 *
 * This is deterministic and only uses radial ray clamps.
 *
 * @param {object} args
 * @param {Array<{x:number,y:number}>} args.wallWarped
 * @param {{x:number,y:number}} args.centre
 * @param {Array<{x:number,y:number}>|null} args.innerHull
 * @param {Array<{x:number,y:number}>|null} args.outerHullLoop
 * @param {number} args.innerMargin
 * @param {number} args.tMid
 * @param {number} args.midMargin
 * @returns {Array<{x:number,y:number}>}
 */
export function clampCurtainPostConditions({
  wallWarped,
  centre,
  innerHull,
  outerHullLoop,
  innerMargin,
  tMid,
  midMargin,
}) {
  let wallWarpedSafe = wallWarped;

  // Hard invariant (deterministic): curtain vertices must be OUTSIDE inner hull.
  if (Array.isArray(innerHull) && innerHull.length >= 3) {
    const m = Number.isFinite(innerMargin) ? innerMargin : 0;
    wallWarpedSafe = clampPolylineOutsidePolyAlongRays(wallWarpedSafe, centre, innerHull, m);
  }

  // Hard invariant (deterministic): curtain vertices must stay inside the mid-band.
  if (
    Array.isArray(innerHull) && innerHull.length >= 3 &&
    Array.isArray(outerHullLoop) && outerHullLoop.length >= 3
  ) {
    const tt = Number.isFinite(tMid) ? tMid : 0.3;
    const mIn = Number.isFinite(innerMargin) ? innerMargin : 0;
    const mMid = Number.isFinite(midMargin) ? midMargin : 0;

    wallWarpedSafe = clampPolylineToMidBandAlongRays(
      wallWarpedSafe,
      centre,
      innerHull,
      outerHullLoop,
      tt,
      mIn,
      mMid
    );
  }

  return wallWarpedSafe;
}
