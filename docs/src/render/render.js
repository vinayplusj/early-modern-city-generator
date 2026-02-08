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

import { pointInPolyOrOn } from "../geom/poly.js";

import { drawPoly, drawCircle, strokePolyline } from "./helpers/draw.js";
import { drawGatehouse } from "./icons/gatehouse.js";

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

  // Background (robust clear even if caller applied transforms)
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();


  // Footprint fill
  if (footprint && footprint.length >= 3) {
    ctx.fillStyle = "#151515";
    drawPoly(ctx, footprint, true);
    ctx.fill();
  }

  // Districts (debug)
  if (model.districts && model.districts.length) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#ffffff";
    for (const d of model.districts) {
      if (!d.polygon || d.polygon.length < 3) continue;
      drawPoly(ctx, d.polygon, true);
      ctx.fill();
    }
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (const d of model.districts) {
      if (!d.polygon || d.polygon.length < 3) continue;
      drawPoly(ctx, d.polygon, true);
      ctx.stroke();
    }
    ctx.restore();
  }
  
  // Blocks (debug) coloured by district
  if (blocks && blocks.length) {
    const palette = [
      "#5ddcff", "#7dffb2", "#ffd36b", "#ff7d7d",
      "#c08bff", "#7dd7ff", "#9cff7d", "#ffb27d",
      "#7d7dff", "#b2ff7d", "#ff7dd7", "#d7d7d7",
    ];
  
    function hashIdToIndex(id, m) {
      const s = String(id || "");
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h % m;
    }
  
    ctx.save();
  
    // Fill
    ctx.globalAlpha = 0.18;
    for (const b of blocks) {
      if (!b || !b.polygon || b.polygon.length < 3) continue;
  
      if (!b.districtId) {
        ctx.fillStyle = "#ff00ff";
      } else {
        ctx.fillStyle = palette[hashIdToIndex(b.districtId, palette.length)];
      }
  
      drawPoly(ctx, b.polygon, true);
      ctx.fill();
    }
  
    // Outline
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (const b of blocks) {
      if (!b || !b.polygon || b.polygon.length < 3) continue;
  
      if (!b.districtId) {
        ctx.strokeStyle = "#ff00ff";
      } else {
        ctx.strokeStyle = palette[hashIdToIndex(b.districtId, palette.length)];
      }
  
      drawPoly(ctx, b.polygon, true);
      ctx.stroke();
    }
  
    ctx.restore();
  }

  // Outer boundary (convex hull) stroke
  if (outerBoundary && outerBoundary.length >= 3) {
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 2;
    drawPoly(ctx, outerBoundary, true);
    ctx.stroke();
  }

  // New Town (polygon + grid)
  if (newTown && newTown.poly && newTown.poly.length >= 3) {
    ctx.fillStyle = "#131313";
    drawPoly(ctx, newTown.poly, true);
    ctx.fill();

    // Streets
    if (newTown.streets && newTown.streets.length) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = "#8f8f8f";
      ctx.lineWidth = 1.5;
      for (const s of newTown.streets) {
        if (!s || s.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        ctx.lineTo(s[1].x, s[1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Main avenue within New Town
    if (newTown.mainAve && newTown.mainAve.length >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffffff";
      strokePolyline(ctx, newTown.mainAve, 2.0);
      ctx.restore();
    }

    // Outline
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 2;
    drawPoly(ctx, newTown.poly, true);
    ctx.stroke();
  }

  // Glacis ring
  if (glacisOuter && glacisOuter.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#242424";
    ctx.lineWidth = 2;
    drawPoly(ctx, glacisOuter, true);
    ctx.stroke();
    ctx.restore();
  }

  // Ditch rings
  if (ditchOuter && ditchOuter.length >= 3 && ditchInner && ditchInner.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.55;

    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 2;
    drawPoly(ctx, ditchOuter, true);
    ctx.stroke();

    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 2;
    drawPoly(ctx, ditchInner, true);
    ctx.stroke();

    ctx.restore();
  }

  // Ravelins
  if (ravelins && ravelins.length) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "#8a8a8a";
    ctx.lineWidth = 2;
    for (const rv of ravelins) {
      if (!rv || rv.length < 3) continue;
      drawPoly(ctx, rv, true);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Bastioned wall (final)
  if (wall && wall.length >= 3) {
    ctx.strokeStyle = "#d9d9d9";
    ctx.lineWidth = 3;
    drawPoly(ctx, wall, true);
    ctx.stroke();
  }

    // Warp overlay (debug)
  if (warp && warp.params && warp.params.debug && warp.wallOriginal && warp.wallWarped) {
    ctx.save();

    ctx.lineWidth = 2;

    // Original wall (dashed)
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([6, 4]);
    drawPoly(ctx, warp.wallOriginal, true);
    ctx.stroke();

    // Warped wall (solid)
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    drawPoly(ctx, warp.wallWarped, true);
    ctx.stroke();

    ctx.restore();
  }

  // Wall base (inner line)
  if (wallBase && wallBase.length >= 3) {
    ctx.strokeStyle = "#9a9a9a";
    ctx.lineWidth = 1.5;
    drawPoly(ctx, wallBase, true);
    ctx.stroke();
  }

  // Ring boulevard (primary)
  if (ring && ring.length >= 3) {
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2;
    drawPoly(ctx, ring, true);
    ctx.stroke();
  }

  // Second ring (secondary)
  if (ring2 && ring2.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 1.25;
    drawPoly(ctx, ring2, true);
    ctx.stroke();
    ctx.restore();
  }

  // Road graph
  if (roadGraph && roadGraph.nodes && roadGraph.edges) {
    const nodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));

    // Secondary first
    ctx.save();
    ctx.globalAlpha = 0.70;
    for (const e of roadGraph.edges) {
      if (e.kind !== "secondary") continue;
      const a = nodeById.get(e.a);
      const b = nodeById.get(e.b);
      if (!a || !b) continue;

      ctx.strokeStyle = "#cfcfcf";
      ctx.lineWidth = e.width || 1.0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // Primary on top
    ctx.save();
    ctx.globalAlpha = 0.95;
    for (const e of roadGraph.edges) {
      if (e.kind !== "primary") continue;
      const a = nodeById.get(e.a);
      const b = nodeById.get(e.b);
      if (!a || !b) continue;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = e.width || 2.0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Gates + markers
  if (gates && gates.length) {
    for (const g of gates) {
      drawGatehouse(ctx, g, { x: cx, y: cy }, (squareR || 10) * 0.55);
      ctx.fillStyle = "#ffffff";
      drawCircle(ctx, g, 3.5);
      ctx.fill();
    }
  }

  if (primaryGate) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, primaryGate, 6);
    ctx.fill();
    ctx.restore();
  }

  // Citadel
  if (citadel && citadel.length >= 3) {
    ctx.fillStyle = "#101010";
    drawPoly(ctx, citadel, true);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    drawPoly(ctx, citadel, true);
    ctx.stroke();

    if (citCentre) {
      ctx.fillStyle = "#ffffff";
      drawCircle(ctx, citCentre, 2.5);
      ctx.fill();
    }
  }

  // ---------- Landmarks (ALWAYS LAST) ----------
  // Use pointInPolyOrOn so points on the wall line still render.
  const squareInside =
    squareCentre &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(squareCentre, wallBase, 1e-6));

  const marketInside =
    marketCentre &&
    (!wallBase || wallBase.length < 3 || pointInPolyOrOn(marketCentre, wallBase, 1e-6));

  // Square (disc + outline + subtle halo)
  if (squareInside) {
    const r = (squareR || 10) * 0.95;

    // Halo behind
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, squareCentre, r * 1.15);
    ctx.fill();
    ctx.restore();

    // Main fill
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#1a1a1a";
    drawCircle(ctx, squareCentre, r);
    ctx.fill();

    // Outline
    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2.5;
    drawCircle(ctx, squareCentre, r);
    ctx.stroke();
    ctx.restore();
  }

  // Market (bigger, with outline + halo so it cannot disappear under roads)
  if (marketInside) {
    const r = Math.max(4, (squareR || 10) * 0.22);

    // Halo
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, marketCentre, r * 1.9);
    ctx.fill();
    ctx.restore();

    // Core dot
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#0f0f0f";
    drawCircle(ctx, marketCentre, r);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    drawCircle(ctx, marketCentre, r);
    ctx.stroke();
    ctx.restore();
  }

  // Centre marker (reference)
  if (centre) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, centre, 2.5);
    ctx.fill();
    ctx.restore();
  }
}
