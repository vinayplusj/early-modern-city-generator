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
// 4.8 integration (Deterministic fields)
// - If params.useFieldsForCoreOrdering is true and fields contain distance_to_plaza_face,
//   this module will overwrite distToCentre with that field value (per ward id),
//   while preserving the old value in distToCentreLegacy for debugging.
// - This keeps behaviour unchanged unless explicitly enabled.
//
// Geometry variant note
// - This module does NOT try to infer "inside fort" vs "outside fort" yet.
//   At this stage, "inner" means "near centre". Later, after fortTargetPoly is
//   built, can refine outside role assignment using containment tests.

 /**
  * @typedef {{x:number, y:number}} Point
  * @typedef {{
  *   id:number,
  *   seed:Point,
  *   poly:Point[]|null,
  *   area:number|null,
  *   distToCentre:number,
  *   distToCentreLegacy?:number,
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
 * @param {boolean} [args.params.useFieldsForCoreOrdering] - If true, use distance fields for ordering.
 * @param {string} [args.params.coreOrderingFieldName] - Defaults to "distance_to_plaza_face".
 * @param {object} [args.fields] - FieldRegistry (ctx.state.fields)
 * @param {object} [args.meshAccess] - meshAccess (makeMeshAccessFromCityMesh(cityMesh)), optional
 * @param {object} [args.fieldsMeta] - ctx.state.fieldsMeta (expects wardIdToFaceId when using face fields)
 * @returns {{
 *   wards: Ward[],
 *   indices: { plaza:number, citadel:number, inner:number[], outside:number[] },
 *   fortHulls: { coreIds:number[], ring1Ids:number[], innerHull:any, outerHull:any }
 * }}
 */
import { buildDistrictLoopsFromWards } from "../mesh/district_loops_from_wards.js";
import { pointInPolyOrOn } from "../../geom/poly.js";
import { proposePlugSeq } from "./ward_role_plug.js";
import { wardAdjacency } from "./ward_adjacency.js";
import { assignOutsideRolesByBands } from "./ward_role_outside.js";
import { normaliseParams, setRole } from "./ward_role_params.js";
import { selectCoreWards } from "./ward_role_select.js";
import { buildFortHulls } from "./ward_role_build_hulls.js";
import { pickNearestVertexId } from "../fields/field_sources.js";
import { makeVertexIdToIndex } from "../fields/field_api.js";
import { assert } from "../util/assert.js";

