// docs/src/model/fields/fields_stage_utils.js
//
// Shared helpers for Stage 075 (fields).
// Keep these deterministic and side-effect free.
//
// NOTE on hidden coupling:
// buildWardIdToFaceIdMap assumes CityMesh face ids correspond to VorGraph cell ids.
// This is true if your mesh builder sets cell.id deterministically and the mesh uses
// the same id space for faces.

import { assert } from "../util/assert.js";

export { assert };

export function computeMinMax(arr) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return { min: null, max: null };
  return { min, max };
}

export function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return Number(id) | 0;
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

export function normaliseSourceIds(ids, label) {
  assert(Array.isArray(ids), `${label} sources must be an array.`);
  const arr = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) arr[i] = toIntId(ids[i], label);

  // Sort + de-dupe to remove any accidental order sensitivity.
  arr.sort((a, b) => a - b);

  const out = [];
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (prev === null || v !== prev) out.push(v);
    prev = v;
  }
  return out;
}

export function formatErr(e) {
  if (!e) return "Unknown error";
  const msg = (e && e.message) ? e.message : String(e);
  return msg;
}

export function resolveOptionalSources({ label, resolveFn }) {
  try {
    const ids = resolveFn();
    if (!ids || ids.length === 0) {
      return { ids: null, error: `${label} sources resolved to an empty set.` };
    }
    return { ids: normaliseSourceIds(ids, label), error: null };
  } catch (e) {
    return { ids: null, error: formatErr(e) };
  }
}

function getCanonicalWardsArray(ctx) {
  const wardsState = ctx?.state?.wards;
  if (Array.isArray(wardsState?.wardsWithRoles)) return wardsState.wardsWithRoles;
  if (Array.isArray(wardsState)) return wardsState; // legacy fallback only
  return null;
}

export function buildWardIdToFaceIdMap({ ctx, routingMesh, meshAccess }) {
  try {
    const canonicalWards = getCanonicalWardsArray(ctx);
    const wardCount = Array.isArray(canonicalWards) ? canonicalWards.length : null;

    const expectedWardIds = new Set();
    if (canonicalWards) {
      for (let i = 0; i < canonicalWards.length; i++) {
        const w = canonicalWards[i];
        if (!w) continue;
        const wid = Number.isInteger(w.id) ? w.id : (w.id | 0);
        if (wid >= 0) expectedWardIds.add(wid);
      }
    }

    const cellOwnership =
      (routingMesh && Array.isArray(routingMesh.cellOwnership)) ? routingMesh.cellOwnership :
      (routingMesh && Array.isArray(routingMesh.ownership)) ? routingMesh.ownership :
      [];

    if (!Array.isArray(cellOwnership) || cellOwnership.length === 0) {
      return {
        map: null,
        meta: null,
        error: "Missing routingMesh.cellOwnership (or routingMesh.ownership).",
      };
    }

    let maxWardId = -1;
    for (let i = 0; i < cellOwnership.length; i++) {
      const rec = cellOwnership[i];
      if (!rec) continue;
      const wid = Number.isInteger(rec?.wardId) ? rec.wardId : (rec?.wardId | 0);
      if (wid > maxWardId) maxWardId = wid;
    }

    const inferredCount = maxWardId >= 0 ? (maxWardId + 1) : 0;
    const finalCount = wardCount != null ? Math.max(wardCount, inferredCount) : inferredCount;
    const wardIdToFaceId = new Array(finalCount).fill(null);

    let assignedCount = 0;

    for (let i = 0; i < cellOwnership.length; i++) {
      const rec = cellOwnership[i];
      if (!rec) continue;

      const wardId = Number.isInteger(rec.wardId) ? rec.wardId : (rec.wardId | 0);
      if (wardId < 0 || wardId >= wardIdToFaceId.length) continue;

      const cellIndex = i;

      // Contract assumption:
      // CityMesh interior face ids are expected to preserve source Voronoi cell ids.
      // The cellIndex fallback is legacy-tolerant only.
      const faceId = Number.isInteger(rec.cell?.id) ? rec.cell.id : cellIndex;
      if (!Number.isInteger(faceId) || faceId < 0) continue;

      if (wardIdToFaceId[wardId] == null) assignedCount++;
      wardIdToFaceId[wardId] = faceId;
    }

    const missingExpectedWardIds = [];
    if (expectedWardIds.size > 0) {
      for (const wid of expectedWardIds) {
        if (wid < 0 || wid >= wardIdToFaceId.length || !Number.isInteger(wardIdToFaceId[wid])) {
          missingExpectedWardIds.push(wid);
        }
      }
    }

    return {
      map: wardIdToFaceId,
      meta: {
        wardCount,
        maxWardId,
        assignedCount,
        expectedWardIdCount: expectedWardIds.size,
        missingExpectedWardIds,
        wardSource: "ctx.state.wards.wardsWithRoles",
        faceIdContract: "CityMesh interior face ids must preserve source Voronoi cell ids.",
      },
      error: null,
    };
  } catch (err) {
    return {
      map: null,
      meta: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function assertStrictAscendingIntIds(ids, label) {
  assert(Array.isArray(ids) && ids.length > 0, `${label}: expected non-empty id set.`);
  let prev = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    const v = ids[i];
    assert((v | 0) === v, `${label}: id not int at i=${i}: ${v}`);
    assert(v >= 0, `${label}: id negative at i=${i}: ${v}`);
    assert(v > prev, `${label}: ids not strictly ascending at i=${i}: ${prev} then ${v}`);
    prev = v;
  }
}

export function computeFiniteStats(arr) {
  let finiteCount = 0;
  let nonFiniteCount = 0;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) finiteCount++;
    else nonFiniteCount++;
  }
  return { finiteCount, nonFiniteCount };
}

export function computeFieldStats(values) {
  const mm = computeMinMax(values);
  const counts = computeFiniteStats(values);
  return {
    min: mm.min,
    max: mm.max,
    finiteCount: counts.finiteCount,
    nonFiniteCount: counts.nonFiniteCount,
  };
}

export function pickFirstPresent(candidates) {
  // candidates: Array<[keyName: string, value: any]>
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i][0];
    const val = candidates[i][1];
    if (val) return { key, value: val };
  }
  return { key: null, value: null };
}
