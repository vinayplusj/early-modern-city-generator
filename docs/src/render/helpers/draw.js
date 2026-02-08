// docs/src/render/helpers/draw.js
// Small canvas drawing helpers.

export function drawPoly(ctx, poly, close = true) {
  if (!poly || poly.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  if (close) ctx.closePath();
}

export function drawCircle(ctx, p, r) {
  if (!p) return;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
}

export function strokePolyline(ctx, pts, width) {
  if (!pts || pts.length < 2) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
