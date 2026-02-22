// docs/src/model/stages/60_anchors.js
//
// Stage 60: Build anchors.
// Extracted from generate.js without functional changes.

import { buildAnchors } from "./anchors.js";

function isPoint(p) {
  return Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function briefPoint(p) {
  if (!p || typeof p !== "object") return p;
  return {
    x: Number.isFinite(p.x) ? Math.round(p.x * 1000) / 1000 : p.x,
    y: Number.isFinite(p.y) ? Math.round(p.y * 1000) / 1000 : p.y,
  };
}

/**
 * @param {object} ctx
 * @returns {object} anchors
 */
export function runAnchorsStage(ctx) {
  const anchors = buildAnchors(ctx);

  if (!anchors || typeof anchors !== "object") {
    throw new Error("[EMCG] Stage 60 buildAnchors() returned a non-object anchors value.");
  }

  // Phase 2: these are hard requirements for routing to be stable.
  // If you later want to support generator modes without a citadel or plaza,
  // then Stage 140 must be made conditional as well.
  if (!isPoint(anchors.plaza)) {
    throw new Error(
      "[EMCG] Stage 60 missing anchors.plaza. Got: " +
      JSON.stringify(briefPoint(anchors.plaza))
    );
  }
  if (!isPoint(anchors.citadel)) {
    throw new Error(
      "[EMCG] Stage 60 missing anchors.citadel. Got: " +
      JSON.stringify(briefPoint(anchors.citadel))
    );
  }
  if (!isPoint(anchors.centre)) {
    throw new Error(
      "[EMCG] Stage 60 missing anchors.centre. Got: " +
      JSON.stringify(briefPoint(anchors.centre))
    );
  }

  // Optional but recommended: make sure we always return the expected keys.
  // Keeps downstream code stable during Phase 2 migration.
  if (!("market" in anchors)) anchors.market = null;
  if (!("docks" in anchors)) anchors.docks = null;
  if (!("primaryGate" in anchors)) anchors.primaryGate = null;

  return anchors;
}
