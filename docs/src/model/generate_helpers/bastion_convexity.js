// docs/src/model/generate_helpers/bastion_convexity.js
//
// Strict convexity + interior angle bounds repair for 5-point bastions.
//
// Bastion point order is assumed:
//   [B0, S0, T, S1, B1]
//
// Constraints enforced (after warping):
// - Strictly convex (no wrong-sign turns, no near-collinear turns).
// - Interior angle at every vertex is within [30°, 150°].
//
// Determinism:
// - No randomness.
// - Fixed step schedule and deterministic tie-break rules.

import { clampPointInsideAlongRay } from "../../geom/radial_ray_clamp.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
// Note: max interior angle is enforced only at movable vertices (S0, T, S1), not at base corners (B0, B1).
const MIN_INTERIOR_ANGLE_DEG = 30;
const MAX_INTERIOR_ANGLE_DEG = 150;
const MIN_INTERIOR_ANGLE_RAD = (MIN_INTERIOR_ANGLE_DEG * Math.PI) / 180;
const MAX_INTERIOR_ANGLE_RAD = (MAX_INTERIOR_ANGLE_DEG * Math.PI) / 180;

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += (p.x * q.y - q.x * p.y);
  }
  return 0.5 * a;
}

function crossZ(a, b, c) {
  const e1x = b.x - a.x;
  const e1y = b.y - a.y;
  const e2x = c.x - b.x;
  const e2y = c.y - b.y;
  return e1x * e2y - e1y * e2x;
}

function computeTurnsCross(poly) {
  const n = poly.length;
  const cross = new Array(n);
  const vertexIndex = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    cross[i] = crossZ(a, b, c);
    vertexIndex[i] = (i + 1) % n;
  }
  return { cross, vertexIndex };
}

function majoritySignFromCross(cross, epsCross) {
  let pos = 0;
  let neg = 0;
  for (const v of cross) {
    if (!Number.isFinite(v)) continue;
    if (Math.abs(v) < epsCross) continue;
    if (v > 0) pos++;
    else neg++;
  }
  if (pos === 0 && neg === 0) return 1;
  return (pos >= neg) ? 1 : -1;
}

function expectedTurnSign(poly, epsArea, epsCross) {
  const a = signedArea(poly);
  if (Math.abs(a) >= epsArea) return (a >= 0) ? 1 : -1;
  const { cross } = computeTurnsCross(poly);
  return majoritySignFromCross(cross, epsCross);
}

