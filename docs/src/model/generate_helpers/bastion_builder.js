// docs/src/model/generate_helpers/bastion_builder.js
//
// Deterministic bastion polygon builder.
// Produces 5-point bastions: [B0, S0, T, S1, B1] in requested winding.

function polySignedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += (p.x * q.y - q.x * p.y);
  }
  return 0.5 * a;
}

function ensureWinding(poly, wantCCW) {
  const a = polySignedArea(poly);
  const isCCW = a > 0;
  if (wantCCW ? !isCCW : isCCW) return poly.slice().reverse();
  return poly;
}

function unit(v) {
  const L = Math.hypot(v.x, v.y);
  if (!Number.isFinite(L) || L <= 1e-9) return { x: 0, y: 0 };
  return { x: v.x / L, y: v.y / L };
}

function add(p, v, s) {
  return { x: p.x + v.x * s, y: p.y + v.y * s };
}

/**
 * Build a 5-point bastion anchored on the sampled curtain at index k.
 *
 * placement must contain:
 *  - curtainPtsS: Array<{x,y}>
 *  - clearance: Array<number>
 *  - sampleStep: number
 *  - minSpacing: number
 *  - bastionOuterClearance: number
 *  - localSpacingByK: Map<number, number> OR null
 *
 * opts:
 *  - cx, cy: centre
 *  - wantCCW: boolean
 *  - shoulderSpanToTip: number (ratio)
 */
export function buildPentBastionAtSampleIndex({ k, placement, cx, cy, wantCCW, shoulderSpanToTip }) {
  const pts = placement.curtainPtsS;
  const n = pts.length;
  const P = pts[k];

  const out = unit({ x: P.x - cx, y: P.y - cy });
  const tan = unit({ x: -out.y, y: out.x });
  const nrm = out;

  const c = placement.clearance?.[k];

  const localSpacing =
    (placement.localSpacingByK && placement.localSpacingByK.has && placement.localSpacingByK.has(k))
      ? placement.localSpacingByK.get(k)
      : placement.minSpacing;

  const shoulderInMaxFromSpacing = 0.45 * localSpacing;

  const reserve = Number.isFinite(placement.bastionOuterClearance) ? placement.bastionOuterClearance : 0;
  const tipLenFromClearance = Number.isFinite(c) ? Math.max(0, c - reserve) : 40;
  const tipLen0 = Math.max(10, Number.isFinite(c) ? Math.min(tipLenFromClearance, Math.max(0, c - 2)) : tipLenFromClearance);

  const ratio = Number.isFinite(shoulderSpanToTip) ? Math.max(0.1, shoulderSpanToTip) : 0.55;

  const shoulderInTarget0 = 0.5 * ratio * tipLen0;
  const shoulderIn0 = Math.max(6, Math.min(shoulderInTarget0, shoulderInMaxFromSpacing));
  const baseHalf0 = shoulderIn0 / 0.55;

  function build(baseHalf, shoulderIn, tipLen) {
    const step = Number.isFinite(placement.sampleStep) ? placement.sampleStep : 10;

    let d = Math.max(1, Math.round(baseHalf / step));

    const minBaseChord = Math.max(2, 0.20 * shoulderIn);
    const dMax = Math.min((n / 6) | 0, 12);

    let B0 = pts[(k - d + n) % n];
    let B1 = pts[(k + d) % n];

    for (let tries = 0; tries < dMax; tries++) {
      const chord = Math.hypot(B1.x - B0.x, B1.y - B0.y);
      if (chord >= minBaseChord) break;
      d += 1;
      B0 = pts[(k - d + n) % n];
      B1 = pts[(k + d) % n];
    }

    const S0 = add(add(P, tan, -shoulderIn), nrm, 0.25 * tipLen);
    const S1 = add(add(P, tan, +shoulderIn), nrm, 0.25 * tipLen);
    const T  = add(P, nrm, tipLen);

    return ensureWinding([B0, S0, T, S1, B1], wantCCW);
  }

  // Deterministic shrink search
  const tipScales = [1.00, 0.85, 0.72, 0.60];
  const widthExtraScales = [1.00, 0.85, 0.72];

  for (const ts of tipScales) {
    const tipLen = tipLen0 * ts;

    const shoulderInTarget2 = 0.5 * ratio * tipLen;
    const shoulderIn2 = Math.max(6, Math.min(shoulderInTarget2, shoulderInMaxFromSpacing));
    const baseHalf2 = shoulderIn2 / 0.55;

    for (const ws of widthExtraScales) {
      const shoulderInTry = shoulderIn2 * ws;
      const baseHalfTry = shoulderInTry / 0.55;

      const poly = build(baseHalfTry, shoulderInTry, tipLen);
      if (Math.abs(polySignedArea(poly)) < 1e-3) continue;
      return poly;
    }
  }

  return build(baseHalf0, shoulderIn0, tipLen0);
}
