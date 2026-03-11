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

function clampInt(value, min, max, fallback) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normaliseOutsideBands(value) {
  if (value === 3 || value === "3") return 3;
  if (value === 2 || value === "2") return 2;
  return 1;
}

function normaliseOuterHullClosureMode(value) {
  return value === "promote-enclosed" ? "promote-enclosed" : "default";
}

export function normaliseParams(params = {}) {
  return {
    innerCount: clampInt(params.innerCount, 1, 12, 3),
    maxPlugAdds: clampInt(params.maxPlugAdds, 0, 12, 2),
    outsideBands: normaliseOutsideBands(params.outsideBands),
    outerHullClosureMode: normaliseOuterHullClosureMode(params.outerHullClosureMode),

    // Milestone 4.8 adoption path.
    // Disabled by default; only active when explicitly requested by caller.
    useFieldsForCoreOrdering: params.useFieldsForCoreOrdering === true,
    coreOrderingFieldName:
      typeof params.coreOrderingFieldName === "string" && params.coreOrderingFieldName.trim()
        ? params.coreOrderingFieldName.trim()
        : "distPlaza01",
  };
}

export default normaliseParams;
