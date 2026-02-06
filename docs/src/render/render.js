// src/render/render.js
//
// Canvas renderer for the city model.
// Keeps visuals close to your current monolithic implementation, but packaged as an ES module.
//
// Exports:
// - render(ctx, model)
//
// Notes:
// - Expects ctx already set up with correct transform for DPR (your app.js does that).
// - Uses helper drawing routines local to this file to keep imports minimal.

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

function drawGatehouse(ctx, gate, centre, size) {
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

  const towerR = size * 0.28;
  const towerL = add(p, mul(side, -w));
  const towerRgt = add(p, mul(side, w));

  ctx.beginPath();
  ctx.arc(towerL.x, towerL.y, towerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(towerRgt.x, towerRgt.y, towerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

export function render(ctx, model) {
  const {
    footprint,
    outerBoundary,
    wall,
    wallBase,
    gates,
    centre,
    squareR,
    ring,
    ring2,
    roadGraph,
    squareCentre,
    marketCentre,
    citadel,
    citCentre,
    ravelins,
    newTown,
    primaryGate,
    cx,
    cy,
    ditchOuter,
    ditchInner,
    glacisOuter,
  } = model || {};

  if (!ctx || !ctx.canvas) return;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Footprint
  if (footprint && footprint.length >= 3) {
    ctx.fillStyle = "#151515";
    drawPoly(ctx, footprint, true);
    ctx.fill();
  }

  // Outer boundary hull
  if (outerBoundary && outerBoundary.length >= 3) {
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 2;
    drawPoly(ctx, outerBoundary, true);
    ctx.stroke();
  }

  // New Town polygon + streets
  if (newTown && newTown.poly && newTown.poly.length >= 3) {
    ctx.fillStyle = "#131313";
    drawPoly(ctx, newTown.poly, true);
    ctx.fill();

    // streets
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

    // connection to primary gate (visual emphasis)
    if (newTown.gateOut && primaryGate && newTown.mainAve && newTown.mainAve.length >= 2) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(primaryGate.x, primaryGate.y);
      ctx.lineTo(newTown.mainAve[1].x, newTown.mainAve[1].y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 2;
    drawPoly(ctx, newTown.poly, true);
    ctx.stroke();
  }

  // Glacis / ditch
  if (glacisOuter && glacisOuter.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#242424";
    ctx.lineWidth = 2;
    drawPoly(ctx, glacisOuter, true);
    ctx.stroke();
    ctx.restore();
  }

  if (ditchOuter && ditchInner && ditchOuter.length >= 3 && ditchInner.length >= 3) {
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

  // Main wall
  if (wall && wall.length >= 3) {
    ctx.strokeStyle = "#d9d9d9";
    ctx.lineWidth = 3;
    drawPoly(ctx, wall, true);
    ctx.stroke();
  }

  // Wall base
  if (wallBase && wallBase.length >= 3) {
    ctx.strokeStyle = "#9a9a9a";
    ctx.lineWidth = 1.5;
    drawPoly(ctx, wallBase, true);
    ctx.stroke();
  }

  // Inner ring (primary boulevard)
  if (ring && ring.length >= 3) {
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2;
    drawPoly(ctx, ring, true);
    ctx.stroke();
  }

  // Second ring
  if (ring2 && ring2.length >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 1.25;
    drawPoly(ctx, ring2, true);
    ctx.stroke();
    ctx.restore();
  }

  // Roads (from roadGraph)
  if (roadGraph && roadGraph.nodes && roadGraph.edges) {
    const nodeById = new Map(roadGraph.nodes.map(n => [n.id, n]));

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

  // Gates
  if (gates && gates.length) {
    for (const g of gates) {
      if (!g) continue;
      drawGatehouse(ctx, g, { x: cx, y: cy }, (squareR || 10) * 0.55);

      ctx.fillStyle = "#ffffff";
      drawCircle(ctx, g, 3.5);
      ctx.fill();
    }
  }

  // Primary gate highlight
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

  // Landmarks: square and market
  if (squareCentre) {
    ctx.fillStyle = "#222222";
    drawCircle(ctx, squareCentre, (squareR || 10) * 0.95);
    ctx.fill();

    ctx.strokeStyle = "#efefef";
    ctx.lineWidth = 2;
    drawCircle(ctx, squareCentre, (squareR || 10) * 0.95);
    ctx.stroke();
  }

  if (marketCentre) {
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, marketCentre, 3);
    ctx.fill();
  }

  // Centre marker (keep as reference)
  if (centre) {
    ctx.fillStyle = "#efefef";
    drawCircle(ctx, centre, 2.5);
    ctx.fill();
  }
}
