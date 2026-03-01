if (window.__EMCG_BOOTED__) {
  console.warn("main.js loaded twice");
  // Prevent duplicate listeners and double rendering loops.
  throw new Error("main.js loaded twice");
}
window.__EMCG_BOOTED__ = 1;

console.log("BOOT COUNT", window.__EMCG_BOOTED__);

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

function computeBastionTargetN({ w, h, density }) {
  // Mirrors run_pipeline.js framing: baseR ~ min(w,h)*0.33
  const baseR = Math.min(w, h) * 0.33;

  // Approximate curtain length by circumference. This keeps the UI deterministic
  // without needing to run the generator first.
  const approxCurtainLen = 2 * Math.PI * baseR;

  // Spacing tuned so Medium roughly matches the old default (8-ish bastions).
  const baseSpacing = Math.max(60, baseR * 0.75);

  let N0 = Math.round(approxCurtainLen / baseSpacing);

  let mult = 1.0;
  if (density === "low") mult = 0.75;
  else if (density === "high") mult = 1.25;

  let N = Math.round(N0 * mult);

  // Clamp to safe bounds similar to your old UI range.
  N = Math.max(5, Math.min(14, N));
  return N;
}

function getInputs() {
  const water = String(document.getElementById("water").value || "none");
  const dock = Boolean(document.getElementById("dock").checked);

  // Ensure gates max and current value are valid before reading.
  syncGateControl();

  const bastionDensity = String(document.getElementById("bastionDensity").value || "medium");
  const { w, h } = resizeCanvasToDevicePixels();
  const bastions = computeBastionTargetN({ w, h, density: bastionDensity });
  const gatesRaw = Number(document.getElementById("gates").value) || 3;
  const maxGates = Math.max(1, Math.floor(bastions / 2));
  const gates = Math.min(Math.max(1, gatesRaw), maxGates);

  return {
    seed: Number(document.getElementById("seed").value) || 1331,
    bastionDensity,
    gates,
    site: {
      water,                 // "none" | "river" | "coast"
      hasDock: water !== "none" && dock,
    },
  };
}

function syncDockControl() {
  const water = String(document.getElementById("water").value || "none");
  const dockEl = document.getElementById("dock");

  const enabled = water !== "none";
  dockEl.disabled = !enabled;

  // If there is no water, docks cannot exist.
  if (!enabled) dockEl.checked = false;
}

function syncGateControl() {
  const densityEl = document.getElementById("bastionDensity");
  const density = String(densityEl.value || "medium");
  
  const { w, h } = resizeCanvasToDevicePixels();
  const bastions = computeBastionTargetN({ w, h, density });
  const gatesEl = document.getElementById("gates");

  // Rule: gates <= floor(bastions / 2), with a minimum of 1.
  const maxGates = Math.max(1, Math.floor(bastions / 2));

  // Enforce spinner limit.
  gatesEl.max = String(maxGates);

  // Clamp current value (covers typing and stale state).
  const gates = Number(gatesEl.value) || 1;
  const clamped = Math.min(Math.max(1, gates), maxGates);

  if (clamped !== gates) {
    gatesEl.value = String(clamped);
  }
}

let model = null;

function regenerate() {
  syncDockControl();
  const { w, h } = resizeCanvasToDevicePixels();
  const { seed, bastionDensity, gates, site } = getInputs();
  const bastions = computeBastionTargetN({ w, h, density: bastionDensity });
  
  console.log("REGEN", { seed, bastionDensity, bastions, gates, w, h });
  
  model = generate(seed, bastionDensity, bastions, gates, w, h, site);
  window.model = model; // debug
  render(ctx, model);
}

// Wire events ONCE
document.getElementById("regen").addEventListener("click", regenerate);
document.getElementById("seed").addEventListener("change", regenerate);
document.getElementById("bastionDensity").addEventListener("change", () => {
  syncGateControl();
  regenerate();
});
document.getElementById("gates").addEventListener("change", () => {
  syncGateControl();
  regenerate();
});
document.getElementById("water").addEventListener("change", () => {
  syncDockControl();
  syncGateControl();
  regenerate();
});

document.getElementById("dock").addEventListener("change", () => {
  syncGateControl();
  regenerate();
});

// Debounced resize (prevents 3–5 regen calls during layout settle)
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(regenerate, 100);
});

// Initial render
syncGateControl();
regenerate();
