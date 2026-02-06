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
// - generateSecondaryRoads
// - generateNewTownGrid
// - makeRavelin
// - minDistPointToPoly
// - bastionAngularOffset
// - routeGateToSquareViaRing

import {
  clamp,
  lerp,
  polar,
  add,
  sub,
  mul,
  perp,
  normalize,
  rotate,
  dist
} from "../geom/primitives.js";

import {
  centroid,
  pointInPoly,
  pointInPolyOrOn,
  closestPointOnPolyline
} from "../geom/poly.js";

// ---------- Footprint ----------
export function generateFootprint(rng, cx, cy, baseR, pointCount = 20) {
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
export function generateBastionedWall(rng, cx, cy, wallR, bastionCount) {
  const base = [];
  const rotation = rng() * Math.PI * 2;

  for (let i = 0; i < bastionCount; i++) {
    const ang = rotation + (i / bastionCount) * Math.PI * 2;
    const r = wallR * (0.96 + rng() * 0.08);
    base.push(polar(cx, cy, ang, r));
  }

  const shoulderFactor = clamp(0.30 - (bastionCount - 5) * (0.10 / 7), 0.20, 0.30);
  const bastionLen = wallR * 2.0 * shoulderFactor;
  const shoulder = wallR * 0.80 * shoulderFactor;

  const cheekAlongFrac = clamp(0.80 - (bastionCount - 5) * 0.02, 0.65, 0.80);
  const cheekOutFrac = 0.6;

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

// ---------- Roads ----------
export function generateRoadsToCentre(gates, centre) {
  return (gates || []).map(g => [g, centre]);
}

export function generateSecondaryRoads(rng, gates, ring1, ring2) {
  const secondary = [];
  if (!gates || !gates.length || !ring1 || !ring2) return secondary;

  const ring1Snaps = [];
  const ring2Snaps = [];

  for (const g of gates) {
    const a = closestPointOnPolyline(g, ring1);
    const b = closestPointOnPolyline(a, ring2);

    ring1Snaps.push(a);
    ring2Snaps.push(b);

    secondary.push([g, a]); // gate -> ring1
    secondary.push([a, b]); // ring1 -> ring2
  }

  const linkCount = clamp(Math.floor(gates.length / 2), 2, 3);
  const used = new Set();

  let guard = 0;
  while (used.size < linkCount && guard++ < 2000) {
    const i = Math.floor(rng() * ring2Snaps.length);
    const step = Math.max(1, Math.floor(lerp(2, Math.max(3, ring2Snaps.length - 1), rng())));
    const j = (i + step) % ring2Snaps.length;

    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (used.has(key)) continue;

    if (dist(ring2Snaps[i], ring2Snaps[j]) < 20) continue;

    used.add(key);
    secondary.push([ring2Snaps[i], ring2Snaps[j]]);
  }

  return secondary;
}

export function routeGateToSquareViaRing(gate, ring, squareCentre) {
  if (!ring || ring.length < 3) return [gate, squareCentre];
  const a = closestPointOnPolyline(gate, ring);
  return [gate, a, squareCentre];
}

// ---------- New Town ----------
export function generateNewTownGrid(gate, cx, cy, wallR, baseR, newTownStartOffset, scale = 1.0) {
  const out = normalize({ x: gate.x - cx, y: gate.y - cy });
  if (!isFinite(out.x) || !isFinite(out.y)) return null;

  const side = normalize(perp(out));

  const gateOut = add(gate, mul(out, newTownStartOffset));

  const depth = wallR * 0.80 * scale;
  const wideNear = wallR * 0.20 * scale;
  const wideFar = wallR * 0.50 * scale;

  const p0 = add(gateOut, mul(side, -wideNear));
  const p1 = add(gateOut, mul(side, wideNear));
  const p2 = add(add(gateOut, mul(out, depth * 0.55)), mul(side, wideFar));
  const p3 = add(add(gateOut, mul(out, depth * 1.00)), mul(side, wideFar));
  const p4 = add(add(gateOut, mul(out, depth * 1.00)), mul(side, -wideFar));
  const p5 = add(add(gateOut, mul(out, depth * 0.55)), mul(side, -wideFar));

  const poly = [p0, p1, p2, p3, p4, p5];

  const spacing = baseR * 0.085 * clamp(scale, 0.75, 1.0);

  const cols = Math.max(10, Math.floor((wideFar * 2) / spacing));
  const rows = Math.max(10, Math.floor(depth / spacing));

  const origin = gateOut;

  const points = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = -Math.floor(cols / 2); c <= Math.floor(cols / 2); c++) {
      const pt = add(add(origin, mul(out, r * spacing)), mul(side, c * spacing));
      if (pointInPoly(pt, poly)) points.push({ r, c, pt });
    }
  }

  const key = (r, c) => `${r}|${c}`;
  const map = new Map();
  for (const p of points) map.set(key(p.r, p.c), p.pt);

  const streets = [];
  for (const p of points) {
    const a = p.pt;

    const b = map.get(key(p.r + 1, p.c));
    if (b) streets.push([a, b]);

    const d = map.get(key(p.r, p.c + 1));
    if (d) streets.push([a, d]);
  }

  const mainEnd = add(gateOut, mul(out, depth * 0.85));
  const mainAve = [gateOut, mainEnd];

  return { poly, streets, mainAve, gateOut };
}

// ---------- Misc helpers ----------
export function minDistPointToPoly(pt, poly) {
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

// ---------- Ravelins ----------
export function makeRavelin(gate, cx, cy, wallR, ditchWidth, glacisWidth, newTownPoly, bastionCount) {
  const out0 = normalize({ x: gate.x - cx, y: gate.y - cy });

  const theta = bastionAngularOffset(bastionCount);

  const forwardFactor = clamp(0.28 - (bastionCount - 5) * (0.10 / 7), 0.18, 0.28);
  const forward = ditchWidth + glacisWidth + wallR * forwardFactor;

  const baseW = wallR * 0.10;
  const depth = wallR * 0.12;

  function build(sign) {
    const out = rotate(out0, sign * theta);
    const side = normalize(perp(out));

    const c0 = add(gate, mul(out, forward));
    const a = add(c0, mul(side, -baseW));
    const b = add(c0, mul(side, baseW));
    const tip = add(c0, mul(out, depth));

    return [a, tip, b];
  }

  const rvPos = build(+1);
  const rvNeg = build(-1);

  // If New Town exists, try to pick the ravelin orientation that avoids overlapping it.
  if (newTownPoly && newTownPoly.length >= 3) {
    const posIn =
      rvPos.some(p => pointInPoly(p, newTownPoly)) ||
      pointInPoly(centroid(rvPos), newTownPoly);

    const negIn =
      rvNeg.some(p => pointInPoly(p, newTownPoly)) ||
      pointInPoly(centroid(rvNeg), newTownPoly);

    if (posIn && !negIn) return rvNeg;
    if (negIn && !posIn) return rvPos;
    if (posIn && negIn) return null;
  }

  return (gate.idx % 2 === 0) ? rvPos : rvNeg;
}
