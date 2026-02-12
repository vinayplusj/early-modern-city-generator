// docs/src/model/districts_voronoi.js
//
// Voronoi-region driven districts.
//
// Goal (incremental migration):
// - Replace radial sector districts with districts derived from ward (Voronoi cell) grouping.
// - Keep the downstream interface stable for:
//   - warp.js (needs per-district kind + angular span for target offsets)
//   - render debug overlays (expects district.polygon)
//   - blocks debug colouring (expects block.districtId)
//
// Design choices (safe, deterministic):
// - Districts are role-groups of wards. This yields a small, stable set:
//   plaza, citadel, inner_ward, new_town, slums, farms, plains, woods.
// - Each district polygon is the convex hull of its member ward vertices.
//   This is a debug/visualisation polygon, not a strict union.
// - Each district also has startAngle/endAngle that minimally covers its polygon
//   around the city centre. This preserves compatibility with the current warp
//   implementation which samples by angle.

import { convexHull } from "../geom/hull.js";
import { centroid as polyCentroid, pointInPolyOrOn } from "../geom/poly.js";

function wrapAngle(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

function titleCase(s) {
  const t = String(s || "").replace(/_/g, " ");
  return t
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function minimalCoveringArc(angles) {
  // Return [a0, a1] such that the circular interval covers all angles,
  // with minimal span (complement of the largest gap).
  if (!Array.isArray(angles) || angles.length === 0) return [0, 0];

  const A = angles
    .filter((x) => Number.isFinite(x))
    .map(wrapAngle)
    .sort((a, b) => a - b);

  if (A.length === 0) return [0, 0];
  if (A.length === 1) return [A[0], A[0]];

  let bestGap = -Infinity;
  let bestIdx = 0;
  const TWO_PI = Math.PI * 2;

  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = A[(i + 1) % A.length];
    const gap = (b - a + TWO_PI) % TWO_PI;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  // Largest gap is between A[bestIdx] -> A[bestIdx+1].
  // Covering arc is the complement: start at next angle, end at this angle.
  const start = A[(bestIdx + 1) % A.length];
  const end = A[bestIdx];
  return [start, end];
}

function districtAnglesFromPoly(poly, centre) {
  if (!poly || poly.length < 3) return [0, 0];
  const angles = [];
  for (const p of poly) {
    angles.push(Math.atan2(p.y - centre.y, p.x - centre.x));
  }
  return minimalCoveringArc(angles);
}

function roleToKind(role) {
  // Preserve fine-grained roles on districts, but normalise the inner label.
  if (role === "inner") return "inner_ward";
  return role;
}

export function buildVoronoiDistrictsFromWards({ wards, centre }) {
  if (!Array.isArray(wards) || wards.length === 0) return [];
  if (!centre || !Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return [];

  // Group wards by role.
  const groups = new Map();
  for (const w of wards) {
    const role = String(w?.role || "").trim() || "plains";
    const key = role;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }

  // Stable role ordering for deterministic district ordering.
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
    const verts = [];

    for (const w of members) {
      const poly = w?.poly;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      for (const p of poly) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) verts.push(p);
      }
    }

    // If a role group has no usable polygon geometry, skip it.
    if (verts.length < 3) continue;

    const hull = convexHull(verts);
    if (!hull || hull.length < 3) continue;

    const [a0, a1] = districtAnglesFromPoly(hull, centre);
    const kind = roleToKind(role);

    districts.push({
      id: `d_${kind}`,
      kind,
      name: titleCase(kind),
      polygon: hull,
      memberWardIds: members.map((w) => w.id),
      startAngle: a0,
      endAngle: a1,
      _debug: { role },
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
    // Use the underlying ward role when available.
    const role = String(d?._debug?.role || "").trim();
    if (role) roleToDistrictId.set(role, d.id);
    // Also map kind for robustness.
    const kind = String(d?.kind || "").trim();
    if (kind) roleToDistrictId.set(kind, d.id);
  }

  // Precompute ward centroids for fallback.
  const wardCentroids = wards.map((w) => {
    const c =
      w?.centroid && Number.isFinite(w.centroid.x)
        ? w.centroid
        : (Array.isArray(w?.poly) ? polyCentroid(w.poly) : null);
    return { id: w.id, role: w.role, poly: w.poly, centroid: c };
  });

  function findWardForPoint(p) {
    // First pass: containment.
    for (const w of wardCentroids) {
      if (!Array.isArray(w.poly) || w.poly.length < 3) continue;
      if (pointInPolyOrOn(p, w.poly, 1e-6)) return w;
    }

    // Fallback: nearest centroid.
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
    const c = polyCentroid(b.polygon);
    if (!c) continue;

    const w = findWardForPoint(c);
    const role = String(w?.role || "").trim() || "plains";

    // Primary mapping is by role, then by kind.
    b.districtId =
      roleToDistrictId.get(role) ||
      roleToDistrictId.get(roleToKind(role)) ||
      `d_${roleToKind(role)}`;
  }

  return blocks;
}
