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
  // angles are in [0, 2pi)
  if (a0 <= a1) return a >= a0 && a < a1;
  return a >= a0 || a < a1; // wrap case
}

function sortAngles(angles) {
  return angles.slice().sort((x, y) => x - y);
}

export function buildRadialDistricts(rng, outerBoundary, cx, cy, opts = {}) {
  const {
    COUNT = 8,
    JITTER = 0.10,        // radians, explicit
    MIN_SPAN = 0.35,      // radians, explicit
  } = opts;

  const TWO_PI = Math.PI * 2;

  // 1) Make raw boundaries
  let cuts = [];
  for (let i = 0; i < COUNT; i++) {
    const base = (i / COUNT) * TWO_PI;
    const j = (rng() * 2 - 1) * JITTER;
    cuts.push(normAngle(base + j));
  }
  cuts = sortAngles(cuts);

  // 2) Enforce minimum span (simple pass)
  // If two cuts are too close, push the later one forward.
  for (let i = 0; i < cuts.length; i++) {
    const prev = cuts[(i - 1 + cuts.length) % cuts.length];
    const cur = cuts[i];
    const span = (cur - prev + TWO_PI) % TWO_PI;
    if (span < MIN_SPAN) {
      cuts[i] = normAngle(prev + MIN_SPAN);
    }
  }
  cuts = sortAngles(cuts);

  // 3) Build polygons as centre + boundary vertices in sector
  const centre = { x: cx, y: cy };
  const districts = [];

  for (let i = 0; i < cuts.length; i++) {
    const a0 = cuts[i];
    const a1 = cuts[(i + 1) % cuts.length];

    const pts = [];
    for (const v of outerBoundary || []) {
      const av = normAngle(angle(cx, cy, v));
      if (inSector(av, a0, a1)) pts.push(v);
    }

    // If not enough points, skip (rare but possible)
    if (pts.length < 2) continue;

    districts.push({
      id: `d${districts.length}`,
      polygon: [centre, ...pts],
      kind: "generic",
      name: `District ${districts.length}`,
      _debug: { a0, a1 },
    });
  }

  return districts;
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
