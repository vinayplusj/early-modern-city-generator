// docs/src/model/util/circular.js
export function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  let t = a % twoPi;
  if (t < 0) t += twoPi;
  return t;
}

export function circularDistance(a, b) {
  const twoPi = Math.PI * 2;
  let d = Math.abs(wrapAngle(a) - wrapAngle(b));
  if (d > Math.PI) d = twoPi - d;
  return d;
}

export function minimalCoveringArc(angles) {
  if (!Array.isArray(angles) || angles.length === 0) return [0, 0];

  const A = angles
    .filter((x) => Number.isFinite(x))
    .map(wrapAngle)
    .sort((a, b) => a - b);

  if (A.length === 0) return [0, 0];
  if (A.length === 1) return [A[0], A[0]];

  let bestGap = -Infinity;
  let bestIdx = 0;
  const TWO_PI = Math.PI * 2;

  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = A[(i + 1) % A.length];
    const gap = (b - a + TWO_PI) % TWO_PI;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  const start = A[(bestIdx + 1) % A.length];
  const end = A[bestIdx];
  return [start, end];
}

export function anglesFromPolygonAroundCentre(poly, centre) {
  if (!Array.isArray(poly) || poly.length < 3 || !centre) return [0, 0];
  const angles = [];
  for (const p of poly) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    angles.push(Math.atan2(p.y - centre.y, p.x - centre.x));
  }
  return minimalCoveringArc(angles);
}
