// docs/src/model/generate.js
//
// City model generator (Milestone 3.5 + 3.6 debug blocks).
// This module assembles the full "model" object consumed by rendering.
//
// Key invariants:
// - Deterministic: same seed -> same city.
// - No external deps.
// - All per-run arrays (polylines, landmarks, etc.) are created INSIDE generate().
// - Rendering remains read-only; all logic here or in geom/roads modules.

import { createCtx } from "./ctx.js";
import { runPipeline } from "./pipeline/run_pipeline.js";

const WARP_FORT = {
  enabled: true,
  debug: true,

  samples: 720,
  smoothRadius: 10,
  maxStep: 1.5,

  maxOut: 40,
  maxIn: 100,

  bandInner: 0,
  bandOuter: 0,
  bandThickness: 120,

  defaultFortOffset: 0,
  newTownFortOffset: 30,
  outerWardFortOffset: 10,
  citadelFortOffset: -10,

  targetMargin: 0,

  // Bastion protection
  bastionLockPad: 0.12,
  bastionLockFeather: 0.10,

  // Option A: blocks outward bulge near bastion tips only
  bastionClearHalfWidth: 0.05,
  bastionClearFeather: 0.06,
};

// ---------------- Build / version stamp ----------------
// Update this string when you make meaningful changes.
export const GENERATOR_BUILD = {
  version: "623",
  buildDate: "2026-02-19",
  commit: "manual",
};

let __buildLogged = false;

function logBuildOnce(seed, width, height, site) {
  if (__buildLogged) return;
  __buildLogged = true;

  // Allow index.html (or other code) to override this at runtime if desired.
  const build = globalThis.__EMCG_BUILD__ || GENERATOR_BUILD;

  console.info("[EMCG] Generator build:", build);
  console.info("[EMCG] First run params:", { seed, width, height, site });
}

export function generate(seed, bastionCount, gateCount, width, height, site = {}) {
  logBuildOnce(seed, width, height, site);

  const waterKind = (site && typeof site.water === "string") ? site.water : "none";
  const hasDock = Boolean(site && site.hasDock) && waterKind !== "none";

  const ctx = createCtx({
    seed,
    w: width,
    h: height,
    site: { water: waterKind, hasDock },
    params: { bastions: bastionCount, gates: gateCount },
  });
  
  // Provide warp parameters to stages via ctx.params (read by Stage 20 / Stage 110).
  ctx.params.warpFortParams = WARP_FORT;
  ctx.params.warpDebugEnabled = WARP_FORT.debug;
  
  // Phase 1: run the full generator pipeline and return the assembled model.
  return runPipeline(ctx);
}
