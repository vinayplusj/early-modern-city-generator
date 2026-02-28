// docs/src/model/generate_helpers/bastion_convexity.js
//
// Strict convexity repair helpers for 5-point bastions.
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// 6cfa8cbefa59855645d22eceabd9483b2734fcb09425ed034d77d2ffb1eaaecd

import { clampPointInsideAlongRay } from "../../geom/radial_ray_clamp.js";

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------- Strict convexity (bastions) ----------------
// Bastion point order is assumed:
//   [B0, S0, T, S1, B1]
// Near-collinear turns are treated as BAD.

function signedArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (!p || !q) continue;
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

// Returns { cross: number[], vertexIndex: number[] }
// cross[i] corresponds to the turn at vertex vertexIndex[i] = (i + 1) % n.
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
    if (Math.abs(v) < epsCross) continue; // collinear turns do not vote
    if (v > 0) pos++;
    else neg++;
  }
  if (pos === 0 && neg === 0) return 1; // arbitrary but deterministic
  return (pos >= neg) ? 1 : -1;
}

// Returns expectedSign (+1 or -1). Uses area if non-degenerate, else majority sign.
function expectedTurnSign(poly, epsArea, epsCross) {
  const a = signedArea(poly);
  if (Math.abs(a) >= epsArea) return (a >= 0) ? 1 : -1;
  const { cross } = computeTurnsCross(poly);
  return majoritySignFromCross(cross, epsCross);
}

// Finds all bad turns. A turn is bad if:
// - abs(cross) < epsCross   (near-collinear is BAD), OR
// - sign(cross) != expectedSign
// Returns list of objects: { i, vIdx, kind, cross }
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

function moveTowardPoint(p, target, step) {
  return {
    x: p.x + (target.x - p.x) * step,
    y: p.y + (target.y - p.y) * step,
  };
}

function clampPointInsideOuter(p, centrePt, outerPoly, margin) {
  // Uses deterministic ray clamp.
  return clampPointInsideAlongRay(p, centrePt, outerPoly, margin);
}

function clampBastionMovablesInsideOuter(poly5, centrePt, outerPoly, margin) {
  // Keep B0 and B1 fixed. Clamp S0, T, S1.
  const out = poly5.slice();
  out[1] = clampPointInsideOuter(out[1], centrePt, outerPoly, margin); // S0
  out[2] = clampPointInsideOuter(out[2], centrePt, outerPoly, margin); // T
  out[3] = clampPointInsideOuter(out[3], centrePt, outerPoly, margin); // S1
  return out;
}

function centroidOf5(poly5) {
  // Use your existing centroidOfPoly if you prefer, but this is local and small.
  let sx = 0, sy = 0;
  for (const p of poly5) {
    sx += p.x; sy += p.y;
  }
  return { x: sx / 5, y: sy / 5 };
}

function farthestShoulderIndex(poly5, c) {
  // Return 1 for S0 or 3 for S1
  const d10 = (poly5[1].x - c.x) ** 2 + (poly5[1].y - c.y) ** 2;
  const d30 = (poly5[3].x - c.x) ** 2 + (poly5[3].y - c.y) ** 2;
  return (d10 >= d30) ? 1 : 3;
}

// Map a bad vertex index to which shoulder is "adjacent" for inward move.
// For 5-point order [B0,S0,T,S1,B1]:
// - If bad vertex is B0 (idx 0) or S0 (idx 1): adjust S0
// - If bad vertex is B1 (idx 4) or S1 (idx 3): adjust S1
// - If bad vertex is T (idx 2): decide later (tie-break)
function shoulderForBadVertex(vIdx) {
  if (vIdx === 0 || vIdx === 1) return 1; // S0
  if (vIdx === 4 || vIdx === 3) return 3; // S1
  return null; // T
}

