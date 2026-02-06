// docs/src/render/render.js
//
// Canvas renderer for Milestone 3.4.
// Expects a model object from docs/src/model/generate.js.
// This renderer draws:
// - footprint + outer boundary
// - New Town polygon + streets + main avenue connector
// - glacis + ditch rings
// - ravelins
// - wall + wallBase + inner rings
// - road graph (primary and secondary)
// - gates + primaryGate marker
// - citadel + landmarks (square + market)
//
// Notes:
// - No external assets.
// - Uses CSS pixel coordinates (ctx already scaled in main.js).

import { pointInPoly } from "../geom/poly.js";

// ---------- Basic drawing helpers ----------
function drawPoly(ctx, poly, close = true) {
  if (!poly || poly.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  if (close) ctx.closePath();
}

function drawCircle(ctx, p, r) {
  if (!p) return;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
}

function strokePolyline(ctx, pts, width) {
  if (!pts || pts.length < 2) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function normalize(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function perp(a) {
  return { x: -a.y, y: a.x };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(a, s) {
  return { x: a.x * s, y: a.y * s };
}

// Gatehouse icon (simple block + towers)
function drawGatehouse(ctx, gate, centre, size) {
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

  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const towerRad = size * 0.28;
  const towerL = add(p, mul(side, -w));
  const towerR = add(p, mul(side, w));

  ctx.beginPath();
  ctx.arc(towerL.x, towerL.y, towerRad, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(towerR.x, towerR.y, towerRad, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

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
  } = model || {};

  // Background
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Footprint fill
  if (footprint && footprint.length >= 3) {
    ctx.fillStyle = "#151515";
    drawPoly(ctx, footprint, true);
    ctx.fill();
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
      ctx.lineWidth = 2.0;
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
    ctx.fillStyle = "#ffffff";
    drawCircle(ctx, primaryGate, 6);
    ctx.fill();
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

  // Landmarks: Main square + market
  // Ensure visibility: draw them regardless, but keep them inside wallBase when possible.
  const squareOk =
    squareCentre &&
    (!wallBase || wallBase.length < 3 || pointInPoly(squareCentre, wallBase));

  const marketOk =
    marketCentre &&
    (!wallBase || wallBase.length < 3 || pointInPoly(marketCentre, wallBase));

  if (squareOk) {
    ctx.fillStyle = "#222222";
    drawCircle(ctx, squareCentre, (squareR || 10) * 0.95);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    drawCircle(ctx, squareCentre, (squareR || 10) * 0.95);
    ctx.stroke();
  }

  if (marketOk) {
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, marketCentre, 3);
    ctx.fill();
  }

  // Centre marker (reference)
  if (centre) {
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, centre, 2.5);
    ctx.fill();
  }
}
