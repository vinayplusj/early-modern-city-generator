// docs/src/model/stages/160_market.js
//
// Stage 160: Market anchor (always-on) and landmarks.
// Extracted from generate.js without functional changes.

import {
  add,
  mul,
  safeNormalize,
  finitePointOrNull,
  vec,
  len,
  clampPointToCanvas,
} from "../../geom/primitives.js";

import { wardCentroid } from "../wards/ward_roles.js";

import { computeInitialMarketCentre, safeMarketNudge } from "../generate_helpers/market.js";
import { ensureInside, pushAwayFromWall } from "../anchors/anchor_constraints.js";

/**
 * @param {object} args
 * @returns {object} { marketCentre, marketAnchor, landmarks }
 */
export function runMarketStage({
  anchors,
  wardsWithRoles,
  wallBaseForDraw,
  centre,
  primaryGateWarped,
  cx,
  cy,
  baseR,
  footprint,
  width,
  height,
  citadel,
}) {
  let marketCentre = computeInitialMarketCentre({
    squareCentre: anchors.plaza,
    primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase: wallBaseForDraw,
  });

  marketCentre = safeMarketNudge({
    squareCentre: anchors.plaza,
    marketCentre,
    centre,
    primaryGate: primaryGateWarped,
    cx,
    cy,
    baseR,
    footprint,
    wallBase: wallBaseForDraw,
  });

  // ---------------- Market anchor (always-on, always valid) ----------------
  let marketAnchor = finitePointOrNull(marketCentre);

  const innerWards = (wardsWithRoles || []).filter((w) => w && w.role === "inner");
  let marketFallback = null;

  for (const w of innerWards) {
    const c = wardCentroid(w);
    if (finitePointOrNull(c)) {
      marketFallback = c;
      break;
    }
  }

  if (!marketAnchor) {
    marketAnchor = add(anchors.plaza, { x: baseR * 0.03, y: -baseR * 0.02 });
  }

  marketAnchor = ensureInside(wallBaseForDraw, marketAnchor, centre, 1.0);
  marketAnchor = pushAwayFromWall(wallBaseForDraw, marketAnchor, baseR * 0.035 * 1.25, centre);

  if (marketFallback) {
    const mv = vec(marketAnchor, marketFallback);
    if (len(mv) > baseR * 0.18) {
      marketAnchor = add(marketAnchor, mul(safeNormalize(mv), baseR * 0.08));
      marketAnchor = ensureInside(wallBaseForDraw, marketAnchor, centre, 1.0);
      marketAnchor = pushAwayFromWall(wallBaseForDraw, marketAnchor, baseR * 0.035 * 1.25, centre);
    }
  }

  marketAnchor = clampPointToCanvas(marketAnchor, width, height, 10);

  marketAnchor = ensureInside(wallBaseForDraw, marketAnchor, centre, 1.0);
  marketAnchor = pushAwayFromWall(wallBaseForDraw, marketAnchor, baseR * 0.035 * 1.25, centre);

  marketCentre = marketAnchor;

  const landmarks = [
    { id: "square", pointOrPolygon: anchors.plaza, kind: "main_square", label: "Main Square" },
    { id: "market", pointOrPolygon: marketAnchor, kind: "market", label: "Market" },
    { id: "citadel", pointOrPolygon: citadel, kind: "citadel", label: "Citadel" },
  ];

  return { marketCentre, marketAnchor, landmarks };
}
