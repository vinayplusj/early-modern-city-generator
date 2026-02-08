// docs/src/render/icons/gatehouse.js
// Gatehouse icon rendering.

import { drawPoly, drawCircle } from "../helpers/draw.js";
import { add, mul, perp, normalize } from "../helpers/vector.js";

// Gatehouse icon (simple block + towers)
export function drawGatehouse(ctx, gate, centre, size) {
  if (!gate || !centre) return;

  const out = normalize({ x: gate.x - centre.x, y: gate.y - centre.y });
  const side = normalize(perp(out));

  const w = size * 1.2;
  const d = size * 0.7;

  const p = add(gate, mul(out, size * 0.35));

  const tl = add(add(p, mul(side, -w)), mul(out, -d));
  const tr = add(add(p, mul(side, w)), mul(out, -d));
  const br = add(add(p, mul(side, w)), mul(out, d));
  const bl = add(add(p, mul(side, -w)), mul(out, d));

  ctx.save();
  ctx.fillStyle = "#0f0f0f";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;

  // Main block
  drawPoly(ctx, [tl, tr, br, bl], true);
  ctx.fill();
  ctx.stroke();

  // Towers
  const t1 = add(p, mul(side, -w * 0.85));
  const t2 = add(p, mul(side, w * 0.85));
  drawCircle(ctx, t1, size * 0.35);
  ctx.fill();
  ctx.stroke();
  drawCircle(ctx, t2, size * 0.35);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
