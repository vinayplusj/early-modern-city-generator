// docs/src/model/generate_helpers/bastion_builder.js
//
// Deterministic bastion polygon builder.
// Produces 5-point bastions: [B0, S0, T, S1, B1] in requested winding.
import { clampPointInsideAlongRay} from "../../geom/radial_ray_clamp.js";
import { clearanceToHullAlongRay } from "./warp_stage.js";
import { dist, unit, add, sub, mul, perp } from "../../geom/primitives.js";
import { signedArea } from "../../geom/poly.js";

function ensureWinding(poly, wantCCW) {
  const a = signedArea(poly);
  const isCCW = a > 0;
  if (wantCCW ? !isCCW : isCCW) return poly.slice().reverse();
  return poly;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function midpoint(a, b) {
  return { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y) };
}

function pointDist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function localCurtainFrame(pts, k, cx, cy) {
  const n = pts.length;
  const pPrev = pts[(k - 1 + n) % n];
  const p = pts[k];
  const pNext = pts[(k + 1) % n];

  const chord = sub(pNext, pPrev);
  let tan = unit(chord);

  if (!Number.isFinite(tan.x) || !Number.isFinite(tan.y) || (Math.abs(tan.x) < 1e-9 && Math.abs(tan.y) < 1e-9)) {
    const radial = unit({ x: p.x - cx, y: p.y - cy });
    tan = unit(perp(radial));
  }

  let nrm = unit(perp(tan));

  const radial = unit({ x: p.x - cx, y: p.y - cy });
  if (dot(nrm, radial) < 0) {
    nrm = mul(nrm, -1);
  }

  return { tan, nrm };
}

