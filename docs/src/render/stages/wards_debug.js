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

export function drawWardsDebug(ctx, { wards, wardSeeds, wardRoleIndices }) {
  const hasWards = Array.isArray(wards) && wards.length > 0;
  const hasSeeds = Array.isArray(wardSeeds) && wardSeeds.length > 0;

  if (!hasWards && !hasSeeds) return;

  // 1) Ward polygons
  if (hasWards) {
    ctx.save();
    ctx.lineWidth = 1;

    // Fill pass
    for (const w of wards) {
      if (!w || !w.poly || w.poly.length < 3) continue;
      const st = styleForRole(w.role);
      ctx.globalAlpha = st.alphaFill;
      ctx.fillStyle = st.fill;
      drawPoly(ctx, w.poly, true);
      ctx.fill();
    }

    // Stroke pass
    for (const w of wards) {
      if (!w || !w.poly || w.poly.length < 3) continue;
      const st = styleForRole(w.role);
      ctx.globalAlpha = st.alphaStroke;
      ctx.strokeStyle = st.stroke;
      drawPoly(ctx, w.poly, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 2) Seed points
  if (hasSeeds) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";

    for (const s of wardSeeds) {
      if (!s) continue;
      drawCircle(ctx, s, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 3) Highlight plaza and citadel seed points (if available)
  if (hasWards && wardRoleIndices) {
    const plazaP = pointAtId(wards, wardRoleIndices.plaza);
    const citadelP = pointAtId(wards, wardRoleIndices.citadel);

    ctx.save();
    ctx.lineWidth = 2;

    if (plazaP) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ROLE_STYLES.plaza.stroke;
      drawCircle(ctx, plazaP, 7);
      ctx.stroke();
    }

    if (citadelP) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = ROLE_STYLES.citadel.stroke;
      drawCircle(ctx, citadelP, 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 4) Optional role labels at centroids (kept subtle)
  if (hasWards) {
    ctx.save();
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const w of wards) {
      const c = w?.centroid;
      if (!c) continue;
      if (!w.role) continue;

      // Keep labels sparse: only key roles by default.
      if (w.role !== "plaza" && w.role !== "citadel") continue;

      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(w.role.toUpperCase(), c.x, c.y);
    }

    ctx.restore();
  }
}
