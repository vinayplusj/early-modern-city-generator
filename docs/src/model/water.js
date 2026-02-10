// docs/src/model/water.js
//
// Model-level wrapper around generate_helpers/water.js.
// Normalizes the output so generate.js and render code have a stable shape.
//


import { buildWater } from "./generate_helpers/water.js";

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function buildWaterModel({ rng, siteWater, outerBoundary, cx, cy, baseR } = {}) {
  const kind = (siteWater === "river" || siteWater === "coast") ? siteWater : "none";

  if (kind === "none") {
    return {
      kind: "none",
      river: null,
      coast: null,
      shoreline: null,
      bankPoint: null,
    };
  }

  const raw = buildWater({ rng, siteWater: kind, outerBoundary, cx, cy, baseR }) || {};

  if (raw.kind === "river" && Array.isArray(raw.polyline) && raw.polyline.length >= 2) {
    return {
      kind: "river",
      river: { polyline: raw.polyline },
      coast: null,
      shoreline: raw.polyline,
      bankPoint: isPoint(raw.bankPoint) ? raw.bankPoint : null,
    };
  }

  // Coast
  if (raw.kind === "coast" && Array.isArray(raw.polygon) && raw.polygon.length >= 3) {
    const bankPoint = isPoint(raw.bankPoint) ? raw.bankPoint : { x: cx, y: cy };
  
    return {
      kind: "coast",
      river: null,
      coast: { polygon: raw.polygon },
      shoreline: raw.polygon,   // <-- change THIS
      bankPoint,
    };
  }

  // Fallback
  return {
    kind: "none",
    river: null,
    coast: null,
    shoreline: null,
    bankPoint: isPoint(raw.bankPoint) ? raw.bankPoint : null,
  };
}
