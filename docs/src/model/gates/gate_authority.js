// docs/src/model/gates/gate_authority.js
//
// Milestone 5A: canonical gate authority.
// This binds each snapped gate to:
// - its wall segment,
// - its CityMesh boundary portal,
// - its outer-boundary exit,
// - its primary/secondary role.
//
// This file must not move geometry. It only records authority.

import { isFinitePoint } from "../../geom/primitives.js";

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clonePoint(p) {
  return isFinitePoint(p) ? { x: p.x, y: p.y } : null;
}

function unitOrNull(v) {
  const m = Math.hypot(v.x, v.y);
  if (!Number.isFinite(m) || m <= 1e-9) return null;
  return { x: v.x / m, y: v.y / m };
}

function projectPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;

  let t = 0;
  if (ab2 > 1e-12) {
    t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
  }

  const point = {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };

  return {
    t,
    point,
    distance: Math.sqrt(dist2(p, point)),
  };
}

function nearestSegmentOnClosedPolyline(p, poly) {
  if (!isFinitePoint(p) || !Array.isArray(poly) || poly.length < 3) return null;

  let best = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

    const projected = projectPointToSegment(p, a, b);

    if (
      !best ||
      projected.distance < best.distance - 1e-9 ||
      (
        Math.abs(projected.distance - best.distance) <= 1e-9 &&
        i < best.segmentIndex
      )
    ) {
      best = {
        segmentIndex: i,
        t: projected.t,
        point: projected.point,
        distance: projected.distance,
      };
    }
  }

  return best;
}

function findPrimaryGateId(gates, primaryGate, fallback = 0) {
  if (!Array.isArray(gates) || gates.length === 0) return null;
  if (!isFinitePoint(primaryGate)) return fallback;

  let bestId = null;
  let bestD2 = Infinity;

  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (!isFinitePoint(g)) continue;

    const d = dist2(g, primaryGate);
    if (d < bestD2 - 1e-9 || (Math.abs(d - bestD2) <= 1e-9 && i < bestId)) {
      bestId = i;
      bestD2 = d;
    }
  }

  return Number.isInteger(bestId) ? bestId : fallback;
}

function normalisePortal(portal) {
  if (!portal || typeof portal !== "object") return null;

  return {
    gateId: Number.isInteger(portal.gateId) ? portal.gateId : null,
    point: clonePoint(portal.point),
    loopId: Number.isInteger(portal.loopId) ? portal.loopId : null,
    boundaryHalfEdgeId: Number.isInteger(portal.boundaryHalfEdgeId) ? portal.boundaryHalfEdgeId : null,
    t: Number.isFinite(portal.t) ? portal.t : null,
    interiorFaceId: Number.isInteger(portal.interiorFaceId) ? portal.interiorFaceId : null,
  };
}

function normaliseBoundaryExit(exit) {
  if (!exit || typeof exit !== "object") return null;

  return {
    exitId: Number.isInteger(exit.exitId) ? exit.exitId : null,
    kind: typeof exit.kind === "string" ? exit.kind : null,
    gateId: Number.isInteger(exit.gateId) ? exit.gateId : null,
    portalGateId: Number.isInteger(exit.portalGateId) ? exit.portalGateId : null,
    point: clonePoint(exit.point),
    outerBoundarySegIndex: Number.isInteger(exit.outerBoundarySegIndex)
      ? exit.outerBoundarySegIndex
      : null,
    t: Number.isFinite(exit.t) ? exit.t : null,
    outward: unitOrNull(exit.outward),
    sourcePoint: clonePoint(exit.sourcePoint),
  };
}

/**
 * @param {object} args
 * @param {Array<{x:number,y:number}>} args.gates
 * @param {{x:number,y:number}|null} args.primaryGate
 * @param {Array<{x:number,y:number}>} args.wallForGateSnap
 * @param {Array<object>} args.gatePortals
 * @param {Array<object>} args.boundaryExits
 * @param {{x:number,y:number}} args.centre
 * @param {number} args.wallTolerance
 */
export function buildGateAuthority({
  gates,
  primaryGate,
  wallForGateSnap,
  gatePortals,
  boundaryExits,
  centre,
  wallTolerance = 4,
}) {
  const safeGates = Array.isArray(gates) ? gates : [];
  const safePortals = Array.isArray(gatePortals) ? gatePortals : [];
  const safeExits = Array.isArray(boundaryExits) ? boundaryExits : [];

  const primaryGateId = findPrimaryGateId(safeGates, primaryGate, 0);

  const records = [];

  for (let gateId = 0; gateId < safeGates.length; gateId++) {
    const gatePoint = safeGates[gateId];
    if (!isFinitePoint(gatePoint)) continue;

    const wallSnap = nearestSegmentOnClosedPolyline(gatePoint, wallForGateSnap);
    const portal = normalisePortal(safePortals[gateId]);
    const boundaryExit = normaliseBoundaryExit(safeExits[gateId]);

    const isPrimary = gateId === primaryGateId;

    records.push({
      gateId,
      role: isPrimary ? "primary_land_gate" : "land_gate",
      isPrimary,
      point: clonePoint(gatePoint),

      wall: wallSnap
        ? {
            segmentIndex: wallSnap.segmentIndex,
            t: wallSnap.t,
            point: wallSnap.point,
            distance: wallSnap.distance,
            onWall: wallSnap.distance <= wallTolerance,
            tolerance: wallTolerance,
          }
        : {
            segmentIndex: null,
            t: null,
            point: null,
            distance: Infinity,
            onWall: false,
            tolerance: wallTolerance,
          },

      portal,
      boundaryExit,

      outward: isFinitePoint(centre)
        ? unitOrNull({ x: gatePoint.x - centre.x, y: gatePoint.y - centre.y })
        : null,

      source: {
        stage: "120_warp_dependent_fort_geometry",
        gateSource: "gatesWarped",
        wallSource: "wallForGateSnap",
        portalSource: "gatePortals",
        exitSource: "boundaryExits",
      },
    });
  }

  const complete =
    records.length === safeGates.length &&
    records.length === safePortals.length &&
    records.length === safeExits.length &&
    records.every(g =>
      Number.isInteger(g.gateId) &&
      isFinitePoint(g.point) &&
      g.wall?.onWall === true &&
      g.portal?.gateId === g.gateId &&
      g.boundaryExit?.gateId === g.gateId
    );

  return {
    kind: "gateAuthority",
    version: 1,
    primaryGateId,
    gates: records,
    meta: {
      gateCount: safeGates.length,
      portalCount: safePortals.length,
      boundaryExitCount: safeExits.length,
      authorityCount: records.length,
      wallTolerance,
      complete,
    },
  };
}
