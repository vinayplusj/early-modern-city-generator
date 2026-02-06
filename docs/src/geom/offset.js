// src/geom/offset.js
// Radial offsetting and related helpers.
// Keeps behaviour identical to your inlined offsetRadial(poly, cx, cy, offset).

export function offsetRadial(poly, cx, cy, offset) {
  if (!poly || poly.length < 2) return poly || [];
  return poly.map((p) => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;
    return { x: p.x + ux * offset, y: p.y + uy * offset };
  });
}
