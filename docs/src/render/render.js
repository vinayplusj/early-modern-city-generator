// docs/src/render/render.js
//
// Canvas renderer for Milestone 3.4.
// Expects a model object from docs/src/model/generate.js.
//
// Draw order (important for visibility):
// 1) background + water + footprint + outer boundary
// 2) New Town polygon + streets
// 3) glacis + ditch rings + ravelins
// 4) walls + rings
// 5) road graph
// 6) gates + primary gate
// 7) citadel
// 8) landmarks (square + market + docks) LAST so they are always visible
// 9) centre marker (reference)

import { drawBackground } from "./stages/background.js";
import { drawWater } from "./stages/water.js";
import { drawFootprintAndDebugOverlays } from "./stages/footprint_debug.js";
import { drawBoundaryAndNewTown } from "./stages/boundary_newtown.js";
import { drawMoatworksAndRavelins } from "./stages/moatworks_ravelins.js";
import { drawWallsAndRingsAndWarp } from "./stages/walls_rings_warp.js";
import { drawRoadGraph } from "./stages/roads.js";
import { drawGatesAndPrimaryGate } from "./stages/gates.js";
import { drawCitadel } from "./stages/citadel.js";
import { drawLandmarksAndCentre } from "./stages/landmarks.js";
import { drawWardsDebug } from "./stages/wards_debug.js";

function drawPolyline(ctx, poly, opts = {}) {
  if (!ctx || !Array.isArray(poly) || poly.length < 2) return;

  const {
    stroke = "rgba(255,255,255,0.9)",
    width = 2,
    closed = true,
  } = opts;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;

  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);

  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ---------- Public render ----------
export function render(ctx, model) {
  const {
    footprint,
    outerBoundary,
    site,
    water,

    wall,
    wallBase,
    wallCurtain,
    bastionPolys,
    bastionHull,
    ring,
    ring2,

    ditchOuter,
    ditchInner,
    glacisOuter,

    ravelins,

    cx,
    cy,
    squareR,
    citadel,
    anchors,

    roadGraph,
    newTown,
    blocks,
    warp,
  } = model || {};

  const A = anchors || {};

  const gates = A.gates || null;
  const primaryGate = A.primaryGate || null;

  drawBackground(ctx);
  drawWater(ctx, { water });

  drawFootprintAndDebugOverlays(ctx, {
    footprint,
    outerBoundary,
    districts: model?.districts,
    blocks: null,
  });

  drawWardsDebug(ctx, {
    wards: model?.wards,
    wardSeeds: model?.wardSeeds,
    wardRoleIndices: model?.wardRoleIndices,
    anchors: A,
  });

  drawBoundaryAndNewTown(ctx, { outerBoundary, newTown });

  drawMoatworksAndRavelins(ctx, { glacisOuter, ditchOuter, ditchInner, ravelins });

  drawWallsAndRingsAndWarp(ctx, {
    wall,
    wallBase,
    wallCurtain,
    bastionPolys,
    ring,
    ring2,
    warp,
  });

  // ---- Debug: convex envelope of all bastions (post-warp, post-clamp) ----
  drawPolyline(ctx, bastionHull, {
    stroke: "rgba(255,255,0,0.95)", // bright yellow for visibility
    width: 3,
    closed: true,
  });
  
    // ---- Debug: ward-derived fort hulls ----
    if (typeof window !== "undefined") {
      const fh = window.__wardDebug?.last?.fortHulls;
  
      const inner = fh?.innerHull?.outerLoop;
      const outer = fh?.outerHull?.outerLoop;
  
      // Inner hull (core wards boundary)
      drawPolyline(ctx, inner, {
        stroke: "rgba(255,0,255,0.9)",
        width: 2,
        closed: true,
      });
  
      // Outer hull (core + ring1 wards boundary)
      drawPolyline(ctx, outer, {
        stroke: "rgba(0,180,255,0.6)",
        width: 2,
        closed: true,
      });
    }

  if (typeof window !== "undefined") {
    const fh = window.__wardDebug?.last?.fortHulls;
    const coreIds = new Set(fh?.coreIds || []);
    const ring1Ids = new Set(fh?.ring1Ids || []);
  
    const wards = window.model?.wards || [];
  
    for (const w of wards) {
      const poly = w?.poly;
      if (!Array.isArray(poly) || poly.length < 3) continue;
  
      let fill = null;
      if (coreIds.has(w.id)) fill = "rgba(255,0,255,0.30)";     // core = cyan tint
      else if (ring1Ids.has(w.id)) fill = "rgba(0,255,255,0.30)"; // ring1 = magenta tint
      else continue;
  
      ctx.save();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawRoadGraph(ctx, { roadGraph });

  drawGatesAndPrimaryGate(ctx, { gates, primaryGate, cx, cy, squareR });

  drawCitadel(ctx, { citadel, anchors: A });

  drawLandmarksAndCentre(ctx, {
    wallBase,
    outerBoundary,
    squareR,
    anchors: A,
    site,
  });
 
}
