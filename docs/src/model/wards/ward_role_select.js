// docs/src/model/wards/ward_role_select.js
//
// Deterministic selection of plaza, citadel, and inner wards.
// Extracted from ward_roles.js. Extraction only. No behaviour changes intended.
//
// This module does NOT assign roles. It only selects indices and ids.
// All dependencies that may vary are injected (distance fn, adjacency builder).

function defaultDist(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @param {object} args
 * @param {Array<object>} args.wardsCopy - defensive copy of wards (mutated only to fill distToCentre when missing)
 * @param {{x:number,y:number}} args.centre
 * @param {{innerCount:number}} args.params - already normalised params
 * @param {Function} args.wardAdjacency - (wardsCopy) => number[][]
 * @param {Function} [args.distFn] - (pointA, pointB) => number
 *
 * @returns {{
 *   order: Array<object>,
 *   plazaWard: object,
 *   candidatesByOrder: Array<object>,
 *   idToIndex: Map<number, number>,
 *   plazaIdx: number,
 *   citadelId: number,
 *   citadelIdx: number|undefined,
 *   innerIdxs: number[],
 *   adj: number[][],
 *   outsideOrder: Array<object>
 * }}
 */
export function selectCoreWards({
  wardsCopy,
  centre,
  params,
  wardAdjacency,
  distFn,
}) {
  const dist = typeof distFn === "function" ? distFn : defaultDist;
  const innerCount = Number(params?.innerCount) || 0;

  // Recompute distToCentre if missing (keeps this helper usable standalone).
  for (const w of wardsCopy) {
    if (!Number.isFinite(w.distToCentre)) {
      w.distToCentre = dist(w.seed, centre);
    }
  }

  // Deterministic ordering: nearest first, tie-break by id.
  const order = wardsCopy
    .slice()
    .sort((a, b) => {
      const da = a.distToCentre;
      const db = b.distToCentre;
      if (da < db) return -1;
      if (da > db) return 1;
      return a.id - b.id;
    });

  const plazaWard = order[0];

  // id -> index mapping for adjacency traversal
  const idToIndex = new Map();
  for (let i = 0; i < wardsCopy.length; i++) idToIndex.set(wardsCopy[i].id, i);

  const plazaIdx = idToIndex.get(plazaWard.id);

  // Choose initial inner candidates by distance order (excluding plaza).
  const candidatesByOrder = order.slice(1);

  // Choose citadel ward as the (innerCount + 1)th in distance order (excluding plaza).
  // If not enough, pick last available.
  const citadelWard =
    candidatesByOrder[Math.min(innerCount, candidatesByOrder.length - 1)];
  let citadelId = citadelWard ? citadelWard.id : plazaWard.id;
  let citadelIdx = idToIndex.get(citadelId);

  // Build adjacency on wardsCopy (consistent data set).
  const adj = wardAdjacency(wardsCopy);

  // Deterministic flood fill outward from plaza until innerCount wards selected.
  // Exclude plaza and citadel from the inner set.
  const exclude = new Set([plazaIdx]);
  if (citadelIdx !== undefined) exclude.add(citadelIdx);

  const innerIdxs = [];

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

  // Ensure citadel is distinct from plaza and inner wards.
  // If collision, pick next available by order.
  {
    const usedIds = new Set([
      plazaWard.id,
      ...innerIdxs.map((i) => wardsCopy[i].id),
    ]);

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

  // Outside wards in deterministic order (order list excluding plaza/citadel/inner).
  const used = new Set([
    plazaWard.id,
    citadelId,
    ...innerIdxs.map((i) => wardsCopy[i]?.id).filter(Number.isFinite),
  ]);

  const outsideOrder = order.filter((w) => !used.has(w.id));

  return {
    order,
    plazaWard,
    candidatesByOrder,
    idToIndex,
    plazaIdx,
    citadelId,
    citadelIdx,
    innerIdxs,
    adj,
    outsideOrder,
  };
}
