export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
export function perp(a) { return { x: -a.y, y: a.x }; }

export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
export function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

export function rotate(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function polar(cx, cy, angle, radius) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
