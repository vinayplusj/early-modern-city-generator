// docs/src/model/water_on_mesh/resample.js

import { finitePoint, clampInt } from "./util.js";

export function resamplePolylineUniform(points, targetCount) {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const n = clampInt(targetCount, 2, 2000);

  const cum = [0];
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) {
      cum.push(total);
      continue;
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    total += d;
    cum.push(total);
  }

  if (!(total > 1e-9)) {
    return [points[0], points[points.length - 1]];
  }

  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * total;

    let i = 1;
    while (i < cum.length && cum[i] < t) i++;

    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(points.length - 1, i);

    const a = points[i0];
    const b = points[i1];

    if (!finitePoint(a) || !finitePoint(b)) {
      out.push(finitePoint(a) ? { x: a.x, y: a.y } : { x: b.x, y: b.y });
      continue;
    }

    const d0 = cum[i0];
    const d1 = cum[i1];
    const u = (d1 > d0) ? (t - d0) / (d1 - d0) : 0;

    out.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    });
  }

  return out;
}
