// docs/src/model/invariants.js
export function assertFinitePoint(p, name) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new Error("Invalid point: " + name);
  }
}

export function assertDistinctPoints(a, b, minDist, nameA, nameB) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < minDist * minDist) {
    throw new Error("Points too close: " + nameA + " vs " + nameB);
  }
}
