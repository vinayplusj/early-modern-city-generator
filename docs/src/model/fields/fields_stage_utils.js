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

export function buildWardIdToFaceIdMap({ ctx, routingMesh, meshAccess }) {
  const vorGraph = routingMesh && routingMesh.vorGraph;
  if (!vorGraph || !Array.isArray(vorGraph.cells)) {
    return {
      map: null,
      meta: null,
      error: "Missing routingMesh.vorGraph.cells (Stage 70 output not persisted).",
    };
  }

  const wardCount =
    (ctx.state.wards && Array.isArray(ctx.state.wards) && ctx.state.wards.length)
      ? (ctx.state.wards.length | 0)
      : null;

  // Determine required length if wardCount is not available.
  let maxWardId = -1;
  for (let i = 0; i < vorGraph.cells.length; i++) {
    const c = vorGraph.cells[i];
    if (!c || c.disabled) continue;
    const wId = toIntId(c.wardId, "ward");
    if (wId > maxWardId) maxWardId = wId;
  }

  const n = (wardCount != null) ? wardCount : (maxWardId + 1);
  const faceIdByWardId = new Array(n);
  for (let i = 0; i < n; i++) faceIdByWardId[i] = -1;

  let assigned = 0;

  for (let cellIndex = 0; cellIndex < vorGraph.cells.length; cellIndex++) {
    const c = vorGraph.cells[cellIndex];
    if (!c || c.disabled) continue;

    const wardId = toIntId(c.wardId, "ward");

    // Hidden coupling:
    // In this repo, CityMesh face id is the VorGraph cell id.
    // If your builder sets cell.id deterministically, this is stable.
    const faceId = (c.id != null) ? toIntId(c.id, "face") : (cellIndex | 0);

    if (wardCount != null) {
      assert(wardId >= 0 && wardId < n, `wardId out of range: ${wardId} (wardCount=${n})`);
    } else {
      assert(wardId >= 0 && wardId < n, `wardId out of inferred range: ${wardId} (n=${n})`);
    }

    assert(
      faceIdByWardId[wardId] === -1,
      `Duplicate wardId mapping: wardId=${wardId} already mapped to faceId=${faceIdByWardId[wardId]}`
    );

    // Sanity check: face id should exist on the mesh.
    if (typeof meshAccess.faceCount === "function") {
      const fc = meshAccess.faceCount();
      assert(faceId >= 0 && faceId < fc, `Mapped faceId out of range: faceId=${faceId} (faceCount=${fc})`);
    }

    faceIdByWardId[wardId] = faceId;
    assigned++;
  }

  // Count missing ward ids.
  let missing = 0;
  for (let i = 0; i < faceIdByWardId.length; i++) if (faceIdByWardId[i] === -1) missing++;

  const meta = {
    wardCount: n,
    assigned,
    missing,
    source: "routingMesh.vorGraph.cells[*].{wardId,id}",
  };

  // If wardCount is known, missing mappings are a hard error.
  if (wardCount != null) {
    assert(missing === 0, `Ward→face mapping incomplete: missing=${missing} of wardCount=${n}`);
  }

  return { map: faceIdByWardId, meta, error: null };
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
