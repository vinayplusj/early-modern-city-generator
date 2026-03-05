// src/model/features.js
//
// Feature generators and helpers (geometry + content), split out from the monolith.
// This file is written as a pure ES module for GitHub Pages.
//
// Exports:
// - generateFootprint
// - generateBastionedWall
// - pickGates
// - generateRoadsToCentre
// - makeRavelin
// - minDistPointToPoly
// - bastionAngularOffset

import {
  clamp,
  lerp,
  polar,
  add,
  mul,
  perp,
  normalize,
  rotate,
} from "../geom/primitives.js";

import {
  centroid,
  pointInPoly,
} from "../geom/poly.js";

import { polyIntersectsPoly } from "../geom/intersections.js";

// ---------- Corridor intent (Milestone 5A) ----------
// A "corridor" is a preferred outward direction that should receive more footprint mass.
// This is used to stretch the outer boundary along main approaches (for example, gate axes),
// and later (optional) water / new town axes.
//
// Design goals:
// - Deterministic: no RNG use here.
// - Stable: small input changes yield small output changes.
// - Bounded: returned weights are clamped, and downstream stretch is clamped.
//
// Corridor object shape:
// { dir: {x,y}, weight: number, kind: "gate"|"water"|"newTown" }
function _angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function _dirToAngle(d) {
  return Math.atan2(d.y, d.x);
}

/**
 * Build a deterministic corridor intent set.
 * @param {object} centre - {x,y}
 * @param {Array<object>} gates - gate points with {x,y}
 * @param {?object} waterDir - optional unit vector {x,y} pointing toward water pull
 * @param {?object} newTownDir - optional unit vector {x,y} pointing toward new town pull
 * @returns {{ centre: object, corridors: Array<object> }}
 */
export function buildCorridorIntent(centre, gates, waterDir = null, newTownDir = null) {
  const corridors = [];

  // Gate corridors
  if (Array.isArray(gates)) {
    for (const g of gates) {
      const v = { x: g.x - centre.x, y: g.y - centre.y };
      const dir = normalize(v);
      // Skip degenerate vectors
      if (!isFinite(dir.x) || !isFinite(dir.y)) continue;
      corridors.push({ dir, weight: 1.0, kind: "gate" });
    }
  }

  // Water corridor (optional)
  if (waterDir) {
    const dir = normalize(waterDir);
    if (isFinite(dir.x) && isFinite(dir.y)) {
      corridors.push({ dir, weight: 1.6, kind: "water" });
    }
  }

  // New town corridor (optional)
  if (newTownDir) {
    const dir = normalize(newTownDir);
    if (isFinite(dir.x) && isFinite(dir.y)) {
      corridors.push({ dir, weight: 1.25, kind: "newTown" });
    }
  }

  // Stable order: gate corridors are already stable if gates are sorted.
  // Enforce stable ordering by kind then angle.
  corridors.sort((a, b) => {
    const ka = a.kind, kb = b.kind;
    if (ka !== kb) return ka < kb ? -1 : 1;
    const aa = _dirToAngle(a.dir);
    const ab = _dirToAngle(b.dir);
    return aa - ab;
  });

  // Clamp weights to a safe range (downstream stretch also clamps).
  for (const c of corridors) c.weight = clamp(c.weight, 0.0, 2.0);

  return { centre, corridors };
}

function _corridorFactorAtAngle(corridors, ang, widthRad) {
  if (!corridors || corridors.length === 0) return 0;

  // Smooth peak around each corridor direction.
  // Gaussian falloff: exp(-(d/width)^2)
  let best = 0;
  for (const c of corridors) {
    const a0 = _dirToAngle(c.dir);
    const d = _angDiff(ang, a0);
    const t = Math.exp(- (d * d) / (widthRad * widthRad));
    best = Math.max(best, c.weight * t);
  }
  return best;
}

