// docs/src/render/stages/background.js

export function drawBackground(ctx) {
  // Background (robust clear even if caller applied transforms)
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#333333";
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}
