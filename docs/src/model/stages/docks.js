// docs/src/model/stages/docks.js
//
// Docks anchor placement (optional). Behaviour should remain identical to the previous inline code.

import {
  add,
  mul,
  normalize,
  clampPointToCanvas,
} from "../../geom/primitives.js";

import {
  pointInPolyOrOn,
  pushOutsidePoly,
  supportPoint,
  snapPointToPolyline,
} from "../../geom/poly.js";

export function buildDocks({
  hasDock,
  anchors,
  newTown,
  outerBoundary,
  wallBase,
  centre,
  waterModel,
  width,
  height,
}) {

  // Deterministic docks point, created only when the UI enables it.
  // Invariant: anchors.docks is null unless hasDock is true.
  let docks = null;

  const dockPoly =
    (newTown?.poly && newTown.poly.length >= 3) ? newTown.poly :
    (outerBoundary && outerBoundary.length >= 3) ? outerBoundary :
    null;

  if (
    hasDock &&
    dockPoly &&
    anchors.primaryGate &&
    waterModel &&
    waterModel.kind !== "none" &&
    Array.isArray(waterModel.shoreline) &&
    waterModel.shoreline.length >= 2
  ) {
    const raw = { x: anchors.primaryGate.x - centre.x, y: anchors.primaryGate.y - centre.y };
    const dir = (Math.hypot(raw.x, raw.y) > 1e-6) ? normalize(raw) : { x: 1, y: 0 };

    const v = supportPoint(dockPoly, dir);

    if (v) {
      const snapped = snapPointToPolyline(v, waterModel.shoreline);

      const iv = { x: centre.x - snapped.x, y: centre.y - snapped.y };
      const inward = (Math.hypot(iv.x, iv.y) > 1e-6) ? normalize(iv) : { x: 1, y: 0 };

      let p = add(snapped, mul(inward, 6));

      const MAX_IN_STEPS = 80;
      const IN_STEP = 6;

      // 1) Walk inward until inside the overall buildable boundary.
      if (Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
        for (let i = 0; i < MAX_IN_STEPS; i++) {
          if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
          p = add(p, mul(inward, IN_STEP));
        }
      }

      // 2) Clamp to visible canvas (coast cases often go off-canvas).
      p = clampPointToCanvas(p, width, height, 10);

      // 3) Clamping can move it outside boundary again, so walk inward again.
      if (Array.isArray(outerBoundary) && outerBoundary.length >= 3) {
        for (let i = 0; i < MAX_IN_STEPS; i++) {
          if (pointInPolyOrOn(p, outerBoundary, 1e-6)) break;
          p = add(p, mul(inward, IN_STEP));
          p = clampPointToCanvas(p, width, height, 10);
        }
      }

      // 4) Final clamp so it always remains drawable.
      p = clampPointToCanvas(p, width, height, 10);

      docks = p;

      // Docks must be outside the bastioned fort (wallBase). If not, push outward; if still bad, drop it.
      if (docks && Array.isArray(wallBase) && wallBase.length >= 3) {
        if (pointInPolyOrOn(docks, wallBase, 1e-6)) {
          docks = pushOutsidePoly(docks, wallBase, centre, 6, 120);
        }

        if (docks && pointInPolyOrOn(docks, wallBase, 1e-6)) {
          docks = null;
        }
      }

      // Keep docks on-canvas if it exists.
      if (docks) {
        docks = clampPointToCanvas(docks, width, height, 10);
      }
    }
  }

  return docks;
}