// ---------- Footprint ----------
export function generateFootprint(rng, cx, cy, baseR, pointCount = 80, opts = null) {
  const pts = [];
  const wobble = baseR * 0.22;
  const phase = rng() * Math.PI * 2;

  const corridors = opts && opts.corridors ? opts.corridors : null;
  const stretchStrength = clamp(opts && opts.stretchStrength != null ? opts.stretchStrength : 0.0, 0.0, 0.9);
  const stretchWidthRad = clamp(opts && opts.stretchWidthRad != null ? opts.stretchWidthRad : (Math.PI / 9), Math.PI / 24, Math.PI / 3);
  const stretchClamp = opts && opts.stretchClamp ? opts.stretchClamp : { min: 0.85, max: 1.65 };

  for (let i = 0; i < pointCount; i++) {
    const t = i / pointCount;
    const ang = t * Math.PI * 2;

    const n1 = Math.sin(ang * 2 + phase) * (0.45 + rng() * 0.25);
    const n2 = Math.sin(ang * 5 + phase * 1.7) * (0.25 + rng() * 0.2);
    const r0 = baseR + wobble * (n1 + n2) + wobble * (rng() - 0.5) * 0.35;

    // Corridor stretch (Milestone 5A). This is a bounded radial multiplier.
    // If no corridors are provided, factor = 0 and behaviour matches prior code.
    const f = _corridorFactorAtAngle(corridors, ang, stretchWidthRad);
    const mulR = clamp(1.0 + stretchStrength * f, stretchClamp.min, stretchClamp.max);

    pts.push(polar(cx, cy, ang, r0 * mulR));
  }

  // Light smoothing
  const smooth = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    smooth.push({ x: lerp(p.x, q.x, 0.25), y: lerp(p.y, q.y, 0.25) });
    smooth.push({ x: lerp(p.x, q.x, 0.75), y: lerp(p.y, q.y, 0.75) });
  }

  return smooth;
}

// ---------- Bastioned wall ----------
export function generateBastionedWall(rng, cx, cy, wallR, bastionCount) {
  // Bastions are now created in Stage 110 from clearance maxima slots on the warped curtain.
  // This function only generates a curtain candidate (base/wall) for upstream stages.

  const base = [];
  const pointCount = Math.max(48, Math.round(18 + 6 * Math.sqrt(Math.max(1, bastionCount || 0))));

  const rotation = rng() * Math.PI * 2;
  const wobble = wallR * 0.05; // mild irregularity for variety; deterministic from rng seed

  for (let i = 0; i < pointCount; i++) {
    const t = i / pointCount;
    const ang = rotation + t * Math.PI * 2;

    // Keep small radial variation but do not create bastions here.
    const r = wallR + wobble * (rng() - 0.5);
    base.push(polar(cx, cy, ang, r));
  }

  // For now, wall == base (pre-warp curtain). Stage 110 will produce the real bastioned wall.
  const wall = base;

  return { base, wall, bastions: [] };
}
export function gateTargetFromDensity(density, bastionCount) {
  const B = Math.max(1, bastionCount | 0);
  const d = (density || "medium").toLowerCase();

  let frac = 0.50; // medium default
  if (d === "low") frac = 0.25;
  else if (d === "high") frac = 0.75;

  let target = Math.round(B * frac);

  // Hard bounds to keep maps readable and stable.
  target = Math.max(2, Math.min(6, target));
  return target;
}

// ---------- Gates ----------
export function pickGates(rng, wallBase, gateSpec, bastionCount) {
  const n = (wallBase && wallBase.length) ? wallBase.length : 0;
  if (n < 3) return [];

  // Derive requested gate count from either a density string or a number.
  const requested = (typeof gateSpec === "string")
    ? gateTargetFromDensity(gateSpec, bastionCount)
    : (gateSpec | 0);

  // With a min-gap style constraint, the maximum number of usable edges on a cycle
  // is bounded. Using floor(n/2) is a conservative, safe cap.
  const maxFeasible = Math.max(1, Math.floor(n / 2));
  const gateCountEff = Math.max(1, Math.min(requested, maxFeasible));

  const gates = [];
  const usedEdges = new Set();

  const minGap = Math.max(1, Math.floor(n / gateCountEff) - 1);
  const tJitter = clamp(0.16 - (bastionCount - 5) * (0.09 / 7), 0.07, 0.16);

  function edgeOk(e) {
    for (const j of usedEdges) {
      const d = Math.min((e - j + n) % n, (j - e + n) % n);
      if (d <= minGap) return false;
    }
    return true;
  }

  // Primary pass: try to place up to gateCountEff gates.
  for (let k = 0; k < gateCountEff; k++) {
    let placed = false;
    let tries = 0;
    while (tries++ < 220) {
      const e = Math.floor(rng() * n);
      if (usedEdges.has(e)) continue;
      if (!edgeOk(e)) continue;

      usedEdges.add(e);

      const a = wallBase[e];
      const b = wallBase[(e + 1) % n];

      const sign = (e % 2 === 0) ? +1 : -1;
      const t = clamp(0.5 + sign * tJitter, 0.15, 0.85);

      const p = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      gates.push({ ...p, idx: e });
      placed = true;
      break;
    }
    if (!placed) break;
  }

  // Fallback fill (still deterministic)
  let guard = 0;
  while (gates.length < gateCountEff && guard++ < 5000) {
    const e = Math.floor(rng() * n);
    if (usedEdges.has(e)) continue;
    if (!edgeOk(e)) continue;

    usedEdges.add(e);

    const a = wallBase[e];
    const b = wallBase[(e + 1) % n];
    const p = { x: lerp(a.x, b.x, 0.5), y: lerp(a.y, b.y, 0.5) };
    gates.push({ ...p, idx: e });
  }

  // Stable order
  gates.sort((g1, g2) => g1.idx - g2.idx);

  // Optional diagnostic
  if (gates.length !== gateCountEff) {
    console.warn("[EMCG] pickGates produced fewer gates than target", {
      requested,
      effective: gateCountEff,
      got: gates.length,
      wallBaseN: n,
      minGap,
    });
  }

  return gates;
}

