// docs/src/model/debug/fortwarp_audit.js
//
// Debug helpers for auditing radial clamp results in FortWarp.
// Behaviour must remain identical to the legacy inline helpers in generate.js.

import { pointInPolyOrOn } from "../../geom/poly.js";
import { convexHull } from "../../geom/hull.js";

function sampleOnRing(thetas, values, theta) {
  const n = thetas.length;
  if (!n) return null;
  const twoPi = Math.PI * 2;

  let a = theta % twoPi;
  if (a < 0) a += twoPi;

  const step = twoPi / n;
  const i0 = Math.floor(a / step) % n;
  const i1 = (i0 + 1) % n;
  const t0 = i0 * step;
  const u = (a - t0) / step;

  const v0 = values[i0];
  const v1 = values[i1];
  if (!Number.isFinite(v0) && !Number.isFinite(v1)) return null;
  if (!Number.isFinite(v0)) return v1;
  if (!Number.isFinite(v1)) return v0;
  return v0 + (v1 - v0) * u;
}

/**
 * Audit whether points in polys violate radial clamp targets.
 *
 * @param {object} args
 * @param {string} args.name
 * @param {Array<Array<{x:number,y:number}>>} args.polys
 * @param {object|null} args.minField
 * @param {object|null} args.maxField
 * @param {number} args.cx
 * @param {number} args.cy
 * @param {number} [args.minMargin]
 * @param {number} [args.maxMargin]
 * @param {boolean} args.debugEnabled
 */
export function auditRadialClamp({
  name,
  polys,
  minField,
  maxField,
  cx,
  cy,
  minMargin,
  maxMargin,
  debugEnabled,
}) {
  if (!debugEnabled) return;
  if ((!minField && !maxField) || !Array.isArray(polys)) return;
  if (polys.length === 0) {
    console.info("[FortWarp Audit]", name, "SKIP (no polys)");
    return;
  }

  let belowMin = 0;
  let aboveMax = 0;
  let total = 0;

  const offendersAbove = [];
  const maxShow = 8;
  let polyIdx = 0;

  for (const poly of polys) {
    if (!Array.isArray(poly)) { polyIdx += 1; continue; }

    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

      const dx = p.x - cx;
      const dy = p.y - cy;
      const r = Math.hypot(dx, dy);
      if (r < 1e-6) continue;

      const theta = Math.atan2(dy, dx);

      const rMinRaw = minField ? sampleOnRing(minField.thetas, minField.rTarget, theta) : null;
      const rMaxRaw = maxField ? sampleOnRing(maxField.thetas, maxField.rTarget, theta) : null;

      const rMin = Number.isFinite(rMinRaw) ? (rMinRaw + (minMargin || 0)) : null;
      const rMax = Number.isFinite(rMaxRaw) ? (rMaxRaw - (maxMargin || 0)) : null;

      if (Number.isFinite(rMin) && r < rMin - 1e-6) belowMin += 1;
      if (Number.isFinite(rMax) && r > rMax + 1e-6) aboveMax += 1;

      if (
        name === "BASTIONS" &&
        Number.isFinite(rMax) &&
        r > rMax + 1e-6 &&
        offendersAbove.length < maxShow
      ) {
        offendersAbove.push({
          polyIdx,
          ptIdx: i,
          excess: +(r - rMax).toFixed(3),
          r: +r.toFixed(3),
          rMax: +rMax.toFixed(3),
          x: +p.x.toFixed(2),
          y: +p.y.toFixed(2),
          theta: +theta.toFixed(4),
        });
      }

      total += 1;
    }

    polyIdx += 1;
  }

  if (offendersAbove.length) {
    const sampleLabel = (name === "BASTIONS" && maxField)
      ? "BASTIONS radialMaxMismatch"
      : name;
    
    console.warn("[FortWarp Audit]", sampleLabel, "aboveMax sample", offendersAbove);

  }

  const label = (name === "BASTIONS" && maxField)
    ? "BASTIONS radialMaxMismatch"
    : name;
  
  if (belowMin || aboveMax) {
    console.warn("[FortWarp Audit]", label, { belowMin, aboveMax, total });
  } else {
    console.info("[FortWarp Audit]", label, "OK", { total });
  }
}

export function auditPolyContainment({
  name,
  polys,
  containerPoly,
  eps = 1e-6,
  debugEnabled,
}) {
  if (!debugEnabled) return;
  if (!Array.isArray(polys) || !Array.isArray(containerPoly) || containerPoly.length < 3) return;

  let outside = 0;
  let total = 0;

  const offenders = [];
  const maxShow = 8;

  let polyIdx = 0;
  for (const poly of polys) {
    if (!Array.isArray(poly)) { polyIdx += 1; continue; }

    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

      const inside = pointInPolyOrOn(p, containerPoly, eps);
      if (!inside) {
        outside += 1;
        if (offenders.length < maxShow) {
          offenders.push({
            polyIdx,
            ptIdx: i,
            x: +p.x.toFixed(2),
            y: +p.y.toFixed(2),
          });
        }
      }
      total += 1;
    }

    polyIdx += 1;
  }

  if (offenders.length) {
    console.warn("[FortWarp Audit]", name, "outside container sample", offenders);
  }

  if (outside) {
    console.warn("[FortWarp Audit]", name, "POLY CONTAINMENT FAIL", { outside, total });
  } else {
    console.info("[FortWarp Audit]", name, "POLY CONTAINMENT OK", { total });
  }
}


export function buildBastionHull(polys) {
  if (!Array.isArray(polys) || polys.length === 0) return null;

  const pts = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    for (const p of poly) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
    }
  }

  if (pts.length < 3) return null;

  const h = convexHull(pts);
  return (Array.isArray(h) && h.length >= 3) ? h : null;
}

export function runFortWarpAudits({
  warpDebugEnabled,
  auditWallDeterministicOutsideInnerHull,
  wallCurtainForDraw,
  innerHull,
  cx,
  cy,
  warpWall,
  bastionPolysWarpedSafe,
  warpOutworks,
  outerHullLoop,
  bastionPlacement,
}) {
  if (!warpDebugEnabled) return;

  auditWallDeterministicOutsideInnerHull({
    debugEnabled: warpDebugEnabled,
    wallCurtainForDraw,
    innerHull,
    centre: { x: cx, y: cy },
    margin: Number.isFinite(warpWall?.clampMinMargin) ? warpWall.clampMinMargin : 2,
  });

  auditRadialClamp({
    name: "BASTIONS",
    polys: bastionPolysWarpedSafe,
    minField: warpOutworks?.minField,
    maxField: warpOutworks?.maxField,
    cx,
    cy,
    minMargin: warpOutworks?.clampMinMargin,
    maxMargin: warpOutworks?.clampMaxMargin,
    debugEnabled: true,
  });

  auditPolyContainment({
    name: "BASTIONS",
    polys: bastionPolysWarpedSafe,
    containerPoly: outerHullLoop,
    debugEnabled: true,
  });

  if (bastionPlacement) {
    console.log("[bastionPlacement]", {
      want: bastionPlacement.want,
      minSpacing: bastionPlacement.minSpacing,
      top3: bastionPlacement.maxima.slice(0, 3),
    });
  }
}
