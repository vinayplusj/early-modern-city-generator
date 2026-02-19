// docs/src/model/debug/fortwarp_audit.js
//
// Debug helpers for auditing radial clamp results in FortWarp.
// Behaviour must remain identical to the legacy inline helpers in generate.js.

function sampleOnRing(thetas, values, theta) {
  const n = thetas.length;
  if (!n) return null;
  const twoPi = Math.PI * 2;

  let a = theta % twoPi;
  if (a < 0) a += twoPi;

  const step = twoPi / n;
  const i0 = Math.floor(a / step) % n;
  const i1 = (i0 + 1) % n;
  const t0 = i0 * step;
  const u = (a - t0) / step;

  const v0 = values[i0];
  const v1 = values[i1];
  if (!Number.isFinite(v0) && !Number.isFinite(v1)) return null;
  if (!Number.isFinite(v0)) return v1;
  if (!Number.isFinite(v1)) return v0;
  return v0 + (v1 - v0) * u;
}

/**
 * Audit whether points in polys violate radial clamp targets.
 *
 * @param {object} args
 * @param {string} args.name
 * @param {Array<Array<{x:number,y:number}>>} args.polys
 * @param {object|null} args.minField
 * @param {object|null} args.maxField
 * @param {number} args.cx
 * @param {number} args.cy
 * @param {number} [args.minMargin]
 * @param {number} [args.maxMargin]
 * @param {boolean} args.debugEnabled
 */
export function auditRadialClamp({
  name,
  polys,
  minField,
  maxField,
  cx,
  cy,
  minMargin,
  maxMargin,
  debugEnabled,
}) {
  if (!debugEnabled) return;
  if ((!minField && !maxField) || !Array.isArray(polys)) return;

  let belowMin = 0;
  let aboveMax = 0;
  let total = 0;

  const offendersAbove = [];
  const maxShow = 8;
  let polyIdx = 0;

  for (const poly of polys) {
    if (!Array.isArray(poly)) { polyIdx += 1; continue; }

    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

      const dx = p.x - cx;
      const dy = p.y - cy;
      const r = Math.hypot(dx, dy);
      if (r < 1e-6) continue;

      const theta = Math.atan2(dy, dx);

      const rMinRaw = minField ? sampleOnRing(minField.thetas, minField.rTarget, theta) : null;
      const rMaxRaw = maxField ? sampleOnRing(maxField.thetas, maxField.rTarget, theta) : null;

      const rMin = Number.isFinite(rMinRaw) ? (rMinRaw + (minMargin || 0)) : null;
      const rMax = Number.isFinite(rMaxRaw) ? (rMaxRaw - (maxMargin || 0)) : null;

      if (Number.isFinite(rMin) && r < rMin - 1e-6) belowMin += 1;
      if (Number.isFinite(rMax) && r > rMax + 1e-6) aboveMax += 1;

      if (
        name === "BASTIONS" &&
        Number.isFinite(rMax) &&
        r > rMax + 1e-6 &&
        offendersAbove.length < maxShow
      ) {
        offendersAbove.push({
          polyIdx,
          ptIdx: i,
          excess: +(r - rMax).toFixed(3),
          r: +r.toFixed(3),
          rMax: +rMax.toFixed(3),
          x: +p.x.toFixed(2),
          y: +p.y.toFixed(2),
          theta: +theta.toFixed(4),
        });
      }

      total += 1;
    }

    polyIdx += 1;
  }

  if (offendersAbove.length) {
    console.warn("[FortWarp Audit]", name, "aboveMax sample", offendersAbove);
  }

  if (belowMin || aboveMax) {
    console.warn("[FortWarp Audit]", name, { belowMin, aboveMax, total });
  } else {
    console.info("[FortWarp Audit]", name, "OK", { total });
  }
}
