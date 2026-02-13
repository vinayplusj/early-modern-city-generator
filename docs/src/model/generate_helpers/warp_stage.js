// docs/src/model/generate_helpers/warp_stage.js
import { buildWarpField, warpPolylineRadial } from "../warp.js";

export function buildFortWarp({
  enabled,
  centre,
  wallPoly,
  // Optional: use a different boundary to build the warp field (sampling rFort).
  // This lets the bastioned wall be warped toward a ward-derived "outer hull".
  fieldPoly,
  districts,
  bastions,
  params,
}) {
  if (!enabled) return null;
  if (!wallPoly || !Array.isArray(wallPoly) || wallPoly.length < 3) return null;

  const fieldPolyUse = (Array.isArray(fieldPoly) && fieldPoly.length >= 3)
    ? fieldPoly : null;

    // First pass: measure rMean from the SAME boundary we will use for the field.
  const tmp = buildWarpField({
    centre,
    wallPoly,                              // sample rFort from the current wall
    targetPoly: fieldPolyUse || null,       // sample rTarget from the hull (if provided)
    districts,
    bastions,
    params: { ...params, bandInner: 0, bandOuter: 0 },
  });
  
    // Debug-only invariant: centre-to-wall rays should usually hit the wall.
  // If many rays miss, the centre is likely outside the wall, or the wall is degenerate/self-intersecting.
  if (params.debug && tmp && tmp.stats && Number.isFinite(tmp.stats.rFortNullSamples)) {
    const misses = tmp.stats.rFortNullSamples;
    const N = tmp.N;

    // Threshold: allow some misses (numerical edge cases), but fail if it is systemic.
    // 20% is conservative; raise to 30% if you see false positives.
    const maxMisses = Math.floor(N * 0.20);

    if (misses > maxMisses) {
      throw new Error(`warp: rFort coverage failed (misses=${misses}/${N}). centre may be outside wallPoly or wallPoly is degenerate.`);
    }
  }

  let sum = 0;
  let count = 0;
  
  for (const r of tmp.rFort) {
    if (Number.isFinite(r)) {
      sum += r;
      count++;
    }
  }
  
  if (count === 0) return null;
  
  const rMean = sum / count;

  const tuned = {
    ...params,
    bandOuter: rMean,
    bandInner: Math.max(0, rMean - params.bandThickness),
  };

  const field = buildWarpField({
  centre,
  wallPoly,
  targetPoly: fieldPolyUse || null,
  districts,
  bastions,
  params: tuned,
});

  const wallWarped = warpPolylineRadial(wallPoly, centre, field, tuned);

  for (const p of wallWarped) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  return {
    centre,
    params: tuned,
    field,
    wallOriginal: wallPoly,
    wallWarped,
    _debug: { fieldPolyUsed: fieldPolyUse ? "hull" : "wall" },
  };
}
