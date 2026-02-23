// docs/src/model/wards/ward_role_outside.js
//
// Outside ward role assignment (distance-band based).
// Extracted from ward_roles.js. Extraction only. No behaviour changes intended.
//
// This module assigns roles to wards that are not plaza/citadel/inner.
// It expects `outsideOrder` to already be a deterministic ordering (typically by distToCentre, id).

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function normaliseOutsideBands(outsideBands) {
  const fallback = [
    { role: "new_town", pct: 0.2 },
    { role: "slums", pct: 0.15 },
    { role: "farms", pct: 0.25 },
    { role: "plains", pct: 0.2 },
    { role: "woods", pct: 0.2 },
  ];

  const bands = Array.isArray(outsideBands?.bands) ? outsideBands.bands : null;
  if (!bands || bands.length === 0) return fallback;

  // Filter to valid entries and clamp pcts.
  const cleaned = [];
  for (const b of bands) {
    const role = typeof b?.role === "string" ? b.role : null;
    const pctRaw = Number(b?.pct);
    if (!role) continue;
    if (!Number.isFinite(pctRaw)) continue;
    const pct = clamp01(pctRaw);
    cleaned.push({ role, pct });
  }

  if (cleaned.length === 0) return fallback;

  // Renormalise so sum(pct) = 1, preserving order.
  let sum = 0;
  for (const b of cleaned) sum += b.pct;

  if (!(sum > 0)) return fallback;

  const out = cleaned.map((b) => ({ role: b.role, pct: b.pct / sum }));

  // Small numeric cleanup: ensure the total is exactly 1 by adjusting the last band.
  let sum2 = 0;
  for (let i = 0; i < out.length; i++) sum2 += out[i].pct;

  const delta = 1 - sum2;
  out[out.length - 1] = { role: out[out.length - 1].role, pct: out[out.length - 1].pct + delta };

  return out;
}

function roleCountsFromBands(bands, n) {
  // Deterministic rounding: floor for all, then distribute remaining to earliest bands.
  const raw = bands.map((b) => b.pct * n);
  const counts = raw.map((v) => Math.floor(v));

  let used = 0;
  for (const c of counts) used += c;

  let remaining = n - used;
  let i = 0;
  while (remaining > 0 && i < counts.length) {
    counts[i] += 1;
    remaining -= 1;
    i += 1;
    if (i >= counts.length && remaining > 0) i = 0;
  }

  return counts;
}

/**
 * Assign outside roles by deterministic distance bands.
 *
 * @param {object} args
 * @param {Array<object>} args.wards - full wards array to mutate roles on
 * @param {Array<object>} args.outsideOrder - deterministic ordered list of ward objects (subset)
 * @param {object} args.params - params object that may include outsideBands
 * @param {Function} args.setRole - injected role setter: (wards, id, role) => void
 */
export function assignOutsideRolesByBands({ wards, outsideOrder, params, setRole }) {
  const outside = Array.isArray(outsideOrder) ? outsideOrder : [];
  if (outside.length === 0) return;

  const bands = normaliseOutsideBands(params?.outsideBands);
  const counts = roleCountsFromBands(bands, outside.length);

  let k = 0;
  for (let bi = 0; bi < bands.length; bi++) {
    const { role } = bands[bi];
    const take = counts[bi];

    for (let i = 0; i < take; i++) {
      const w = outside[k];
      if (!w) break;
      if (typeof setRole === "function") setRole(wards, w.id, role);
      k += 1;
      if (k >= outside.length) return;
    }
  }

  // Safety: if rounding drift leaves any unassigned, assign them to the last band role.
  const lastRole = bands[bands.length - 1]?.role || "woods";
  while (k < outside.length) {
    const w = outside[k];
    if (w && typeof setRole === "function") setRole(wards, w.id, lastRole);
    k += 1;
  }
}
