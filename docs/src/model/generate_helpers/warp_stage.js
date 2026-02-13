// docs/src/model/generate_helpers/warp_stage.js
import { buildWarpField, warpPolylineRadial } from "../warp.js";

export function buildFortWarp({
  enabled,
  centre,
  wallPoly,
  fieldPoly,   // ward outer hull (target)
  districts,
  bastions,
  params,
}) {
  if (!enabled) return null;
  if (!Array.isArray(wallPoly) || wallPoly.length < 3) return null;

  const targetPolyUse =
    (Array.isArray(fieldPoly) && fieldPoly.length >= 3) ? fieldPoly : null;

  // Pass 1: measure mean radius of the ACTUAL wall (so band sizing covers the wall)
  const tmp = buildWarpField({
    centre,
    wallPoly,                 // <- sample rFort from the wall
    targetPoly: targetPolyUse, // <- sample rTarget from hull when available
    districts,
    bastions,
    params: { ...params, bandInner: 0, bandOuter: 0 },
  });

  if (params.debug && tmp?.stats && Number.isFinite(tmp.stats.rFortNullSamples)) {
    const misses = tmp.stats.rFortNullSamples;
    const N = tmp.N;
    const maxMisses = Math.floor(N * 0.20);
    if (misses > maxMisses) {
      throw new Error(
        `warp: rFort coverage failed (misses=${misses}/${N}). centre may be outside wallPoly or wallPoly is degenerate.`
      );
    }
  }

  let sum = 0;
  let count = 0;
  for (const r of tmp.rFort) {
    if (Number.isFinite(r)) { sum += r; count++; }
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
  
    // What we are warping (current fort wall)
    wallPoly,
  
    // What we want to conform to (ward-derived outer hull)
    targetPoly: fieldPolyUse || wallPoly,
  
    districts,
    bastions,
    params: tuned,
  });

  const wallWarped = warpPolylineRadial(wallPoly, centre, field, tuned);

  for (const p of wallWarped) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  return { centre, params: tuned, field, wallOriginal: wallPoly, wallWarped };
}
