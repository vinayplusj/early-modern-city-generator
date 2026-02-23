// docs/src/model/districts.js
import { centroid, pointInPolyOrOn} from "../geom/poly.js";
import { isPoint } from "../geom/primitives.js";
import {
  polyAreaSigned,
  loopBBox,
  loopPerimeter,
  loopMinMaxEdge,
  loopSelfIntersectionCount,
  loopMetrics,
} from "../geom/loop_metrics.js";
import { angle, normAngle, inSector, sortAngles } from "../geom/angle_sector.js";
import { buildLoopsFromPolys, cyclicDistance, nextIndex, prevIndex } from "./mesh/loops_from_polys.js";

export function buildRadialDistricts(rng, outerBoundary, cx, cy, opts = {}) {
  const {
    COUNT = 8,
    JITTER = 0.10,
    MIN_SPAN = 0.35,
  } = opts;

  const TWO_PI = Math.PI * 2;
  const centre = { x: cx, y: cy };

  // Precompute boundary angles once (and keep both point + angle).
  const boundary = (outerBoundary || []).map((p) => ({
    p,
    a: normAngle(angle(cx, cy, p)),
  }));

  // 1) Make raw boundaries
  let cuts = [];
  for (let i = 0; i < COUNT; i++) {
    const base = (i / COUNT) * TWO_PI;
    const j = (rng() * 2 - 1) * JITTER;
    cuts.push(normAngle(base + j));
  }
  cuts = sortAngles(cuts);

  // 2) Enforce minimum span with a few deterministic passes
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < cuts.length; i++) {
      const prev = cuts[(i - 1 + cuts.length) % cuts.length];
      const cur = cuts[i];
      const span = (cur - prev + TWO_PI) % TWO_PI;
      if (span < MIN_SPAN) {
        cuts[i] = normAngle(prev + MIN_SPAN);
      }
    }
    cuts = sortAngles(cuts);
  }

  // 3) Build districts (sector polygon = centre + boundary points in angle order)
  const districts = [];

  for (let i = 0; i < cuts.length; i++) {
    const a0 = cuts[i];
    const a1 = cuts[(i + 1) % cuts.length];

    // Collect boundary vertices in this sector
    const pts = [];
    for (const v of boundary) {
      if (inSector(v.a, a0, a1)) pts.push(v);
    }

    if (pts.length < 2) continue;

    // Sort by angle so polygon does not fold
    pts.sort((u, v) => u.a - v.a);

    const poly = [centre, ...pts.map((x) => x.p)];

    districts.push({
      id: `d${districts.length}`,
      polygon: poly,
      kind: "generic",
      name: `District ${districts.length}`,
      _debug: { a0, a1 },
    });
  }

  return districts;
}

