// docs/src/model/invariants/anchor_invariants.js
// Anchor placement checks for Stage 900.

import { finitePointOrNull } from "../../geom/primitives.js";
import { pointInPolyOrOn } from "../../geom/poly.js";
import { isInsidePolyOrSkip } from "../../geom/is_inside_poly_or_skip.js";
import { resolveDockPoint } from "./invariant_utils.js";

export function checkAnchorInvariants({
  errors,
  anchors,
  wallBase,
  outerBoundary,
  width,
  height,
  hasDock,
  waterModel,
}) {
  const bad = [];

  const plazaOk =
    finitePointOrNull(anchors?.plaza) &&
    isInsidePolyOrSkip(anchors.plaza, wallBase) &&
    (anchors.plaza.x >= 0 && anchors.plaza.x <= width && anchors.plaza.y >= 0 && anchors.plaza.y <= height);

  const citadelOk =
    finitePointOrNull(anchors?.citadel) &&
    isInsidePolyOrSkip(anchors.citadel, wallBase) &&
    (anchors.citadel.x >= 0 && anchors.citadel.x <= width && anchors.citadel.y >= 0 && anchors.citadel.y <= height);

  const marketOk =
    finitePointOrNull(anchors?.market) &&
    isInsidePolyOrSkip(anchors.market, wallBase) &&
    (anchors.market.x >= 0 && anchors.market.x <= width && anchors.market.y >= 0 && anchors.market.y <= height);

  const dockPoint = resolveDockPoint(anchors);

  let docksOk = true;
  if (hasDock) {
    docksOk =
      (anchors?.docks === null) ||
      (dockPoint &&
        !pointInPolyOrOn(dockPoint, wallBase, 1e-6) &&
        isInsidePolyOrSkip(dockPoint, outerBoundary) &&
        (dockPoint.x >= 0 && dockPoint.x <= width && dockPoint.y >= 0 && dockPoint.y <= height));
  }

  if (!plazaOk) bad.push("plaza");
  if (!citadelOk) bad.push("citadel");
  if (!marketOk) bad.push("market");
  if (!docksOk) bad.push("docks");

  if (bad.length) {
    console.warn("ANCHOR INVARIANTS FAILED", bad, {
      plaza: anchors?.plaza,
      citadel: anchors?.citadel,
      market: anchors?.market,
      docks: anchors?.docks,
      dockPoint,
      hasDock,
      water: waterModel?.kind,
    });
    errors.push(`Anchors invalid: ${bad.join(", ")}`);
  }
}
