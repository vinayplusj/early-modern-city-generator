// docs/src/model/wards/ward_role_params.js
//
// Parameter normalisation and role mutation helpers.
// Extracted from ward_roles.js. Extraction only. No behaviour changes intended.

/**
 * Deterministic role assignment by ward id.
 * Mutates the provided wards array in place.
 */
export function setRole(wards, id, role) {
  for (let i = 0; i < wards.length; i++) {
    const w = wards[i];
    if (w && w.id === id) {
      w.role = role;
      return;
    }
  }
}

/**
 * Normalise params for assignWardRoles().
 * Keep defaults and bounds identical to ward_roles.js.
 */
export function normaliseParams(params) {
  const p = params || {};

  // Defaults (must match previous behaviour)
  const innerCountRaw = Number(p.innerCount);
  const maxPlugAddsRaw = Number(p.maxPlugAdds);

  const out = {
    innerCount: Number.isFinite(innerCountRaw) ? innerCountRaw : 2,
    maxPlugAdds: Number.isFinite(maxPlugAddsRaw) ? maxPlugAddsRaw : 0,
    outsideBands: p.outsideBands || null,
    outerHullClosureMode:
      typeof p.outerHullClosureMode === "string" ? p.outerHullClosureMode : "off",
  };

  // Clamp where applicable (preserve prior defensive behaviour)
  if (out.innerCount < 0) out.innerCount = 0;
  if (out.innerCount > 50) out.innerCount = 50;

  if (out.maxPlugAdds < 0) out.maxPlugAdds = 0;
  if (out.maxPlugAdds > 10) out.maxPlugAdds = 10;

  return out;
}
