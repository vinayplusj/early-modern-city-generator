// docs/src/model/generate_helpers/warpfield_bastion_repair_pipeline.js
//
// Stage 110 helper: warp, clamp, repair, and finalize bastion polygons.
// Keeps bastion-specific logic out of the main stage orchestration file.

import { warpPolylineRadial } from "../warp.js";
import { auditRadialClamp, auditPolyContainment } from "../debug/fortwarp_audit.js";
import { repairBastionsStrictConvex } from "./bastion_convex_repair.js";
import { slideRepairBastions } from "./bastion_slide_repair.js";
import { clampPolylineInsidePolyAlongRays } from "../../geom/radial_ray_clamp.js";
import { ensureWinding, signedArea } from "../../geom/poly.js";

function isFinitePoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function validPoly(poly) {
  return Array.isArray(poly) && poly.length >= 3;
}

function bastionQuickStats(poly) {
  if (!Array.isArray(poly) || poly.length !== 5) {
    return { ok: false, why: "not_5" };
  }

  const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const baseGap = d(poly[0], poly[4]);
  const shoulderGap = d(poly[1], poly[3]);
  const tipShoulder0 = d(poly[2], poly[1]);
  const tipShoulder1 = d(poly[2], poly[3]);

  return {
    ok: true,
    areaSigned: signedArea(poly),
    baseGap,
    shoulderGap,
    tipShoulder0,
    tipShoulder1,
  };
}

/**
 * Warp + clamp + repair bastions for Stage 110.
 *
 * Inputs are intentionally close to the existing Stage 110 locals so the
 * extraction is low-risk.
 */
export function runWarpfieldBastionRepairPipeline({
  ctx,
  bastionPolys,
  bastionsForWarp,
  wallCurtainForDraw,
  fortOuterHull,
  centrePt,
  cx,
  cy,
  wantCCW,
  warpWall,
  warpOutworks,
  curtainMinField,
  bastionOuterInset,
  placement,
  slideTries,
  margin,
  K,
  warpDebugEnabled,
  buildPentBastionAtSampleIndex,
  bastionCentroid,
  nearestSampleIndex,
  nearestMaximaIndex,
}) {
  const out = {
    bastionPolysWarped: [],
    bastionPolysWarpedSafe: [],
    bastionRepairStats: null,
    bastionSlideRepairStats: null,
  };

  if (!Array.isArray(bastionPolys) || bastionPolys.length === 0) {
    return out;
  }

  const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params);
  const hasOutworksWarp = Boolean(warpOutworks?.field && warpOutworks?.params);

  // ---------------------------------------------------------------------------
  // 1) Initial warp + clamp of bastion polys
  // ---------------------------------------------------------------------------
  const bastionPolysWarped = bastionPolys.map((poly) => {
    if (!validPoly(poly)) return null;

    let q = poly;

    if (hasCurtainWarp) {
      q = warpPolylineRadial(q, centrePt, warpWall.field, warpWall.params);
    }
    if (hasOutworksWarp && !warpOutworks?.bastionsBuiltFromMaxima) {
      q = warpPolylineRadial(q, centrePt, warpOutworks.field, warpOutworks.params);
    }

    if (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) {
      const baseM = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
      const m = baseM + (Number.isFinite(bastionOuterInset) ? bastionOuterInset : 0);
      q = clampPolylineInsidePolyAlongRays(q, centrePt, fortOuterHull, m);
    }

    q = ensureWinding(q, wantCCW);
    return q;
  });

  out.bastionPolysWarped = bastionPolysWarped;

  if (warpDebugEnabled) {
    auditRadialClamp("BASTIONS", bastionPolysWarped, centrePt);
    if (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) {
      auditPolyContainment("BASTIONS POLY CONTAINMENT", bastionPolysWarped, fortOuterHull);
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Strict convex repair pass
  // ---------------------------------------------------------------------------
  const repairRes = repairBastionsStrictConvex({
    bastionPolys: bastionPolysWarped,
    centrePt,
    outerHullLoop: fortOuterHull,
    margin,
    K,
    warpDebugEnabled,
  });

  let bastionPolysWarpedSafe = Array.isArray(repairRes?.bastionPolysOut)
    ? repairRes.bastionPolysOut
    : bastionPolysWarped;

  out.bastionRepairStats = repairRes?.repairStats || null;

  // ---------------------------------------------------------------------------
  // 3) Optional slide repair for failed bastions
  // ---------------------------------------------------------------------------
  const failedIndices = [];
  for (let i = 0; i < bastionPolysWarpedSafe.length; i++) {
    const poly = bastionPolysWarpedSafe[i];
    if (!validPoly(poly) || poly.length !== 5) {
      failedIndices.push(i);
      continue;
    }
    const s = bastionQuickStats(poly);
    if (!s.ok) {
      failedIndices.push(i);
      continue;
    }
  }

  if (
    failedIndices.length > 0 &&
    placement &&
    Array.isArray(placement.maxima) &&
    placement.maxima.length > 0 &&
    typeof buildPentBastionAtSampleIndex === "function" &&
    typeof bastionCentroid === "function" &&
    typeof nearestSampleIndex === "function" &&
    typeof nearestMaximaIndex === "function"
  ) {
    const slideOut = slideRepairBastions({
      bastionPolys: bastionPolysWarpedSafe,
      failedIndices,
      placement,
      maxima: placement.maxima,
      L: placement.totalLen,
      centrePt,
      cx,
      cy,
      wantCCW,
      outerHullLoop: fortOuterHull,
      warpWall,
      warpOutworks,
      curtainMinField,
      bastionOuterInset,
      bastionsBuiltFromMaxima: Boolean(warpOutworks?.bastionsBuiltFromMaxima),
      slideTries,
      margin,
      K,
      debug: Boolean(warpDebugEnabled),

      warpPolylineRadial,
      clampPolylineRadial: warpOutworks?.clampPolylineRadial || ctx?.geom?.clampPolylineRadial,
      clampPolylineInsidePolyAlongRays,
      ensureWinding,
      polyAreaSigned: signedArea,
      repairBastionStrictConvex: repairRes?.repairOne || ctx?.geom?.repairBastionStrictConvex,
      bastionCentroid,
      nearestSampleIndex,
      nearestMaximaIndex,
      buildPentBastionAtSampleIndex,
    });

    if (Array.isArray(slideOut?.bastionPolysOut)) {
      bastionPolysWarpedSafe = slideOut.bastionPolysOut;
    }
    out.bastionSlideRepairStats = slideOut?.slideStats || null;
  }

  // ---------------------------------------------------------------------------
  // 4) Final normalization + audit
  // ---------------------------------------------------------------------------
  bastionPolysWarpedSafe = bastionPolysWarpedSafe.map((poly) => {
    if (!validPoly(poly)) return null;
    return ensureWinding(poly, wantCCW);
  });

  out.bastionPolysWarpedSafe = bastionPolysWarpedSafe;

  if (warpDebugEnabled) {
    auditRadialClamp("BASTIONS radialMaxMismatch OK", bastionPolysWarpedSafe, centrePt);
    if (Array.isArray(fortOuterHull) && fortOuterHull.length >= 3) {
      auditPolyContainment("BASTIONS POLY CONTAINMENT OK", bastionPolysWarpedSafe, fortOuterHull);
    }
  }

  return out;
}
