// docs/src/model/wards/ward_roles.js
//
// Purpose
// - Assign deterministic ward roles based on distance-to-centre ordering.
// - Enforce the required ordering:
//   1) Central ward -> plaza
//   2) Next N wards -> inner (fort wards)
//   3) Next 1 ward -> citadel (also a fort ward)
//   4) Remaining wards -> outside categories (new_town, slums, farms, plains, woods)
//
// Important coupling and invariants
// - This module assumes wards have stable `id` and a stable `distToCentre` value.
// - Sorting uses (distToCentre, id) to break ties deterministically.
// - Roles are data only. Fort generation later should derive its target boundary
//   from the union of wards where role ∈ {plaza, inner, citadel}.
//
// Geometry variant note
// - This module does NOT try to infer "inside fort" vs "outside fort" yet.
//   At this stage, "inner" means "near centre". Later, after fortTargetPoly is
//   built, can refine outside role assignment using containment tests.
//
// Suggested usage
//   const { wards: wardsWithRoles, indices } = assignWardRoles({
//     wards,
//     centre: fortCentre,
//     params: { innerCount: 4 }
//   });
//   model.wards = wardsWithRoles;
//   model.wardRoleIndices = indices;

 /**
  * @typedef {{x:number, y:number}} Point
  * @typedef {{
  *   id:number,
  *   seed:Point,
  *   poly:Point[]|null,
  *   area:number|null,
  *   distToCentre:number,
  *   role?:string,
  *   ringIndex?:number
  * }} Ward
  */

/**
 * @param {object} args
 * @param {Ward[]} args.wards
 * @param {Point} args.centre
 * @param {object} args.params
 * @param {number} [args.params.innerCount] - How many wards after plaza are considered inner wards.
 * @param {object} [args.params.outsideBands] - Optional distance-band based role distribution.
 *  * @returns {{
 *   wards: Ward[],
 *   indices: { plaza:number, citadel:number, inner:number[], outside:number[] },
 *   fortHulls: { coreIds:number[], ring1Ids:number[], innerHull:any, outerHull:any }
 * }}

 */
import { buildDistrictLoopsFromWards } from "../districts.js";
import { pointInPolyOrOn } from "../../geom/poly.js";
import { proposePlugSeq } from "./ward_role_plug.js";
import { wardAdjacency } from "./ward_adjacency.js";
import {
  wardHasValidPoly,
  idsWithMissingPoly,
  filterIdsWithValidPoly,
  wardCentroid,
} from "./ward_shape_utils.js";
import {
  selectOuterLoopDeterministic,
  computeEnclosedNonMembers,
  promoteEnclosedIds,
  farthestMembersSummary,
  forceSingleOuterLoopInPlace,
} from "./ward_role_hulls.js";
import { assignOutsideRolesByBands } from "./ward_role_outside.js";
import { normaliseParams, setRole } from "./ward_role_params.js";
import { selectCoreWards } from "./ward_role_select.js";

