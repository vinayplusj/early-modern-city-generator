// docs/src/model/mesh/city_mesh/build_gate_portals.js
//
// Gate portals bind warped gate points to the bound outer boundary loop in CityMesh.
// These are required for Milestone 5 exterior road extension.
//
// Output: Array<GatePortal>
// GatePortal {
//   gateId: number,
//   point: {x,y},
//   loopId: number,
//   boundaryHalfEdgeId: number,
//   t: number,                 // 0..1 on that boundary segment
//   interiorFaceId: number|null
// }

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function buildVertexPosMap(cityMesh) {
  const m = new Map();
  for (const v of cityMesh.vertices || []) {
    if (!v || !Number.isInteger(v.id)) continue;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    m.set(v.id, { x: v.x, y: v.y });
  }
  return m;
}

function projectPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;

  let t = 0;
  if (ab2 > 0) t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const qx = a.x + t * abx;
  const qy = a.y + t * aby;

  const dx = p.x - qx;
  const dy = p.y - qy;

  return { t, q: { x: qx, y: qy }, d2: dx * dx + dy * dy };
}

/**
 * @param {object} args
 * @param {object} args.cityMesh
 * @param {object} args.boundaryBinding   // from bindOuterBoundaryToCityMesh
 * @param {Array<{x:number,y:number}>} args.gates
 */
export function buildGatePortals({ cityMesh, boundaryBinding, gates }) {
  assert(cityMesh && typeof cityMesh === "object", "[EMCG][gatePortals] cityMesh is required.");
  assert(Array.isArray(cityMesh.halfEdges), "[EMCG][gatePortals] cityMesh.halfEdges must be an array.");
  assert(Array.isArray(cityMesh.vertices), "[EMCG][gatePortals] cityMesh.vertices must be an array.");
  assert(boundaryBinding && typeof boundaryBinding === "object", "[EMCG][gatePortals] boundaryBinding is required.");
  assert(Number.isInteger(boundaryBinding.loopId), "[EMCG][gatePortals] boundaryBinding.loopId must be an integer.");
  assert(Array.isArray(boundaryBinding.halfEdgeIds) && boundaryBinding.halfEdgeIds.length >= 3, "[EMCG][gatePortals] boundaryBinding.halfEdgeIds invalid.");
  assert(Array.isArray(gates), "[EMCG][gatePortals] gates must be an array.");

  const vpos = buildVertexPosMap(cityMesh);
  const halfEdges = cityMesh.halfEdges;

  const portals = [];

  for (let gateId = 0; gateId < gates.length; gateId++) {
    const g = gates[gateId];
    if (!isFinitePoint(g)) continue;

    let bestHeId = null;
    let bestT = 0;
    let bestD2 = Infinity;

    for (const heId of boundaryBinding.halfEdgeIds) {
      const he = halfEdges[heId];
      if (!he) continue;

      const a = vpos.get(he.origin);
      const b = vpos.get(he.to);
      if (!a || !b) continue;

      const pr = projectPointToSegment(g, a, b);

      if (pr.d2 < bestD2 - 1e-9) {
        bestD2 = pr.d2;
        bestHeId = heId;
        bestT = pr.t;
      } else if (Math.abs(pr.d2 - bestD2) <= 1e-9 && bestHeId != null && heId < bestHeId) {
        bestHeId = heId;
        bestT = pr.t;
      }
    }

    if (bestHeId == null) {
      throw new Error("[EMCG][gatePortals] Could not bind a gate to the outer boundary loop.");
    }

    const he = halfEdges[bestHeId];
    const interiorFaceId = Number.isInteger(he.face) ? he.face : null;

    portals.push({
      gateId,
      point: { x: g.x, y: g.y },
      loopId: boundaryBinding.loopId,
      boundaryHalfEdgeId: bestHeId,
      t: bestT,
      interiorFaceId,
    });
  }

  // Invariant: every input gate produces one portal (unless it was invalid)
  // If you want strictness, enforce equal length here.
  return portals;
}