// Strict convexity repair for a single 5-point bastion.
// Returns { poly, ok, iters, note }
export function repairBastionStrictConvex(poly5, centrePt, outerPoly, margin, K) {
  if (!Array.isArray(poly5) || poly5.length !== 5) {
    return { poly: poly5, ok: false, iters: 0, note: "skip_non5" };
  }
  if (!outerPoly) {
    return { poly: poly5, ok: false, iters: 0, note: "no_outerHull" };
  }

  // Tuning knobs (deterministic):
  // epsCross scales with geometry size; use bastion base length as reference.
  const bastionBaseLen = dist(poly5[0], poly5[4]);
  const epsCross = Math.max(1e-3, (bastionBaseLen * bastionBaseLen) * 1e-1);
  const epsArea = Math.max(1e-6, (bastionBaseLen * bastionBaseLen) * 1e-5);

  let cur = clampBastionMovablesInsideOuter(poly5, centrePt, outerPoly, margin);

  // Precompute M for T shrink direction.
  const M = { x: (cur[0].x + cur[4].x) / 2, y: (cur[0].y + cur[4].y) / 2 };

  for (let it = 0; it < K; it++) {
    const exp = expectedTurnSign(cur, epsArea, epsCross);
    const bad = findBadTurns(cur, exp, epsCross);
    if (bad.length === 0) {
      return { poly: cur, ok: true, iters: it, note: "ok" };
    }

    // Pick the worst bad turn by absolute cross magnitude, but treat collinear as severe.
    let worst = bad[0];
    for (const b of bad) {
      const w0 = (worst.kind === "collinear") ? Infinity : Math.abs(worst.cross);
      const w1 = (b.kind === "collinear") ? Infinity : Math.abs(b.cross);
      if (w1 > w0) worst = b;
    }

    const vIdx = worst.vIdx;

    // Actions by bad vertex type:
    // - Bad at S0 or S1: shrink T toward M.
    // - Bad at T: move one shoulder inward (tie-break), then clamp.
    // - Bad at B0 or B1: move adjacent shoulder inward, then clamp.
    if (vIdx === 1 || vIdx === 3) {
      // Shrink T -> M (fixed step schedule).
      cur[2] = moveTowardPoint(cur[2], M, 0.12);
      cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
    } else if (vIdx === 0 || vIdx === 4) {
      const sIdx = shoulderForBadVertex(vIdx); // 1 or 3
      cur[sIdx] = moveTowardPoint(cur[sIdx], M, 0.18);
      cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
    } else if (vIdx === 2) {
      // Bad at tip: move the shoulder adjacent to the bad turn inward.
      // Tie-break uses farthest-from-centroid rule.
      const c = centroidOf5(cur);
      const pick = farthestShoulderIndex(cur, c); // 1 or 3
      cur[pick] = moveTowardPoint(cur[pick], M, 0.18);
      cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
    } else {
      // Unexpected vertex index, shrink tip as safest move.
      cur[2] = moveTowardPoint(cur[2], M, 0.12);
      cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
    }

    // Always re-clamp movables after any move.
    cur = clampBastionMovablesInsideOuter(cur, centrePt, outerPoly, margin);
  }

  // Fallback after K iterations:
  // Try a tighter tip shrink, then collapse to triangle if needed.
  const exp2 = expectedTurnSign(cur, epsArea, epsCross);
  const bad2 = findBadTurns(cur, exp2, epsCross);
  if (bad2.length === 0) return { poly: cur, ok: true, iters: K, note: "ok_afterK" };

  // One aggressive tip shrink attempt.
  cur[2] = moveTowardPoint(cur[2], M, 0.35);
  cur[2] = clampPointInsideOuter(cur[2], centrePt, outerPoly, margin);
  const exp3 = expectedTurnSign(cur, epsArea, epsCross);
  const bad3 = findBadTurns(cur, exp3, epsCross);
  if (bad3.length === 0) return { poly: cur, ok: true, iters: K, note: "ok_afterFallbackShrink" };

  // No strict-convex solution found within K iterations under current constraints.
  // Return best-effort current shape (already clamped), and mark failure.
  return { poly: cur, ok: false, iters: K, note: "fallback_keep_current" };
}
