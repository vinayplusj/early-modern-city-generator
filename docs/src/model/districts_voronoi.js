// docs/src/model/districts_voronoi.js
//
// Voronoi-region driven districts.

import { centroid, pointInPolyOrOn } from "../geom/poly.js";
import { titleCase, roleToKind } from "./districts.js";
import { minimalCoveringArc, anglesFromPolygonAroundCentre } from "./util/circular.js";
import { deriveDistrictLoopsFromWardPolys } from "./mesh/district_loops_from_wards.js";

export function buildVoronoiDistrictsFromWards({ wards, centre }) {
  if (!Array.isArray(wards) || wards.length === 0) return [];
  if (!centre || !Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return [];

  const groups = new Map();
  for (const w of wards) {
    const role = String(w?.role || "").trim() || "plains";
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(w);
  }

  const ROLE_ORDER = [
    "plaza",
    "citadel",
    "inner",
    "new_town",
    "slums",
    "farms",
    "plains",
    "woods",
  ];

  const roles = Array.from(groups.keys()).sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a);
    const ib = ROLE_ORDER.indexOf(b);
    const da = ia >= 0 ? ia : 999;
    const db = ib >= 0 ? ib : 999;
    if (da !== db) return da - db;
    return String(a).localeCompare(String(b));
  });

  const districts = [];

  for (const role of roles) {
    const members = groups.get(role) || [];
    const loopsRes = deriveDistrictLoopsFromWardPolys(members);
    const outer = loopsRes?.outer;
    const holes = loopsRes?.holes || [];
    const loops = loopsRes?.loops || [];
    const eps = loopsRes?.eps ?? 0;

    if (!outer || outer.length < 3) continue;

    const kind = roleToKind(role);
    const [a0, a1] = anglesFromPolygonAroundCentre(outer, centre);

    districts.push({
      id: `d_${kind}`,
      kind,
      name: titleCase(kind),
      polygon: outer,
      holes,
      memberWardIds: members.map((w) => w.id),
      startAngle: a0,
      endAngle: a1,
      _debug: {
        role,
        unionEps: eps,
        loopCount: loops.length,
        holeCount: holes.length,
        componentCount: 1,
        loops,
      },
    });
  }

  return districts;
}

export function assignBlocksToDistrictsByWards({ blocks, wards, districts }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  if (!Array.isArray(wards) || wards.length === 0) return blocks;
  if (!Array.isArray(districts) || districts.length === 0) return blocks;

  const roleToDistrictId = new Map();
  for (const d of districts) {
    const role = String(d?._debug?.role || "").trim();
    if (role) roleToDistrictId.set(role, d.id);
    const kind = String(d?.kind || "").trim();
    if (kind) roleToDistrictId.set(kind, d.id);
  }

  const wardCentroids = wards.map((w) => {
    const c =
      w?.centroid && Number.isFinite(w.centroid.x)
        ? w.centroid
        : (Array.isArray(w?.poly) ? centroid(w.poly) : null);
    return { id: w.id, role: w.role, poly: w.poly, centroid: c };
  });

  function findWardForPoint(p) {
    for (const w of wardCentroids) {
      if (!Array.isArray(w.poly) || w.poly.length < 3) continue;
      if (pointInPolyOrOn(p, w.poly, 1e-6)) return w;
    }

    let best = null;
    let bestD = Infinity;
    for (const w of wardCentroids) {
      const c = w.centroid;
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = w;
      }
    }
    return best;
  }

  for (const b of blocks) {
    if (!b || !Array.isArray(b.polygon) || b.polygon.length < 3) continue;

    const c = centroid(b.polygon);
    if (!c) continue;

    const w = findWardForPoint(c);
    const role = String(w?.role || "").trim() || "plains";
    const kind = roleToKind(role);

    b.districtId = roleToDistrictId.get(role) || roleToDistrictId.get(kind) || `d_${kind}`;
  }

  return blocks;
}
