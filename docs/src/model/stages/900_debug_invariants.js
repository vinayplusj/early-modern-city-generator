// docs/src/model/stages/900_debug_invariants.js
//
// Stage 900: Debug invariants and diagnostics.
// Extended for Milestone 4.8 closure checks.
//
// Notes:
// - This stage still returns immediately when debugEnabled is false.
// - New checks added here focus on:
//   1) corridor intent presence and structure
//   2) anchor placement sanity
//   3) hull containment sanity
//   4) field completeness and bounded ranges, when fieldsMeta is passed in
//
// Safe coupling:
// - All new checks are additive.
// - Field checks are only enforced when fieldsMeta is provided by the registry.
// - This lets you land this file first, then add the small registry follow-up.

import { finitePointOrNull } from "../../geom/primitives.js";
import { pointInPolyOrOn } from "../../geom/poly.js";
import { isInsidePolyOrSkip } from "../../geom/is_inside_poly_or_skip.js";

function isFinitePoint(p) {
  return !!(p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

function corridorAngleDeg(dir) {
  const ang = Math.atan2(dir?.y ?? 0, dir?.x ?? 0);
  return Math.round(((ang * 180) / Math.PI) * 10) / 10;
}

function inferWaterKind({ params, waterModel }) {
  if (params && typeof params.waterKind === "string" && params.waterKind.length > 0) {
    return params.waterKind;
  }
  if (waterModel && typeof waterModel.kind === "string" && waterModel.kind.length > 0) {
    return waterModel.kind;
  }
  return "none";
}

function getFieldStageMeta(fieldsMeta) {
  if (!fieldsMeta || typeof fieldsMeta !== "object") return null;
  if (!fieldsMeta.stage || typeof fieldsMeta.stage !== "object") return null;
  return fieldsMeta.stage;
}

function getFieldStatsMap(fieldsMeta) {
  const stageMeta = getFieldStageMeta(fieldsMeta);
  if (!stageMeta || !stageMeta.fieldStats || typeof stageMeta.fieldStats !== "object") return null;
  return stageMeta.fieldStats;
}

function hasFiniteBounds(stats, fieldName) {
  if (!stats || typeof stats !== "object") return false;
  const rec = stats[fieldName];
  if (!rec || typeof rec !== "object") return false;
  return Number.isFinite(rec.min) && Number.isFinite(rec.max);
}

function pushIfFalse(errors, condition, message) {
  if (!condition) errors.push(message);
}

function countCorridorsByKind(corridorIntent, kind) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return 0;
  let n = 0;
  for (const c of corridorIntent.corridors) {
    if (c && c.kind === kind) n += 1;
  }
  return n;
}

function everyCorridorHasFiniteDir(corridorIntent) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return false;
  for (const c of corridorIntent.corridors) {
    if (!c || !Number.isFinite(c.dir?.x) || !Number.isFinite(c.dir?.y)) return false;
  }
  return true;
}

function everyCorridorHasFiniteWeight(corridorIntent) {
  if (!corridorIntent || !Array.isArray(corridorIntent.corridors)) return false;
  for (const c of corridorIntent.corridors) {
    if (!c || !Number.isFinite(c.weight)) return false;
  }
  return true;
}

/**
 * @param {object} args
 */
