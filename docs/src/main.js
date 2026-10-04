if (window.__EMCG_BOOTED__) {
  console.warn("main.js loaded twice");
  // Prevent duplicate listeners and double rendering loops.
  throw new Error("main.js loaded twice");
}
window.__EMCG_BOOTED__ = 1;

console.log("BOOT COUNT", window.__EMCG_BOOTED__);

import {
  generate,
  MODEL_SPACE,
} from "./model/generate.js";
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

function computeBastionTargetN({ density }) {
  const w = MODEL_SPACE.width;
  const h = MODEL_SPACE.height;

  // Generation dimensions are canonical model-space dimensions,
  // never browser or canvas dimensions.
  const baseR = Math.min(w, h) * 0.33;

  const approxCurtainLen = 2 * Math.PI * baseR;
  const baseSpacing = Math.max(60, baseR * 0.75);

  let N0 = Math.round(approxCurtainLen / baseSpacing);

  let mult = 1.0;
  if (density === "low") mult = 0.75;
  else if (density === "high") mult = 1.25;

  let N = Math.round(N0 * mult);

  N = Math.max(5, Math.min(14, N));
  return N;
}

function getInputs() {
  const water = String(
    document.getElementById("water").value || "none"
  );

  const dock = Boolean(
    document.getElementById("dock").checked
  );

  const bastionDensity = String(
    document.getElementById("bastionDensity").value || "medium"
  );

  const gateDensity = String(
    document.getElementById("gateDensity").value || "medium"
  );

  return {
    seed: Number(document.getElementById("seed").value) || 1331,
    bastionDensity,
    gateDensity,

    site: {
      water,
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

let model = null;

function computeViewTransform(canvasW, canvasH) {
  const modelW = MODEL_SPACE.width;
  const modelH = MODEL_SPACE.height;

  const scale = Math.min(
    canvasW / modelW,
    canvasH / modelH
  );

  return {
    scale,
    tx: (canvasW - modelW * scale) * 0.5,
    ty: (canvasH - modelH * scale) * 0.5,
  };
}

function renderCurrentModel() {
  if (!model) return;

  const { w, h } = resizeCanvasToDevicePixels();
  const view = computeViewTransform(w, h);

  ctx.save();

  ctx.setTransform(
    view.scale,
    0,
    0,
    view.scale,
    view.tx,
    view.ty
  );

  render(ctx, model);

  ctx.restore();

  // Debug only. This is render state, not model state.
  window.__EMCG_VIEW__ = {
    ...view,
    canvasWidth: w,
    canvasHeight: h,
    modelWidth: MODEL_SPACE.width,
    modelHeight: MODEL_SPACE.height,
  };
}

function regenerate() {
  syncDockControl();

  const {
    seed,
    bastionDensity,
    gateDensity,
    site,
  } = getInputs();

  const bastions = computeBastionTargetN({
    density: bastionDensity,
  });

  console.log("REGEN", {
    seed,
    bastionDensity,
    bastions,
    modelSpace: MODEL_SPACE,
  });

  model = generate(
    seed,
    bastionDensity,
    bastions,
    0,
    gateDensity,
    site
  );

  window.model = model;

  renderCurrentModel();
}

// Wire events ONCE
document.getElementById("regen").addEventListener("click", regenerate);
document.getElementById("seed").addEventListener("change", regenerate);
document.getElementById("bastionDensity").addEventListener("change", () => {
  regenerate();
});
document.getElementById("water").addEventListener("change", () => {
  syncDockControl();
  regenerate();
});
document.getElementById("dock").addEventListener("change", () => {
  regenerate();
});

// Debounced resize (prevents 3–5 regen calls during layout settle)
let resizeTimer = null;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    // Resize is a rendering event only.
    // Never regenerate city geometry here.
    renderCurrentModel();
  }, 100);
});

// Initial render
regenerate();