function bastionQuickShape(poly) {
  if (!Array.isArray(poly) || poly.length !== 5) {
    return { ok: false, why: "not_5" };
  }

  const baseGap = pointDist(poly[0], poly[4]);
  const shoulderGap = pointDist(poly[1], poly[3]);
  const tipS0 = pointDist(poly[2], poly[1]);
  const tipS1 = pointDist(poly[2], poly[3]);

  if (!(baseGap > 1e-9)) {
    return { ok: false, why: "base_collapsed", baseGap, shoulderGap, tipS0, tipS1 };
  }

  const shoulderRatio = shoulderGap / baseGap;
  const tipRatio = Math.min(tipS0, tipS1) / baseGap;

  if (shoulderGap < 1e-6) {
    return { ok: false, why: "shoulders_collapsed", baseGap, shoulderGap, tipS0, tipS1, shoulderRatio, tipRatio };
  }

  if (shoulderRatio < 0.12) {
    return { ok: false, why: "shoulder_ratio_too_small", baseGap, shoulderGap, tipS0, tipS1, shoulderRatio, tipRatio };
  }

  if (tipRatio < 0.08) {
    return { ok: false, why: "tip_ratio_too_small", baseGap, shoulderGap, tipS0, tipS1, shoulderRatio, tipRatio };
  }

  return { ok: true, baseGap, shoulderGap, tipS0, tipS1, shoulderRatio, tipRatio };
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
export function buildPentBastionAtSampleIndex({ k, placement, cx, cy, wantCCW, shoulderSpanToTip, outerHullLoop }) {
  const pts = placement.curtainPtsS;
  const n = pts.length;
  const P = pts[k];

  const { tan, nrm } = localCurtainFrame(pts, k, cx, cy);

  const cNormal = placement.clearance?.[k];
  
  // Clearance along the actual tip direction (radial)
  let cRadial = null;
  if (Array.isArray(outerHullLoop) && outerHullLoop.length >= 3) {
    const hit = clearanceToHullAlongRay(P, nrm, outerHullLoop);
    cRadial = (hit && hit.ok) ? hit.dist : null;
  }
  
  // Conservative effective clearance for tip sizing.
  let cEff = null;
  if (Number.isFinite(cNormal) && Number.isFinite(cRadial)) cEff = Math.min(cNormal, cRadial);
  else if (Number.isFinite(cNormal)) cEff = cNormal;
  else if (Number.isFinite(cRadial)) cEff = cRadial;

  const localSpacing =
    (placement.localSpacingByK && placement.localSpacingByK.has && placement.localSpacingByK.has(k))
      ? placement.localSpacingByK.get(k)
      : placement.minSpacing;

  const shoulderInMaxFromSpacing = 0.45 * localSpacing;

  const reserve = Number.isFinite(placement.bastionOuterClearance) ? placement.bastionOuterClearance : 0;
  // --- DEBUG: bastion tip clearance mismatch (Milestone 4.8 diagnostics) ---
  if (typeof window !== "undefined" && window.__bastionDebug) {
    try {  
      // Radial direction used for tip point construction
      const dir = nrm;
  
      // Clearance along the actual tip direction (radial)
      const hit = clearanceToHullAlongRay(P, dir, outerHullLoop);
  
      // “How far could the tip extend” after reserve
      const tipRoomNormal = (Number.isFinite(cNormal) && Number.isFinite(reserve)) ? (cNormal - reserve) : null;
      const tipRoomRadial = (Number.isFinite(cRadial) && Number.isFinite(reserve)) ? (cRadial - reserve) : null;
  
      // Print a single compact record
      // Toggle: window.__bastionDebug = true
      console.log("[bastion clearance]", {
        k,
        P: { x: +P.x.toFixed(2), y: +P.y.toFixed(2) },
        out: { x: +dir.x.toFixed(4), y: +dir.y.toFixed(4) },
        reserve: +reserve.toFixed(2),
        cNormal: (cNormal == null) ? null : +cNormal.toFixed(2),
        cRadial: (cRadial == null) ? null : +cRadial.toFixed(2),
        tipRoomNormal: (tipRoomNormal == null) ? null : +tipRoomNormal.toFixed(2),
        tipRoomRadial: (tipRoomRadial == null) ? null : +tipRoomRadial.toFixed(2),
        cEff: (cEff == null) ? null : +cEff.toFixed(2),
      });
    } catch (e) {
      console.warn("[bastion clearance] debug failed:", e && e.message ? e.message : e);
    }
  }
  // --- END DEBUG ---  
  const tipLenFromClearance = Number.isFinite(cEff) ? Math.max(0, cEff - reserve) : 40;
  const tipLen0 = Math.max(
    10,
    Number.isFinite(cEff) ? Math.min(tipLenFromClearance, Math.max(0, cEff - 2)) : tipLenFromClearance
  );

  const ratio = Number.isFinite(shoulderSpanToTip) ? Math.max(0.1, shoulderSpanToTip) : 0.55;
  const shoulderInsetMin = 0.75;
  const shoulderInTarget0 = 0.5 * ratio * tipLen0;
  const shoulderIn0 = Math.max(shoulderInsetMin, Math.min(shoulderInTarget0, shoulderInMaxFromSpacing));
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

    // Candidate shoulders + tip (existing lines)
  let S0 = add(add(P, mul(tan, -shoulderIn)), mul(nrm, 0.50 * tipLen));
  let S1 = add(add(P, mul(tan, +shoulderIn)), mul(nrm, 0.50 * tipLen));
  let T  = add(P, mul(nrm, tipLen));
    
    // Reserve clamp for tip + shoulders against outerHullLoop (new)
    if (reserve > 0 && Array.isArray(outerHullLoop) && outerHullLoop.length >= 3) {
      const centre = { x: cx, y: cy };
    
      S0 = clampPointInsideAlongRay(S0, centre, outerHullLoop, reserve);
      S1 = clampPointInsideAlongRay(S1, centre, outerHullLoop, reserve);
      T  = clampPointInsideAlongRay(T,  centre, outerHullLoop, reserve);
    }
    
    return ensureWinding([B0, S0, T, S1, B1], wantCCW);
  }

  // Deterministic shrink search
  const tipScales = [1.00, 0.85, 0.72, 0.60];
  const widthExtraScales = [1.00, 0.85, 0.72];

  for (const ts of tipScales) {
    const tipLen = tipLen0 * ts;

    const shoulderInTarget2 = 0.5 * ratio * tipLen;
    const shoulderIn2 = Math.max(shoulderInsetMin, Math.min(shoulderInTarget2, shoulderInMaxFromSpacing));
    const baseHalf2 = shoulderIn2 / 0.55;

    for (const ws of widthExtraScales) {
      const shoulderInTry = shoulderIn2 * ws;
      const baseHalfTry = shoulderInTry / 0.55;

    const poly = build(baseHalfTry, shoulderInTry, tipLen);
    if (Math.abs(signedArea(poly)) < 1e-3) continue;
    
    const quick = bastionQuickShape(poly);
    if (!quick.ok) continue;
    
    return poly;
    }
  }

  const fallbackPoly = build(baseHalf0, shoulderIn0, tipLen0);
  const fallbackQuick = bastionQuickShape(fallbackPoly);
  if (!fallbackQuick.ok && typeof window !== "undefined" && window.__bastionDebug) {
    console.warn("[bastionBuilder] fallback rejected by quick shape", {
      k,
      fallbackQuick,
      poly: fallbackPoly,
    });
  }
  return fallbackPoly;
}
