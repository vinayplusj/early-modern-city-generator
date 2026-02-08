// docs/src/render/helpers/vector.js
// Minimal vector helpers used by render layers.

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function mul(a, s) {
  return { x: a.x * s, y: a.y * s };
}

export function perp(a) {
  return { x: -a.y, y: a.x };
}

export function normalize(v) {
  const d = Math.hypot(v.x, v.y);
  if (d < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / d, y: v.y / d };
}