// A turn is bad if:
// - abs(cross) < epsCross (near-collinear treated as invalid), OR
// - sign(cross) != expectedSign
function findBadTurns(poly, expectedSign, epsCross) {
  const { cross, vertexIndex } = computeTurnsCross(poly);
  const bad = [];
  for (let i = 0; i < cross.length; i++) {
    const v = cross[i];
    const vIdx = vertexIndex[i];
    if (!Number.isFinite(v)) {
      bad.push({ i, vIdx, kind: "nan", cross: v });
      continue;
    }
    if (Math.abs(v) < epsCross) {
      bad.push({ i, vIdx, kind: "collinear", cross: v });
      continue;
    }
    const s = (v > 0) ? 1 : -1;
    if (s !== expectedSign) {
      bad.push({ i, vIdx, kind: "wrong_sign", cross: v });
    }
  }
  return bad;
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function interiorAngleAt(poly, i) {
  const n = poly.length;
  const pPrev = poly[(i - 1 + n) % n];
  const p = poly[i];
  const pNext = poly[(i + 1) % n];

  const ax = pPrev.x - p.x;
  const ay = pPrev.y - p.y;
  const bx = pNext.x - p.x;
  const by = pNext.y - p.y;

  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (!Number.isFinite(la) || !Number.isFinite(lb) || la <= 1e-9 || lb <= 1e-9) {
    return 0;
  }

  let c = (ax * bx + ay * by) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return Math.acos(c);
}

function findAngleViolations(poly, minRad, maxRad) {
  const n = poly.length;
  const v = [];

  // Small hysteresis to avoid repairs triggered by floating-point noise near thresholds.
  const EPS = (1.0 * Math.PI) / 180; // 1 degree

  for (let i = 0; i < n; i++) {
    const ang = interiorAngleAt(poly, i);

    if (!Number.isFinite(ang)) {
      v.push({ vIdx: i, kind: "angle_nan", angle: ang, severity: Infinity });
      continue;
    }

    // Enforce minimum at ALL vertices (including base corners).
    if (ang < (minRad - EPS)) {
      v.push({ vIdx: i, kind: "too_small", angle: ang, severity: (minRad - ang) });
      continue;
    }

    // Enforce maximum ONLY at movable vertices: S0 (1), T (2), S1 (3).
    // Do NOT enforce max at B0 (0) or B1 (4).
    if ((i === 1 || i === 2 || i === 3) && ang > (maxRad + EPS)) {
      v.push({ vIdx: i, kind: "too_large", angle: ang, severity: (ang - maxRad) });
    }
  }

  return v;
}

function pickWorstViolation(vios) {
  let worst = vios[0];
  for (let i = 1; i < vios.length; i++) {
    const a = vios[i];
    if (a.severity > worst.severity) worst = a;
    else if (a.severity === worst.severity && a.vIdx < worst.vIdx) worst = a;
  }
  return worst;
}

function moveTowardPoint(p, target, step) {
  const t = clamp01(step);
  return { x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t };
}

function moveAwayFromPoint(p, from, step) {
  // p' = from + (1 + step) * (p - from)
  const t = Math.max(0, step);
  return { x: from.x + (p.x - from.x) * (1 + t), y: from.y + (p.y - from.y) * (1 + t) };
}

function clampPointInsideOuter(p, centrePt, outerPoly, margin) {
  return clampPointInsideAlongRay(p, centrePt, outerPoly, margin);
}

function clampBastionMovablesInsideOuter(poly5, centrePt, outerPoly, margin) {
  const out = poly5.slice();
  out[1] = clampPointInsideOuter(out[1], centrePt, outerPoly, margin); // S0
  out[2] = clampPointInsideOuter(out[2], centrePt, outerPoly, margin); // T
  out[3] = clampPointInsideOuter(out[3], centrePt, outerPoly, margin); // S1
  return out;
}

function centroidOf5(poly5) {
  let sx = 0, sy = 0;
  for (const p of poly5) { sx += p.x; sy += p.y; }
  return { x: sx / 5, y: sy / 5 };
}

function farthestShoulderIndex(poly5, c) {
  const d1 = (poly5[1].x - c.x) ** 2 + (poly5[1].y - c.y) ** 2;
  const d3 = (poly5[3].x - c.x) ** 2 + (poly5[3].y - c.y) ** 2;
  return (d1 >= d3) ? 1 : 3;
}

function shoulderForBadVertex(vIdx) {
  if (vIdx === 0 || vIdx === 1) return 1;
  if (vIdx === 4 || vIdx === 3) return 3;
  return null;
}

/**
 * Strict convexity + [minAngle,maxAngle] repair for a single 5-point bastion.
 *
 * @param {Array<{x:number,y:number}>} poly5
 * @param {{x:number,y:number}} centrePt
 * @param {Array<{x:number,y:number}>} outerPoly
 * @param {number} margin
 * @param {number} K max iterations
 * @returns {{poly:Array, ok:boolean, iters:number, note:string}}
 */
export function repairBastionStrictConvex(poly5, centrePt, outerPoly, margin, K) {
  if (!Array.isArray(poly5) || poly5.length !== 5) {
    return { poly: poly5, ok: false, iters: 0, note: "skip_non5" };
  }
  if (!outerPoly) {
    return { poly: poly5, ok: false, iters: 0, note: "no_outerHull" };
  }

  const bastionBaseLen = dist(poly5[0], poly5[4]);
  const epsCross = Math.max(1e-3, (bastionBaseLen * bastionBaseLen) * 1e-1);
  const epsArea = Math.max(1e-6, (bastionBaseLen * bastionBaseLen) * 1e-5);

  let cur = clampBastionMovablesInsideOuter(poly5, centrePt, outerPoly, margin);

  const M = { x: (cur[0].x + cur[4].x) / 2, y: (cur[0].y + cur[4].y) / 2 };

  for (let it = 0; it < K; it++) {
    // 1) Convexity first (repairs can otherwise create flips).
    const exp = expectedTurnSign(cur, epsArea, epsCross);
    const badTurns = findBadTurns(cur, exp, epsCross);

    if (badTurns.length > 0) {
      // Fix worst convexity defect deterministically.
      let worst = badTurns[0];
      for (const b of badTurns) {
        const w0 = (worst.kind === "collinear") ? Infinity : Math.abs(worst.cross);
        const w1 = (b.kind === "collinear") ? Infinity : Math.abs(b.cross);
        if (w1 > w0) worst = b;
      }

      const vIdx = worst.vIdx;
      if (vIdx === 1 || vIdx === 3) {
        // Bad at shoulder: shrink tip inward.
        cur[2] = moveTowardPoint(cur[2], M, 0.12);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      } else if (vIdx === 0 || vIdx === 4) {
        // Bad at base corner: pull adjacent shoulder inward.
        const sIdx = shoulderForBadVertex(vIdx); // 1 or 3
        cur[sIdx] = moveTowardPoint(cur[sIdx], M, 0.18);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else if (vIdx === 2) {
        // Bad at tip: move one shoulder inward (deterministic tie-break).
        const c = centroidOf5(cur);
        const pick = farthestShoulderIndex(cur, c); // 1 or 3
        cur[pick] = moveTowardPoint(cur[pick], M, 0.18);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else {
        cur[2] = moveTowardPoint(cur[2], M, 0.12);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      }

      cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      continue;
    }

    // 2) Angle bounds once convex.
    const vios = findAngleViolations(cur, MIN_INTERIOR_ANGLE_RAD, MAX_INTERIOR_ANGLE_RAD);
    if (vios.length === 0) {
      return { poly: cur, ok: true, iters: it, note: "ok" };
    }

    const worst = pickWorstViolation(vios);
    const vIdx = worst.vIdx;

    // Too small => blunt by moving inward toward base midpoint.
    if (worst.kind === "too_small" || worst.kind === "angle_nan") {
      if (vIdx === 2) {
        cur[2] = moveTowardPoint(cur[2], M, 0.18);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      } else if (vIdx === 1 || vIdx === 0) {
        cur[1] = moveTowardPoint(cur[1], M, 0.22);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else if (vIdx === 3 || vIdx === 4) {
        cur[3] = moveTowardPoint(cur[3], M, 0.22);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else {
        cur[2] = moveTowardPoint(cur[2], M, 0.18);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      }

      cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      continue;
    }

    // Too large => sharpen by moving outward away from base midpoint.
    // Still clamp along ray to stay inside the hull.
    if (worst.kind === "too_large") {
      if (vIdx === 2) {
        cur[2] = moveAwayFromPoint(cur[2], M, 0.10);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      } else if (vIdx === 1 || vIdx === 0) {
        cur[1] = moveAwayFromPoint(cur[1], M, 0.10);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else if (vIdx === 3 || vIdx === 4) {
        cur[3] = moveAwayFromPoint(cur[3], M, 0.10);
        cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      } else {
        cur[2] = moveAwayFromPoint(cur[2], M, 0.10);
        cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
      }

      cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
      continue;
    }
  }

  // Deterministic fallback: shrink inward if we could not converge.
  cur[2] = moveTowardPoint(cur[2], M, 0.35);
  cur[1] = moveTowardPoint(cur[1], M, 0.28);
  cur[3] = moveTowardPoint(cur[3], M, 0.28);
  cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);

  // Final validation.
  const exp2 = expectedTurnSign(cur, epsArea, epsCross);
  const bad2 = findBadTurns(cur, exp2, epsCross);
  const v2 = (bad2.length === 0) ? findAngleViolations(cur, MIN_INTERIOR_ANGLE_RAD, MAX_INTERIOR_ANGLE_RAD) : [{ vIdx: -1, kind: "not_convex", angle: 0, severity: Infinity }];

  if (bad2.length === 0 && v2.length === 0) {
    return { poly: cur, ok: true, iters: K, note: "ok_afterFallbackShrink" };
  }

  return { poly: cur, ok: false, iters: K, note: "fallback_keep_current" };
}
