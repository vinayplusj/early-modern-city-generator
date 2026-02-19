// docs/src/model/generate_helpers/new_town.js
//
// New Town placement and targeted bastion flattening.

import { clamp, add, mul, perp, normalize } from "../../geom/primitives.js";

export function placeNewTown({
  gates,
  cx,
  cy,
}) {
  if (!Array.isArray(gates) || gates.length === 0) {
    return {
      newTown: null,
      primaryGate: null,
      hitBastions: [],
      stats: {},
      wallFinal: null,
      bastionPolys: null,
    };
  }

  // Deterministic: choose first gate (same as current fallback behaviour)
  const g = gates[0];

  const out = normalize({ x: g.x - cx, y: g.y - cy });
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) {
    return {
      newTown: null,
      primaryGate: g,
      hitBastions: [],
      stats: {},
      wallFinal: null,
      bastionPolys: null,
    };
  }

  const side = normalize(perp(out));

  const newTown = {
    kind: "new_town",
    orientation: { out, side },
    gate: g,
  };

  return {
    newTown,
    primaryGate: g,
    hitBastions: [],
    stats: {},
    wallFinal: null,
    bastionPolys: null,
  };
}
