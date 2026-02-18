// docs/src/render/stages/wards_debug.js
// Debug renderer for Voronoi wards.

import { drawCircle, drawPoly } from "../helpers/draw.js";

// Palette chosen to remain readable over the dark footprint fill.
const ROLE_STYLES = {
  plaza: { fill: "#ffffff", stroke: "#ffffff", alphaFill: 0.10, alphaStroke: 0.40 },
  citadel: { fill: "#ffdd55", stroke: "#ffdd55", alphaFill: 0.10, alphaStroke: 0.45 },
  inner: { fill: "#7dffb2", stroke: "#7dffb2", alphaFill: 0.06, alphaStroke: 0.30 },
  new_town: { fill: "#5ddcff", stroke: "#5ddcff", alphaFill: 0.06, alphaStroke: 0.30 },
  slums: { fill: "#ff7d7d", stroke: "#ff7d7d", alphaFill: 0.06, alphaStroke: 0.30 },
  farms: { fill: "#ffd36b", stroke: "#ffd36b", alphaFill: 0.06, alphaStroke: 0.30 },
  plains: { fill: "#d7d7d7", stroke: "#d7d7d7", alphaFill: 0.05, alphaStroke: 0.25 },
  woods: { fill: "#c08bff", stroke: "#c08bff", alphaFill: 0.05, alphaStroke: 0.25 },
  default: { fill: "#ffffff", stroke: "#ffffff", alphaFill: 0.04, alphaStroke: 0.18 },
};

function styleForRole(role) {
  if (role && ROLE_STYLES[role]) return ROLE_STYLES[role];
  return ROLE_STYLES.default;
}

function pointAtId(wards, id) {
  if (!wards || id == null) return null;
  const w = wards.find((x) => x && x.id === id);
  return w?.seed || w?.centroid || null;
}

function drawLabel(ctx, text, x, y) {
  ctx.save();

  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const padX = 6;
  const padY = 3;
  const m = ctx.measureText(text);
  const w = Math.ceil(m.width) + padX * 2;
  const h = 14 + padY * 2;

  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#000000";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);

  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000000";
  ctx.strokeText(text, x, y);

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);

  ctx.restore();
}

export function drawWardsDebug(ctx, { wards, wardSeeds, wardRoleIndices, anchors, hideWardIds }) {
  const hide = (hideWardIds instanceof Set)
    ? hideWardIds
    : new Set(Array.isArray(hideWardIds) ? hideWardIds : []);

  const hasWards = Array.isArray(wards) && wards.length > 0;
  if (!hasWards) return;

  // 1) Ward polygons (fill + outline), skipping hidden wards
  ctx.save();
  ctx.lineWidth = 1;

  for (const w of wards) {
    if (!w || !w.poly || w.poly.length < 3) continue;
    if (Number.isFinite(w.id) && hide.has(w.id)) continue;

    const st = styleForRole(w.role);
    ctx.globalAlpha = st.alphaFill;
    ctx.fillStyle = st.fill;
    drawPoly(ctx, w.poly, true);
    ctx.fill();
  }

  for (const w of wards) {
    if (!w || !w.poly || w.poly.length < 3) continue;
    if (Number.isFinite(w.id) && hide.has(w.id)) continue;

    const st = styleForRole(w.role);
    ctx.globalAlpha = st.alphaStroke;
    ctx.strokeStyle = st.stroke;
    drawPoly(ctx, w.poly, true);
    ctx.stroke();
  }

  ctx.restore();

  // 2) Ward seeds (draw from wards so we can skip hidden wards)
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#ffffff";

  for (const w of wards) {
    if (!w || !w.seed) continue;
    if (Number.isFinite(w.id) && hide.has(w.id)) continue;

    drawCircle(ctx, w.seed, 2);
    ctx.fill();
  }

  ctx.restore();

  // NOTE: Do NOT draw wardSeeds[] here, because it cannot be filtered by ward id.
  // If you still need wardSeeds for some other mode, gate it behind a flag.

  // 3) Highlight plaza and citadel (anchors first, fallback to wardRoleIndices)
  const plazaP =
    (anchors && anchors.plaza) ||
    (wardRoleIndices ? pointAtId(wards, wardRoleIndices.plaza) : null);

  const citadelP =
    (anchors && anchors.citadel) ||
    (wardRoleIndices ? pointAtId(wards, wardRoleIndices.citadel) : null);

  if (plazaP || citadelP) {
    ctx.save();
    ctx.lineWidth = 2;

    if (plazaP) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ROLE_STYLES.plaza.stroke;
      drawCircle(ctx, plazaP, 7);
      ctx.stroke();
      drawLabel(ctx, "PLAZA", plazaP.x, plazaP.y);
    }

    if (citadelP) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = ROLE_STYLES.citadel.stroke;
      drawCircle(ctx, citadelP, 7);
      ctx.stroke();
      drawLabel(ctx, "CITADEL", citadelP.x, citadelP.y);
    }

    ctx.restore();
  }
}
