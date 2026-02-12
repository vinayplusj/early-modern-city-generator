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
// Suggested usage in generate.js
//   const { wards: wardsWithRoles, indices } = assignWardRoles({
//     wards,
//     centre: fortCentre,
//     params: { innerCount: 8 }
//   });
//   model.wards = wardsWithRoles;
//   model.wardRoleIndices = indices;

 /**
  * @typedef {{x:number, y:number}} Point
  * @typedef {{
  *   id:number,
  *   seed:Point,
  *   poly:Point[]|null,
  *   centroid:Point|null,
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
 * @returns {{wards: Ward[], indices: {plaza:number, citadel:number, inner:number[], outside:number[]}}}
 */
import { centroid, pointInPolyOrOn } from "../../geom/poly.js";
import { isPoint } from "../../geom/primitives.js";

function wardAdjacency(wards) {
  // Build adjacency by shared polygon edges using quantised point keys.
  // Invariant: wards are Voronoi partitions clipped to same boundary, so shared borders exist.

  const bbox = (() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of wards) {
      const poly = w?.poly;
      if (!Array.isArray(poly)) continue;
      for (const p of poly) {
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const ok = Number.isFinite(minX);
    return ok ? { minX, minY, maxX, maxY } : null;
  })();

  if (!bbox) return wards.map(() => []);

  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  const keyOf = (p) => `${Math.round(p.x * inv)},${Math.round(p.y * inv)}`;
  const edgeKey = (aKey, bKey) => (aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`);

  // edgeKey -> list of ward indices that have this edge
  const edgeOwners = new Map();

  for (let wi = 0; wi < wards.length; wi++) {
    const poly = wards[wi]?.poly;
    if (!Array.isArray(poly) || poly.length < 3) continue;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      const aKey = keyOf(a);
      const bKey = keyOf(b);
      if (aKey === bKey) continue;

      const k = edgeKey(aKey, bKey);
      if (!edgeOwners.has(k)) edgeOwners.set(k, []);
      edgeOwners.get(k).push(wi);
    }
  }

  const adj = wards.map(() => new Set());

  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    // If more than 2 owners due to quantisation, connect all pairs deterministically.
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i];
        const b = owners[j];
        adj[a].add(b);
        adj[b].add(a);
      }
    }
  }

  return adj.map((s) => Array.from(s).sort((a, b) => a - b));
}

function coreHoleCount({ wards, coreIdxs }) {
  const polys = [];
  for (const idx of coreIdxs) {
    const poly = wards[idx]?.poly;
    if (Array.isArray(poly) && poly.length >= 3) polys.push(poly);
  }
  if (polys.length === 0) return 0;

  // Inline: union boundary via edge cancellation (same method as districts).
  // We only need hole count, so minimal implementation is acceptable here.
  const bbox = (() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  })();
  if (!bbox) return 0;

  const dx = bbox.maxX - bbox.minX, dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);
  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;
  const keyOf = (p) => `${Math.round(p.x * inv)},${Math.round(p.y * inv)}`;
  const eKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const rep = new Map();
  const edgeCount = new Map();

  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ak = keyOf(a), bk = keyOf(b);
      if (ak === bk) continue;
      if (!rep.has(ak)) rep.set(ak, { x: a.x, y: a.y });
      if (!rep.has(bk)) rep.set(bk, { x: b.x, y: b.y });
      const k = eKey(ak, bk);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }

  // Boundary edges = count === 1, build adjacency.
  const adj = new Map();
  const unused = new Set();
  function addAdj(u, v) {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u).add(v);
  }

  for (const [k, c] of edgeCount.entries()) {
    if (c !== 1) continue;
    const [a, b] = k.split("|");
    addAdj(a, b); addAdj(b, a);
    unused.add(k);
  }

  function nextNeighbour(curr, prev) {
    const nbrs = adj.get(curr);
    if (!nbrs) return null;
    const ordered = Array.from(nbrs).sort();
    for (const n of ordered) {
      if (n === prev) continue;
      const k = eKey(curr, n);
      if (unused.has(k)) return n;
    }
    for (const n of ordered) {
      const k = eKey(curr, n);
      if (unused.has(k)) return n;
    }
    return null;
  }

  const loops = [];
  const keysSorted = () => Array.from(adj.keys()).sort();

  while (unused.size > 0) {
    let start = null;
    for (const u of keysSorted()) {
      for (const v of (adj.get(u) || [])) {
        if (unused.has(eKey(u, v))) { start = u; break; }
      }
      if (start) break;
    }
    if (!start) break;

    const nbrs0 = Array.from(adj.get(start) || []).sort();
    let first = null;
    for (const v of nbrs0) {
      if (unused.has(eKey(start, v))) { first = v; break; }
    }
    if (!first) break;

    const loopKeys = [start, first];
    unused.delete(eKey(start, first));

    let prev = start, curr = first;
    for (let step = 0; step < 200000; step++) {
      const nxt = nextNeighbour(curr, prev);
      if (!nxt) break;
      if (nxt === start) { unused.delete(eKey(curr, nxt)); break; }
      unused.delete(eKey(curr, nxt));
      prev = curr; curr = nxt;
      loopKeys.push(curr);
    }

    const loop = loopKeys.map((k) => rep.get(k)).filter(Boolean);
    if (loop.length >= 3) loops.push(loop);
  }

  if (loops.length <= 1) return 0;
 

  const area = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
};
// Find outer by abs area.
  let outer = null;
  let outerAbs = -Infinity;

  for (const l of loops) {
    const aa = Math.abs(area(l));
    if (aa > outerAbs) {
      outerAbs = aa;
      outer = l;
    }
  }

  if (!outer) return 0;

  // Hole test matches districts_voronoi.js:
  // A loop is a hole if its centroid lies inside the outer loop.
  let holes = 0;
  for (const l of loops) {
    if (l === outer) continue;
    const c = centroid(l);
    if (c && pointInPolyOrOn(c, outer, 1e-6)) holes += 1;
  }
  return holes;

}

export function assignWardRoles({ wards, centre, params }) {
  const p = normaliseParams(params);

  // Defensive copy so caller can keep original list if needed.
  const wardsCopy = wards.map((w) => ({ ...w }));

  const fortCoreIdxs = (innerArr) => {
    const out = [];
    if (Number.isInteger(plazaIdx)) out.push(plazaIdx);
    if (Number.isInteger(citadelIdx)) out.push(citadelIdx);
    for (const i of innerArr) if (Number.isInteger(i)) out.push(i);
    return out;
  };

 // Recompute distToCentre if missing (keeps this module usable standalone).
  for (const w of wardsCopy) {
    if (!Number.isFinite(w.distToCentre)) {
      w.distToCentre = dist(w.seed, centre);
    }
  }

  // Deterministic ordering: nearest first.
  const order = wardsCopy
    .slice()
    .sort((a, b) => {
      const da = a.distToCentre;
      const db = b.distToCentre;
      if (da < db) return -1;
      if (da > db) return 1;
      return a.id - b.id;
    });

  if (order.length < 3) {
    // Not enough wards to assign roles meaningfully.
    // Assign everything as plains as a safe fallback.
    for (const w of wardsCopy) w.role = "plains";
    return {
      wards: wardsCopy,
      indices: { plaza: -1, citadel: -1, inner: [], outside: wardsCopy.map((w) => w.id) },
    };
  }

  // Roles by required ordering.
  const plazaWard = order[0];

  // Select a citadel candidate deterministically before picking inner wards.
  // Default: the ward immediately after the inner band in distance order.
  const innerCount = p.innerCount;

  // Helper: map ward id -> index in wardsCopy for adjacency traversal.
  const idToIndex = new Map();
  for (let i = 0; i < wardsCopy.length; i++) idToIndex.set(wardsCopy[i].id, i);

  const plazaIdx = idToIndex.get(plazaWard.id);

  // Fallback safety: if id mapping fails, degrade to distance-only logic.
  if (plazaIdx === undefined) {
    for (const w of wardsCopy) w.role = "plains";
    return {
      wards: wardsCopy,
      indices: { plaza: -1, citadel: -1, inner: [], outside: wardsCopy.map((w) => w.id) },
    };
  }

  // Choose initial inner candidates by distance order (excluding plaza).
  const candidatesByOrder = order.slice(1);

  // Choose citadel ward as the (innerCount + 1)th in distance order (excluding plaza).
  // If not enough, pick last available.
  const citadelWard = candidatesByOrder[Math.min(innerCount, candidatesByOrder.length - 1)];
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

  // Now ensure citadel is distinct from plaza and inner wards.
  // If collision, pick next available by order.
  {
    const usedIds = new Set([plazaWard.id, ...innerIdxs.map((i) => wardsCopy[i].id)]);
    if (usedIds.has(citadelId)) {
      const alt = order.find((w) => !usedIds.has(w.id));
      if (alt) {
        citadelId = alt.id;
        citadelIdx = idToIndex.get(citadelId);
      }
    }
  }
 
  // Assign plaza + citadel now. Inner is assigned after optional plugging.
  setRole(wardsCopy, plazaWard.id, "plaza");
  setRole(wardsCopy, citadelId, "citadel");
  
  function proposePlugSeq({ innerIdxsNow, maxAddsLeft }) {
   const depthMax = Math.min(3, maxAddsLeft);
   const beamWidth = 12;
   const candidateLimit = 25;
 
   const plazaIdx2 = plazaIdx;
   const citadelIdx2 = citadelIdx;
 
   const isCore = (idx, innerSet) =>
     idx === plazaIdx2 || idx === citadelIdx2 || innerSet.has(idx);
 
   function orderedCandidates(innerArr) {
     const innerSet = new Set(innerArr);
 
     const candidateSet = new Set();
 
     const frontierSeeds = [
       ...innerArr,
       ...(Number.isInteger(plazaIdx2) ? [plazaIdx2] : []),
       ...(Number.isInteger(citadelIdx2) ? [citadelIdx2] : []),
     ];
 
     for (const u of frontierSeeds) {
       for (const v of (adj[u] || [])) candidateSet.add(v);
     }
 
     return Array.from(candidateSet)
       .filter((v) => !isCore(v, innerSet))
       .sort((a, b) => {
         const da = wardsCopy[a]?.distToCentre ?? Infinity;
         const db = wardsCopy[b]?.distToCentre ?? Infinity;
         if (da !== db) return da - db;
         const ia = wardsCopy[a]?.id ?? 0;
         const ib = wardsCopy[b]?.id ?? 0;
         return ia - ib;
       })
       .slice(0, candidateLimit);
   }
 
   function score(innerArr) {
     const holes = coreHoleCount({ wards: wardsCopy, coreIdxs: fortCoreIdxs(innerArr) });
     let distSum = 0;
     for (const i of innerArr) distSum += wardsCopy[i]?.distToCentre ?? 1e9;
     return { holes, distSum };
   }
 
   const base = innerIdxsNow.slice();
   const baseScore = score(base);
   if (baseScore.holes === 0) return [];
 
   // Beam states: { seq, innerArr, holes, distSum }
   let beam = [{ seq: [], innerArr: base, ...baseScore }];
 
   for (let depth = 1; depth <= depthMax; depth++) {
     const next = [];
 
     for (const state of beam) {
       if (state.holes === 0) return state.seq;
 
       const cand = orderedCandidates(state.innerArr);
 
       for (const v of cand) {
         const inner2 = state.innerArr.concat([v]);
         const sc = score(inner2);
         next.push({ seq: state.seq.concat([v]), innerArr: inner2, ...sc });
       }
     }
 
     if (next.length === 0) break;
 
     next.sort((a, b) => {
       if (a.holes !== b.holes) return a.holes - b.holes;
       if (a.distSum !== b.distSum) return a.distSum - b.distSum;
 
       // Stable tie-break: compare ward ids of the sequence
       const aKey = a.seq.map((i) => String(wardsCopy[i]?.id ?? i)).join(",");
       const bKey = b.seq.map((i) => String(wardsCopy[i]?.id ?? i)).join(",");
       return aKey.localeCompare(bKey);
     });
 
     beam = next.slice(0, beamWidth);
 
     if (beam[0].holes === 0) return beam[0].seq;
   }
 
   // If we cannot solve, still return a sequence that improves holes (if any).
   const best = beam[0];
   if (best && best.holes < baseScore.holes) return best.seq;
 
   return [];
 }

 // Optional: plug holes by adding a few extra inner wards (deterministic).
 const maxPlugAdds = p.maxPlugAdds;
 if (maxPlugAdds > 0) {
   const plazaIdx2 = plazaIdx;
   const citadelIdx2 = citadelIdx;
 
   const isCore = (idx) =>
     idx === plazaIdx2 || idx === citadelIdx2 || innerIdxs.includes(idx);
 
   let addsLeft = maxPlugAdds;
   
   while (addsLeft > 0) {
     const holesBefore = coreHoleCount({ wards: wardsCopy, coreIdxs: fortCoreIdxs(innerIdxs) });
     if (holesBefore === 0) break;
   
     const seq = proposePlugSeq({ innerIdxsNow: innerIdxs, maxAddsLeft: addsLeft });
     if (!seq || seq.length === 0) break;
   
     // Apply the sequence (bounded by remaining budget)
     for (const v of seq) {
       if (addsLeft <= 0) break;
       if (!innerIdxs.includes(v)) {
         innerIdxs.push(v);
         addsLeft -= 1;
       }
     }
   
     const holesAfter = coreHoleCount({ wards: wardsCopy, coreIdxs: fortCoreIdxs(innerIdxs) });
     if (holesAfter >= holesBefore) break;
   }

 }
 
 // Now that innerIdxs is final, assign inner roles and compute innerWards.
 const innerWards = innerIdxs.map((i) => wardsCopy[i]).filter(Boolean);
 for (const w of innerWards) setRole(wardsCopy, w.id, "inner");


  const used = new Set([plazaWard.id, citadelId, ...innerIdxs.map((i) => wardsCopy[i]?.id).filter(Number.isFinite)]);


  // Remaining wards are "outside candidates".
  const outside = order.filter((w) => !used.has(w.id));

  // Assign outside roles deterministically.
  // Phase 1 (safe, Commit-ready): distance bands only.
  // Phase 2 (later): refine using containment vs fortTargetPoly and adjacency.

  assignOutsideRolesByBands({
    wards: wardsCopy,
    outsideOrder: outside,
    params: p,
  });

  // Add a ringIndex for debugging / later logic:
  // ringIndex is just the rank in the distance ordering.
  for (let i = 0; i < order.length; i++) {
    const id = order[i].id;
    const idx = wardsCopy.findIndex((w) => w.id === id);
    if (idx >= 0) wardsCopy[idx].ringIndex = i;
  }

  return {
    wards: wardsCopy,
    indices: {
      plaza: plazaWard.id,
      citadel: citadelId,
      inner: innerWards.map((w) => w.id),
      outside: outside.map((w) => w.id),
    },
  };
}

/* ---------------------------- Outside role logic --------------------------- */

/**
 * Deterministic distance-band role assignment.
 *
 * Default pattern (closest to farthest among outside wards):
 * - First ~20%: new_town
 * - Next  ~15%: slums
 * - Next  ~25%: farms
 * - Next  ~20%: plains
 * - Remaining: woods
 *
 * This is tunable via params.outsideBands.
 */
function assignOutsideRolesByBands({ wards, outsideOrder, params }) {
  const n = outsideOrder.length;
  if (n <= 0) return;

  const bands = normaliseOutsideBands(params.outsideBands);

  // Compute deterministic cut indices.
  const cut = [];
  let acc = 0;
  for (const b of bands) {
    acc += b.pct;
    cut.push(Math.floor(acc * n));
  }

  // Ensure monotonic and last cut covers all.
  for (let i = 0; i < cut.length; i++) {
    cut[i] = clampInt(cut[i], 0, n);
    if (i > 0 && cut[i] < cut[i - 1]) cut[i] = cut[i - 1];
  }
  cut[cut.length - 1] = n;

  let start = 0;
  for (let bi = 0; bi < bands.length; bi++) {
    const end = cut[bi];
    const role = bands[bi].role;

    for (let i = start; i < end; i++) {
      setRole(wards, outsideOrder[i].id, role);
    }
    start = end;
  }
}

function normaliseOutsideBands(outsideBands) {
  // Default deterministic distribution.
  const def = [
    { role: "new_town", pct: 0.20 },
    { role: "slums", pct: 0.15 },
    { role: "farms", pct: 0.25 },
    { role: "plains", pct: 0.20 },
    { role: "woods", pct: 0.20 },
  ];

  if (!Array.isArray(outsideBands) || outsideBands.length === 0) return def;

  // Validate and normalise to sum to 1.
  const cleaned = [];
  let sum = 0;

  for (const b of outsideBands) {
    const role = String(b?.role || "").trim();
    const pct = Number(b?.pct);
    if (!role) continue;
    if (!Number.isFinite(pct) || pct <= 0) continue;
    cleaned.push({ role, pct });
    sum += pct;
  }

  if (cleaned.length === 0) return def;

  // Normalise.
  return cleaned.map((b) => ({ role: b.role, pct: b.pct / sum }));
}

/* ------------------------------- Utilities -------------------------------- */

function setRole(wards, id, role) {
  const w = wards.find((x) => x.id === id);
  if (!w) return;
  w.role = role;
}

function normaliseParams(params) {
 return {
   innerCount: clampInt(params?.innerCount ?? 8, 1, 200),
   maxPlugAdds: clampInt(params?.maxPlugAdds ?? 3, 0, 20),
   outsideBands: params?.outsideBands,
 };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
export function wardCentroid(w) {
  if (!w) return null;

  if (isPoint(w.centroid)) return w.centroid;

  const poly =
    (Array.isArray(w.polygon) && w.polygon.length >= 3) ? w.polygon :
    (Array.isArray(w.poly) && w.poly.length >= 3) ? w.poly :
    null;

  if (poly) {
    const c = centroid(poly);
    if (isPoint(c)) return c;
  }

  if (isPoint(w.site)) return w.site;
  if (isPoint(w.seed)) return w.seed;
  if (isPoint(w.point)) return w.point;
  if (isPoint(w.center)) return w.center;
  if (isPoint(w.centre)) return w.centre;

  return null;
}
