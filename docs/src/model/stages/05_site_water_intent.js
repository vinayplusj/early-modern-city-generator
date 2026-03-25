// docs/src/model/stages/05_site_water_intent.js
//
// Stage 05: canonical pre-geometry water intent.
//
// Milestone 4.8 contract:
// - Publish deterministic water intent before footprint generation.
// - Keep this independent from Stage 40 water geometry.
// - Provide a stable object shape for Stage 25 and Stage 40.
//
// Output shape:
// {
//   kind: "none" | "river" | "coast",
//   dir: { x, y } | null,   // points toward the water pull / sea side
//   side: 0 | 1 | 2 | 3 | null,
//   source: string,
// }
//
// Hidden coupling:
// - Coast side convention must match the water helper used later in Stage 40:
//   0 = left, 1 = right, 2 = top, 3 = bottom.
// - Stage 25 consumes { kind, dir, side } and uses kind to choose water corridor mode.
// - Stage 40 may receive this object as an upstream hint, but must not become its source of truth.

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
  const side =
    Number.isInteger(sideRaw) && sideRaw >= 0 && sideRaw <= 3
      ? sideRaw
      : null;

  if (kind === "none") {
    return {
      kind: "none",
      dir: null,
      side: null,
      source: existing.source || "stage:water-intent:none:existing",
    };
  }

  if (kind === "river") {
    if (!dir) return null;
    return {
      kind: "river",
      dir,
      side: null,
      source: existing.source || "stage:water-intent:river:existing",
    };
  }

  if (kind === "coast") {
    const finalSide = side != null ? side : (dir ? dirToDominantCoastSide(dir) : null);
    const finalDir = dir || coastSideToDir(finalSide);
    if (finalSide == null || !finalDir) return null;

    return {
      kind: "coast",
      dir: unitOrNull(finalDir),
      side: finalSide,
      source:
        existing.source ||
        (side != null
          ? "stage:water-intent:coast:existing-side"
          : "stage:water-intent:coast:existing-dir"),
    };
  }

  return null;
}

function buildRiverIntent(seed) {
  const rng = rngFork(seed, "stage:water-intent:river");
  const ang = rng() * Math.PI * 2;
  const dir = unitOrNull({ x: Math.cos(ang), y: Math.sin(ang) });

  if (!dir) {
    throw new Error("[EMCG] Stage 05 failed to build a finite river direction.");
  }

  return {
    kind: "river",
    dir,
    side: null,
    source: "stage:water-intent:river:v1",
  };
}

function buildCoastIntent(seed) {
  const rng = rngFork(seed, "stage:water-intent:coast");
  const side = Math.floor(rng() * 4) & 3;
  const dir = coastSideToDir(side);

  if (!dir) {
    throw new Error("[EMCG] Stage 05 failed to map coast side to direction.");
  }

  return {
    kind: "coast",
    dir: unitOrNull(dir),
    side,
    source: "stage:water-intent:coast:v1",
  };
}

function validateCanonicalIntent(out) {
  if (!out || typeof out !== "object") {
    throw new Error("[EMCG] Stage 05 produced no water intent object.");
  }

  const kind = normalizeWaterKind(out.kind);

  if (kind === "none") {
    if (out.dir != null || out.side != null) {
      throw new Error("[EMCG] Stage 05 invalid none intent: dir and side must be null.");
    }
    return out;
  }

  if (!isFiniteDir(out.dir)) {
    throw new Error(`[EMCG] Stage 05 invalid ${kind} intent: dir must be finite.`);
  }

  if (kind === "river") {
    if (out.side != null) {
      throw new Error("[EMCG] Stage 05 invalid river intent: side must be null.");
    }
    return {
      kind: "river",
      dir: unitOrNull(out.dir),
      side: null,
      source: out.source || "stage:water-intent:river:validated",
    };
  }

  if (kind === "coast") {
    if (!(Number.isInteger(out.side) && out.side >= 0 && out.side <= 3)) {
      throw new Error("[EMCG] Stage 05 invalid coast intent: side must be 0..3.");
    }
    return {
      kind: "coast",
      dir: unitOrNull(out.dir),
      side: out.side,
      source: out.source || "stage:water-intent:coast:validated",
    };
  }

  return {
    kind: "none",
    dir: null,
    side: null,
    source: "stage:water-intent:none:validated-fallback",
  };
}

export function runSiteWaterIntentStage({ ctx, waterKind, seed = null } = {}) {
  if (!ctx) throw new Error("[EMCG] Stage 05 requires ctx.");

  ctx.state = ctx.state || {};

  const kind = normalizeWaterKind(waterKind);
  const rootSeed = Number.isFinite(seed) ? seed : ctx.seed;

  // Preserve a valid pre-existing canonical intent when present.
  const existing = canonicalizeExistingIntent(ctx.state.waterIntent, kind);
  if (existing) {
    ctx.state.waterIntent = validateCanonicalIntent(existing);
    return ctx.state.waterIntent;
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

  ctx.state.waterIntent = validateCanonicalIntent(out);
  return ctx.state.waterIntent;
}

export default runSiteWaterIntentStage;
