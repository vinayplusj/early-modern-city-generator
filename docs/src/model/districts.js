// docs/src/model/districts.js
import { centroid as polyCentroid } from "../geom/poly.js";

function angle(cx, cy, p) {
  return Math.atan2(p.y - cy, p.x - cx);
}

function normAngle(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

function inSector(a, a0, a1) {
  if (a0 <= a1) return a >= a0 && a < a1;
  return a >= a0 || a < a1;
}

function sortAngles(angles) {
  return angles.slice().sort((x, y) => x - y);
}

function angleDist(a, b) {
  // circular distance in radians
  const d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
}

export function buildRadialDistricts(rng, outerBoundary, cx, cy, opts = {}) {
  const {
    COUNT = 8,
    JITTER = 0.10,
    MIN_SPAN = 0.35,
  } = opts;

  const TWO_PI = Math.PI * 2;
  const centre = { x: cx, y: cy };

  // Precompute boundary angles once
  const boundary = (outerBoundary || []).map((p) => ({
    p,
    a: normAngle(angle(cx, cy, p)),
  }));

  // 1) Raw cuts
  let cuts = [];
  for (let i = 0; i < COUNT; i++) {
    const base = (i / COUNT) * TWO_PI;
    const j = (rng() * 2 - 1) * JITTER;
    cuts.push(normAngle(base + j));
  }
  cuts = sortAngles(cuts);

  // 2) Enforce minimum span with a few deterministic passes
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < cuts.length; i++) {
      const prev = cuts[(i - 1 + cuts.length) % cuts.length];
      const cur = cuts[i];
      const span = (cur - prev + TWO_PI) % TWO_PI;
      if (span < MIN_SPAN) {
        cuts[i] = normAngle(prev + MIN_SPAN);
      }
    }
    cuts = sortAngles(cuts);
  }

  // 3) Build districts
  const districts = [];

  for (let i = 0; i < cuts.length; i++) {
    const a0 = cuts[i];
    const a1 = cuts[(i + 1) % cuts.length];

    // Collect boundary points in sector
    let pts = [];
    for (const v of boundary) {
      if (inSector(v.a, a0, a1)) pts.push(v);
    }

    // If too few points, pick two closest boundary vertices to a0 and a1
    if (pts.length < 2) {
      let best0 = null;
      let best1 = null;
      for (const v of boundary) {
        const d0 = angleDist(v.a, a0);
        const d1 = angleDist(v.a, a1);
        if (!best0 || d0 < best0.d) best0 = { d: d0, v };
        if (!best1 || d1 < best1.d) best1 = { d: d1, v };
      }
      pts = [];
      if (best0) pts.push(best0.v);
      if (best1 && best1.v !== best0?.v) pts.push(best1.v);
    }

    // Sort points by angle so polygon does not fold
    pts.sort((u, v) => u.a - v.a);

    const poly = [centre, ...pts.map((x) => x.p)];

    districts.push({
      id: `d${districts.length}`,
      polygon: poly,
      kind: "generic",
      name: `District ${districts.length}`,
      _debug: { a0, a1 },
    });
  }

  return districts;
}

export function assignBlocksToDistricts(blocks, districts, cx, cy) {
  if (!blocks || !districts || districts.length === 0) return blocks;

  const sectors = districts.map((d) => ({
    id: d.id,
    a0: d._debug?.a0 ?? 0,
    a1: d._debug?.a1 ?? 0,
  }));

  function findDistrictId(p) {
    const a = normAngle(Math.atan2(p.y - cy, p.x - cx));
    for (const s of sectors) {
      if (inSector(a, s.a0, s.a1)) return s.id;
    }
    return sectors[0].id;
  }

  for (const b of blocks || []) {
    const c = polyCentroid(b.polygon);
    b.districtId = findDistrictId(c);
  }

  return blocks;
}

export function assignBlocksToDistricts(blocks, districts, cx, cy) {
  if (!blocks || !districts || districts.length === 0) return blocks;

  // Build sector list from district debug angles.
  const sectors = districts.map((d) => ({
    id: d.id,
    a0: d._debug?.a0 ?? 0,
    a1: d._debug?.a1 ?? 0,
  }));

  function findDistrictId(p) {
    const a = normAngle(Math.atan2(p.y - cy, p.x - cx));
    for (const s of sectors) {
      if (inSector(a, s.a0, s.a1)) return s.id;
    }
    return sectors[0].id;
  }

  for (const b of blocks || []) {
    const c = polyCentroid(b.polygon);
    b.districtId = findDistrictId(c);
  }

  return blocks;
}
