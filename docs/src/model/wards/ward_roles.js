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
import { centroid } from "../../geom/poly.js";
import { isPoint } from "../../geom/primitives.js";

export function assignWardRoles({ wards, centre, params }) {
  const p = normaliseParams(params);

  // Defensive copy so caller can keep original list if needed.
  const wardsCopy = wards.map((w) => ({ ...w }));

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
  const innerWards = order.slice(1, 1 + p.innerCount);
  const citadelWard = order[1 + p.innerCount] ?? order[order.length - 1];

  // Assign roles.
  setRole(wardsCopy, plazaWard.id, "plaza");

  for (const w of innerWards) {
    setRole(wardsCopy, w.id, "inner");
  }

  // Ensure citadel is distinct from plaza and any inner ward.
  // If it collides, pick the next available ward by order.
  const used = new Set([plazaWard.id, ...innerWards.map((w) => w.id)]);
  let citadelId = citadelWard.id;

  if (used.has(citadelId)) {
    const alt = order.find((w) => !used.has(w.id));
    if (alt) citadelId = alt.id;
  }

  setRole(wardsCopy, citadelId, "citadel");
  used.add(citadelId);

  // Remaining wards are "outside candidates".
  const outside = order.filter((w) => !used.has(w.id));

  // Assign outside roles deterministically.
  // Phase 1 (safe, Commit-ready): distance bands only.
  // Phase 2 (later): refine using containment vs fortTargetPoly and adjacency.

  assignOutsideRolesByBands({
    wards: wardsCopy,
    outsideOrder: outside,
    centre,
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
