// docs/src/model/stages/docks.js
//
// Docks anchor placement.
//
// Milestone 4.9 repair:
// - Dock anchors must never publish inside the fort wall.
// - A dock is accepted only when it is:
//   1) finite
//   2) inside the outer boundary
//   3) outside the wallBase polygon
//   4) inside the canvas
//
// If no valid dock point can be found deterministically, return null.
// This is safer than publishing a bad dock anchor.

import {
  add,
  mul,
  normalize,
  clampPointToCanvas,
} from "../../geom/primitives.js";

import {
  pointInPolyOrOn,
  supportPoint,
  snapPointToPolyline,
} from "../../geom/poly.js";

function isFinitePoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function inCanvas(p, width, height, pad = 10) {
  return (
    isFinitePoint(p) &&
    p.x >= pad &&
    p.x <= width - pad &&
    p.y >= pad &&
    p.y <= height - pad
  );
}

function insideOuterBoundary(p, outerBoundary) {
  if (!Array.isArray(outerBoundary) || outerBoundary.length < 3) return true;
  return pointInPolyOrOn(p, outerBoundary, 1e-6);
}

function outsideWall(p, wallBase) {
  if (!Array.isArray(wallBase) || wallBase.length < 3) return true;
  return !pointInPolyOrOn(p, wallBase, 1e-6);
}

function isValidDockPoint(p, {
  outerBoundary,
  wallBase,
  width,
  height,
}) {
  return (
    isFinitePoint(p) &&
    inCanvas(p, width, height, 10) &&
    insideOuterBoundary(p, outerBoundary) &&
    outsideWall(p, wallBase)
  );
}

function tryPointAndCanvasClamp(p, geom) {
  if (isValidDockPoint(p, geom)) return p;

  const q = clampPointToCanvas(p, geom.width, geom.height, 10);
  if (isValidDockPoint(q, geom)) return q;

  return null;
}

function firstValidAlongRay({
  origin,
  dir,
  geom,
  start = 0,
  step = 4,
  maxSteps = 180,
}) {
  if (!isFinitePoint(origin) || !isFinitePoint(dir)) return null;

  for (let i = 0; i <= maxSteps; i++) {
    const d = start + i * step;
    const p = add(origin, mul(dir, d));
    const ok = tryPointAndCanvasClamp(p, geom);
    if (ok) return ok;
  }

  return null;
}

function firstValidDockNearShore({
  snapped,
  centre,
  primaryGateDir,
  outerBoundary,
  wallBase,
  width,
  height,
}) {
  const geom = { outerBoundary, wallBase, width, height };

  if (!isFinitePoint(snapped) || !isFinitePoint(centre)) return null;

  const inwardRaw = { x: centre.x - snapped.x, y: centre.y - snapped.y };
  const inward =
    Math.hypot(inwardRaw.x, inwardRaw.y) > 1e-6
      ? normalize(inwardRaw)
      : { x: 1, y: 0 };

  const outwardRaw = { x: snapped.x - centre.x, y: snapped.y - centre.y };
  const outward =
    Math.hypot(outwardRaw.x, outwardRaw.y) > 1e-6
      ? normalize(outwardRaw)
      : { x: -inward.x, y: -inward.y };

  const gateDir =
    isFinitePoint(primaryGateDir) && Math.hypot(primaryGateDir.x, primaryGateDir.y) > 1e-6
      ? normalize(primaryGateDir)
      : outward;

  // Preferred order:
  // 1. Move inward from water. This usually finds the waterfront belt.
  // 2. Move outward from water. This handles cases where the snap landed inside the wall.
  // 3. Move along the primary gate axis as a deterministic fallback.
  const candidates = [
    firstValidAlongRay({ origin: snapped, dir: inward, geom, start: 6, step: 4, maxSteps: 180 }),
    firstValidAlongRay({ origin: snapped, dir: outward, geom, start: 6, step: 4, maxSteps: 180 }),
    firstValidAlongRay({ origin: snapped, dir: gateDir, geom, start: 6, step: 4, maxSteps: 180 }),
  ];

  for (const p of candidates) {
    if (isValidDockPoint(p, geom)) return p;
  }

  return null;
}

export function buildDocks({
  hasDock,
  anchors,
  newTown,
  outerBoundary,
  wallBase,
  centre,
  waterModel,
  width,
  height,
}) {
  // Invariant: return null unless a valid dock point can be placed.
  if (!hasDock) return null;

  const dockPoly =
    (newTown?.poly && newTown.poly.length >= 3) ? newTown.poly :
    (outerBoundary && outerBoundary.length >= 3) ? outerBoundary :
    null;

  if (
    !dockPoly ||
    !anchors?.primaryGate ||
    !isFinitePoint(centre) ||
    !waterModel ||
    waterModel.kind === "none" ||
    !Array.isArray(waterModel.shoreline) ||
    waterModel.shoreline.length < 2
  ) {
    return null;
  }

  const primaryGateDirRaw = {
    x: anchors.primaryGate.x - centre.x,
    y: anchors.primaryGate.y - centre.y,
  };

  const primaryGateDir =
    Math.hypot(primaryGateDirRaw.x, primaryGateDirRaw.y) > 1e-6
      ? normalize(primaryGateDirRaw)
      : { x: 1, y: 0 };

  const support = supportPoint(dockPoly, primaryGateDir);
  if (!support) return null;

  const snapped = snapPointToPolyline(support, waterModel.shoreline);
  if (!isFinitePoint(snapped)) return null;

  const dock = firstValidDockNearShore({
    snapped,
    centre,
    primaryGateDir,
    outerBoundary,
    wallBase,
    width,
    height,
  });

  // Final hard guard. Never publish a dock inside the wall.
  if (!isValidDockPoint(dock, { outerBoundary, wallBase, width, height })) {
    return null;
  }

  return dock;
}
