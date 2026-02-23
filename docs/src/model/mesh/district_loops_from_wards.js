// docs/src/model/mesh/district_loops_from_wards.js
//
// Build district boundary loops from ward polygons.
// Extracted from: docs/src/model/districts.js
//
// Behaviour: extraction only (no logic changes).
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

import { centroid, pointInPolyOrOn } from "../../geom/poly.js";
import { isPoint } from "../../geom/primitives.js";
import { polyAreaSigned, loopMetrics } from "../../geom/loop_metrics.js";
import { buildLoopsFromPolys } from "./loops_from_polys.js";

export function buildDistrictLoopsFromWards(wards, memberWardIds, opts = {}) {
  const wardArr = Array.isArray(wards) ? wards : [];
  const ids = Array.isArray(memberWardIds)
    ? memberWardIds.map(Number).filter(Number.isFinite)
    : [];

  if (wardArr.length === 0 || ids.length === 0) {
    return {
      loops: [],
      holeCount: 0,
      outerLoop: null,
      outerLoopIndex: -1,
      loopMeta: [],
      warnings: [],
      preferPointInside: null,
    };

  }

  const idSet = new Set(ids);

  const polys = [];
  for (const w of wardArr) {
    if (!w || !idSet.has(w.id)) continue;

    const poly =
      (Array.isArray(w.poly) && w.poly.length >= 3) ? w.poly :
      (Array.isArray(w.polygon) && w.polygon.length >= 3) ? w.polygon :
      null;

    if (Array.isArray(poly) && poly.length >= 3) polys.push(poly);
  }

  const warnings = [];

  if (polys.length === 0) {
    warnings.push("no_polys_for_memberWardIds");
    return {
      loops: [],
      holeCount: 0,
      outerLoop: null,
      outerLoopIndex: -1,
      loopMeta: [],
      warnings,
      preferPointInside: null,
    };
  }

  const loops = buildLoopsFromPolys(polys);

  if (!Array.isArray(loops) || loops.length === 0) {
    warnings.push("no_loops_from_polys");
    return {
      loops: [],
      holeCount: 0,
      outerLoop: null,
      outerLoopIndex: -1,
      loopMeta: [],
      warnings,
      preferPointInside: null,
    };
  }

  // Determine outer loop as loop with largest absolute area.
  let outerLoopIndex = -1;
  let outerAreaAbs = -Infinity;

  const loopMeta = loops.map((loop, i) => {
    const m = loopMetrics(loop);
    const areaAbs = m.areaAbs;

    if (areaAbs > outerAreaAbs) {
      outerAreaAbs = areaAbs;
      outerLoopIndex = i;
    }

    return {
      i,
      ...m,
      areaSign: (m.areaSigned >= 0) ? 1 : -1,
    };
  });

  const outerLoop = (outerLoopIndex >= 0) ? loops[outerLoopIndex] : null;

  // Hole count: loops other than outer loop whose signed area sign differs from outer loop sign.
  // (Typical polygon orientation convention: outer CCW, holes CW.)
  let holeCount = 0;
  const outerSign = (outerLoop && Number.isFinite(polyAreaSigned(outerLoop)) && polyAreaSigned(outerLoop) >= 0) ? 1 : -1;

  for (let i = 0; i < loops.length; i++) {
    if (i === outerLoopIndex) continue;
    const a = polyAreaSigned(loops[i]);
    const s = (a >= 0) ? 1 : -1;
    if (s !== outerSign) holeCount++;
  }

  // Prefer a point inside: use opts.preferPointInside if provided and is inside outerLoop and not in a hole.
  // Else choose centroid of outerLoop.
  let preferPointInside = null;

  const candidate = opts?.preferPointInside ?? null;
  if (isPoint(candidate) && outerLoop) {
    const inOuter = pointInPolyOrOn(candidate, outerLoop);
    if (inOuter) {
      // Also ensure it is not inside a hole (if any).
      let inHole = false;
      for (let i = 0; i < loops.length; i++) {
        if (i === outerLoopIndex) continue;
        const a = polyAreaSigned(loops[i]);
        const s = (a >= 0) ? 1 : -1;
        if (s !== outerSign) {
          if (pointInPolyOrOn(candidate, loops[i])) {
            inHole = true;
            break;
          }
        }
      }
      if (!inHole) preferPointInside = candidate;
    }
  }

  if (!preferPointInside && outerLoop) {
    const c = centroid(outerLoop);
    if (isPoint(c)) preferPointInside = c;
  }

  // Optional warnings.
  const label = opts?.label ? String(opts.label) : "";

  if (outerLoopIndex < 0 || !outerLoop) {
    warnings.push(`no_outerLoop${label ? " " + label : ""}`);
  }

  if (holeCount > 0 && opts?.warnOnHoles) {
    warnings.push(`holeCount=${holeCount}${label ? " " + label : ""}`);
  }

  return {
    loops,
    holeCount,
    outerLoop,
    outerLoopIndex,
    loopMeta,
    warnings,
    preferPointInside,
  };
}
