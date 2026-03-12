// docs/src/model/generate_helpers/bastion_slide_repair.js
//
// Sliding repair for bastions: for each failing bastion index, slide its anchor to
// nearby clearance maxima slots and rebuild a fresh pentagonal bastion there,
// then re-run the same warp + clamp + convex repair pipeline.
//
// This is dependency-injected: Stage 110 passes in the functions and state it already has.
// No RNG is used here; order is deterministic.
import { signedArea, areaAbs } from "../../geom/poly.js";
import { repairBastionsStrictConvex } from "./bastion_convex_repair.js";

function _validPoly(poly) {
  return Array.isArray(poly) && poly.length >= 3;
}
function diag5(poly) {
  if (!Array.isArray(poly)) return { ok: false, why: "not_array" };
  if (poly.length !== 5) return { ok: false, why: "not_5", n: poly.length };

  const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;

  const baseGap = d(poly[0], poly[4]);
  const shoulderGap = d(poly[1], poly[3]);
  const tipS0 = d(poly[2], poly[1]);
  const tipS1 = d(poly[2], poly[3]);

  let sign = 0;
  for (let i = 0; i < 5; i++) {
    const a = poly[i], b = poly[(i + 1) % 5], c = poly[(i + 2) % 5];
    const abx = b.x - a.x, aby = b.y - a.y;
    const bcx = c.x - b.x, bcy = c.y - b.y;
    const z = cross(abx, aby, bcx, bcy);
    if (!Number.isFinite(z) || Math.abs(z) < 1e-9) return { ok: false, why: "collinear", i, baseGap, shoulderGap, tipS0, tipS1 };
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return { ok: false, why: "non_convex", i, baseGap, shoulderGap, tipS0, tipS1 };
  }

  const flags = [];
  const eps = 1.0;
  if (shoulderGap < eps) flags.push("shoulders_collapsed");
  if (baseGap < eps) flags.push("base_collapsed");

  return { ok: flags.length === 0, flags, baseGap, shoulderGap, tipS0, tipS1 };
}
function roundNum(v, d = 3) {
  return Number.isFinite(v) ? Number(v.toFixed(d)) : v;
}

function roundPt(p, d = 3) {
  if (!p) return p;
  return { x: roundNum(p.x, d), y: roundNum(p.y, d) };
}

function crossZ(a, b, c) {
  const e1x = b.x - a.x;
  const e1y = b.y - a.y;
  const e2x = c.x - b.x;
  const e2y = c.y - b.y;
  return e1x * e2y - e1y * e2x;
}

function signedAreaLocal(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function interiorAngleLocal(poly, i) {
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
    return NaN;
  }

  let c = (ax * bx + ay * by) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return Math.acos(c) * 180 / Math.PI;
}

