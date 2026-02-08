// docs/src/render/render.js
//
// Canvas renderer for Milestone 3.4.
// Expects a model object from docs/src/model/generate.js.
//
// Draw order (important for visibility):
// 1) background + footprint + outer boundary
// 2) New Town polygon + streets
// 3) glacis + ditch rings + ravelins
// 4) walls + rings
// 5) road graph
// 6) gates + primary gate
// 7) citadel
// 8) landmarks (square + market) LAST so they are always visible
// 9) centre marker (reference)

import { drawBackground } from "./stages/background.js";
import { drawFootprintAndDebugOverlays } from "./stages/footprint_debug.js";
import { drawBoundaryAndNewTown } from "./stages/boundary_newtown.js";
import { drawMoatworksAndRavelins } from "./stages/moatworks_ravelins.js";
import { drawWallsAndRingsAndWarp } from "./stages/walls_rings_warp.js";
import { drawRoadGraph } from "./stages/roads.js";
import { drawGatesAndPrimaryGate } from "./stages/gates.js";
import { drawCitadel } from "./stages/citadel.js";
import { drawLandmarksAndCentre } from "./stages/landmarks.js";

// ---------- Public render ----------
export function render(ctx, model) {
  const {
    footprint,
    outerBoundary,

    // Walls
    wall,
    wallBase,
    ring,
    ring2,

    // Moatworks
    ditchOuter,
    ditchInner,
    glacisOuter,

    // Features
    gates,
    primaryGate,
    ravelins,

    // Anchors
    cx,
    cy,
    centre,
    squareR,
    squareCentre,
    marketCentre,
    citadel,
    citCentre,

    // Roads
    roadGraph,

    // New Town
    newTown,
    blocks,
    warp,
  } = model || {};

  // 1) background
  drawBackground(ctx);

  // 1) footprint + debug overlays (districts + blocks) + outer boundary stroke
  drawFootprintAndDebugOverlays(ctx, {
    footprint,
    outerBoundary,
    districts: model?.districts,
    blocks,
  });

  // 2) New Town polygon + streets + main avenue
  drawBoundaryAndNewTown(ctx, {
    outerBoundary,
    newTown,
  });

  // 3) glacis + ditch rings + ravelins
  drawMoatworksAndRavelins(ctx, {
    glacisOuter,
    ditchOuter,
    ditchInner,
    ravelins,
  });

  // 4) walls + rings + warp overlay
  drawWallsAndRingsAndWarp(ctx, {
    wall,
    wallBase,
    ring,
    ring2,
    warp,
  });

  // 5) road graph
  drawRoadGraph(ctx, { roadGraph });

  // 6) gates + primary gate
  drawGatesAndPrimaryGate(ctx, {
    gates,
    primaryGate,
    cx,
    cy,
    squareR,
  });

  // 7) citadel
  drawCitadel(ctx, {
    citadel,
    citCentre,
  });

  // 8) landmarks LAST + 9) centre marker
  drawLandmarksAndCentre(ctx, {
    wallBase,
    centre,
    squareR,
    squareCentre,
    marketCentre,
  });
}
