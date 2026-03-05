// docs/src/model/generate_helpers/bastion_convex_repair.js
//
// Strict convexity repair for bastion polygons after warp/clamp/shrink.
// This module is intentionally dependency-injected so it can be used by Stage 110
// without importing stage-local helpers.
//
// Exports:
// - repairBastionsStrictConvex
// - checkBastionsStrictConvex

/**
 * @typedef {{x:number,y:number}} Pt
 * @typedef {Pt[]} Poly
 */

/**
 * Repair a set of bastion polygons to be strictly convex (where possible).
 *
 * This function:
 * - normalises winding (via ensureWinding)
 * - rejects degenerate polygons (area too small)
 * - delegates the actual convex repair to repairOne(poly, opts)
 * - returns repaired polys and a stats object that Stage 110 can store for audit/debug
 *
 * @param {object} args
 * @param {Poly[]} args.bastionPolys - input polygons (may include nulls)
 * @param {boolean} args.wantCCW - desired winding (true = CCW)
 * @param {number} args.areaEps - absolute area threshold for degeneracy (default 1e-3)
 * @param {function(Poly, boolean):Poly} args.ensureWinding - (poly, wantCCW) -> poly'
 * @param {function(Poly):number} args.polyAreaSigned - signed area
 * @param {function(Poly, object):{ok:boolean, poly?:Poly, reason?:string}} args.repairOne
 * @param {object} [args.repairOpts] - forwarded to repairOne
 *
 * @returns {{ bastionPolysOut: Poly[], convexStats: object }}
 */
export function repairBastionsStrictConvex({
  bastionPolys,
  wantCCW,
  areaEps = 1e-3,
  ensureWinding,
  polyAreaSigned,
  repairOne,
  repairOpts = {},
} = {}) {
  const input = Array.isArray(bastionPolys) ? bastionPolys : [];
  const out = new Array(input.length);

  const stats = {
    n: input.length,
    ok: 0,
    repaired: 0,
    degenerate: 0,
    nulls: 0,
    failed: 0,
    reasons: {}, // reason -> count
  };

  for (let i = 0; i < input.length; i++) {
    const poly = input[i];

    if (!Array.isArray(poly) || poly.length < 3) {
      out[i] = poly;
      stats.nulls++;
      continue;
    }

    const p0 = ensureWinding(poly, wantCCW);

    const a = polyAreaSigned(p0);
    if (!Number.isFinite(a) || Math.abs(a) < areaEps) {
      out[i] = p0;
      stats.degenerate++;
      continue;
    }

    const res = repairOne(p0, repairOpts) || { ok: false, reason: "repairOne returned null" };

    if (res.ok && Array.isArray(res.poly) && res.poly.length >= 3) {
      const p1 = ensureWinding(res.poly, wantCCW);
      out[i] = p1;

      // Count as repaired only if it changed reference or length differs; otherwise ok.
      const changed = (p1 !== p0) || (p1.length !== p0.length);
      if (changed) stats.repaired++;
      else stats.ok++;
    } else {
      out[i] = p0;
      stats.failed++;

      const r = (res && res.reason) ? String(res.reason) : "unknown";
      stats.reasons[r] = (stats.reasons[r] || 0) + 1;
    }
  }

  return { bastionPolysOut: out, convexStats: stats };
}

/**
 * “Check-only” wrapper that runs the same pipeline but sets repaired==0 unless repairOne mutates.
 * In practice Stage 110 can use this after sliding repair to refresh stats.
 *
 * @param {object} args - same as repairBastionsStrictConvex
 * @returns {{ bastionPolysOut: Poly[], convexStats: object }}
 */
export function checkBastionsStrictConvex(args = {}) {
  return repairBastionsStrictConvex(args);
}
