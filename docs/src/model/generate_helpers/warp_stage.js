// docs/src/model/generate_helpers/warp_stage.js
import { buildWarpField, warpPolylineRadial } from "../warp.js";

export function buildFortWarp({
  enabled,
  centre,
  wallPoly,
  districts,
  bastions,   // ADD
  params,
}) {
  if (!enabled) return null;
  if (!wallPoly || !Array.isArray(wallPoly) || wallPoly.length < 3) return null;

  const tmp = buildWarpField({
    centre,
    wallPoly,
    districts,
    bastions, // ADD
    params: { ...params, bandInner: 0, bandOuter: 0 },
  });

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
    districts,
    bastions, // ADD
    params: tuned,
  });

  const wallWarped = warpPolylineRadial(wallPoly, centre, field, tuned);

  for (const p of wallWarped) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  return { centre, params: tuned, field, wallOriginal: wallPoly, wallWarped };
}
