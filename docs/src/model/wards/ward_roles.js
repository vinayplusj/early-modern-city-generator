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
import { assignOutsideRolesByBands } from "./ward_role_outside.js";
import { normaliseParams, setRole } from "./ward_role_params.js";
import { selectCoreWards } from "./ward_role_select.js";
import { buildFortHulls } from "./ward_role_build_hulls.js";

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

 const fortHulls = buildFortHulls({
   wardsCopy,
   centre,
   idToIndex,
   adj,
   plazaId: plazaWard.id,
   citadelId,
   innerIds: innerIdxs.map((i) => wardsCopy[i]?.id).filter(Number.isFinite),
   params: p,
   buildDistrictLoopsFromWards,
   pointInPolyOrOn,
 });
 // Now that innerIdxs is final, assign inner roles and compute innerWards.
 const innerWards = innerIdxs.map((i) => wardsCopy[i]).filter(Boolean);
 for (const w of innerWards) setRole(wardsCopy, w.id, "inner");

 // Optional: export to debug (recommended).
 if (typeof window !== "undefined") {
   window.__wardDebug = window.__wardDebug || {};
   window.__wardDebug.last = window.__wardDebug.last || {};
   window.__wardDebug.last.fortHulls = fortHulls;
 }

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
    const idx = idToIndex.get(id);
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
