// docs/src/model/stages/05_site_water_intent.js
//
// Milestone 4.8: canonical pre-geometry water intent.
//
// Purpose:
// - Publish a deterministic water intent before footprint generation.
// - Keep this independent from Stage 40 water geometry so stage order does not
//   change the later water RNG stream.
// - Provide a stable contract for Stage 25 footprint shaping.
//
// Output shape:
// {
//   kind: "none" | "river" | "coast",
//   dir: {x,y} | null,    // points toward the water pull / sea side
//   side: 0 | 1 | 2 | 3 | null,
//   source: string,
// }

import { normalize } from "../../geom/primitives.js";
import { rngFork } from "../rng/rng_fork.js";

function isFiniteDir(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y);
}

function unitOrNull(v) {
  if (!isFiniteDir(v)) return null;
  const n = normalize(v);
  if (!isFiniteDir(n)) return null;
  const m = Math.hypot(n.x, n.y);
  if (!Number.isFinite(m) || m <= 1e-9) return null;
  return n;
}

function normalizeWaterKind(kind) {
  return (kind === "river" || kind === "coast") ? kind : "none";
}

// Coast side convention must match docs/src/model/generate_helpers/water.js:
// 0 = left, 1 = right, 2 = top, 3 = bottom.
function coastSideToDir(side) {
  if (side === 0) return { x: -1, y: 0 };
  if (side === 1) return { x: 1, y: 0 };
  if (side === 2) return { x: 0, y: -1 };
  if (side === 3) return { x: 0, y: 1 };
  return null;
}

function dirToDominantCoastSide(dir) {
  if (!isFiniteDir(dir)) return null;
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x < 0 ? 0 : 1;
  return dir.y < 0 ? 2 : 3;
}

function canonicalizeExistingIntent(existing, kind) {
  if (!existing || typeof existing !== "object") return null;

  const dir = unitOrNull(existing.dir);
  const sideRaw = existing.side;
  const side = Number.isInteger(sideRaw) && sideRaw >= 0 && sideRaw <= 3 ? sideRaw : null;

  if (kind === "none") {
    return {
      kind: "none",
      dir: null,
      side: null,
      source: existing.source || "existing:none",
    };
  }

  if (kind === "river") {
    if (!dir) return null;
    return {
      kind: "river",
      dir,
      side: null,
      source: existing.source || "existing:river-dir",
    };
  }

  if (kind === "coast") {
    const finalSide = side != null ? side : (dir ? dirToDominantCoastSide(dir) : null);
    const finalDir = dir || coastSideToDir(finalSide);
    if (finalSide == null || !finalDir) return null;
    return {
      kind: "coast",
      dir: finalDir,
      side: finalSide,
      source: existing.source || (side != null ? "existing:coast-side" : "existing:coast-dir"),
    };
  }

  return null;
}

function buildRiverIntent(seed) {
  const rng = rngFork(seed, "stage:water-intent:river");
  const ang = rng() * Math.PI * 2;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  return {
    kind: "river",
    dir: unitOrNull(dir),
    side: null,
    source: "stage:water-intent:river:v1",
  };
}

function buildCoastIntent(seed) {
  const rng = rngFork(seed, "stage:water-intent:coast");
  const side = Math.floor(rng() * 4) & 3;
  const dir = coastSideToDir(side);
  return {
    kind: "coast",
    dir,
    side,
    source: "stage:water-intent:coast:v1",
  };
}

export function runSiteWaterIntentStage({ ctx, waterKind, seed = null } = {}) {
  const kind = normalizeWaterKind(waterKind);
  const rootSeed = Number.isFinite(seed) ? seed : ctx?.seed;

  if (!ctx) throw new Error("[EMCG] Stage 05 requires ctx.");

  ctx.state = ctx.state || {};

  // Preserve a valid pre-existing canonical intent when present.
  const existing = canonicalizeExistingIntent(ctx.state.waterIntent, kind);
  if (existing) {
    ctx.state.waterIntent = existing;
    return existing;
  }

  let out = null;

  if (kind === "none") {
    out = {
      kind: "none",
      dir: null,
      side: null,
      source: "stage:water-intent:none:v1",
    };
  } else if (kind === "river") {
    if (!Number.isFinite(rootSeed)) {
      throw new Error("[EMCG] Stage 05 river intent requires a finite seed.");
    }
    out = buildRiverIntent(rootSeed);
  } else if (kind === "coast") {
    if (!Number.isFinite(rootSeed)) {
      throw new Error("[EMCG] Stage 05 coast intent requires a finite seed.");
    }
    out = buildCoastIntent(rootSeed);
  }

  ctx.state.waterIntent = out;
  return out;
}