export function generateRoadsToCentre(gates, centre) {
  return (gates || []).map(g => [g, centre]);
}

// ---------- Misc helpers ----------
export function minDistPointToPoly(pt, poly) {
  // Guard: avoid crashing if caller passes undefined/null.
  if (!poly || !Array.isArray(poly) || poly.length < 2) return Infinity;
  let best = Infinity;
  for (const p of poly) {
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d < best) best = d;
  }
  return best;
}

export function bastionAngularOffset(bastionCount) {
  return clamp(0.22 - (bastionCount - 5) * (0.13 / 7), 0.09, 0.22);
}

// ---------- Outworks ----------
export function makeRavelin(
  gate, cx, cy, wallR, ditchWidth, glacisWidth,
  newTownPoly, bastionCount,
  bastionPolys = null,
  wallPoly = null
) {
  const out0 = normalize({ x: gate.x - cx, y: gate.y - cy });
  const theta = bastionAngularOffset(bastionCount);

  const forwardFactor = clamp(0.28 - (bastionCount - 5) * (0.10 / 7), 0.18, 0.28);
  const forward = ditchWidth + glacisWidth + wallR * forwardFactor;

  const baseW = wallR * 0.10;
  const depth = wallR * 0.12;

  function build(sign, fwd) {
    const out = rotate(out0, sign * theta);
    const side = normalize(perp(out));

    const c0 = add(gate, mul(out, fwd));
    const a = add(c0, mul(side, -baseW));
    const b = add(c0, mul(side, baseW));
    const tip = add(c0, mul(out, depth));
    return [a, tip, b];
  }

  function hitsFort(rv) {
    if (!rv || rv.length < 3) return true;

    if (bastionPolys && bastionPolys.length) {
      for (const b of bastionPolys) {
        if (!b || b.length < 3) continue;
        if (polyIntersectsPoly(rv, b)) return true;
      }
    }

    if (wallPoly && wallPoly.length >= 3) {
      if (polyIntersectsPoly(rv, wallPoly)) return true;
    }

    return false;
  }

  function hitsNewTown(rv) {
    if (!newTownPoly || newTownPoly.length < 3) return false;
    return (
      rv.some((p) => pointInPoly(p, newTownPoly)) ||
      pointInPoly(centroid(rv), newTownPoly)
    );
  }

  // Build initial candidates
  const rvPos = build(+1, forward);
  const rvNeg = build(-1, forward);

  // Candidate preference (parity) but respecting New Town
  let preferred = (gate.idx % 2 === 0) ? rvPos : rvNeg;
  let alternate = (gate.idx % 2 === 0) ? rvNeg : rvPos;

  // If New Town exists, prefer the one that does NOT overlap it
  if (newTownPoly && newTownPoly.length >= 3) {
    const prefBad = hitsNewTown(preferred);
    const altBad = hitsNewTown(alternate);

    if (prefBad && !altBad) {
      const tmp = preferred;
      preferred = alternate;
      alternate = tmp;
    } else if (prefBad && altBad) {
      return null;
    }
  }

  // Now enforce fort intersection constraints
  if (!hitsFort(preferred)) return preferred;
  if (!hitsFort(alternate)) return alternate;

  // Shrink forward deterministically and retry both sides
  for (const m of [0.85, 0.72, 0.60]) {
    const fwd2 = forward * m;

    const p2 = build(+1, fwd2);
    const n2 = build(-1, fwd2);

    const pref2 = (gate.idx % 2 === 0) ? p2 : n2;
    const alt2  = (gate.idx % 2 === 0) ? n2 : p2;

    // Preserve New Town constraint
    if (newTownPoly && newTownPoly.length >= 3) {
      const prefBad = hitsNewTown(pref2);
      const altBad = hitsNewTown(alt2);
      if (prefBad && altBad) continue;
      if (!prefBad && !hitsFort(pref2)) return pref2;
      if (!altBad && !hitsFort(alt2)) return alt2;
      continue;
    }

    if (!hitsFort(pref2)) return pref2;
    if (!hitsFort(alt2)) return alt2;
  }

  return null;
}

