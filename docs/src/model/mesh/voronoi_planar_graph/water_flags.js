// docs/src/model/mesh/voronoi_planar_graph/water_flags.js

import { isFinitePoint, pointToPolylineDistance } from "./util.js";

function pickWaterPolyline(waterModel) {
  if (!waterModel || typeof waterModel !== "object") return null;

  if (Array.isArray(waterModel.shoreline) && waterModel.shoreline.length >= 2) return waterModel.shoreline;
  if (Array.isArray(waterModel.coast) && waterModel.coast.length >= 2) return waterModel.coast;
  if (Array.isArray(waterModel.river) && waterModel.river.length >= 2) return waterModel.river;

  return null;
}

function toIdSet(maybeIds) {
  if (!maybeIds) return null;
  if (maybeIds instanceof Set) return maybeIds;
  if (Array.isArray(maybeIds)) return new Set(maybeIds);
  return null;
}

// Apply water flags using one of two mechanisms:
// 1) Exact edge id sets: waterModel.mesh.{riverEdgeIds, coastEdgeIds, waterEdgeIds}
// 2) Legacy proximity to a geometric water polyline.
export function computeWaterFlagForEdge(edge, nodes, waterModel, params) {
  if (!edge) return { isWater: false, waterKind: null };

  const mesh = (waterModel && waterModel.mesh && typeof waterModel.mesh === "object") ? waterModel.mesh : null;
  const riverSet = toIdSet(mesh && mesh.riverEdgeIds);
  const coastSet = toIdSet(mesh && mesh.coastEdgeIds);
  const waterSet = toIdSet(mesh && mesh.waterEdgeIds);

  // Prefer explicit sets when present.
  if (riverSet || coastSet || waterSet) {
    const isCoast = coastSet ? coastSet.has(edge.id) : false;
    const isRiver = riverSet ? riverSet.has(edge.id) : false;
    const isWaterGeneric = waterSet ? waterSet.has(edge.id) : false;

    const isWater = Boolean(isCoast || isRiver || isWaterGeneric);

    // If multiple apply, prefer coast.
    const waterKind = isCoast ? "coast" : (isRiver ? "river" : (isWaterGeneric ? "water" : null));
    return { isWater, waterKind };
  }

  // Legacy: treat as water if close to generated polyline.
  const waterLine = pickWaterPolyline(waterModel);
  if (!waterLine) return { isWater: false, waterKind: null };

  const a = nodes[edge.a];
  const b = nodes[edge.b];
  if (!a || !b) return { isWater: false, waterKind: null };

  const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  const clearance = (params && Number.isFinite(params.roadWaterClearance)) ? params.roadWaterClearance : 20;
  const isWater = pointToPolylineDistance(mid, waterLine) <= clearance;
  const waterKind = isWater ? (waterModel && waterModel.kind ? String(waterModel.kind) : "water") : null;
  return { isWater, waterKind };
}

export function applyDeterministicEdgeFlags({ edges, nodes, waterModel, anchors, params }) {
  const p = (params && typeof params === "object") ? params : {};

  const citadelPt = (anchors && isFinitePoint(anchors.citadel)) ? anchors.citadel : null;
  const citadelAvoidRadius = Number.isFinite(p.roadCitadelAvoidRadius) ? p.roadCitadelAvoidRadius : 80;

  for (const e of edges) {
    if (!e || e.disabled) continue;
    if (!e.flags || typeof e.flags !== "object") {
      e.flags = { isWater: false, nearCitadel: false };
    }

    const a = nodes[e.a];
    const b = nodes[e.b];
    const m = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };

    if (citadelPt) {
      e.flags.nearCitadel = Math.hypot(m.x - citadelPt.x, m.y - citadelPt.y) <= citadelAvoidRadius;
    }

    const wf = computeWaterFlagForEdge(e, nodes, waterModel, p);
    e.flags.isWater = Boolean(wf && wf.isWater);
    if (wf && wf.waterKind) e.flags.waterKind = wf.waterKind;
  }
}
