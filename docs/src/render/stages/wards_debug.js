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

function computeBboxFromWards(wards) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of wards) {
    const poly = w?.poly;
    if (!Array.isArray(poly) || poly.length < 2) continue;
    for (const p of poly) {
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function buildWardEdgeMap(wards, hideSet) {
  const bbox = computeBboxFromWards(wards);
  if (!bbox) return { edges: [], boundaryEdges: [] };

  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  // Deterministic quantisation epsilon based on scene size.
  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  const keyOf = (p) => `${Math.round(p.x * inv)},${Math.round(p.y * inv)}`;
  const edgeKey = (aKey, bKey) => (aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`);

  // edgeKey -> { a:{x,y}, b:{x,y}, owners:number }
  const map = new Map();

  for (const w of wards) {
    const id = w?.id;
    if (Number.isFinite(id) && hideSet && hideSet.has(id)) continue;

    const poly = w?.poly;
    if (!Array.isArray(poly) || poly.length < 3) continue;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;

      const aKey = keyOf(a);
      const bKey = keyOf(b);
      if (aKey === bKey) continue;

      const k = edgeKey(aKey, bKey);
      const entry = map.get(k);

      if (!entry) {
        map.set(k, { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, owners: 1 });
      } else {
        entry.owners += 1;
      }
    }
  }

  const edges = [];
  const boundaryEdges = [];

  for (const e of map.values()) {
    if (e.owners <= 1) boundaryEdges.push(e);
    else edges.push(e);
  }

  return { edges, boundaryEdges };
}

function drawWardEdgesOverlay(ctx, wards, hideSet) {
  const { edges, boundaryEdges } = buildWardEdgeMap(wards, hideSet);

  ctx.save();

  // Interior shared edges (draw once, high contrast).
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  for (const e of edges) {
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
  }
  ctx.stroke();

  // Boundary edges (slightly thicker, slightly brighter).
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2.25;

  ctx.beginPath();
  for (const e of boundaryEdges) {
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
  }
  ctx.stroke();

  ctx.restore();
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

  console.log("[wards_debug] running", {
    wardsLen: wards.length,
    hideWardIds,
    hideSetSize: hide.size,
    polyCount: wards.filter((w) => Array.isArray(w?.poly) && w.poly.length >= 3).length,
    polygonCount: wards.filter((w) => Array.isArray(w?.polygon) && w.polygon.length >= 3).length,
  });

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

  // 1b) Ward edges overlay (draw every unique edge once)
  // This makes shared borders visible even when role strokes blend into fills.
  drawWardEdgesOverlay(ctx, wards, hide);

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

  // 4) Ward ids (optional)
  if (!hideWardIds) {
    drawWardIds(ctx, wards, hide);
  }
 }

function drawWardIds(ctx, wards, hideSet) {
  if (!Array.isArray(wards) || wards.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "12px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 3;

  for (const w of wards) {
    const id = w?.id;
    if (!Number.isFinite(id)) continue;
    if (hideSet && hideSet.has(id)) continue;

    const p =
      (w?.centroid && Number.isFinite(w.centroid.x) && Number.isFinite(w.centroid.y))
        ? w.centroid
        : (w?.seed && Number.isFinite(w.seed.x) && Number.isFinite(w.seed.y))
        ? w.seed
        : null;

    if (!p) continue;

    const s = String(id);
    ctx.strokeText(s, p.x, p.y);
    ctx.fillText(s, p.x, p.y);
  }

  ctx.restore();
}
