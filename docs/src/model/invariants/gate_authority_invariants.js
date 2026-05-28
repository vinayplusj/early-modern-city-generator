// docs/src/model/invariants/gate_authority_invariants.js
// Milestone 5A gate authority checks.

import { isFinitePoint } from "../../geom/primitives.js";
import { pushIfFalse } from "./invariant_utils.js";

function isUnitLike(v, eps = 1e-3) {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
  const m = Math.hypot(v.x, v.y);
  return Math.abs(m - 1) <= eps;
}

function hasValidPortal(portal, gateId) {
  return (
    portal &&
    typeof portal === "object" &&
    portal.gateId === gateId &&
    Number.isInteger(portal.boundaryHalfEdgeId) &&
    Number.isFinite(portal.t) &&
    portal.t >= 0 &&
    portal.t <= 1
  );
}

function hasValidBoundaryExit(exit, gateId) {
  return (
    exit &&
    typeof exit === "object" &&
    exit.gateId === gateId &&
    Number.isInteger(exit.exitId) &&
    Number.isInteger(exit.outerBoundarySegIndex) &&
    Number.isFinite(exit.t) &&
    exit.t >= 0 &&
    exit.t <= 1 &&
    isFinitePoint(exit.point)
  );
}

export function checkGateAuthorityInvariants({
  errors,
  gateAuthority,
  gates,
  gatePortals,
  boundaryExits,
}) {
  pushIfFalse(
    errors,
    !!gateAuthority,
    "Milestone 5A invalid: gateAuthority is missing"
  );

  if (!gateAuthority) return;

  pushIfFalse(
    errors,
    gateAuthority.kind === "gateAuthority",
    `Milestone 5A invalid: gateAuthority.kind must be gateAuthority, got ${gateAuthority.kind}`
  );

  pushIfFalse(
    errors,
    gateAuthority.version === 1,
    `Milestone 5A invalid: gateAuthority.version must be 1, got ${gateAuthority.version}`
  );

  const records = Array.isArray(gateAuthority.gates) ? gateAuthority.gates : [];

  pushIfFalse(
    errors,
    records.length > 0,
    "Milestone 5A invalid: gateAuthority.gates must be non-empty"
  );

  pushIfFalse(
    errors,
    Array.isArray(gates) && records.length === gates.length,
    `Milestone 5A invalid: gateAuthority.gates length must equal gates length (${gates?.length ?? "unknown"}), got ${records.length}`
  );

  pushIfFalse(
    errors,
    Array.isArray(gatePortals) && records.length === gatePortals.length,
    `Milestone 5A invalid: gateAuthority.gates length must equal gatePortals length (${gatePortals?.length ?? "unknown"}), got ${records.length}`
  );

  pushIfFalse(
    errors,
    Array.isArray(boundaryExits) && records.length === boundaryExits.length,
    `Milestone 5A invalid: gateAuthority.gates length must equal boundaryExits length (${boundaryExits?.length ?? "unknown"}), got ${records.length}`
  );

  let primaryCount = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];

    pushIfFalse(
      errors,
      rec?.gateId === i,
      `Milestone 5A invalid: gateAuthority record index ${i} must have gateId=${i}`
    );

    pushIfFalse(
      errors,
      isFinitePoint(rec?.point),
      `Milestone 5A invalid: gate ${i} point is invalid`
    );

    pushIfFalse(
      errors,
      rec?.wall?.onWall === true,
      `Milestone 5A invalid: gate ${i} is not certified on wall (distance=${rec?.wall?.distance ?? "unknown"})`
    );

    pushIfFalse(
      errors,
      Number.isInteger(rec?.wall?.segmentIndex) && Number.isFinite(rec?.wall?.t),
      `Milestone 5A invalid: gate ${i} wall binding is incomplete`
    );

    pushIfFalse(
      errors,
      hasValidPortal(rec?.portal, i),
      `Milestone 5A invalid: gate ${i} portal binding is invalid`
    );

    pushIfFalse(
      errors,
      hasValidBoundaryExit(rec?.boundaryExit, i),
      `Milestone 5A invalid: gate ${i} boundary exit binding is invalid`
    );

    pushIfFalse(
      errors,
      isUnitLike(rec?.outward),
      `Milestone 5A invalid: gate ${i} outward vector is invalid`
    );

    if (rec?.isPrimary === true) primaryCount++;
  }

  pushIfFalse(
    errors,
    primaryCount === 1,
    `Milestone 5A invalid: exactly one primary gate is required, got ${primaryCount}`
  );

  pushIfFalse(
    errors,
    Number.isInteger(gateAuthority.primaryGateId) &&
      gateAuthority.primaryGateId >= 0 &&
      gateAuthority.primaryGateId < records.length,
    `Milestone 5A invalid: primaryGateId is out of range: ${gateAuthority.primaryGateId}`
  );

  pushIfFalse(
    errors,
    gateAuthority.meta?.complete === true,
    "Milestone 5A invalid: gateAuthority.meta.complete must be true"
  );
}
