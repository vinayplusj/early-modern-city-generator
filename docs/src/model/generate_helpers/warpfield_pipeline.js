// docs/src/model/generate_helpers/warpfield_pipeline.js

import {
  sampleClosedPolylineByArcLength,
  computeCurtainClearanceProfile,
  pickClearanceMaximaWithSpacing,
  clampPolylineRadial,
} from "./warp_stage.js";
import { buildPentBastionAtSampleIndex } from "./bastion_builder.js";
import { computeLocalSpacingByMaxima, selectTopMaxima } from "./warpfield_slots.js";
import { warpPolylineRadial } from "../warp.js";
import { clampPolylineInsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";
import { assert } from "../util/assert.js";
import { median } from "../util/stats.js";

export function deriveBastionPlacementFromCurtain({
  ctx,
  wallCurtainForDraw,
  outerHullLoop,
  centrePt,
  cx,
  cy,
  warpFortParams,
  warpOutworks,
  targetN,
  bastionNDesired,
  wantCCW,
  bastionPolysUsed,
  buildPentBastion = buildPentBastionAtSampleIndex,
  warpDebugEnabled,
}) {
  let bastionPlacement = null;
  let bastionsBuiltFromMaxima = false;

  if (!(outerHullLoop && Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 8)) {
    return { bastionPlacement, bastionsBuiltFromMaxima, bastionPolysUsed };
  }

  const sampleStep =
    Number.isFinite(ctx?.params?.warpFort?.placementSampleStep)
      ? Math.max(2, ctx.params.warpFort.placementSampleStep)
      : 10;

  const { pts: curtainPtsS, s: sArr, totalLen } =
    sampleClosedPolylineByArcLength(wallCurtainForDraw, sampleStep);

  const outwardMode = ctx?.params?.warpFort?.placementOutwardMode || "normal";
  const { clearance } = computeCurtainClearanceProfile({
    curtainPts: curtainPtsS,
    centre: centrePt,
    outerHullLoop,
    outwardMode,
  });

  const soft = ctx?.params?.bastionSoft || null;
  const budget = Number.isFinite(soft?.reinsertBudget) ? Math.max(0, soft.reinsertBudget | 0) : 0;

  const fortRParam =
    (Number.isFinite(ctx?.params?.warpFort?.bandOuter) && ctx.params.warpFort.bandOuter > 0)
      ? ctx.params.warpFort.bandOuter
      : (Number.isFinite(warpFortParams?.bandOuter) ? warpFortParams.bandOuter : null);

  let fortRGeom = null;
  if (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 8) {
    const rs = [];
    for (let i = 0; i < wallCurtainForDraw.length; i++) {
      const p = wallCurtainForDraw[i];
      if (!p) continue;
      rs.push(Math.hypot(p.x - cx, p.y - cy));
    }
    fortRGeom = median(rs);
  }

  const fortR = (Number.isFinite(fortRParam) && fortRParam > 0) ? fortRParam : fortRGeom;

  assert(
    Number.isFinite(fortR) && fortR > 0,
    `warpFort.bandOuter invalid; fortRParam=${fortRParam}, fortRGeom=${fortRGeom}`
  );

  if (warpOutworks) {
    warpOutworks._fortR = { param: fortRParam, geom: fortRGeom, used: fortR };
  }

  const ditchWidthEst = Number.isFinite(fortR) ? fortR * 0.030 : 0;
  const glacisWidthEst = Number.isFinite(fortR) ? fortR * 0.070 : 0;

  const bastionOuterClearance =
    Number.isFinite(ctx?.params?.warpFort?.bastionOuterClearance)
      ? Math.max(0, ctx.params.warpFort.bastionOuterClearance)
      : (ditchWidthEst + glacisWidthEst) * 1.20;

  assert(Number.isFinite(bastionOuterClearance), `bastionOuterClearance non-finite: ${bastionOuterClearance}`);
  assert(bastionOuterClearance > 0, `bastionOuterClearance is zero; fortR=${fortR}, ditchWidthEst=${ditchWidthEst}, glacisWidthEst=${glacisWidthEst}`);

  if (warpDebugEnabled) {
    console.log("[bastionOuterClearance]", {
      fortRParam,
      fortRGeom,
      fortR,
      ditchWidthEst,
      glacisWidthEst,
      bastionOuterClearance,
    });
  }

  const minSpacing =
    Number.isFinite(ctx?.params?.warpFort?.placementMinSpacing)
      ? Math.max(0, ctx.params.warpFort.placementMinSpacing)
      : (targetN > 0 ? Math.max(20, 0.65 * (totalLen / targetN)) : 0);

  const want = Math.max(0, targetN + budget + 3);

  const maxima = pickClearanceMaximaWithSpacing({
    s: sArr,
    clearance,
    targetN: want,
    minSpacing,
    neighbourhood: 2,
    totalLen,
  });

  const localSpacingByK = computeLocalSpacingByMaxima(maxima, totalLen);

  bastionPlacement = {
    curtainPtsS,
    sArr,
    clearance,
    sampleStep,
    totalLen,
    outwardMode,
    bastionOuterClearance,
    localSpacingByK,
    minSpacing,
    want,
    maxima,
  };

  if (warpOutworks) warpOutworks.bastionPlacement = bastionPlacement;
  if (warpOutworks) warpOutworks.bastionsBuiltFromMaxima = bastionsBuiltFromMaxima;

  if (bastionPlacement?.maxima?.length && bastionNDesired > 0) {
    const maximaTop = selectTopMaxima(bastionPlacement.maxima, bastionNDesired);

    const built = maximaTop
      .map(m => m.i)
      .filter(k => Number.isFinite(k) && k >= 0 && k < bastionPlacement.curtainPtsS.length)
      .map(k => buildPentBastion({
        k,
        placement: bastionPlacement,
        cx,
        cy,
        wantCCW,
        shoulderSpanToTip: ctx?.params?.warpFort?.bastionShoulderSpanToTip,
        outerHullLoop,
      }));

    if (built.length > 0) {
      bastionPolysUsed.length = 0;
      for (const poly of built) bastionPolysUsed.push(poly);

      bastionsBuiltFromMaxima = true;
      if (warpOutworks) warpOutworks.bastionsBuiltFromMaxima = true;
      if (warpOutworks) warpOutworks.bastionsBuiltCount = built.length;
    }
  }

  return { bastionPlacement, bastionsBuiltFromMaxima, bastionPolysUsed };
}

export function warpBastionPolysThroughFields({
  warpOutworks,
  warpWall,
  bastionPolysUsed,
  centrePt,
  curtainMinField,
  outerHullLoop,
  bastionOuterInset,
  bastionsBuiltFromMaxima,
}) {
  let bastionPolysWarpedSafe = bastionPolysUsed;

  if (!(warpOutworks?.field && Array.isArray(bastionPolysUsed))) {
    return bastionPolysWarpedSafe;
  }

  const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params) && !bastionsBuiltFromMaxima;

  bastionPolysWarpedSafe = bastionPolysUsed.map((poly) => {
    if (!Array.isArray(poly) || poly.length < 3) return poly;

    const warpedByCurtain = hasCurtainWarp
      ? warpPolylineRadial(poly, centrePt, warpWall.field, warpWall.params)
      : poly;

    const warpedByOutworks = bastionsBuiltFromMaxima
      ? warpedByCurtain
      : warpPolylineRadial(warpedByCurtain, centrePt, warpOutworks.field, warpOutworks.params);

    const clamped = clampPolylineRadial(
      warpedByOutworks,
      centrePt,
      curtainMinField,
      null,
      2,
      warpOutworks.clampMaxMargin
    );

    let clampedSafe = clamped;

    if (outerHullLoop) {
      const baseM = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
      const m = baseM + bastionOuterInset;
      clampedSafe = clampPolylineInsidePolyAlongRays(clampedSafe, centrePt, outerHullLoop, m);
    }

    return clampedSafe;
  });

  return bastionPolysWarpedSafe;
}
