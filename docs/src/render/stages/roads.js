// docs/src/render/stages/roads.js

export function drawRoadGraph(ctx, { roadGraph }) {
  if (!roadGraph || !roadGraph.nodes || !roadGraph.edges) return;

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
