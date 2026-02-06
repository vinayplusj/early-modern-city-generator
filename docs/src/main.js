import { clamp } from "./geom/primitives.js";
import { generate } from "./model/generate.js";
import { render } from "./render/render.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const seedInput = document.getElementById("seed");
const bastionsInput = document.getElementById("bastions");
const gatesInput = document.getElementById("gates");
const regenBtn = document.getElementById("regen");

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor((window.innerHeight - 60) * dpr);
  canvas.style.height = (window.innerHeight - 60) + "px";
  canvas.style.width = window.innerWidth + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const seed = Math.max(1, parseInt(seedInput.value || "1", 10));
  const bastions = clamp(parseInt(bastionsInput.value || "9", 10), 5, 14);
  const gates = clamp(parseInt(gatesInput.value || "3", 10), 2, 6);

  const model = generate(seed, bastions, gates, window.innerWidth, window.innerHeight - 60);
  render(ctx, model);
}

regenBtn.addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000) + 1);
  draw();
});

seedInput.addEventListener("change", draw);
bastionsInput.addEventListener("change", draw);
gatesInput.addEventListener("change", draw);
window.addEventListener("resize", () => { resizeCanvas(); draw(); });

resizeCanvas();
draw();
