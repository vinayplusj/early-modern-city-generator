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
import { resampleClosedPolyline } from "./warp_stage.js";
import { buildWarpField } from "../warp.js";
import { signedArea } from "../../geom/poly.js";

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


export function deriveFinalCurtainFromPostClamp({
  wallWarpedSafe,
  wallWarped,
  wallBaseDense,
  curtainVertexN,
}) {
  const wallCurtainForDrawRaw = wallWarpedSafe || wallWarped || wallBaseDense;

  const wallCurtainForDraw =
    (Array.isArray(wallCurtainForDrawRaw) && wallCurtainForDrawRaw.length >= 3)
      ? resampleClosedPolyline(wallCurtainForDrawRaw, curtainVertexN)
      : wallCurtainForDrawRaw;

  const curtainArea =
    (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
      ? signedArea(wallCurtainForDraw)
      : 1;

  return {
    wallCurtainForDrawRaw,
    wallCurtainForDraw,
    curtainArea,
    wantCCW: curtainArea > 0,
  };
}

export function rebindWarpWallToFinalCurtain({
  warpWall,
  wallBaseDense,
  wallCurtainForDraw,
  cx,
  cy,
  warpDebugEnabled,
}) {
  if (warpWall) {
    if (!warpWall.wallWarpedRaw) {
      warpWall.wallWarpedRaw = warpWall.wallWarped || null;
    }

    warpWall.wallWarped = wallCurtainForDraw;

    if (warpDebugEnabled) {
      console.log("[warpWall] overwrite wallWarped -> wallCurtainForDraw", {
        rawLen: warpWall.wallWarpedRaw?.length ?? null,
        finalLen: warpWall.wallWarped?.length ?? null,
        sameRef: warpWall.wallWarpedRaw === warpWall.wallWarped,
      });
    }
  }

  const finalCurtainParams = (warpWall?.params)
    ? {
        ...warpWall.params,
        debug: false,
        _clampField: true,
        ignoreBand: true,
        smoothRadius: 0,
        maxStep: 1e9,
        maxIn: 1e9,
        maxOut: 1e9,
      }
    : null;

  const finalCurtainField =
    (Array.isArray(wallBaseDense) && wallBaseDense.length >= 3 &&
     Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3 &&
     finalCurtainParams)
      ? buildWarpField({
          centre: { x: cx, y: cy },
          wallPoly: wallBaseDense,
          targetPoly: wallCurtainForDraw,
          districts: null,
          bastions: [],
          params: finalCurtainParams,
        })
      : null;

  if (warpWall && finalCurtainField) {
    warpWall.fieldOriginal = warpWall.field;
    warpWall.paramsOriginal = warpWall.params;
    warpWall.field = finalCurtainField;
    warpWall.params = finalCurtainParams;
  }

  return {
    warpWall,
    finalCurtainField,
    finalCurtainParams,
  };
}

export function buildCurtainMinField({
  warpOutworks,
  wallCurtainForDraw,
  cx,
  cy,
}) {
  return (
    warpOutworks?.params &&
    Array.isArray(wallCurtainForDraw) &&
    wallCurtainForDraw.length >= 3
  )
    ? buildWarpField({
        centre: { x: cx, y: cy },
        wallPoly: wallCurtainForDraw,
        targetPoly: wallCurtainForDraw,
        districts: null,
        bastions: [],
        params: { ...warpOutworks.params, debug: false },
      })
    : null;
}
