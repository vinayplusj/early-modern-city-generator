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
    stroke = "rgba(255,255,255,1.0)",
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
    bastionHull, // ---- Debug: convex envelope of all bastions (post-warp, post-clamp) ----
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
    fortHulls: model?.fortHulls ?? null,
  });
  
  // ---- Debug: ward-derived fort hulls (from model.fortHulls) ----
  {
    const fh = model?.fortHulls ?? null;

    const inner = fh?.innerHull?.outerLoop || null;
    const outer = fh?.outerHull?.outerLoop || null;

    // Inner hull (core wards boundary)
    drawPolyline(ctx, inner, {
      stroke: "rgba(255,0,255,1.0)",
      width: 2,
      closed: true,
    });

    // Outer hull (core + ring1 wards boundary)
    drawPolyline(ctx, outer, {
      stroke: "rgba(0,255,255,0.0)", // temporary debug
      width: 2,
      closed: true,
    });
  }

  // ---- Debug: highlight core wards and ring1 wards (no window coupling) ----
  {
    const fh = model?.fortHulls ?? null;

    // Core = plaza + inner + citadel
    const coreIds = new Set(fh?.coreIds || []);

    // Ring1 = wards that sit between innerHull and outerHull.
    // Prefer the geometry-valid set when present, so we do not silently skip bad polys.
    const ring1Raw = (Array.isArray(fh?.ring1IdsForHull) && fh.ring1IdsForHull.length > 0)
      ? fh.ring1IdsForHull
      : (fh?.ring1Ids || []);
    const ring1Ids = new Set(ring1Raw);

    const wards = model?.wards || [];

    for (const w of wards) {
      const poly =
        (Array.isArray(w?.poly) && w.poly.length >= 3) ? w.poly :
        (Array.isArray(w?.polygon) && w.polygon.length >= 3) ? w.polygon :
        null;

      if (!poly) continue;

      const isCore = coreIds.has(w.id);
      const isRing1 = ring1Ids.has(w.id);

      // Only highlight core + ring1. Everything else is left untouched.
      if (!isCore && !isRing1) continue;

      ctx.save();

      if (isCore) {
        // Core wards (inside inner hull)
        ctx.fillStyle = "rgba(255,0,255,0.10)";
        ctx.strokeStyle = "rgba(255,0,255,0.80)";
        ctx.lineWidth = 2.0;
      } else {
        // Ring1 wards (between inner and outer hull)
        ctx.fillStyle = "rgba(0,255,255,0.10)";
        ctx.strokeStyle = "rgba(0,255,255,0.80)";
        ctx.lineWidth = 2.5;
      }

      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();

      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
  }

  drawRoadGraph(ctx, { roadGraph });

  drawGatesAndPrimaryGate(ctx, { gates, primaryGate, cx, cy, squareR });

  drawCitadel(ctx, { citadel, anchors: A });
  // ---- Wards debug overlay (ids + unique-edge overlay) ----
  // This must be called, otherwise wards_debug.js will never render.

  drawLandmarksAndCentre(ctx, {
    wallBase,
    outerBoundary,
    squareR,
    anchors: A,
    site,
  });
  // ---- Debug: draw wards overlay LAST so ids/edges are on top ----
    drawWardsDebug(ctx, {
    wards: model?.wards || [],
    wardSeeds: model?.wardSeeds || [],
    wardRoleIndices: model?.wardRoleIndices || null,
    anchors: A,
    hideWardIds: false,
  });
}
