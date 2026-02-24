// docs/src/model/stages/anchors.js

import { add, mul } from "../../geom/primitives.js";
import { centroid, pointInPolyOrOn } from "../../geom/poly.js";

import {
  ensureInside,
  pushAwayFromWall,
  enforceMinSeparation,
} from "../domain/anchor_constraints.js";

import { assertFinitePoint, assertDistinctPoints } from "../invariants.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampPointToCanvas(p, w, h, pad) {
  if (!p) return p;
  return { x: clamp(p.x, pad, w - pad), y: clamp(p.y, pad, h - pad) };
}

function isPoint(p) {
  return Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
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
  // ---- Phase 2 canonical reads with Phase 1 fallbacks ----
  const fort = ctx?.state?.fortifications ?? null;

  const wallBase =
    fort?.wallBase ??
    ctx?.geom?.wallBase ??
    null;

  const wards =
    ctx?.state?.wards?.wardsWithRoles ??
    ctx?.wards?.cells ??
    null;

  if (!Array.isArray(wallBase) || wallBase.length < 3) {
    throw new Error(
      "[EMCG] anchors stage requires wallBase polygon (ctx.state.fortifications.wallBase)."
    );
  }
  if (!Array.isArray(wards) || wards.length < 1) {
    throw new Error(
      "[EMCG] anchors stage requires role-tagged wards (ctx.state.wards.wardsWithRoles or ctx.wards.cells)."
    );
  }

  const w = ctx?.canvas?.w;
  const h = ctx?.canvas?.h;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error("[EMCG] anchors stage requires ctx.canvas.w and ctx.canvas.h.");
  }

  // Prefer ctx.params.baseR if present, else match pipeline frame.
  const baseR = Number.isFinite(ctx?.params?.baseR)
    ? ctx.params.baseR
    : Math.min(w, h) * 0.33;

  const minWallClear = ctx?.params?.minWallClear;
  const minAnchorSep = ctx?.params?.minAnchorSep;
  const pad = Number.isFinite(ctx?.params?.canvasPad) ? ctx.params.canvasPad : 10;

  if (!Number.isFinite(minWallClear) || minWallClear < 0) {
    throw new Error("[EMCG] anchors stage requires ctx.params.minWallClear.");
  }
  if (!Number.isFinite(minAnchorSep) || minAnchorSep <= 0) {
    throw new Error("[EMCG] anchors stage requires ctx.params.minAnchorSep.");
  }

  // Centre: prefer fort centre if present, else match pipeline.
  const centre =
    (isPoint(fort?.centre) ? fort.centre : null) ??
    { x: w * 0.5, y: h * 0.55 };

  // ---- Strict role requirements (preserve behaviour) ----
  const plazaWard = wards.find((wd) => wd && wd.role === "plaza") || null;
  const citadelWard = wards.find((wd) => wd && wd.role === "citadel") || null;

  if (!plazaWard) throw new Error("No plaza ward found");
  if (!citadelWard) throw new Error("No citadel ward found");

  const plazaPoly = wardPoly(plazaWard);
  const citadelPoly = wardPoly(citadelWard);

  let plaza = wardCentroid(plazaWard) || { x: centre.x, y: centre.y };
  let citadel = wardCentroid(citadelWard) || { x: centre.x - baseR * 0.12, y: centre.y + baseR * 0.02 };

  if (plazaPoly && !pointInPolyOrOn(plaza, plazaPoly, 1e-6)) {
    plaza = pushInsidePoly(plaza, plazaPoly, wardCentroid(plazaWard) || centre, 4, 60);
  }
  if (citadelPoly && !pointInPolyOrOn(citadel, citadelPoly, 1e-6)) {
    citadel = pushInsidePoly(citadel, citadelPoly, wardCentroid(citadelWard) || centre, 4, 60);
  }

  const centreHint = centre;

  plaza = ensureInside(wallBase, plaza, centreHint, 1.0);
  citadel = ensureInside(wallBase, citadel, centreHint, 1.0);

  plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
  citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);

  {
    const sep = enforceMinSeparation(plaza, citadel, minAnchorSep);
    plaza = ensureInside(wallBase, sep.a, centreHint, 1.0);
    citadel = ensureInside(wallBase, sep.b, centreHint, 1.0);

    plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
    citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);
  }

  plaza = clampPointToCanvas(plaza, w, h, pad);
  citadel = clampPointToCanvas(citadel, w, h, pad);

  plaza = ensureInside(wallBase, plaza, centreHint, 1.0);
  citadel = ensureInside(wallBase, citadel, centreHint, 1.0);

  plaza = pushAwayFromWall(wallBase, plaza, minWallClear, centreHint);
  citadel = pushAwayFromWall(wallBase, citadel, minWallClear, centreHint);

  const market = null;
  const docks = null;

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
