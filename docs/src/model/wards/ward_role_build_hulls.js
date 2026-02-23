// docs/src/model/wards/ward_role_build_hulls.js
//
// Build fort hull structures (inner + outer) from role-selected ward memberships.
// Extracted from ward_roles.js. Extraction only. No behaviour changes intended.
//
// This module performs:
// - coreIds / ring1Ids computation
// - geometry-valid filtering for hull construction
// - district loop building for inner and outer hulls
// - optional closure mode: promote enclosed wards
// - optional hole handling: force a single outer loop deterministically
//
// All external dependencies are injected to keep behaviour stable and auditable.

import {
  selectOuterLoopDeterministic,
  computeEnclosedNonMembers,
  promoteEnclosedIds,
  forceSingleOuterLoopInPlace,
} from "./ward_role_hulls.js";

import {
  idsWithMissingPoly,
  filterIdsWithValidPoly,
  wardHasValidPoly,
  wardCentroid,
} from "./ward_shape_utils.js";

/**
 * @param {object} args
 * @param {Array<object>} args.wardsCopy
 * @param {{x:number,y:number}} args.centre
 * @param {Map<number, number>} args.idToIndex
 * @param {number[][]} args.adj
 *
 * @param {number} args.plazaId
 * @param {number} args.citadelId
 * @param {number[]} args.innerIds
 *
 * @param {object} args.params - expects outerHullClosureMode
 *
 * @param {Function} args.buildDistrictLoopsFromWards
 * @param {Function} args.pointInPolyOrOn
 *
 * @returns {object} fortHulls
 */
