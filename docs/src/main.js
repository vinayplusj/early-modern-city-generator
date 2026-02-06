import { generate } from "./model/generate.js";
import { render } from "./render/render.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function resizeCanvasToDevicePixels() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

function getInputs() {
  return {
    seed: Number(document.getElementById("seed").value) || 1,
    bastions: Number(document.getElementById("bastions").value) || 8,
    gates: Number(document.getElementById("gates").value) || 3,
  };
}

let model = null;

function regenerate() {
  const { w, h } = resizeCanvasToDevicePixels();
  const { seed, bastions, gates } = getInputs();

  console.log("REGEN", { seed, bastions, gates, w, h });

  model = generate(seed, bastions, gates, w, h);
  window.model = model; // debug
  render(ctx, model);
}

// Wire events ONCE
document.getElementById("regen").addEventListener("click", regenerate);
document.getElementById("seed").addEventListener("change", regenerate);
document.getElementById("bastions").addEventListener("change", regenerate);
document.getElementById("gates").addEventListener("change", regenerate);

// Debounced resize (prevents 3–5 regen calls during layout settle)
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(regenerate, 100);
});

// Initial render
regenerate();
