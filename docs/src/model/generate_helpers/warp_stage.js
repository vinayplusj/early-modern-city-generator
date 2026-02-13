// docs/src/model/generate_helpers/warp_stage.js
import { buildWarpField, warpPolylineRadial } from "../warp.js";

export function buildFortWarp({
  enabled,
  centre,
  wallPoly,
  targetPoly,  // <-- rename from fieldPoly to targetPoly (clearer)
  districts,
  bastions,
  params,
}) {
  if (!enabled) return null;
  if (!Array.isArray(wallPoly) || wallPoly.length < 3) return null;

  const targetPolyUse =
    (Array.isArray(targetPoly) && targetPoly.length >= 3) ? targetPoly : null;

  // Pass 1: measure mean radius of the actual wall
  const tmp = buildWarpField({
    centre,
    wallPoly,
    targetPoly: targetPolyUse,
    districts,
    bastions,
    params: { ...params, bandInner: 0, bandOuter: 0 },
  });

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
    wallPoly,
    targetPoly: targetPolyUse,
    districts,
    bastions,
    params: tuned,
  });

  const wallWarped = warpPolylineRadial(wallPoly, centre, field, tuned);
  return { centre, params: tuned, field, wallOriginal: wallPoly, wallWarped };
}
