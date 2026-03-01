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


// ---------- Footprint ----------
export function generateFootprint(rng, cx, cy, baseR, pointCount = 80) {
  const pts = [];
  const wobble = baseR * 0.22;
  const phase = rng() * Math.PI * 2;

  for (let i = 0; i < pointCount; i++) {
    const t = i / pointCount;
    const ang = t * Math.PI * 2;
    const n1 = Math.sin(ang * 2 + phase) * (0.45 + rng() * 0.25);
    const n2 = Math.sin(ang * 5 + phase * 1.7) * (0.25 + rng() * 0.2);
    const r = baseR + wobble * (n1 + n2) + wobble * (rng() - 0.5) * 0.35;
    pts.push(polar(cx, cy, ang, r));
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
export function generateBastionedWall(rng, cx, cy, wallR, bastionCount, opts = {}) {
  const base = [];
  const rotation = rng() * Math.PI * 2;
  const skewMax = Number.isFinite(opts.skewMax) ? Math.max(0, Math.min(0.35, opts.skewMax)) : 0.12;
  // Optional: allow slightly asymmetric base endpoints around each bastion centre.
  // 0.12 means up to 12% of the segment length shifts from one side to the other.
  
  const phase = Number.isFinite(opts.phase) ? opts.phase : 0;
  // Deterministic phase offset (radians) if you ever want to rotate the whole pattern.
  for (let i = 0; i < bastionCount; i++) {
    const ang = rotation + (i / bastionCount) * Math.PI * 2;
    const r = wallR * (0.96 + rng() * 0.08);
    base.push(polar(cx, cy, ang, r));
  }

  // Thinner bastions as bastionCount rises.
  // At 5 bastions -> about 0.30
  // At 16 bastions -> about 0.12 (noticeably thinner)
  const t = clamp((bastionCount - 5) / 11, 0, 1);
  const shoulderFactor = lerp(0.30, 0.10, t);
  
  const bastionLen = wallR * 2.0 * shoulderFactor;
  const shoulder = wallR * 0.80 * shoulderFactor;
  
  // Keep faces from getting too wide at high counts
  const cheekAlongFrac = lerp(0.80, 0.60, t);
  const cheekOutFrac = lerp(0.60, 0.40, t);
  
  const bastions = [];

  function pushOutToMinRadial(p, curr, out, minOut) {
    const r = (p.x - curr.x) * out.x + (p.y - curr.y) * out.y;
    if (r >= minOut) return p;
    const delta = minOut - r;
    return { x: p.x + out.x * delta, y: p.y + out.y * delta };
  }

  for (let i = 0; i < base.length; i++) {
    const prev = base[(i - 1 + base.length) % base.length];
    const curr = base[i];
    const next = base[(i + 1) % base.length];

    const uIn = normalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const uOut = normalize({ x: next.x - curr.x, y: next.y - curr.y });
    const out = normalize({ x: curr.x - cx, y: curr.y - cy });

    const s1 = { x: curr.x - uIn.x * shoulder, y: curr.y - uIn.y * shoulder };
    const s2 = { x: curr.x + uOut.x * shoulder, y: curr.y + uOut.y * shoulder };

    const L = bastionLen * (0.90 + rng() * 0.25);
    const cheekAlong = L * cheekAlongFrac;

    const tip = { x: curr.x + out.x * L, y: curr.y + out.y * L };
    const cheekOut = L * cheekOutFrac;

    const leftFace0 = {
      x: curr.x + out.x * cheekOut - uIn.x * cheekAlong,
      y: curr.y + out.y * cheekOut - uIn.y * cheekAlong,
    };

    const rightFace0 = {
      x: curr.x + out.x * cheekOut + uOut.x * cheekAlong,
      y: curr.y + out.y * cheekOut + uOut.y * cheekAlong,
    };

    const minOut = wallR * 0.02;
    const leftFace = pushOutToMinRadial(leftFace0, curr, out, minOut);
    const rightFace = pushOutToMinRadial(rightFace0, curr, out, minOut);

    bastions.push({
      i,
      pts: [s1, leftFace, tip, rightFace, s2],
      shoulders: [s1, s2],
    });
  }

  const wall = bastions.flatMap(b => b.pts);
  return { base, wall, bastions };
}

// ---------- Gates ----------
export function pickGates(rng, wallBase, gateCount, bastionCount) {
  const n = wallBase.length;
  const gates = [];
  const usedEdges = new Set();

  const minGap = Math.max(1, Math.floor(n / gateCount) - 1);
  const tJitter = clamp(0.16 - (bastionCount - 5) * (0.09 / 7), 0.07, 0.16);

  function edgeOk(e) {
    for (const j of usedEdges) {
      const d = Math.min((e - j + n) % n, (j - e + n) % n);
      if (d <= minGap) return false;
    }
    return true;
  }

  // Primary pass
  for (let k = 0; k < gateCount; k++) {
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
      break;
    }
  }

  // Fallback fill (still deterministic)
  let guard = 0;
  while (gates.length < gateCount && guard++ < 5000) {
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

