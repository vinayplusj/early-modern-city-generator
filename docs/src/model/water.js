// docs/src/model/water.js
//
// Model-level wrapper around generate_helpers/water.js.
// Normalizes the output so generate.js and render code have a stable shape.

import { buildWater } from "./generate_helpers/water.js";

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function dist2PointToSeg(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-12) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }

  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  const cx = a.x + abx * t;
  const cy = a.y + aby * t;

  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

// Picks the polygon edge closest to nearPoint, and returns it as a 2-point polyline.
function pickBestEdge(poly, nearPoint) {
  if (!Array.isArray(poly) || poly.length < 3 || !isPoint(nearPoint)) return null;

  let bestI = 0;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isPoint(a) || !isPoint(b)) continue;

    const d2 = dist2PointToSeg(nearPoint, a, b);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
    }
  }

  const a = poly[bestI];
  const b = poly[(bestI + 1) % poly.length];
  if (!isPoint(a) || !isPoint(b)) return null;

  return [a, b];
}

export function buildWaterModel({ rng, siteWater, outerBoundary, cx, cy, baseR } = {}) {
  const kind = (siteWater === "river" || siteWater === "coast") ? siteWater : "none";

  if (kind === "none") {
    return { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null };
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

  if (raw.kind === "coast" && Array.isArray(raw.polygon) && raw.polygon.length >= 3) {
    const bankPoint = isPoint(raw.bankPoint) ? raw.bankPoint : { x: cx, y: cy };
    const shoreline = pickBestEdge(raw.polygon, bankPoint);

    return {
      kind: "coast",
      river: null,
      coast: { polygon: raw.polygon },
      shoreline,              // shoreline is now the cut edge, not the full sea polygon
      bankPoint,
    };
  }

  return { 
    kind: "none", 
    river: null, 
    coast: null, 
    shoreline: null, 
    bankPoint: null };
}