export function runDebugInvariantsStage({
  debugEnabled,
  debugOut,

  cx,
  cy,
  fortHulls,

  vorGraph,
  primaryRoads,
  anchors,
  wallBase,
  outerBoundary,
  width,
  height,
  hasDock,
  waterModel,

  // Milestone 4.8+
  corridorIntent,
  params,

  // Optional but strongly recommended for Milestone 4.8 closure
  fieldsMeta,
}) {
  if (!debugEnabled) return;

  const errors = [];
  const bad = [];

  console.info("[Routing] vorGraph", {
    nodes: vorGraph?.nodes?.length,
    edges: vorGraph?.edges?.length,
    primaryRoads: primaryRoads?.length,
  });

  // ---------------- Corridor intent diagnostics ----------------
  if (corridorIntent && Array.isArray(corridorIntent.corridors)) {
    const corridors = corridorIntent.corridors;

    const summary = corridors.map((c) => ({
      kind: c.kind,
      weight: c.weight,
      deg: corridorAngleDeg(c.dir),
      dir: c.dir,
    }));

    console.info("[Corridors] intent", {
      count: corridors.length,
      centre: corridorIntent.centre,
      corridors: summary,
    });
  } else {
    console.info("[Corridors] intent", { count: 0 });
  }

  if (params && typeof params === "object") {
    const stretch = {
      strength: params.footprintStretchStrength,
      widthRad: params.footprintStretchWidthRad,
      clampMin: params.footprintStretchClampMin,
      clampMax: params.footprintStretchClampMax,
    };

    const hasAny =
      stretch.strength != null ||
      stretch.widthRad != null ||
      stretch.clampMin != null ||
      stretch.clampMax != null;

    if (hasAny) {
      console.info("[Footprint] corridor stretch params", stretch);
    }
  }

  // ---------------- Routing edge flag diagnostics ----------------
  if (vorGraph && Array.isArray(vorGraph.edges)) {
    let waterEdges = 0;
    let citadelEdges = 0;
    let activeEdges = 0;

    for (const e of vorGraph.edges) {
      if (!e || e.disabled) continue;
      activeEdges += 1;
      if (e.flags && e.flags.isWater) waterEdges += 1;
      if (e.flags && e.flags.nearCitadel) citadelEdges += 1;
    }

    console.info("[Routing] edge flags", { activeEdges, waterEdges, citadelEdges });
  }

  // ---------------- Fort hull diagnostics ----------------
  console.info("[Hulls] gate", {
    cx,
    cy,
    cxFinite: Number.isFinite(cx),
    cyFinite: Number.isFinite(cy),
    hasFortHulls: !!fortHulls,
  });

  if (Number.isFinite(cx) && Number.isFinite(cy) && fortHulls) {
    const centre = { x: cx, y: cy };

    const inner = fortHulls?.innerHull || null;
    const outer = fortHulls?.outerHull || null;

    const innerOuterLoop = inner?.outerLoop || null;
    const outerOuterLoop = outer?.outerLoop || null;

    console.info("[Hulls] summary", {
      inner: {
        loops: inner?.loops?.length,
        holeCount: inner?.holeCount,
        outerLoopIndex: inner?.outerLoopIndex,
        warnings: inner?.warnings?.length,
      },
      outer: {
        loops: outer?.loops?.length,
        holeCount: outer?.holeCount,
        outerLoopIndex: outer?.outerLoopIndex,
        warnings: outer?.warnings?.length,
      },
    });

    if (Array.isArray(inner?.warnings) && inner.warnings.length) {
      console.warn("[Hulls] inner warnings", inner.warnings);
    }
    if (Array.isArray(outer?.warnings) && outer.warnings.length) {
      console.warn("[Hulls] outer warnings", outer.warnings);
    }

    const centreInInner =
      Array.isArray(innerOuterLoop) && innerOuterLoop.length >= 3
        ? pointInPolyOrOn(centre, innerOuterLoop, 1e-6)
        : null;

    const centreInOuter =
      Array.isArray(outerOuterLoop) && outerOuterLoop.length >= 3
        ? pointInPolyOrOn(centre, outerOuterLoop, 1e-6)
        : null;

    console.info("[Hulls] centre containment", { centreInInner, centreInOuter });

    if (centreInOuter === false) {
      errors.push("Hull invalid: centre is outside outer hull");
    }
    if (centreInInner === false) {
      errors.push("Hull suspicious: centre is outside inner hull");
    }

    if (
      Array.isArray(innerOuterLoop) &&
      innerOuterLoop.length >= 3 &&
      Array.isArray(outerOuterLoop) &&
      outerOuterLoop.length >= 3
    ) {
      const n = innerOuterLoop.length;
      const samples = Math.min(8, n);
      let fails = 0;

      for (let k = 0; k < samples; k++) {
        const i = Math.floor((k * n) / samples);
        const p = innerOuterLoop[i];
        if (!p) continue;
        if (!pointInPolyOrOn(p, outerOuterLoop, 1e-6)) fails += 1;
      }

      if (fails > 0) {
        console.warn("[Hulls] inner outerLoop not fully contained in outer outerLoop (sampled)", {
          samples,
          fails,
        });
        errors.push(`Hull invalid: inner hull not contained in outer hull (sampled fails=${fails}/${samples})`);
      } else {
        console.info("[Hulls] inner outerLoop containment sampled OK", { samples });
      }
    }
  }

  // ---------------- Milestone 4.8 corridor closure ----------------
  const waterKind = inferWaterKind({ params, waterModel });

  const corridorCount = Array.isArray(corridorIntent?.corridors)
    ? corridorIntent.corridors.length
    : 0;

  const gateCorridorCount = countCorridorsByKind(corridorIntent, "gate");
  const waterCorridorCount = countCorridorsByKind(corridorIntent, "water");
  const newTownCorridorCount = countCorridorsByKind(corridorIntent, "newTown");

  pushIfFalse(
    errors,
    corridorIntent && Array.isArray(corridorIntent.corridors),
    "Milestone 4.8 invalid: missing corridorIntent.corridors"
  );

  if (corridorIntent && Array.isArray(corridorIntent.corridors)) {
    pushIfFalse(
      errors,
      isFinitePoint(corridorIntent.centre),
      "Milestone 4.8 invalid: corridorIntent.centre is missing or non-finite"
    );

    pushIfFalse(
      errors,
      corridorCount > 0,
      "Milestone 4.8 invalid: corridorIntent.corridors is empty"
    );

    pushIfFalse(
      errors,
      gateCorridorCount > 0,
      "Milestone 4.8 invalid: no gate corridors were published"
    );

    pushIfFalse(
      errors,
      everyCorridorHasFiniteDir(corridorIntent),
      "Milestone 4.8 invalid: one or more corridors has a non-finite direction"
    );

    pushIfFalse(
      errors,
      everyCorridorHasFiniteWeight(corridorIntent),
      "Milestone 4.8 invalid: one or more corridors has a non-finite weight"
    );

    if (waterKind !== "none") {
      pushIfFalse(
        errors,
        waterCorridorCount > 0,
        `Milestone 4.8 invalid: waterKind=${waterKind} but no water corridor was published`
      );
    }

    // This one is intentionally softer.
    // New-town direction is expected in the new 4.8 wiring, but some seeds may still
    // pass through older fallback flows while you are landing the rest of the patch set.
    if (newTownCorridorCount === 0) {
      console.warn("[Corridors] no newTown corridor published");
    }
  }

  // ---------------- Anchor invariants ----------------
  const plazaOk =
    finitePointOrNull(anchors?.plaza) &&
    isInsidePolyOrSkip(anchors.plaza, wallBase) &&
    (anchors.plaza.x >= 0 && anchors.plaza.x <= width && anchors.plaza.y >= 0 && anchors.plaza.y <= height);

  const citadelOk =
    finitePointOrNull(anchors?.citadel) &&
    isInsidePolyOrSkip(anchors.citadel, wallBase) &&
    (anchors.citadel.x >= 0 && anchors.citadel.x <= width && anchors.citadel.y >= 0 && anchors.citadel.y <= height);

  const marketOk =
    finitePointOrNull(anchors?.market) &&
    isInsidePolyOrSkip(anchors.market, wallBase) &&
    (anchors.market.x >= 0 && anchors.market.x <= width && anchors.market.y >= 0 && anchors.market.y <= height);

  let docksOk = true;
  if (hasDock) {
    docksOk =
      (anchors?.docks === null) ||
      (finitePointOrNull(anchors?.docks) &&
        !pointInPolyOrOn(anchors.docks, wallBase, 1e-6) &&
        isInsidePolyOrSkip(anchors.docks, outerBoundary) &&
        (anchors.docks.x >= 0 && anchors.docks.x <= width && anchors.docks.y >= 0 && anchors.docks.y <= height));
  }

  if (!plazaOk) bad.push("plaza");
  if (!citadelOk) bad.push("citadel");
  if (!marketOk) bad.push("market");
  if (!docksOk) bad.push("docks");

  if (bad.length) {
    console.warn("ANCHOR INVARIANTS FAILED", bad, {
      plaza: anchors?.plaza,
      citadel: anchors?.citadel,
      market: anchors?.market,
      docks: anchors?.docks,
      hasDock,
      water: waterModel?.kind,
    });
    errors.push(`Anchors invalid: ${bad.join(", ")}`);
  }

  // ---------------- Milestone 4.8 field closure ----------------
  if (!fieldsMeta) {
    console.warn("[Fields] fieldsMeta not provided to Stage 900; skipping 4.8 field closure checks");
  } else {
    const stageMeta = getFieldStageMeta(fieldsMeta);
    const fieldStats = getFieldStatsMap(fieldsMeta);

    pushIfFalse(
      errors,
      !!stageMeta,
      "Milestone 4.8 invalid: fieldsMeta.stage is missing"
    );

    if (stageMeta) {
      const requiredFields = stageMeta.requiredFields || {};
      const computedFields = stageMeta.computedFields || {};

      pushIfFalse(
        errors,
        requiredFields.plaza === true,
        "Milestone 4.8 invalid: requiredFields.plaza must be true"
      );

      pushIfFalse(
        errors,
        requiredFields.wall === true,
        "Milestone 4.8 invalid: requiredFields.wall must be true"
      );

      if (waterKind !== "none") {
        pushIfFalse(
          errors,
          requiredFields.water === true,
          `Milestone 4.8 invalid: requiredFields.water must be true when waterKind=${waterKind}`
        );
      }

      pushIfFalse(
        errors,
        computedFields.plaza === true,
        "Milestone 4.8 invalid: distance_to_plaza_vertex was not computed"
      );

      pushIfFalse(
        errors,
        computedFields.wall === true,
        "Milestone 4.8 invalid: distance_to_wall_vertex was not computed"
      );

      if (waterKind !== "none") {
        pushIfFalse(
          errors,
          computedFields.water === true,
          `Milestone 4.8 invalid: distance_to_water_vertex was not computed when waterKind=${waterKind}`
        );
      }

      const sourceResolution = stageMeta.sourceResolution || {};
      const wallSourceMethod = sourceResolution.wall?.method || null;
      const waterSourceMethod = sourceResolution.water?.method || null;

      pushIfFalse(
        errors,
        !!wallSourceMethod && wallSourceMethod !== "unavailable",
        "Milestone 4.8 invalid: wall source resolution is unavailable"
      );

      if (waterKind !== "none") {
        pushIfFalse(
          errors,
          !!waterSourceMethod && waterSourceMethod !== "unavailable",
          "Milestone 4.8 invalid: water source resolution is unavailable"
        );
      }
    }

    pushIfFalse(
      errors,
      !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_plaza_vertex"),
      "Milestone 4.8 invalid: distance_to_plaza_vertex is missing finite bounds"
    );

    pushIfFalse(
      errors,
      !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_wall_vertex"),
      "Milestone 4.8 invalid: distance_to_wall_vertex is missing finite bounds"
    );

    if (waterKind !== "none") {
      pushIfFalse(
        errors,
        !!fieldStats && hasFiniteBounds(fieldStats, "distance_to_water_vertex"),
        `Milestone 4.8 invalid: distance_to_water_vertex is missing finite bounds when waterKind=${waterKind}`
      );
    }
  }

  const ok = errors.length === 0;

  if (debugOut && typeof debugOut === "object") {
    debugOut.invariants = { ok, errors };

    if (corridorIntent) {
      debugOut.corridors = corridorIntent;
    }

    if (params && typeof params === "object") {
      debugOut.footprintStretch = {
        strength: params.footprintStretchStrength,
        widthRad: params.footprintStretchWidthRad,
        clampMin: params.footprintStretchClampMin,
        clampMax: params.footprintStretchClampMax,
      };
    }

    if (fieldsMeta) {
      debugOut.fieldsMeta = fieldsMeta;
    }
  }
}
