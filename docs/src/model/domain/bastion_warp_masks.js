// docs/src/model/domain/bastion_warp_masks.js
//
// Bastion-related warp masks.
// Extracted from docs/src/model/warp.js to thin that file (no behaviour change).

import {
  wrapAngle,
  angularSpan,
  angularDistance,
  intervalLockWeight,
} from "../util/angles.js";

export function buildBastionLockMask(thetas, centre, bastions, params) {
  const N = thetas.length;
  const out = new Array(N).fill(1);

  if (!bastions || !Array.isArray(bastions) || bastions.length === 0) return out;

  const lockPad = params.bastionLockPad ?? 0.10;         // radians
  const lockFeather = params.bastionLockFeather ?? 0.08; // radians

  for (const b of bastions) {
    if (!b || !Array.isArray(b.shoulders) || b.shoulders.length < 2) continue;

    let a0 = wrapAngle(angleOfPoint(centre, b.shoulders[0]));
    let a1 = wrapAngle(angleOfPoint(centre, b.shoulders[1]));

    // Force the smaller arc between the two shoulders.
    // If the forward span a0 -> a1 is bigger than PI, swap them.
    if (angularSpan(a0, a1) > Math.PI) {
      const tmp = a0;
      a0 = a1;
      a1 = tmp;
    }

    const start = a0 - lockPad;
    const end = a1 + lockPad;

    for (let i = 0; i < N; i++) {
      const t = thetas[i];

      // Weight is 0 inside [start,end], ramps to 1 across lockFeather.
      const w = intervalLockWeight(t, start, end, lockFeather);

      // Combine locks conservatively: once locked, it stays locked.
      out[i] = Math.min(out[i], w);
    }
  }

  if (params.debug) {
    let minW = 1, maxW = 0;
    for (const w of out) {
      minW = Math.min(minW, w);
      maxW = Math.max(maxW, w);
    }
    // Intentionally no logging. This preserves current behaviour.
  }

  return out;
}

export function buildBastionClearMask(thetas, centre, bastions, params) {
  const N = thetas.length;
  const out = new Array(N).fill(1);

  if (!bastions || !Array.isArray(bastions) || bastions.length === 0) return out;

  // Make this much smaller than lockPad, by design.
  const halfWidth = params.bastionClearHalfWidth ?? 0.05; // radians
  const feather = params.bastionClearFeather ?? 0.06;     // radians

  for (const b of bastions) {
    if (!b || !Array.isArray(b.pts) || b.pts.length === 0) continue;

    // Bastion mid angle: use the average of the bastion polygon points.
    let mx = 0, my = 0;
    for (const p of b.pts) { mx += p.x; my += p.y; }
    mx /= b.pts.length;
    my /= b.pts.length;

    const mid = wrapAngle(angleOfPoint(centre, { x: mx, y: my }));

    const start = mid - halfWidth;
    const end = mid + halfWidth;

    for (let i = 0; i < N; i++) {
      const t = thetas[i];
      const w = intervalLockWeight(t, start, end, feather);
      out[i] = Math.min(out[i], w);
    }
  }

  if (params.debug) {
    let zeros = 0;
    let minW = 1, maxW = 0;
    for (const w of out) {
      if (w <= 1e-6) zeros++;
      minW = Math.min(minW, w);
      maxW = Math.max(maxW, w);
    }
    // Intentionally no logging. This preserves current behaviour.
  }

  return out;
}

export function angleOfPoint(centre, p) {
  return Math.atan2(p.y - centre.y, p.x - centre.x);
}

export function angularDistanceToInterval(t, start, end) {
  if (angleInInterval(t, start, end)) return 0;

  // Compute distance to each boundary along the circle.
  const d0 = angularDistance(t, start);
  const d1 = angularDistance(t, end);
  return Math.min(d0, d1);
}

function angleInInterval(t, a0, a1) {
  const start = wrapAngle(a0);
  const end = wrapAngle(a1);
  if (start <= end) return t >= start && t < end;
  return t >= start || t < end; // wrap interval
}