function getWardField01(ward, key) {
  if (!ward || !ward.field) return null;
  const v = ward.field[key];
  if (!Number.isFinite(v)) return null;
  // Guard against accidental out-of-range values.
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function getFaceFieldValue(fields, meshAccess, fieldName, faceId) {
  const rec = fields.get(fieldName);
  // If you later expose faceIdToIndex on meshAccess, prefer it.
  if (meshAccess && typeof meshAccess.faceIdToIndex === "function") {
    const idx = meshAccess.faceIdToIndex(faceId);
    assert(Number.isInteger(idx) && idx >= 0 && idx < rec.values.length, `faceIdToIndex(${faceId}) out of range for field "${fieldName}".`);
    return rec.values[idx];
  }
  // Fallback: assume faceId is a dense index.
  assert(Number.isInteger(faceId) && faceId >= 0 && faceId < rec.values.length, `Face id ${faceId} out of range for field "${fieldName}".`);
  return rec.values[faceId];
}

function resolveFaceIdForWard({ wardId, fieldsMeta }) {
  if (!fieldsMeta || !Array.isArray(fieldsMeta.wardIdToFaceId)) return null;

  const arr = fieldsMeta.wardIdToFaceId;
  if (!Number.isInteger(wardId) || wardId < 0 || wardId >= arr.length) return null;

  const faceId = arr[wardId];
  if (!Number.isInteger(faceId) || faceId < 0) return null;

  return faceId;
}

function getVertexFieldValueAtPoint(fields, meshAccess, fieldName, p, vertexIdToIndex) {
  assert(meshAccess && typeof meshAccess.iterVertexIds === "function", "Vertex field sampling requires meshAccess.iterVertexIds().");
  assert(meshAccess && typeof meshAccess.vertexXY === "function", "Vertex field sampling requires meshAccess.vertexXY(vId).");
  assert(p && Number.isFinite(p.x) && Number.isFinite(p.y), "Vertex field sampling requires p={x,y} with finite numbers.");

  const rec = fields.get(fieldName);
  const vId = pickNearestVertexId(meshAccess, p);
  const idx = vertexIdToIndex(vId);

  assert(Number.isInteger(idx) && idx >= 0 && idx < rec.values.length, `vertexIdToIndex(${vId}) out of range for field "${fieldName}".`);
  return rec.values[idx];
}

export function assignWardRoles({ wards, centre, params, fields, fieldsMeta, meshAccess }) {
  const p = normaliseParams(params);

  // Defensive copy so caller can keep original list if needed.
  const wardsCopy = wards.map((w) => ({ ...w }));

  // ------------------------------------------------------------
  // 4.8: Optional replacement of distToCentre using deterministic fields
  // ------------------------------------------------------------
  const useFieldsForCoreOrdering = !!p.useFieldsForCoreOrdering;
  const coreOrderingFieldName = p.coreOrderingFieldName || "distance_to_plaza_face";

  if (useFieldsForCoreOrdering) {
    // Prefer Stage 085 ward metrics when available.
    let usedWardMetric = false;
    
    // Allow ward-level field keys here.
    // For now, the expected keys are Stage 085 outputs such as:
    //   distPlaza01, distWall01, distWater01
    const wardMetricFieldName =
      typeof coreOrderingFieldName === "string" &&
      /^dist[A-Z].*01$/.test(coreOrderingFieldName)
        ? coreOrderingFieldName
        : "distPlaza01";
    
    for (let i = 0; i < wardsCopy.length; i++) {
      const w = wardsCopy[i];
      const v01 = getWardField01(w, wardMetricFieldName);
      if (v01 != null) {
        w.distToCentreLegacy = w.distToCentre;
        w.distToCentre = v01;
        usedWardMetric = true;
      }
    }
    
    if (usedWardMetric) {
      wardsCopy._coreOrderingField = {
        requested: coreOrderingFieldName,
        used: `ward.field.${wardMetricFieldName}`,
        mode: "ward_metric_01",
        hasWardIdToFaceId: !!(fieldsMeta && Array.isArray(fieldsMeta.wardIdToFaceId)),
      };
    } else {
      // Fall back to FieldRegistry sampling logic.
      assert(fields && typeof fields.get === "function", "useFieldsForCoreOrdering=true requires a FieldRegistry in args.fields.");

      let fieldNameUsed = coreOrderingFieldName;
      let mode = "face";

      if (!fields.has(fieldNameUsed)) {
        if (fieldNameUsed === "distance_to_plaza_face" && fields.has("distance_to_plaza_vertex")) {
          fieldNameUsed = "distance_to_plaza_vertex";
          mode = "vertex_at_seed";
        } else {
          throw new Error(`Missing required field "${coreOrderingFieldName}" for core ordering, and no supported fallback is available.`);
        }
      }

      const vertexIdToIndex = (mode === "vertex_at_seed")
        ? (assert(meshAccess, "vertex_at_seed field sampling requires meshAccess."), makeVertexIdToIndex(meshAccess))
        : null;

      for (let i = 0; i < wardsCopy.length; i++) {
        const w = wardsCopy[i];
        w.distToCentreLegacy = w.distToCentre;

        if (mode === "face") {
          const faceId = resolveFaceIdForWard({ wardId: w.id, fieldsMeta });
          assert(Number.isInteger(faceId), `useFieldsForCoreOrdering: missing fieldsMeta.wardIdToFaceId mapping for wardId=${w.id}.`);
          w.distToCentre = getFaceFieldValue(fields, meshAccess, fieldNameUsed, faceId);
        } else {
          w.distToCentre = getVertexFieldValueAtPoint(fields, meshAccess, fieldNameUsed, w.seed, vertexIdToIndex);
        }

        assert(Number.isFinite(w.distToCentre), `Non-finite field value for ward id ${w.id} using field "${fieldNameUsed}" (${mode}).`);
      }

      wardsCopy._coreOrderingField = {
        requested: coreOrderingFieldName,
        used: fieldNameUsed,
        mode,
        hasWardIdToFaceId: !!(fieldsMeta && Array.isArray(fieldsMeta.wardIdToFaceId)),
      };
    }
  }

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
      plaza: plazaIdx,
      citadel: citadelIdx,
      inner: innerIdxs.slice(),
      outside: outsideOrder.map((w) => w.id),
    },
    fortHulls,
  };
}