export function assignBlocksToDistricts(blocks, districts, cx, cy) {
  if (!blocks || !districts || districts.length === 0) return blocks;

  const sectors = districts.map((d) => ({
    id: d.id,
    a0: d._debug?.a0 ?? 0,
    a1: d._debug?.a1 ?? 0,
  }));

  function findDistrictId(p) {
    const a = normAngle(Math.atan2(p.y - cy, p.x - cx));
    for (const s of sectors) {
      if (inSector(a, s.a0, s.a1)) return s.id;
    }
    return sectors[0].id;
  }

  for (const b of blocks || []) {
    const c = polyCentroid(b.polygon);
    b.districtId = findDistrictId(c);
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Deterministic district roles
// ---------------------------------------------------------------------------

function findDistrictIndexForPoint(districts, cx, cy, p) {
  if (!p || !districts || districts.length === 0) return 0;
  const a = normAngle(Math.atan2(p.y - cy, p.x - cx));
  for (let i = 0; i < districts.length; i++) {
    const d = districts[i];
    const a0 = d._debug?.a0 ?? 0;
    const a1 = d._debug?.a1 ?? 0;
    if (inSector(a, a0, a1)) return i;
  }
  return 0;
}

export function assignDistrictRoles(districts, cx, cy, anchors = {}, opts = {}) {
  function validIndex(i, n) {
    return Number.isInteger(i) && i >= 0 && i < n;
  }

  const {
    INNER_COUNT = 3,
    NEW_TOWN_COUNT = 1,
    OUTER_WARD_COUNT = 2,
    OUTER_PATTERN = ["slums", "farms", "plains", "woods"],
  } = opts;

  if (!districts || districts.length === 0) return districts;

  const squareCentre = anchors.squareCentre || null;
  const citCentre = anchors.citCentre || null;
  const primaryGate = anchors.primaryGate || null;

  const plazaIndex = findDistrictIndexForPoint(
    districts,
    cx,
    cy,
    squareCentre || { x: cx, y: cy }
  );

  const citadelIndex = findDistrictIndexForPoint(
    districts,
    cx,
    cy,
    citCentre || { x: cx, y: cy }
  );

  const n = districts.length;

  // ---------------- Base roles (same structure as before) ----------------

  const innerSet = new Set();
  for (let k = 1; k <= Math.min(INNER_COUNT, n - 1); k++) {
    innerSet.add((plazaIndex + k) % n);
  }

  // Reset all districts first.
  for (let i = 0; i < n; i++) {
    const d = districts[i];
    d.kind = "generic";
    d.name = `District ${i}`;
  }

  // Plaza
  districts[plazaIndex].kind = "plaza";
  districts[plazaIndex].name = "Plaza";

  // Citadel (if it is not the plaza)
  if (citadelIndex !== plazaIndex) {
    districts[citadelIndex].kind = "citadel";
    districts[citadelIndex].name = "Citadel Quarter";
  }

  // Inner wards (skip plaza and citadel)
  for (let i = 0; i < n; i++) {
    if (i === plazaIndex) continue;
    if (i === citadelIndex) continue;
    if (!innerSet.has(i)) continue;

    districts[i].kind = "inner_ward";
    districts[i].name = `Inner Ward ${cyclicDistance(plazaIndex, i, n)}`;
  }

  // ---------------- Milestone 3.7: new_town + outer_ward ----------------

  // Pick a new_town district from the primary gate direction.
  // If no primaryGate is provided, we skip new_town.
  let newTownIndex = null;

  if (primaryGate) {
    const gateIndex = findDistrictIndexForPoint(districts, cx, cy, primaryGate);

    // Do not allow plaza or citadel to become new_town.
    if (gateIndex !== plazaIndex && gateIndex !== citadelIndex) {
      newTownIndex = gateIndex;
    } else {
      // Fallback: walk outward until we find a non-plaza, non-citadel sector.
      for (let step = 1; step < n; step++) {
        const a = (gateIndex + step) % n;
        const b = (gateIndex - step + n) % n;

        if (a !== plazaIndex && a !== citadelIndex) {
          newTownIndex = a;
          break;
        }
        if (b !== plazaIndex && b !== citadelIndex) {
          newTownIndex = b;
          break;
        }
      }
    }
  }

  if (newTownIndex != null && NEW_TOWN_COUNT >= 1) {
    // Set new_town.
    districts[newTownIndex].kind = "new_town";
    districts[newTownIndex].name = "New Town";

    // Pick outer_ward neighbours around new_town.
    // Default is 2: one clockwise and one counter-clockwise, skipping plaza/citadel.
    const outerWardSet = new Set();

    const want = Math.max(0, OUTER_WARD_COUNT | 0);

    // First pass: immediate neighbours.
    let left = prevIndex(newTownIndex, n);
    let right = nextIndex(newTownIndex, n);

    // Helper to add if valid.
    function tryAddOuter(i) {
      if (outerWardSet.size >= want) return;
      if (i === plazaIndex || i === citadelIndex || i === newTownIndex) return;
      if (innerSet.has(i)) return; // keep inner wards intact
      outerWardSet.add(i);
    }

    tryAddOuter(left);
    tryAddOuter(right);

        // If plaza/citadel blocked a neighbour, expand outward until filled.
    let expand = 2;
    while (outerWardSet.size < want && expand < n + 2) {
      tryAddOuter((newTownIndex - expand + n) % n);
      tryAddOuter((newTownIndex + expand) % n);
      expand++;
    }

    for (const idx of outerWardSet) {
      if (!validIndex(idx, n)) continue;
    
      const d = districts[idx];
      if (!d) continue;
    
      d.kind = "outer_ward";
      d.name = "Outer Ward";
    }

  }

  // ---------------- Fill remaining outer districts ----------------

  for (let i = 0; i < n; i++) {
    if (!validIndex(i, n)) continue;
    const d = districts[i];
  
    if (!d) continue;
    if (d.kind !== "generic") continue;
  
    const distFromPlaza = cyclicDistance(plazaIndex, i, n);
    const label =
      OUTER_PATTERN[(distFromPlaza - 1 + OUTER_PATTERN.length) % OUTER_PATTERN.length];
  
    d.kind = label;
    d.name = label.charAt(0).toUpperCase() + label.slice(1);
  }

  // Debug tags
  for (let i = 0; i < n; i++) {
    districts[i]._debug = districts[i]._debug || {};
    districts[i]._debug.plazaIndex = plazaIndex;
    districts[i]._debug.citadelIndex = citadelIndex;
    districts[i]._debug.newTownIndex = newTownIndex;
  }

  return districts;
}

/**
 * Build boundary loops for a district defined as a membership list of wards.
 *
 * Districts remain membership lists only:
 * - kind
 * - memberWardIds
 *
 * This helper does NOT mutate districts or create a district polygon.
 *
 * @param {Array} wards - ward objects (each may have .poly or .polygon)
 * @param {number[]} memberWardIds - ward ids included in the feature
 * @returns {{ loops: Array, holeCount: number, outerLoop: Array|null }}
 */
export function buildDistrictLoopsFromWards(wards, memberWardIds, opts = {}) {
  const wardArr = Array.isArray(wards) ? wards : [];
  const ids = Array.isArray(memberWardIds)
    ? memberWardIds.map(Number).filter(Number.isFinite)
    : [];

  if (wardArr.length === 0 || ids.length === 0) {
    return {
      loops: [],
      holeCount: 0,
      outerLoop: null,
      outerLoopIndex: -1,
      loopMeta: [],
      warnings: [],
      preferPointInside: null,
    };

  }

  const idSet = new Set(ids);

  const polys = [];
  for (const w of wardArr) {
    if (!w || !idSet.has(w.id)) continue;

    const poly =
      (Array.isArray(w.poly) && w.poly.length >= 3) ? w.poly :
      (Array.isArray(w.polygon) && w.polygon.length >= 3) ? w.polygon :
      null;

    if (Array.isArray(poly) && poly.length >= 3) polys.push(poly);
  }

  if (polys.length === 0) {
    return { loops: [], holeCount: 0, outerLoop: null };
  }

  const loops = buildLoopsFromPolys(polys);

  const loopMeta = loops.map(loopMetrics);
  const warnings = [];
  const preferPoint = (opts && opts.preferPoint) ? opts.preferPoint : null;
  const label = (opts && typeof opts.label === "string") ? opts.label : "";

  if (loops.length === 0) {
    return { loops: [], holeCount: 0, outerLoop: null };
  }

  // Outer loop = max absolute area (keep behaviour unchanged for now)
  let outerLoop = null;
  let outerLoopIndex = -1;
  let outerAbs = -Infinity;
  
  for (let i = 0; i < loops.length; i++) {
    const l = loops[i];
    const aa = Math.abs(polyAreaSigned(l));
    if (aa > outerAbs) {
      outerAbs = aa;
      outerLoop = l;
      outerLoopIndex = i;
    }
  }

  // Quality warnings (no behaviour change)
  for (let i = 0; i < loopMeta.length; i++) {
    const m = loopMeta[i];
    if (!m || !Number.isFinite(m.diag) || m.diag <= 0) continue;
  
    if (m.selfIntersections > 0) {
      warnings.push(`loop[${i}] selfIntersections=${m.selfIntersections}${label ? " " + label : ""}`);
    }
  
    const tinyEdge = m.diag * 1e-4;
    if (m.minEdgeLen > 0 && m.minEdgeLen < tinyEdge) {
      warnings.push(`loop[${i}] minEdgeLen=${m.minEdgeLen.toFixed(4)} < diag*1e-4 (${tinyEdge.toFixed(4)})${label ? " " + label : ""}`);
    }
  }
  
  let preferPointInside = null;
  if (preferPoint) {
    const insideFlags = loops.map((l) => pointInPolyOrOn(preferPoint, l, 1e-6));
    const anyContains = insideFlags.some(Boolean);
    const outerContains = (outerLoopIndex >= 0) ? insideFlags[outerLoopIndex] : false;
    preferPointInside = outerContains;
  
    if (anyContains && !outerContains) {
      const candidates = insideFlags
        .map((v, i) => (v ? i : -1))
        .filter((i) => i >= 0);
      warnings.push(
        `outerLoop does not contain preferPoint; candidate loops that do: [${candidates.join(", ")}]${label ? " " + label : ""}`
      );
    }
  }

  if (!outerLoop) {
    return {
      loops,
      holeCount: 0,
      outerLoop: null,
      outerLoopIndex: -1,
      loopMeta,
      warnings,
      preferPointInside,
    };
  }

  // Holes: loop centroid inside outer loop
  let holeCount = 0;
  for (const l of loops) {
    if (l === outerLoop) continue;
    const c = centroid(l);
    if (isPoint(c) && pointInPolyOrOn(c, outerLoop, 1e-6)) holeCount += 1;
  }

  if (holeCount > 0) {
    warnings.push(`holeCount=${holeCount}${label ? " " + label : ""}`);
  }

  return {
    loops,
    holeCount,
    outerLoop,
    outerLoopIndex,
    loopMeta,
    warnings,
    preferPointInside,
  };
}
