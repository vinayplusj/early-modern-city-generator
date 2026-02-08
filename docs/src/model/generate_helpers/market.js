// docs/src/model/generate_helpers/market.js
//
// Market placement helpers.

import { add, mul, normalize, perp } from "../../geom/primitives.js";
import { pointInPoly } from "../../geom/poly.js";

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function safeMarketNudge({
  squareCentre,
  marketCentre,
  centre,
  primaryGate,
  cx,
  cy,
  baseR,
  footprint,
  wallBase,
}) {
  if (!squareCentre || !marketCentre) return marketCentre;

  const minSep = baseR * 0.04;
  const minSep2 = minSep * minSep;
  if (dist2(squareCentre, marketCentre) >= minSep2) return marketCentre;

  const inside = (p) =>
    (!footprint || footprint.length < 3 || pointInPoly(p, footprint)) &&
    (!wallBase || wallBase.length < 3 || pointInPoly(p, wallBase));

  // Preferred direction: perpendicular to gate->centre axis
  let out = null;
  if (primaryGate) {
    out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
  } else if (centre) {
    out = normalize({ x: squareCentre.x - centre.x, y: squareCentre.y - centre.y });
  } else {
    out = { x: 1, y: 0 };
  }

  const side = normalize(perp(out));
  const step = minSep;

  const c1 = add(squareCentre, mul(side, step));
  if (inside(c1)) return c1;

  const c2 = add(squareCentre, mul(side, -step));
  if (inside(c2)) return c2;

  // Fallback: try a few angles around the square
  const tries = 10;
  for (let i = 0; i < tries; i++) {
    const ang = (i / tries) * Math.PI * 2;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const c = add(squareCentre, mul(dir, step));
    if (inside(c)) return c;
  }

  return marketCentre;
}

export function computeMarketCentre({
  squareCentre,
  centre,
  primaryGate,
  cx,
  cy,
  baseR,
  footprint,
  wallBase,
}) {
  // Initial candidate: side-offset from the square.
  if (!primaryGate) {
    const c0 = add(squareCentre, { x: baseR * 0.07, y: 0 });
    return (pointInPoly(c0, footprint) && pointInPoly(c0, wallBase)) ? c0 : squareCentre;
  }

  const out = normalize({ x: primaryGate.x - cx, y: primaryGate.y - cy });
  const side = normalize(perp(out));

  const c1 = add(squareCentre, mul(side, baseR * 0.07));
  if (pointInPoly(c1, footprint) && pointInPoly(c1, wallBase)) return c1;

  const c2 = add(squareCentre, mul(side, -baseR * 0.07));
  if (pointInPoly(c2, footprint) && pointInPoly(c2, wallBase)) return c2;

  // Fallback: the square.
  return squareCentre;
}

// Alias for call sites that import the old name.
export const computeInitialMarketCentre = computeMarketCentre;
