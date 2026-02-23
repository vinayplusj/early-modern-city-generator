// docs/src/model/wards/ward_role_hulls.js
//
// Fort hull post-processing helpers extracted from ward_roles.js.
// Extraction only. No behaviour changes intended.
//
// All external dependencies are injected to keep this module deterministic and easy to audit.

function signedArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function quantile(sorted, q) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const i0 = Math.floor(i);
  const i1 = Math.min(sorted.length - 1, i0 + 1);
  const t = i - i0;
  return sorted[i0] * (1 - t) + sorted[i1] * t;
}

/**
 * Choose an outer loop deterministically from a hull that may contain multiple loops.
 * Preference:
 * 1) loops containing preferPoint (if provided)
 * 2) largest absolute area
 * 3) lowest original index
 */
export function selectOuterLoopDeterministic({ hull, preferPoint, pointInPolyOrOn }) {
  const loops = hull?.loops;
  if (!Array.isArray(loops) || loops.length === 0) return null;

  const scored = [];
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i];
    if (!Array.isArray(loop) || loop.length < 3) continue;

    const contains =
      preferPoint &&
      Number.isFinite(preferPoint.x) &&
      Number.isFinite(preferPoint.y) &&
      typeof pointInPolyOrOn === "function" &&
      pointInPolyOrOn(preferPoint, loop, 1e-6);

    scored.push({
      i,
      contains: contains ? 1 : 0,
      areaAbs: Math.abs(signedArea(loop)),
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.contains !== b.contains) return b.contains - a.contains;
    if (a.areaAbs !== b.areaAbs) return b.areaAbs - a.areaAbs;
    return a.i - b.i;
  });

  return scored[0].i;
}

/**
 * Compute IDs of wards whose representative point lies inside (or on) the given outer loop,
 * excluding wards already present in memberSet.
 */
export function computeEnclosedNonMembers({
  wardsCopy,
  outerLoop,
  memberSet,
  idToIndex,
  wardCentroid,
  pointInPolyOrOn,
}) {
  if (!Array.isArray(outerLoop) || outerLoop.length < 3) return [];

  const enclosed = [];

  for (const w of wardsCopy) {
    const id = w?.id;
    if (!Number.isFinite(id)) continue;
    if (memberSet && memberSet.has(id)) continue;

    const c = typeof wardCentroid === "function" ? wardCentroid(w) : null;
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;

    if (typeof pointInPolyOrOn === "function" && pointInPolyOrOn(c, outerLoop, 1e-6)) {
      enclosed.push(id);
    }
  }

  enclosed.sort((a, b) => a - b);
  return enclosed;
}

/**
 * Promote enclosed ward IDs into memberSet, but only if the ward has a valid polygon.
 * This matches the original invariant: hull construction needs valid polygons.
 */
export function promoteEnclosedIds({
  enclosedIds,
  memberSet,
  wardsCopy,
  idToIndex,
  wardHasValidPoly,
}) {
  const promoted = [];

  for (const id of enclosedIds) {
    if (!Number.isFinite(id)) continue;
    if (memberSet.has(id)) continue;

    const idx = idToIndex.get(id);
    if (!Number.isInteger(idx)) continue;

    const w = wardsCopy[idx];
    if (typeof wardHasValidPoly === "function" && !wardHasValidPoly(w)) continue;

    memberSet.add(id);
    promoted.push(id);
  }

  promoted.sort((a, b) => a - b);
  return promoted;
}

/**
 * Build summary stats for "members farthest" debug logging.
 */
export function farthestMembersSummary({ wardsCopy, memberIds, idToIndex, topN = 10 }) {
  const membersDetailed = [];

  for (const id of memberIds) {
    const idx = idToIndex.get(id);
    const w = Number.isInteger(idx) ? wardsCopy[idx] : null;
    const d = w && Number.isFinite(w.distToCentre) ? w.distToCentre : null;
    const role = w && typeof w.role === "string" ? w.role : null;

    membersDetailed.push({ id, role, distToCentre: d });
  }

  membersDetailed.sort((a, b) => {
    const da = Number.isFinite(a.distToCentre) ? a.distToCentre : -Infinity;
    const db = Number.isFinite(b.distToCentre) ? b.distToCentre : -Infinity;
    return db - da;
  });

  const dists = membersDetailed
    .map((m) => m.distToCentre)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const maxDist = dists.length ? dists[dists.length - 1] : null;
  const p95Dist = quantile(dists, 0.95);

  const topFarthest = membersDetailed.slice(0, topN).map((m) => ({
    id: m.id,
    role: m.role,
    dist: Number.isFinite(m.distToCentre) ? +m.distToCentre.toFixed(3) : null,
  }));

  return {
    members: memberIds.length,
    maxDist: Number.isFinite(maxDist) ? +maxDist.toFixed(3) : null,
    p95Dist: Number.isFinite(p95Dist) ? +p95Dist.toFixed(3) : null,
    topFarthest,
  };
}

/**
 * Convenience helper: enforce a single outer loop on a hull object, preserving original loops.
 * Mutates hull in-place to match prior behaviour in ward_roles.js.
 */
export function forceSingleOuterLoopInPlace({ hull, chosenIdx, preferPoint }) {
  if (!hull || !Array.isArray(hull.loops) || hull.loops.length <= 1) return false;
  if (!Number.isInteger(chosenIdx) || chosenIdx < 0 || chosenIdx >= hull.loops.length) return false;

  const chosen = hull.loops[chosenIdx];
  if (!Array.isArray(chosen) || chosen.length < 3) return false;

  // Preserve original loops for debugging.
  hull._originalLoops = hull.loops;

  // Collapse to one loop and clear hole flags.
  hull.loops = [chosen];
  hull.outerLoopIndex = 0;
  hull.outerLoop = chosen;
  hull.holeCount = 0;
  hull._forcedSingleLoop = true;
  hull._forcedSingleLoopChosenIndex = chosenIdx;

  // Preserve any caller-supplied preferPoint metadata if present.
  if (preferPoint && hull._preferPoint == null) hull._preferPoint = preferPoint;

  if (Array.isArray(hull.warnings)) {
    hull.warnings = hull.warnings.filter((w) => !String(w).includes("holeCount="));
  }

  return true;
}
