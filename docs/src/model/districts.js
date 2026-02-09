// docs/src/model/districts.js
import { centroid as polyCentroid } from "../geom/poly.js";

function angle(cx, cy, p) {
  return Math.atan2(p.y - cy, p.x - cx);
}

function normAngle(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

function inSector(a, a0, a1) {
  if (a0 <= a1) return a >= a0 && a < a1;
  return a >= a0 || a < a1;
}

function sortAngles(angles) {
  return angles.slice().sort((x, y) => x - y);
}

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

function cyclicDistance(a, b, n) {
  return (b - a + n) % n;
}

function nextIndex(i, n) {
  return (i + 1) % n;
}

function prevIndex(i, n) {
  return (i - 1 + n) % n;
}

export function assignDistrictRoles(districts, cx, cy, anchors = {}, opts = {}) {
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
      districts[idx].kind = "outer_ward";
      districts[idx].name = "Outer Ward";
    }
  }

  // ---------------- Fill remaining outer districts ----------------

  for (let i = 0; i < n; i++) {
    const d = districts[i];

    // Anything already assigned stays assigned.
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