export function buildFortHulls({
  wardsCopy,
  centre,
  idToIndex,
  adj,

  plazaId,
  citadelId,
  innerIds,

  params,

  buildDistrictLoopsFromWards,
  pointInPolyOrOn,
}) {
  // Core = plaza + citadel + inner.
  const coreIds = []
    .concat([plazaId, citadelId], Array.isArray(innerIds) ? innerIds : [])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  // Geometry-valid membership for hull construction only.
  const coreIdsForHull = filterIdsWithValidPoly(wardsCopy, coreIds);
  const coreSkippedMissingPoly = idsWithMissingPoly(wardsCopy, coreIds);

  if (coreSkippedMissingPoly.length) {
    console.warn("[Hulls] coreIds skipped (missing poly)", {
      skippedCount: coreSkippedMissingPoly.length,
      skippedIds: coreSkippedMissingPoly,
    });
  }

  // Use geometry-valid core for any adjacency-driven expansion.
  const coreIdxSet = new Set(
    coreIdsForHull
      .map((id) => idToIndex.get(id))
      .filter((idx) => Number.isInteger(idx))
  );

  // Ring 1 = neighbours of core wards, excluding the core wards themselves.
  const ring1IdxSet = new Set();
  for (const coreIdx of coreIdxSet) {
    const nbrs = adj[coreIdx] || [];
    for (const nbrIdx of nbrs) {
      if (!coreIdxSet.has(nbrIdx)) ring1IdxSet.add(nbrIdx);
    }
  }

  const ring1Ids = Array.from(ring1IdxSet)
    .map((idx) => wardsCopy[idx]?.id)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const ring1IdsForHull = filterIdsWithValidPoly(wardsCopy, ring1Ids);
  const ring1SkippedMissingPoly = idsWithMissingPoly(wardsCopy, ring1Ids);

  if (ring1SkippedMissingPoly.length) {
    console.warn("[Hulls] ring1Ids skipped (missing poly)", {
      skippedCount: ring1SkippedMissingPoly.length,
      skippedIds: ring1SkippedMissingPoly,
    });
  }

  const outerIdsForHull0 = coreIdsForHull
    .concat(ring1IdsForHull)
    .sort((a, b) => a - b);

  // Build base hulls.
  const innerHull = buildDistrictLoopsFromWards(wardsCopy, coreIdsForHull, {
    preferPoint: centre,
    label: "fort.innerHull(core)",
  });

  let outerHullFinal = buildDistrictLoopsFromWards(
    wardsCopy,
    outerIdsForHull0,
    {
      preferPoint: centre,
      label: "fort.outerHull(core+ring1)",
    }
  );

  // Attach membership metadata (used by downstream debugging).
  innerHull._memberIdsForHull = coreIdsForHull;
  outerHullFinal._memberIdsForHull = outerIdsForHull0;

  // ---- Outer hull closure: optionally promote enclosed wards and rebuild once ----
  let outerIdsForHullFinal = outerIdsForHull0;

  function computeEnclosed({ outerLoop, memberSet }) {
    return computeEnclosedNonMembers({
      wardsCopy,
      outerLoop,
      memberSet,
      idToIndex,
      wardCentroid,
      pointInPolyOrOn,
    });
  }

  if ((outerHullFinal?.holeCount ?? 0) > 0 && params?.outerHullClosureMode === "promote_enclosed") {
    const outerLoop0 = outerHullFinal?.outerLoop;
    const enclosed0 = computeEnclosed({
      outerLoop: outerLoop0,
      memberSet: new Set(outerIdsForHullFinal),
    });

    const memberSet1 = new Set(outerIdsForHullFinal);
    const promoted = promoteEnclosedIds({
      enclosedIds: enclosed0,
      memberSet: memberSet1,
      wardsCopy,
      idToIndex,
      wardHasValidPoly,
    });

    if (promoted.length > 0) {
      outerIdsForHullFinal = Array.from(memberSet1).sort((a, b) => a - b);

      console.warn("[Hulls] outerHull closure: promoting enclosed wards", {
        holeCountBefore: outerHullFinal?.holeCount ?? null,
        promotedCount: promoted.length,
        promotedIds: promoted,
      });

      outerHullFinal = buildDistrictLoopsFromWards(wardsCopy, outerIdsForHullFinal, {
        preferPoint: centre,
        label: "fort.outerHull(core+ring1+closure)",
      });

      outerHullFinal._memberIdsForHull = outerIdsForHullFinal;
    }
  }

  // ---- If holes remain, force a single outer loop deterministically ----
  if (Array.isArray(outerHullFinal?.loops) && outerHullFinal.loops.length > 1) {
    const chosenIdx = selectOuterLoopDeterministic({
      hull: outerHullFinal,
      preferPoint: centre,
      pointInPolyOrOn,
    });

    if (Number.isInteger(chosenIdx)) {
      console.warn("[Hulls] outerHull forcing single outerLoop (ignoring interior loops)", {
        holeCountBefore: outerHullFinal.holeCount,
        loopsBefore: outerHullFinal.loops.length,
        chosenLoopIndex: chosenIdx,
      });

      forceSingleOuterLoopInPlace({
        hull: outerHullFinal,
        chosenIdx,
        preferPoint: centre,
      });
    }
  }

  // ---- Investigation: enclosed non-members on final outer loop ----
  {
    const outerLoop = outerHullFinal?.outerLoop;
    const memberSet = new Set(outerIdsForHullFinal);
    const enclosedFinal = computeEnclosed({ outerLoop, memberSet });

    if ((outerHullFinal?.holeCount ?? 0) > 0 && enclosedFinal.length > 0) {
      console.warn("[Hulls] outerHull enclosed non-members (final)", {
        holeCount: outerHullFinal?.holeCount ?? null,
        members: outerIdsForHullFinal.length,
        enclosedCount: enclosedFinal.length,
        enclosedIds: enclosedFinal,
      });
    } else if (enclosedFinal.length > 0) {
      console.info("[Hulls] outerHull enclosed non-members (final, no-holes)", {
        members: outerIdsForHullFinal.length,
        enclosedCount: enclosedFinal.length,
        enclosedIds: enclosedFinal,
        forcedSingleLoop: !!outerHullFinal?._forcedSingleLoop,
      });
    }
  }

  return {
    coreIds,           // logical membership
    ring1Ids,          // logical membership
    coreIdsForHull,    // geometry-valid membership used for hulls
    ring1IdsForHull,   // geometry-valid membership used for hulls
    outerIdsForHull: outerIdsForHullFinal, // geometry-valid members used for final outer hull
    innerHull,
    outerHull: outerHullFinal,
  };
}
