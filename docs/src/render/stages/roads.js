// docs/src/render/stages/roads.js

function drawPolylineList(ctx, roads, { strokeStyle, lineWidth, globalAlpha }) {
  if (!ctx || !Array.isArray(roads) || roads.length === 0) return;

  ctx.save();
  ctx.globalAlpha = globalAlpha;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;

  for (const poly of roads) {
    if (!Array.isArray(poly) || poly.length < 2) continue;

    const p0 = poly[0];
    const p1 = poly[poly.length - 1];
    if (!p0 || !p1) continue;

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i];
      if (!p) continue;
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw polyline roads (Stage 140 / Stage 7 style).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} args
 * @param {Array<Array<{x:number,y:number}>>} args.roads
 * @param {"primary"|"secondary"} args.kind
 */
export function drawRoadPolylines(ctx, { roads, kind }) {
  const isPrimary = kind === "primary";

  drawPolylineList(ctx, roads, {
    strokeStyle: isPrimary ? "#c9b07b" : "#c9b07b",
    lineWidth: isPrimary ? 2.0 : 1.0,
    globalAlpha: isPrimary ? 0.95 : 0.70,
  });
}

/**
 * Draw a normalised roadGraph (Milestone 8+).
 * Existing API preserved.
 */
export function drawRoadGraph(ctx, { roadGraph }) {
  if (!roadGraph || !roadGraph.nodes || !roadGraph.edges) return;

  const nodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));

  // Secondary first
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.strokeStyle = "#c9b07b";

  for (const e of roadGraph.edges) {
    if (!e || e.kind !== "secondary") continue;

    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) continue;

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
  ctx.strokeStyle = "#c9b07b";

  for (const e of roadGraph.edges) {
    if (!e || e.kind !== "primary") continue;

    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) continue;

    ctx.lineWidth = e.width || 2.0;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Optional wrapper: draw roads from either roadGraph or polylines.
 * This keeps render code simple and guarantees consistent styling.
 */
export function drawRoadLayers(ctx, { roadGraph, primaryRoads, secondaryRoads }) {
  if (roadGraph) {
    drawRoadGraph(ctx, { roadGraph });
    return;
  }

  drawRoadPolylines(ctx, { roads: secondaryRoads, kind: "secondary" });
  drawRoadPolylines(ctx, { roads: primaryRoads, kind: "primary" });
}
