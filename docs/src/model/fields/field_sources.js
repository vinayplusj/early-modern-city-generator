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
import { assert } from "../util/assert.js";
import { toIntId } from "../util/ids.js";

function isFiniteXY(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
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

function samplePolylineDeterministic(polyline, step) {
  assert(Array.isArray(polyline) && polyline.length >= 2, "samplePolylineDeterministic requires polyline length >= 2.");
  assert(Number.isFinite(step) && step > 0, "samplePolylineDeterministic requires finite step > 0.");

  const pts = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (!isFiniteXY(a) || !isFiniteXY(b)) continue;

    // Always include segment start.
    pts.push({ x: a.x, y: a.y });

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (!Number.isFinite(L) || L <= 0) continue;

    // Insert interior points at distances: step, 2*step, ...
    const n = Math.floor(L / step);
    for (let k = 1; k <= n; k++) {
      const d = k * step;
      if (d >= L) break;
      const t = d / L;
      pts.push({ x: a.x + dx * t, y: a.y + dy * t });
    }
  }

  // Always include last point.
  const last = polyline[polyline.length - 1];
  if (isFiniteXY(last)) pts.push({ x: last.x, y: last.y });

  return pts;
}

function polylineToNearestVertexIds(meshAccess, polyline, step) {
  const pts = samplePolylineDeterministic(polyline, step);
  assert(pts.length > 0, "Polyline sampling produced no points.");

  const ids = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    ids[i] = pickNearestVertexId(meshAccess, pts[i]);
  }
  return dedupeSortIntIds(ids, "vertex");
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
  } else if (Array.isArray(args.wallVertexIds) && args.wallVertexIds.length > 0) {
    ids = args.wallVertexIds;
  } else if (Array.isArray(args.wallPolyline) && args.wallPolyline.length >= 2) {
    const step = (args.wallSampleStep == null) ? 20 : Number(args.wallSampleStep);
    assert(Number.isFinite(step) && step > 0, "Invalid wallSampleStep.");
    ids = polylineToNearestVertexIds(ma, args.wallPolyline, step);
  }

  assert(Array.isArray(ids) && ids.length > 0, "Wall sources are not available. Provide meshAccess.wallSourceVertexIds() or pass wallVertexIds explicitly.");
  return dedupeSortIntIds(ids, "vertex");
}

/**
 * Derive source vertex ids from graph edge ids (deterministic).
 * Intended for water: shorelineEdgeIds / riverEdgeIds -> vertex ids (edge endpoints).
 *
 * @param {object} args
 * @param {object} args.graph - { edges: Array<{a:number,b:number}> }
 * @param {Array<number|string>} args.edgeIds
 * @param {string} [args.label] - used for error messages
 * @returns {number[]} sorted unique vertex ids
 */
export function deriveVertexIdsFromGraphEdgeIds(args) {
  assert(args && args.graph, "deriveVertexIdsFromGraphEdgeIds requires args.graph.");
  assert(Array.isArray(args.graph.edges), "deriveVertexIdsFromGraphEdgeIds requires graph.edges array.");
  assert(Array.isArray(args.edgeIds), "deriveVertexIdsFromGraphEdgeIds requires args.edgeIds array.");

  const label = args.label || "edge";

  const vIds = [];
  for (let i = 0; i < args.edgeIds.length; i++) {
    const eid = toIntId(args.edgeIds[i], label);
    if (eid < 0 || eid >= args.graph.edges.length) continue;

    const e = args.graph.edges[eid];
    if (!e) continue;

    // Expected edge shape: { id, a, b, ... }
    if (Number.isInteger(e.a)) vIds.push(e.a);
    if (Number.isInteger(e.b)) vIds.push(e.b);
  }

  assert(vIds.length > 0, "deriveVertexIdsFromGraphEdgeIds: no vertex ids could be derived from edgeIds.");
  return dedupeSortIntIds(vIds, "vertex");
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
  } else if (Array.isArray(args.waterVertexIds) && args.waterVertexIds.length > 0) {
    ids = args.waterVertexIds;
  } else if (args.graph && Array.isArray(args.waterEdgeIds) && args.waterEdgeIds.length > 0) {
    ids = deriveVertexIdsFromGraphEdgeIds({
      graph: args.graph,
      edgeIds: args.waterEdgeIds,
      label: "water edge",
    });
  }

  assert(
    Array.isArray(ids) && ids.length > 0,
    "Water sources are not available. Provide meshAccess.waterSourceVertexIds(), pass waterVertexIds explicitly, or provide graph + waterEdgeIds."
  );
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