function bastionTurnDiagnostics(poly) {
  if (!Array.isArray(poly) || poly.length !== 5) {
    return { n: Array.isArray(poly) ? poly.length : null, turns: [] };
  }

  const turns = [];
  for (let i = 0; i < 5; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 5];
    const c = poly[(i + 2) % 5];
    turns.push({
      turnAtVertex: (i + 1) % 5,
      cross: roundNum(crossZ(a, b, c), 6),
      angleDeg: roundNum(interiorAngleLocal(poly, (i + 1) % 5), 3),
    });
  }

  return {
    n: 5,
    signedArea: roundNum(signedAreaLocal(poly), 6),
    points: poly.map((p, idx) => ({ idx, ...roundPt(p, 3) })),
    turns,
  };
}
/**
 * Slide-repair bastions in-place (returns a new array copy).
 *
 * @param {object} args
 * @param {Array<Array<{x:number,y:number}>>} args.bastionPolys - current bastion polys (warped + clamped + shrunk)
 * @param {number[]} args.failedIndices - indices in bastionPolys to attempt to repair
 * @param {object} args.placement - warpOutworks.bastionPlacement
 * @param {Array<{i:number,s:number,c:number}>} args.maxima - placement.maxima
 * @param {number} args.L - placement.totalLen
 * @param {{x:number,y:number}} args.centrePt
 * @param {number} args.cx
 * @param {number} args.cy
 * @param {boolean} args.wantCCW
 * @param {Array<{x:number,y:number}>} args.outerHullLoop
 * @param {object|null} args.warpWall - { field, params } or null
 * @param {object} args.warpOutworks - { field, params, clampMaxMargin, ... }
 * @param {object|null} args.curtainMinField
 * @param {number} args.bastionOuterInset
 * @param {boolean} args.bastionsBuiltFromMaxima
 * @param {number} args.slideTries
 * @param {number} args.margin
 * @param {number} args.K
 *
 * @param {function(Array<{x,y}>, {x,y}, object, object):Array<{x,y}>} args.warpPolylineRadial
 * @param {function(Array<{x,y}>, {x,y}, object|null, object|null, number, number):Array<{x,y}>} args.clampPolylineRadial
 * @param {function(Array<{x,y}>, {x,y}, Array<{x,y}>, number):Array<{x,y}>} args.clampPolylineInsidePolyAlongRays
 * @param {function(Array<{x,y}>, boolean):Array<{x,y}>} args.ensureWinding
 * @param {function(Array<{x,y}>):number} args.polyAreaSigned
 * @param {function(Array<{x,y}>, {x:number,y:number}, Array<{x,y}>, number, number):{ok:boolean, poly:Array<{x,y}>, iters?:number, reason?:string}} args.repairBastionStrictConvex
 * @param {function(Array<{x,y}>):{x:number,y:number}} args.bastionCentroid
 * @param {function(Array<{x,y}>, {x:number,y:number}):number} args.nearestSampleIndex
 * @param {function(Array<any>, number, number):number} args.nearestMaximaIndex
 * @param {function(object):Array<{x,y}>} args.buildPentBastionAtSampleIndex
 *
 * @returns {{ bastionPolysOut: Array<Array<{x,y}>>, slideStats: object }}
 */
