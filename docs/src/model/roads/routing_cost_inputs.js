// docs/src/model/roads/routing_cost_inputs.js
//
// Stage 140 support: build a routing cost accessor that depends ONLY on fields + fieldsMeta,
// not on raw geometry.
//
// Determinism contract:
// - Reads deterministic arrays from FieldRegistry.
// - Uses min/max from fieldsMeta.stage.fieldStats when available.
// - Normalisation is clamped and stable; degenerate ranges map to 0.
//
// This module is deliberately small and stable so Stage 140 can stay orchestration-focused.

import { clamp01 } from "../../geom/primitives.js";

function getFieldRec(fields, name) {
  if (!fields || typeof fields.get !== "function") return null;
  if (!fields.has || !fields.has(name)) return null;
  return fields.get(name);
}

function getStats(fieldsMeta, fieldName) {
  const s = fieldsMeta && fieldsMeta.stage && fieldsMeta.stage.fieldStats;
  return s ? s[fieldName] : null;
}

function norm01FromStats(value, stats) {
  if (!Number.isFinite(value)) return 1; // treat non-finite as maximally bad
  if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) return 0;
  const min = stats.min;
  const max = stats.max;
  const den = max - min;
  if (den === 0) return 0;
  return clamp01((value - min) / den);
}

/**
 * Build a cost input bundle for routing.
 *
 * Returned object is stable and has no hidden dependencies.
 */
export function buildRoutingCostInputs(ctx) {
  const fields = ctx.state.fields;
  const fieldsMeta = ctx.state.fieldsMeta;

  // Weights: default to safe values if missing.
  const p = (ctx.params && ctx.params.roads && ctx.params.roads.cost) ? ctx.params.roads.cost : {};
  const weights = {
    base: Number.isFinite(p.base) ? p.base : 1,
    waterAvoid: Number.isFinite(p.waterAvoid) ? p.waterAvoid : 2,
    wallAvoid: Number.isFinite(p.wallAvoid) ? p.wallAvoid : 1,
    plazaAttract: Number.isFinite(p.plazaAttract) ? p.plazaAttract : 0.5,
  };

  // Vertex-distance fields (expected from Stage 075).
  const FN_PLAZA = "distance_to_plaza_vertex";
  const FN_WALL = "distance_to_wall_vertex";
  const FN_WATER = "distance_to_water_vertex";

  const recPlaza = getFieldRec(fields, FN_PLAZA);
  const recWall = getFieldRec(fields, FN_WALL);
  const recWater = getFieldRec(fields, FN_WATER);

  const stPlaza = getStats(fieldsMeta, FN_PLAZA);
  const stWall = getStats(fieldsMeta, FN_WALL);
  const stWater = getStats(fieldsMeta, FN_WATER);

  function valueAt(rec, vId) {
    if (!rec || !rec.values) return null;
    const v = rec.values[vId];
    return Number.isFinite(v) ? v : null;
  }

  function norm01Field(fieldName, rec, stats, vId) {
    const raw = valueAt(rec, vId);
    if (raw == null) return null;
    return norm01FromStats(raw, stats);
  }

  // Deterministic vertex penalty.
  // Interpretations:
  // - waterAvoid: penalise being CLOSE to water -> use (1 - norm(distance_to_water))
  // - wallAvoid: penalise being CLOSE to wall -> use (1 - norm(distance_to_wall))
  // - plazaAttract: prefer being CLOSE to plaza -> use (1 - norm(distance_to_plaza)) as a NEGATIVE penalty
  //
  // This is only the *cost shaping*. Hard constraints (no water crossing except bridges)
  // should remain separate topology checks in Stage 140.
  function vertexPenalty(vId) {
    let cost = weights.base;

    // water: if field missing, treat as 0 effect
    {
      const n = norm01Field(FN_WATER, recWater, stWater, vId);
      if (n != null) cost += weights.waterAvoid * (1 - n);
    }

    // wall: if field missing, treat as 0 effect
    {
      const n = norm01Field(FN_WALL, recWall, stWall, vId);
      if (n != null) cost += weights.wallAvoid * (1 - n);
    }

    // plaza attraction: subtract cost near plaza (bounded so it never flips negative wildly)
    {
      const n = norm01Field(FN_PLAZA, recPlaza, stPlaza, vId);
      if (n != null) cost -= weights.plazaAttract * (1 - n);
    }

    // Enforce a safe lower bound to avoid negative edges.
    if (!Number.isFinite(cost) || cost < 0.05) cost = 0.05;
    return cost;
  }

  return {
    weights,
    has: {
      plaza: !!recPlaza,
      wall: !!recWall,
      water: !!recWater,
    },
    vertexPenalty,
    // Expose normalised values for debugging / audits if needed:
    norm01: (fieldName, vId) => {
      if (fieldName === FN_PLAZA) return norm01Field(FN_PLAZA, recPlaza, stPlaza, vId);
      if (fieldName === FN_WALL) return norm01Field(FN_WALL, recWall, stWall, vId);
      if (fieldName === FN_WATER) return norm01Field(FN_WATER, recWater, stWater, vId);
      return null;
    },
  };
}

export default buildRoutingCostInputs;
