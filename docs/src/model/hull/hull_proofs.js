// docs/src/model/hull/hull_proofs.js
// Containment proofs for Stage 105 hull outputs.

import { safeArray, samplePolyline, pointInsidePoly } from "./hull_geom.js";
import { wardById, wardCentroid } from "./core_set.js";

function boolResult(ok, extra = {}) {
  return { ok: !!ok, ...extra };
}

export function buildHullProofs({ cx, cy, wardsState, coreSet, innerHullModel, outerHullModel }) {
  const centre = { x: cx, y: cy };
  const wardsWithRoles = safeArray(wardsState?.wardsWithRoles);

  const centreInInner = pointInsidePoly(innerHullModel.poly, centre);
  const centreInOuter = pointInsidePoly(outerHullModel.poly, centre);

  const innerSamples = samplePolyline(innerHullModel.poly, 64);
  let sampledFails = 0;
  for (const p of innerSamples) {
    if (!pointInsidePoly(outerHullModel.poly, p)) sampledFails++;
  }

  const missingCoreWardIds = [];
  for (const wid of safeArray(coreSet.coreIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    const c = wardCentroid(w);
    if (!pointInsidePoly(innerHullModel.poly, c)) missingCoreWardIds.push(wid);
  }

  const missingOuterWardIds = [];
  for (const wid of safeArray(coreSet.outerIdsForHull)) {
    const w = wardById(wardsWithRoles, wid);
    const c = wardCentroid(w);
    if (!pointInsidePoly(outerHullModel.poly, c)) missingOuterWardIds.push(wid);
  }

  return {
    centreInInnerHull: boolResult(centreInInner, { value: centreInInner }),
    centreInOuterHull: boolResult(centreInOuter, { value: centreInOuter }),
    innerHullInsideOuterHullSampled: boolResult(sampledFails === 0, {
      samples: innerSamples.length,
      fails: sampledFails,
    }),
    coreMembersInsideInnerHull: boolResult(missingCoreWardIds.length === 0, {
      missingWardIds: missingCoreWardIds,
    }),
    claimedOuterMembersInsideOuterHull: boolResult(missingOuterWardIds.length === 0, {
      missingWardIds: missingOuterWardIds,
    }),
  };
}