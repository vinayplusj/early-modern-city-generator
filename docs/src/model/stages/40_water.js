// docs/src/model/stages/40_water.js

import { buildWaterModel } from "../water.js";

/**
 * @param {object} args
 * @returns {object} waterModel
 */
function _unitDir(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const m = Math.hypot(dx, dy);
  if (m <= 1e-9) return null;
  return { x: dx / m, y: dy / m };
}

function _perp(v) {
  return v ? { x: -v.y, y: v.x } : null;
}
export function runWaterStage({ waterKind, rng, outerBoundary, cx, cy, baseR, waterIntent = null }) {
  const waterModel = (waterKind === "none")
    ? { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null }
    : buildWaterModel({
        rng,
        siteWater: waterKind,
        outerBoundary,
        cx,
        cy,
        baseR,
        waterIntent,
      });

  let derived = null;

  if (waterModel && waterModel.kind === "river" && waterModel.river && Array.isArray(waterModel.river.polyline)) {
    const pts = waterModel.river.polyline;
    if (pts.length >= 2) derived = _unitDir(pts[0], pts[pts.length - 1]);
  }

  if (waterModel && waterModel.kind === "coast" && Array.isArray(waterModel.shoreline) && waterModel.shoreline.length === 2) {
    const [a, b] = waterModel.shoreline;
    const shoreDir = _unitDir(a, b);
    derived = _perp(shoreDir);
  }

  return { waterModel, waterIntentDerived: derived ? { dir: derived } : null };
}
