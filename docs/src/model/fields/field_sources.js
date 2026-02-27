// docs/src/model/fields/field_sources.js
//
// Milestone 4.8: Deterministic source selection for base distance fields.
//
// This module is intentionally strict and does not guess silently.
// It provides small, explicit utilities to turn known anchors / bindings into
// sets of vertex ids suitable for multi-source Dijkstra.
//
// Current v1 strategy (safe, deterministic):
// - Plaza sources: nearest vertex to anchors.plaza (ties broken by smaller vertex id)
// - Wall sources: explicit list from meshAccess.wallSourceVertexIds() OR caller-provided list
// - Water sources: explicit list from meshAccess.waterSourceVertexIds() OR caller-provided list
//
// This avoids hidden coupling to unstable geometry. If wall/water bindings are not yet exposed
// by the pipeline, this file will throw with clear messages until you wire those bindings.
//
// Expected meshAccess hooks (you will add as needed):
// - iterVertexIds() -> stable iteration order
// - vertexXY(vId) -> {x,y} in world coords
// - wallSourceVertexIds() -> Array<vertexId>   (optional, if you expose wall binding)
// - waterSourceVertexIds() -> Array<vertexId>  (optional, if you expose water snapping)
//
// NOTE: We do not require pointToFaceId(p) here.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFiniteXY(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return (Number(id) | 0);
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

function dedupeSortIntIds(ids, label) {
  const m = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = toIntId(ids[i], label);
    if (!m.has(id)) m.set(id, true);
  }
  const out = Array.from(m.keys());
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Deterministically choose the nearest vertex id to a point.
 * Tie-break: smaller vertex id wins.
 *
 * @param {object} meshAccess
 * @param {{x:number,y:number}} p
 * @returns {number} vertexId
 */
export function pickNearestVertexId(meshAccess, p) {
  assert(meshAccess, "pickNearestVertexId requires meshAccess.");
  assert(typeof meshAccess.iterVertexIds === "function", "pickNearestVertexId requires meshAccess.iterVertexIds().");
  assert(typeof meshAccess.vertexXY === "function", "pickNearestVertexId requires meshAccess.vertexXY(vId).");
  assert(isFiniteXY(p), "pickNearestVertexId requires p={x,y} with finite numbers.");

  let bestId = null;
  let bestD2 = Infinity;

  for (const vIdRaw of meshAccess.iterVertexIds()) {
    const vId = toIntId(vIdRaw, "vertex");
    const xy = meshAccess.vertexXY(vId);
    assert(xy && Number.isFinite(xy.x) && Number.isFinite(xy.y), "meshAccess.vertexXY(vId) must return finite x,y.");

    const dx = xy.x - p.x;
    const dy = xy.y - p.y;
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2 || (d2 === bestD2 && (bestId == null || vId < bestId))) {
      bestD2 = d2;
      bestId = vId;
    }
  }

  assert(bestId != null, "pickNearestVertexId failed to select a vertex.");
  return bestId;
}

/**
 * Compute plaza source vertices from anchors.
 *
 * v1: single nearest vertex to anchors.plaza
 * Future: include a small k-ring around the nearest vertex for smoother basins.
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {object} args.anchors - expects anchors.plaza = {x,y}
 * @returns {number[]} sorted unique vertex ids
 */
export function getPlazaSourceVertexIds(args) {
  assert(args && args.meshAccess, "getPlazaSourceVertexIds requires args.meshAccess.");
  assert(args.anchors, "getPlazaSourceVertexIds requires args.anchors.");
  const plaza = args.anchors.plaza;
  assert(isFiniteXY(plaza), "anchors.plaza must be {x,y} with finite numbers.");

  const v0 = pickNearestVertexId(args.meshAccess, plaza);
  return [v0];
}

/**
 * Get wall source vertices.
 *
 * Preferred: meshAccess.wallSourceVertexIds() (exposed from wall binding layer)
 * Fallback: caller-provided args.wallVertexIds (explicit list)
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {Array<number|string>} [args.wallVertexIds]
 * @returns {number[]} sorted unique vertex ids
 */
export function getWallSourceVertexIds(args) {
  assert(args && args.meshAccess, "getWallSourceVertexIds requires args.meshAccess.");
  const ma = args.meshAccess;

  let ids = null;

  if (typeof ma.wallSourceVertexIds === "function") {
    ids = ma.wallSourceVertexIds();
  } else if (Array.isArray(args.wallVertexIds)) {
    ids = args.wallVertexIds;
  }

  assert(Array.isArray(ids) && ids.length > 0, "Wall sources are not available. Provide meshAccess.wallSourceVertexIds() or pass wallVertexIds explicitly.");
  return dedupeSortIntIds(ids, "vertex");
}

/**
 * Get water source vertices.
 *
 * Preferred: meshAccess.waterSourceVertexIds() (exposed from water snapping layer)
 * Fallback: caller-provided args.waterVertexIds (explicit list)
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {Array<number|string>} [args.waterVertexIds]
 * @returns {number[]} sorted unique vertex ids
 */
export function getWaterSourceVertexIds(args) {
  assert(args && args.meshAccess, "getWaterSourceVertexIds requires args.meshAccess.");
  const ma = args.meshAccess;

  let ids = null;

  if (typeof ma.waterSourceVertexIds === "function") {
    ids = ma.waterSourceVertexIds();
  } else if (Array.isArray(args.waterVertexIds)) {
    ids = args.waterVertexIds;
  }

  assert(Array.isArray(ids) && ids.length > 0, "Water sources are not available. Provide meshAccess.waterSourceVertexIds() or pass waterVertexIds explicitly.");
  return dedupeSortIntIds(ids, "vertex");
}

/**
 * Convenience: gather all base sources in one call.
 *
 * @param {object} args
 * @param {object} args.meshAccess
 * @param {object} args.anchors
 * @param {Array<number|string>} [args.wallVertexIds]
 * @param {Array<number|string>} [args.waterVertexIds]
 * @returns {{plaza:number[], wall:number[], water:number[]}}
 */
export function getBaseDistanceFieldSources(args) {
  return {
    plaza: getPlazaSourceVertexIds(args),
    wall: getWallSourceVertexIds(args),
    water: getWaterSourceVertexIds(args),
  };
}
