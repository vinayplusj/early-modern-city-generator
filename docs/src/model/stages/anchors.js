// docs/src/model/stages/anchors.js

import { add, mul } from "../../geom/primitives.js";
import { centroid, pointInPolyOrOn } from "../../geom/poly.js";

import {
  ensureInside,
  pushAwayFromWall,
  enforceMinSeparation,
} from "../anchors/anchor_constraints.js";

import { assertFinitePoint, assertDistinctPoints } from "../invariants.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampPointToCanvas(p, w, h, pad) {
  if (!p) return p;
  return { x: clamp(p.x, pad, w - pad), y: clamp(p.y, pad, h - pad) };
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function wardPoly(w) {
  if (!w) return null;
  const a = w.polygon;
  const b = w.poly;
  if (Array.isArray(a) && a.length >= 3) return a;
  if (Array.isArray(b) && b.length >= 3) return b;
  return null;
}

function wardCentroid(w) {
  if (!w) return null;
  if (isPoint(w.centroid)) return w.centroid;

  const poly = wardPoly(w);
  if (poly) {
    const c = centroid(poly);
    if (isPoint(c)) return c;
  }

  if (isPoint(w.site)) return w.site;
  if (isPoint(w.seed)) return w.seed;
  if (isPoint(w.point)) return w.point;
  if (isPoint(w.center)) return w.center;
  if (isPoint(w.centre)) return w.centre;

  return null;
}

function vec(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function len(v) {
  return Math.hypot(v.x, v.y);
}

function safeNormalize(v, fallback = { x: 1, y: 0 }) {
  const m = len(v);
  if (m > 1e-9) return { x: v.x / m, y: v.y / m };
  return fallback;
}

function pushInsidePoly(p, poly, toward, step = 4, iters = 60) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return p;

  let q = p;
  const dir = safeNormalize(vec(q, toward));

  for (let i = 0; i < iters; i++) {
    if (pointInPolyOrOn(q, poly, 1e-6)) return q;
    q = add(q, mul(dir, step));
  }

  return q;
}

export function buildAnchors(ctx) {
  const wallBase = ctx?.geom?.wallBase;
  const wards = ctx?.wards?.cells;

  if (!Array.isArray(wallBase) || wallBase.length < 3) {
    throw new Error("anchors stage requires ctx.geom.wallBase polygon");
  }
  if (!Array.isArray(wards) || wards.length < 1) {
    throw new Error("anchors stage requires ctx.wards.cells (role-tagged wards)");
  }

  const w = ctx.canvas.w;
  const h = ctx.canvas.h;

  const baseR = ctx?.params?.baseR;
  const minWallClear = ctx?.params?.minWallClear;
  const minAnchorSep = ctx?.params?.minAnchorSep;
  const pad = Number.isFinite(ctx?.params?.canvasPad) ? ctx.params.canvasPad : 10;

  if (!Number.isFinite(baseR) || baseR <= 0) {
    throw new Error("anchors stage requires ctx.params.baseR");
  }
  if (!Number.isFinite(minWallClear) || minWallClear < 0) {
    throw new Error("anchors stage requires ctx.params.minWallClear");
  }
  if (!Number.isFinite(minAnchorSep) || minAnchorSep <= 0) {
    throw new Error("anchors stage requires ctx.params.minAnchorSep");
  }

  // Centre is purely canvas-derived (deterministic).
  const centre = { x: ctx.canvas.cx, y: ctx.canvas.cy };

  // Ward-driven: pick the wards by role.
  const plazaWard = wards.find((wd) => wd && wd.role === "plaza") || null;
  const citadelWard = wards.find((wd) => wd && wd.role === "citadel") || null;

  if (!plazaWard) throw new Error("No plaza ward found");
  if (!citadelWard) throw new Error("No citadel ward found");

  const plazaPoly = wardPoly(plazaWard);
  const citadelPoly = wardPoly(citadelWard);

  // Initial candidates from ward centroid.
  let plaza = wardCentroid(plazaWard) || { x: ctx.canvas.cx, y: ctx.canvas.cy };
  let citadel = wardCentroid(citadelWard) || { x: ctx.canvas.cx - baseR * 0.12, y: ctx.canvas.cy + baseR * 0.02 };

  // Ensure each anchor is inside its ward poly if available.
  if (plazaPoly && !pointInPolyOrOn(plaza, plazaPoly, 1e-6)) {
    plaza = pushInsidePoly(plaza, plazaPoly, wardCentroid(plazaWard) || centre, 4, 60);
  }
  if (citadelPoly && !pointInPolyOrOn(citadel, citadelPoly, 1e-6)) {
    citadel = pushInsidePoly(citadel, citadelPoly, wardCentroid(citadelWard) || centre, 4, 60);
  }

  // Now apply wall constraints.
  const centreHint = centre;

  plaza = ensureInside(wallBase, plaza, centreHint, 1.0);
  citadel = ensureInside(wallBase, citadel, centreHint, 1.0);

  plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
  citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);

  // Enforce separation and re-apply constraints (bounded deterministic pass).
  {
    const sep = enforceMinSeparation(plaza, citadel, minAnchorSep);
    plaza = ensureInside(wallBase, sep.a, centreHint, 1.0);
    citadel = ensureInside(wallBase, sep.b, centreHint, 1.0);

    plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
    citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);
  }

  // Canvas clamp and re-constraint.
  plaza = clampPointToCanvas(plaza, w, h, pad);
  citadel = clampPointToCanvas(citadel, w, h, pad);

  plaza = ensureInside(wallBase, plaza, centreHint, 1.0);
  citadel = ensureInside(wallBase, citadel, centreHint, 1.0);

  plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
  citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);

  // Market is not ward-driven yet. Keep it null here; generate.js can compute it for now.
  // In window 1 we only stabilise plaza/citadel.
  const market = null;

  // Docks are site-driven; keep null in stage for now.
  const docks = null;

  // Final invariants (throwing here is good; it surfaces real bugs).
  assertFinitePoint(plaza, "anchors.plaza");
  assertFinitePoint(citadel, "anchors.citadel");

  assertDistinctPoints(plaza, citadel, minAnchorSep, "plaza", "citadel");

  return {
    centre,
    plaza,
    citadel,
    market,
    docks,
    primaryGate: null,
  };
}