export function slideRepairBastions({
  bastionPolys,
  failedIndices,
  placement,
  maxima,
  L,
  centrePt,
  cx,
  cy,
  wantCCW,
  outerHullLoop,
  warpWall,
  warpOutworks,
  curtainMinField,
  bastionOuterInset,
  bastionsBuiltFromMaxima,
  slideTries,
  margin,
  K,
  debug = false,
  warpPolylineRadial,
  clampPolylineRadial,
  clampPolylineInsidePolyAlongRays,
  ensureWinding,
  polyAreaSigned,
  repairBastionStrictConvex,
  bastionCentroid,
  nearestSampleIndex,
  nearestMaximaIndex,
  buildPentBastionAtSampleIndex,
} = {}) {
  const polysIn = Array.isArray(bastionPolys) ? bastionPolys : [];
  const out = polysIn.slice();

  const stats = {
    attempted: 0,
    repaired: 0,
    failed: 0,
    usedMaxima: 0,
  };

  if (!Array.isArray(failedIndices) || failedIndices.length === 0) {
    return { bastionPolysOut: out, slideStats: stats };
  }

  if (!placement || !Array.isArray(maxima) || maxima.length === 0 || !warpOutworks?.field) {
    return { bastionPolysOut: out, slideStats: stats };
  }

  const usedMax = new Set();

  function warpClampRepairOne(poly5) {
    const hasCurtainWarp = Boolean(warpWall?.field && warpWall?.params) && !bastionsBuiltFromMaxima;

    const warpedByCurtain = hasCurtainWarp
      ? warpPolylineRadial(poly5, centrePt, warpWall.field, warpWall.params)
      : poly5;

    const warpedByOutworks = bastionsBuiltFromMaxima
      ? warpedByCurtain
      : warpPolylineRadial(warpedByCurtain, centrePt, warpOutworks.field, warpOutworks.params);

    const clamped = clampPolylineRadial(
      warpedByOutworks,
      centrePt,
      curtainMinField,
      null,
      2,
      warpOutworks.clampMaxMargin
    );

    let clampedSafe = clamped;

    if (outerHullLoop) {
      const baseM = Number.isFinite(warpOutworks?.clampMaxMargin) ? warpOutworks.clampMaxMargin : 10;
      const m = baseM + (Number.isFinite(bastionOuterInset) ? bastionOuterInset : 0);
      clampedSafe = clampPolylineInsidePolyAlongRays(clampedSafe, centrePt, outerHullLoop, m);
    }
    
    const poly2 = ensureWinding(clampedSafe, wantCCW);
    if (!_validPoly(poly2)) {
      return { ok: false, poly: poly2, reason: "invalid_after_clamp" };
    }
    if (areaAbs(poly2) < 1e-3) {
      return { ok: false, poly: poly2, reason: "degenerate_area_after_clamp" };
    }
    
    const res = repairBastionStrictConvex(poly2, centrePt, outerHullLoop, margin, K);
    if (res?.ok) {
      return { ok: true, poly: res.poly };
    }
    return {
      ok: false,
      poly: res?.poly || poly2,
      reason: res?.reason || res?.note || "strict_repair_failed",
      iters: res?.iters,
    };
  }

  // Deterministic order: sort indices
  const failed = failedIndices.slice().filter(Number.isFinite).map(i => i | 0).sort((a, b) => a - b);

  for (const idx of failed) {
    if (idx < 0 || idx >= out.length) continue;
    const cur = out[idx];
    if (!_validPoly(cur)) continue;

    stats.attempted++;

    // Project current bastion to a nearby s value on the sampled curtain.
    const c = bastionCentroid(cur);
    const k0 = nearestSampleIndex(placement.curtainPtsS, c);
    const s0 = placement.sArr?.[k0] ?? 0;

    // Find nearest maxima and try around it deterministically.
    const j0 = nearestMaximaIndex(maxima, s0, L);
    if (j0 < 0) {
      stats.failed++;
      continue;
    }

    const candJs = [j0];
    for (let k = 1; k <= slideTries; k++) {
      candJs.push((j0 - k + maxima.length) % maxima.length);
      candJs.push((j0 + k) % maxima.length);
    }

    let repaired = false;

    for (const j of candJs) {
      if (usedMax.has(j)) continue;

      const m = maxima[j];
      const kSample = m?.i;
      if (!Number.isFinite(kSample)) continue;
      if (kSample < 0 || kSample >= placement.curtainPtsS.length) continue;

      const candPoly = buildPentBastionAtSampleIndex({
        k: kSample,
        placement,
        cx,
        cy,
        wantCCW,
        outerHullLoop,
      });
      if (debug) {
        console.log("[slideRepair] cand pre", {
          idx,
          j,
          kSample,
          pre: diag5(candPoly),
          preDiag: bastionTurnDiagnostics(candPoly),
        });
      }
      
      const outRes = warpClampRepairOne(candPoly);
      
      if (debug) {
        console.info("[slideRepair] cand post", {
          idx,
          j,
          kSample,
          outOk: Boolean(outRes?.ok),
          outReason: outRes?.reason || outRes?.note || null,
          post: diag5(outRes?.poly),
          postDiag: bastionTurnDiagnostics(outRes?.poly),
        });
      }
      
      if (!outRes?.ok) {
        console.warn("[slideRepair] cand post FAIL detail", {
          idx,
          j,
          kSample,
          outReason: outRes?.reason || outRes?.note || null,
          pre: diag5(candPoly),
          post: diag5(outRes?.poly),
          preDiag: bastionTurnDiagnostics(candPoly),
          postDiag: bastionTurnDiagnostics(outRes?.poly),
        });
      
        const diag = bastionTurnDiagnostics(outRes?.poly);
        const postQuick = diag5(outRes?.poly);
        const v1Turn = Array.isArray(diag.turns)
          ? diag.turns.find(t => t.turnAtVertex === 1)
          : null;
      
        console.warn("[slideRepair] vertex-1 focus", {
          idx,
          j,
          kSample,
          outReason: outRes?.reason || outRes?.note || null,
          failVertex: postQuick?.i ?? null,
          failWhy: postQuick?.why ?? null,
          vertex1: v1Turn,
          points: diag.points,
        });
      }
      if (outRes.ok && _validPoly(outRes.poly)) {
        if (debug) console.info("[slideRepair] ACCEPT", { idx, j, kSample });
        out[idx] = outRes.poly;
        usedMax.add(j);
        repaired = true;
        stats.repaired++;
        break;
      }
    }

    if (!repaired) stats.failed++;
  }

  stats.usedMaxima = usedMax.size;

  return { bastionPolysOut: out, slideStats: stats };
}


