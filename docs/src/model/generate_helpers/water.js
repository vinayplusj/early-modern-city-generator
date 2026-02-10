// docs/src/model/generate_helpers/water.js
//
// Generates water geometry for the site selector.
// Output is deterministic for a given RNG stream.
//
// Contract:
// buildWater({ rng, siteWater, outerBoundary, cx, cy, baseR }) -> {
//   kind: "none" | "river" | "coast",
//   polyline: Array<{x,y}> | null,   // river centreline
//   polygon: Array<{x,y}> | null,    // coast "sea" polygon
//   bankPoint: {x,y} | null,         // useful hint for docks later
// }

import { add, sub, mul, normalize, lerp } from "../../geom/primitives.js";

function bboxFromPoly(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly || []) {
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function supportPoint(poly, dir) {
  if (!poly || poly.length < 1) return null;
  let best = poly[0];
  let bestDot = best.x * dir.x + best.y * dir.y;

  for (let i = 1; i < poly.length; i++) {
    const p = poly[i];
    const d = p.x * dir.x + p.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      best = p;
    }
  }
  return best;
}

function makeRiverPolyline({ rng, outerBoundary, cx, cy, baseR }) {
  const bb = bboxFromPoly(outerBoundary);
  const pad = Math.max(baseR * 1.2, 120);

  const w = (bb.maxX - bb.minX) + pad * 2;
  const h = (bb.maxY - bb.minY) + pad * 2;
  const span = Math.max(w, h);

  // Pick a direction and a perpendicular.
  const ang = rng() * Math.PI * 2;
  const dir = normalize({ x: Math.cos(ang), y: Math.sin(ang) });
  const perp = { x: -dir.y, y: dir.x };

  // Choose where the river crosses near the city centre.
  const crossOffset = (rng() * 2 - 1) * baseR * 0.35;
  const cross = add({ x: cx, y: cy }, mul(perp, crossOffset));

  // Build points along the line, with gentle lateral meander.
  const steps = 18;
  const amp = baseR * (0.10 + rng() * 0.10); // meander amplitude
  const freq = 1.2 + rng() * 1.2;
  const phase = rng() * Math.PI * 2;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = lerp(-0.2, 1.2, i / steps);

    const along = (t - 0.5) * span * 1.25;
    const meander = Math.sin(t * Math.PI * 2 * freq + phase) * amp;

    const p = add(cross, add(mul(dir, along), mul(perp, meander)));
    pts.push(p);
  }

  // A reasonable dock hint for later: bank side near the outward direction.
  // For now, just return the point farthest from centre.
  let bankPoint = null;
  let bestD2 = -Infinity;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) {
      bestD2 = d2;
      bankPoint = p;
    }
  }

  return { polyline: pts, bankPoint };
}

function makeCoastPolygon({ rng, outerBoundary, cx, cy, baseR }) {
  const bb = bboxFromPoly(outerBoundary);
  const pad = Math.max(baseR * 1.6, 180);

  const minX = bb.minX - pad;
  const maxX = bb.maxX + pad;
  const minY = bb.minY - pad;
  const maxY = bb.maxY + pad;

  // Pick a side for the sea to come from.
  // 0: left, 1: right, 2: top, 3: bottom
  const side = Math.floor(rng() * 4);

  // How deep the sea cuts into the map.
  const cut = baseR * (0.45 + rng() * 0.35);

  let poly = null;
  let bankPoint = null;

  if (side === 0) {
    const xCut = (bb.minX + bb.maxX) * 0.5 - cut;
    poly = [
      { x: minX, y: minY },
      { x: xCut, y: minY },
      { x: xCut, y: maxY },
      { x: minX, y: maxY },
    ];
    bankPoint = { x: xCut, y: cy };
  } else if (side === 1) {
    const xCut = (bb.minX + bb.maxX) * 0.5 + cut;
    poly = [
      { x: xCut, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: xCut, y: maxY },
    ];
    bankPoint = { x: xCut, y: cy };
  } else if (side === 2) {
    const yCut = (bb.minY + bb.maxY) * 0.5 - cut;
    poly = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: yCut },
      { x: minX, y: yCut },
    ];
    bankPoint = { x: cx, y: yCut };
  } else {
    const yCut = (bb.minY + bb.maxY) * 0.5 + cut;
    poly = [
      { x: minX, y: yCut },
      { x: maxX, y: yCut },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    bankPoint = { x: cx, y: yCut };
  }

  return { polygon: poly, bankPoint };
}

export function buildWater({ rng, siteWater, outerBoundary, cx, cy, baseR }) {
  const kind = (siteWater === "river" || siteWater === "coast") ? siteWater : "none";

  if (kind === "none") {
    return { kind: "none", polyline: null, polygon: null, bankPoint: null };
  }

  if (!outerBoundary || outerBoundary.length < 3) {
    return { kind, polyline: null, polygon: null, bankPoint: { x: cx, y: cy } };
  }

  if (kind === "river") {
    const { polyline, bankPoint } = makeRiverPolyline({ rng, outerBoundary, cx, cy, baseR });
    return { kind: "river", polyline, polygon: null, bankPoint };
  }

  // Coast
  const { polygon, bankPoint } = makeCoastPolygon({ rng, outerBoundary, cx, cy, baseR });
  return { kind: "coast", polyline: null, polygon, bankPoint };
}