export function assignWardRoles({ wards, centre, params }) {
  const p = normaliseParams(params);

  // Defensive copy so caller can keep original list if needed.
  const wardsCopy = wards.map((w) => ({ ...w }));

  const {
    order,
    plazaWard,
    idToIndex,
    plazaIdx,
    citadelId,
    citadelIdx,
    innerIdxs,
    adj,
    outsideOrder,
  } = selectCoreWards({
    wardsCopy,
    centre,
    params: p,
    wardAdjacency,
    // distFn is optional; only pass it if ward_roles.js already defines/imports dist()
    // distFn: dist,
  });
 
  const fortCoreIdxs = (innerArr = innerIdxs) => {
   const arr = Array.isArray(innerArr) ? innerArr : [];
   const out = [];
   if (Number.isInteger(plazaIdx)) out.push(plazaIdx);
 
   const cIdx = idToIndex.get(citadelId);
   if (Number.isInteger(cIdx)) out.push(cIdx);
 
   for (const i of arr) if (Number.isInteger(i)) out.push(i);
   return out;
 };
 
  const fortCoreWardIds = (innerArr = innerIdxs) => {
   const idxs = fortCoreIdxs(innerArr);
   const ids = [];
   for (const i of idxs) {
     const id = wardsCopy[i]?.id;
     if (Number.isFinite(id)) ids.push(id);
   }
   return ids;
 };

 const visited = new Set([plazaIdx]);
  let frontier = [plazaIdx];

  while (frontier.length && innerIdxs.length < innerCount) {
    const nextFrontier = [];
    frontier.sort((a, b) => a - b);

    for (const u of frontier) {
      const nbrs = adj[u] || [];
      for (const v of nbrs) {
        if (visited.has(v)) continue;
        visited.add(v);
        nextFrontier.push(v);

        if (!exclude.has(v)) {
          innerIdxs.push(v);
          if (innerIdxs.length >= innerCount) break;
        }
      }
      if (innerIdxs.length >= innerCount) break;
    }

    frontier = nextFrontier;
  }

  // Fallback: if BFS did not yield enough, fill by distance order deterministically.
  if (innerIdxs.length < innerCount) {
    const excludeIds = new Set([plazaWard.id, citadelId]);
    const already = new Set(innerIdxs.map((i) => wardsCopy[i]?.id));

    for (const w of candidatesByOrder) {
      if (innerIdxs.length >= innerCount) break;
      if (excludeIds.has(w.id)) continue;
      if (already.has(w.id)) continue;
      const idx = idToIndex.get(w.id);
      if (idx === undefined) continue;
      innerIdxs.push(idx);
      already.add(w.id);
    }
  }

  // Now ensure citadel is distinct from plaza and inner wards.
 // If collision, pick next available by order.
 {
   const usedIds = new Set([plazaWard.id, ...innerIdxs.map((i) => wardsCopy[i].id)]);
 
   if (usedIds.has(citadelId)) {
     // Try to pick an alternative citadel.
     const alt = order.find((w) => !usedIds.has(w.id));
     if (alt) {
       citadelId = alt.id;
       citadelIdx = idToIndex.get(citadelId);
     }
 
     // Always ensure citadel is not in innerIdxs, even if no alt exists.
     if (Number.isInteger(citadelIdx)) {
       const pos = innerIdxs.indexOf(citadelIdx);
       if (pos >= 0) innerIdxs.splice(pos, 1);
     }
   }
 }
 
  exclude.clear();
  exclude.add(plazaIdx);
  if (Number.isInteger(citadelIdx)) exclude.add(citadelIdx);

 // Assign plaza + citadel now. Inner is assigned after optional plugging.
  setRole(wardsCopy, plazaWard.id, "plaza");
  setRole(wardsCopy, citadelId, "citadel");

 // Optional: plug holes by adding a few extra inner wards (deterministic).
 const maxPlugAdds = p.maxPlugAdds;
 if (maxPlugAdds > 0) {
   let addsLeft = maxPlugAdds;   
   while (addsLeft > 0) {
     const holesBefore = buildDistrictLoopsFromWards(
      wardsCopy,
      fortCoreWardIds(innerIdxs)
    ).holeCount;

     if (holesBefore === 0) break;
   
     const seq = proposePlugSeq({
       wardsCopy,
       adj,
       plazaIdx,
       citadelId,
       idToIndex,
       innerIdxsNow: innerIdxs,
       maxAddsLeft: addsLeft,
       fortCoreWardIds,
       buildDistrictLoopsFromWards,
     });
     if (!seq || seq.length === 0) break;
   
     // Apply the sequence (bounded by remaining budget)
     for (const v of seq) {
       if (addsLeft <= 0) break;
       if (!innerIdxs.includes(v)) {
         innerIdxs.push(v);
         addsLeft -= 1;
       }
     }
   
    const holesAfter = buildDistrictLoopsFromWards(
     wardsCopy,
     fortCoreWardIds(innerIdxs)
   ).holeCount;

    if (holesAfter >= holesBefore) break;
   }

 }
 
 // Now that innerIdxs is final, assign inner roles and compute innerWards.
 const innerWards = innerIdxs.map((i) => wardsCopy[i]).filter(Boolean);
 for (const w of innerWards) setRole(wardsCopy, w.id, "inner");

 // ---------------- Fort hull memberships: core + ring1 ----------------

  // Core = wards that are inside the fort: plaza + citadel + inner.
  const coreIds = wardsCopy
    .filter((w) => w && (w.role === "plaza" || w.role === "citadel" || w.role === "inner"))
    .map((w) => w.id)
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
 // This prevents null-poly core wards from pulling ring1 membership.
 const coreIdxSet = new Set(
   coreIdsForHull
     .map((id) => idToIndex.get(id))
     .filter((idx) => Number.isInteger(idx))
 );

  // Ring 1 = immediate neighbours of ANY core ward, excluding the core wards themselves.
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

 // Geometry-valid member set used for hull construction and any closure logic.
 const outerIdsForHull0 = coreIdsForHull.concat(ring1IdsForHull).sort((a, b) => a - b);
 const outerIdSetForHull0 = new Set(outerIdsForHull0);
 
 // Logical member set for reporting only (may include null-poly wards).
 const outerIdSetLogical = new Set(coreIds.concat(ring1Ids));

 // Inner Hull = boundary loops of the core region.
 const innerHull = buildDistrictLoopsFromWards(wardsCopy, coreIdsForHull, {
   preferPoint: centre,
   label: "fort.innerHull(core)",
 });
 
 // Outer Hull = boundary loops of the (core + ring1) region.
 const outerHull = buildDistrictLoopsFromWards(
   wardsCopy,
   coreIdsForHull.concat(ring1IdsForHull),
   {
     preferPoint: centre,
     label: "fort.outerHull(core+ring1)",
   }
 );

 outerHull._memberIdsForHull = outerIdsForHull0;
 innerHull._memberIdsForHull = coreIdsForHull;
 
 // ---- Outer hull closure: promote enclosed wards (geometry-valid) and rebuild once ----
let outerHullFinal = outerHull;
let outerIdsForHullFinal = outerIdsForHull0;

// Step 1 (OPTIONAL): closure by promoting enclosed wards.
// Option 1: keep this OFF (default). We want outer hull membership = core + ring1 only.
// Holes are handled by selecting a single deterministic outer loop (Step 2).
if ((outerHullFinal?.holeCount ?? 0) > 0 && p.outerHullClosureMode === "promote_enclosed") {
  const outerLoop0 = outerHullFinal?.outerLoop;
  const enclosed0 = computeEnclosedNonMembers({
    wardsCopy,
    outerLoop: outerLoop0,
    memberSet: new Set(outerIdsForHullFinal),
    idToIndex,
    wardCentroid,
    pointInPolyOrOn,
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

 // Step 2: if holes still remain, force a single outer loop deterministically.
 // This keeps downstream wall warping stable (one curtain trace).
 if (Array.isArray(outerHullFinal?.loops) && outerHullFinal.loops.length > 1) {
   const chosenIdx = selectOuterLoopDeterministic({
    hull: outerHullFinal,
    preferPoint: centre,
    pointInPolyOrOn,
  });
 
   if (Number.isInteger(chosenIdx)) {
     const chosen = outerHullFinal.loops[chosenIdx];
 
     console.warn("[Hulls] outerHull forcing single outerLoop (ignoring interior loops)", {
       holeCountBefore: outerHullFinal.holeCount,
       loopsBefore: outerHullFinal.loops.length,
       chosenLoopIndex: chosenIdx,
       chosenLoopAreaAbs: +Math.abs(signedArea(chosen)).toFixed(3),
     });
 
     // Preserve original loops for debugging.
     forceSingleOuterLoopInPlace({
       hull: outerHullFinal,
       chosenIdx,
       preferPoint: centre,
     });

     if (Array.isArray(outerHullFinal.warnings)) {
       outerHullFinal.warnings = outerHullFinal.warnings.filter((w) => !String(w).includes("holeCount="));
     }
   }
 }

 // ---- Investigation: log enclosed non-members on the final outer loop ----
{
  const outerLoop = outerHullFinal?.outerLoop;
  const memberSet = new Set(outerIdsForHullFinal);

  const enclosedFinal = computeEnclosedNonMembers({
    wardsCopy,
    outerLoop,
    memberSet,
    idToIndex,
    wardCentroid,
    pointInPolyOrOn,
  });

  // Use logical sets for isCore / isRing1 flags (reporting only).
  const coreSet = new Set(coreIds);
  const ring1Set = new Set(ring1Ids);

  // Members farthest (reporting: based on final hull member IDs).
  const summary = farthestMembersSummary({
    wardsCopy,
    memberIds: outerIdsForHullFinal,
    idToIndex,
    topN: 10,
  });
  
  console.info("[Hulls] outerHull members farthest (final)", summary);

  // Enclosed non-members adjacency to ring1 (same as your prior logic).
  let adjacency = null;
  if (typeof adj !== "undefined" && adj) adjacency = adj;
  else if (typeof wardAdj !== "undefined" && wardAdj) adjacency = wardAdj;
  else if (typeof wardAdjacency === "function") adjacency = wardAdjacency(wardsCopy);

  const enclosedAdj = [];
  if (adjacency && enclosedFinal.length) {
    const ring1Set2 = new Set(ring1Ids);
    for (const id of enclosedFinal) {
      const idx = idToIndex.get(id);
      const neighArr =
        Number.isInteger(idx) && Array.isArray(adjacency[idx]) ? adjacency[idx] : [];

      let ring1Touch = 0;
      for (const nbIdx of neighArr) {
        const nbId = wardsCopy[nbIdx]?.id;
        if (Number.isFinite(nbId) && ring1Set2.has(nbId)) ring1Touch += 1;
      }

      const w = Number.isInteger(idx) ? wardsCopy[idx] : null;
      const role = (w && typeof w.role === "string") ? w.role : null;
      const d = (w && Number.isFinite(w.distToCentre)) ? w.distToCentre : null;

      enclosedAdj.push({
        id,
        role,
        dist: Number.isFinite(d) ? +d.toFixed(3) : null,
        ring1Touch,
      });
    }

    enclosedAdj.sort((a, b) => (b.ring1Touch - a.ring1Touch) || (a.id - b.id));

    console.info("[Hulls] outerHull enclosed non-members adjacency (final)", {
      enclosedCount: enclosedAdj.length,
      top: enclosedAdj.slice(0, 15),
    });
  }

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
// ---- End closure + investigation ----

 const fortHulls = {
   coreIds,           // logical membership
   ring1Ids,          // logical membership
   coreIdsForHull,    // geometry-valid membership used for hulls
   ring1IdsForHull,   // geometry-valid membership used for hulls
 
   // New: actual geometry-valid members used for the final outer hull (after closure)
   outerIdsForHull: outerIdsForHullFinal,
 
   innerHull,
   outerHull: outerHullFinal,
 };

 // Optional: export to debug (recommended).
 if (typeof window !== "undefined") {
   window.__wardDebug = window.__wardDebug || {};
   window.__wardDebug.last = window.__wardDebug.last || {};
   window.__wardDebug.last.fortHulls = fortHulls;
 }

  const used = new Set([plazaWard.id, citadelId, ...innerIdxs.map((i) => wardsCopy[i]?.id).filter(Number.isFinite)]);

  // Remaining wards are "outside candidates".
  assignOutsideRolesByBands({
    wards: wardsCopy,
    outsideOrder: outsideOrder,
    params: p,
    setRole,
  });

  // Add a ringIndex for debugging / later logic:
  // ringIndex is just the rank in the distance ordering.
  for (let i = 0; i < order.length; i++) {
    const id = order[i].id;
    const idx = wardsCopy.findIndex((w) => w.id === id);
    if (idx >= 0) wardsCopy[idx].ringIndex = i;
  }

 if (typeof window !== "undefined") {
   window.__wardDebug = window.__wardDebug || {};
   window.__wardDebug.last = window.__wardDebug.last || {};
   const fortCore = buildDistrictLoopsFromWards(
    wardsCopy,
    fortCoreWardIds(innerIdxs)
  );
  
  window.__wardDebug.last.fortCore = {
    plazaId: plazaWard.id,
    citadelId,
    innerIds: innerIdxs.map((i) => wardsCopy[i]?.id).filter(Number.isFinite),
    coreHoleCount: fortCore.holeCount,
    _debug: {
      loops: fortCore.loops,
      outerLoop: fortCore.outerLoop,
    },
  };

 }

  return {
    wards: wardsCopy,
    indices: {
      plaza: plazaWard.id,
      citadel: citadelId,
      inner: innerWards.map((w) => w.id),
      outside: outsideOrder.map((w) => w.id),
    },
    fortHulls,
  };
}

/* ---------------------------- Outside role logic --------------------------- */

/**
 * Deterministic distance-band role assignment.
 *
 * Default pattern (closest to farthest among outside wards):
 * - First ~20%: new_town
 * - Next  ~15%: slums
 * - Next  ~25%: farms
 * - Next  ~20%: plains
 * - Remaining: woods
 *
 * Override via params.outsideBands:
 * {
 *   bands: [
 *     { role: "new_town", pct: 0.2 },
 *     { role: "slums",    pct: 0.15 },
 *     ...
 *   ]
 * }
 */

/* ------------------------------- Utilities -------------------------------- */

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

if (typeof window !== "undefined") {
  window.__wardDebug = window.__wardDebug || {};
  window.__wardDebug.buildDistrictLoopsFromWards = buildDistrictLoopsFromWards;

}