export function runSlideRepairPass({
  ctx,
  warpDebugEnabled,
  bastionPolysWarpedSafe,
  wantCCW,
  centrePt,
  outerHullLoop,
  margin,
  K,
  warpOutworks,
  wallCurtainForDraw,
  warpWall,
  curtainMinField,
  bastionOuterInset,
  bastionsBuiltFromMaxima,
  warpPolylineRadial,
  clampPolylineRadial,
  clampPolylineInsidePolyAlongRays,
  ensureWinding,
  repairBastionStrictConvex,
  polyAreaSigned = signedArea,
}) {
  let polysOut = bastionPolysWarpedSafe;
  let convexStats = null;

  const enableSlideRepair = Boolean(ctx?.params?.warpFort?.enableSlideRepair ?? true);
  if (ctx?.params?.warpFort?.debug) {
    const arr = Array.isArray(polysOut) ? polysOut : [];
    console.info("[Warp110] slideRepair gate", {
      enableSlideRepair,
      bastionPolysN: arr.length,
      hasPlacement: Boolean(warpOutworks?.bastionPlacement),
    });
  }

  if (
    enableSlideRepair &&
    warpOutworks?.bastionPlacement?.maxima?.length &&
    warpOutworks.bastionPlacement.curtainPtsS?.length &&
    warpOutworks.bastionPlacement.sArr?.length &&
    warpOutworks?.field &&
    outerHullLoop &&
    Array.isArray(wallCurtainForDraw)
  ) {
    const placement = warpOutworks.bastionPlacement;
    const maxima = placement.maxima;
    const L = placement.totalLen;

    const slideTries = Number.isFinite(ctx?.params?.warpFort?.slideMaxTries)
      ? Math.max(1, ctx.params.warpFort.slideMaxTries | 0)
      : 3;

    const failedIndices = [];
    for (let i = 0; i < polysOut.length; i++) {
      const poly = polysOut[i];
      if (!Array.isArray(poly) || poly.length !== 5) continue;

      const poly2 = ensureWinding(poly, wantCCW);
      if (Math.abs(polyAreaSigned(poly2)) < 1e-3) {
        failedIndices.push(i);
        continue;
      }

      const res = repairBastionStrictConvex(poly2.slice(), centrePt, outerHullLoop, margin, K);
      if (!res || !res.ok) failedIndices.push(i);
    }

    if (failedIndices.length && warpDebugEnabled) {
      console.log("[slideRepair] failedIndices", failedIndices);
    }

    const { bastionPolysOut, slideStats } = slideRepairBastions({
      bastionPolys: polysOut,
      failedIndices,
      placement,
      maxima,
      L,
      centrePt,
      cx: centrePt.x,
      cy: centrePt.y,
      wantCCW,
      outerHullLoop,
      debug: Boolean(ctx?.params?.warpFort?.debug),
      warpWall,
      warpOutworks,
      curtainMinField,
      bastionOuterInset,
      bastionsBuiltFromMaxima,
      slideTries,
      margin,
      K,
      warpPolylineRadial,
      clampPolylineRadial,
      clampPolylineInsidePolyAlongRays,
      ensureWinding,
      signedArea: polyAreaSigned,
      repairBastionStrictConvex,
      bastionCentroid,
      nearestSampleIndex,
      nearestMaximaIndex,
      buildPentBastionAtSampleIndex: (args) => buildPentBastionAtSampleIndex({
        ...args,
        shoulderSpanToTip: ctx?.params?.warpFort?.bastionShoulderSpanToTip,
      }),
    });

    polysOut = bastionPolysOut;
    warpOutworks.bastionSlideRepair = slideStats;

    if (ctx?.params?.warpFort?.debug) {
      const polys = Array.isArray(polysOut) ? polysOut : [];
      const eps = Number.isFinite(ctx?.params?.warpFort?.bastionTriEps) ? ctx.params.warpFort.bastionTriEps : 1.0;

      for (let i = 0; i < polys.length; i++) {
        const p = polys[i];
        if (!Array.isArray(p)) {
          console.warn("[Warp110] bastion diag", { i, kind: "not_array" });
          continue;
        }

        const n = p.length;
        const a = (typeof polyAreaSigned === "function" && n >= 3) ? polyAreaSigned(p) : null;

        let shoulderGap = null;
        let baseGap = null;
        let tipShoulder0 = null;
        let tipShoulder1 = null;

        if (n === 5) {
          baseGap = Math.hypot(p[4].x - p[0].x, p[4].y - p[0].y);
          shoulderGap = Math.hypot(p[3].x - p[1].x, p[3].y - p[1].y);
          tipShoulder0 = Math.hypot(p[1].x - p[2].x, p[1].y - p[2].y);
          tipShoulder1 = Math.hypot(p[3].x - p[2].x, p[3].y - p[2].y);
        }

        const convex = diag5(p);
        const triFlags = [];
        if (n === 5 && Number.isFinite(shoulderGap) && shoulderGap < eps) triFlags.push("shoulders_collapsed");
        if (n === 5 && Number.isFinite(baseGap) && baseGap < eps) triFlags.push("base_collapsed");
        if (n === 5 && convex.ok === false) triFlags.push(`convex_fail:${convex.why}`);

        if (triFlags.length) {
          console.warn("[Warp110] bastion TRIANGLE-LIKE", {
            i, n, areaSigned: a, baseGap, shoulderGap, tipShoulder0, tipShoulder1, triFlags,
          });
        } else {
          console.info("[Warp110] bastion ok", { i, n, areaSigned: a, baseGap, shoulderGap });
        }
      }
    }

    if (ctx?.params?.warpFort?.debug) {
      const arr = Array.isArray(polysOut) ? polysOut : [];
      const nonNull = arr.filter(p => Array.isArray(p) && p.length >= 3).length;
      console.info("[Warp110] bastions AFTER slide repair", { n: arr.length, nonNull });
    }

    const refreshed = repairBastionsStrictConvex({
      bastionPolys: polysOut,
      wantCCW,
      areaEps: 1e-3,
      ensureWinding,
      polyAreaSigned,
      repairOne: (poly) => {
        const r = repairBastionStrictConvex(poly, centrePt, outerHullLoop, margin, K);
        if (!r) return { ok: false, reason: "repairBastionStrictConvex returned null" };
        return (r.ok && Array.isArray(r.poly))
          ? { ok: true, poly: r.poly }
          : { ok: false, reason: r.reason || "repair failed" };
      },
      repairOpts: {},
    });

    convexStats = refreshed.convexStats;
  }

  if (warpOutworks && warpOutworks.bastionPlacement) {
    const soft = ctx?.params?.bastionSoft || null;
    const targetN = Number.isFinite(soft?.targetN) ? soft.targetN : null;

    warpOutworks.bastionPlacement.final = {
      targetN,
      finalCount: Array.isArray(polysOut) ? polysOut.length : 0,
      candidates: warpOutworks.bastionPlacement.maxima ? warpOutworks.bastionPlacement.maxima.length : 0,
    };
  }

  return { bastionPolysOut: polysOut, convexStats };
}
