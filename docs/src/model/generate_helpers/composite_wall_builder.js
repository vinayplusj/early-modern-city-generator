// docs/src/model/generate_helpers/composite_wall_builder.js
//
// Composite wall builder: splice bastion polygons into the curtain loop.
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// a86d82a0075cd6c162f18c75ed2e6254055eb9dc1095aed7a450723e9022082f

// ---------------- Composite wall builder (curtain + bastions) ----------------
// Build a single outer loop by splicing final bastion polygons into the final curtain loop.
// Assumes bastion point order [B0, S0, T, S1, B1].
// Deterministic; no polygon boolean ops.

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// Return nearest vertex index on a closed polyline (curtain) for point p.
// This assumes B0/B1 are already aligned very close to curtain vertices after warp.
function nearestVertexIndexOnClosed(poly, p) {
  if (!Array.isArray(poly) || poly.length < 3 || !p) return -1;
  let bestI = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i];
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    const d2 = dist2(p, q);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
    }
  }
  return bestI;
}

// Circular forward arc from i0 to i1 inclusive on a closed polyline.
function circularArcInclusive(poly, i0, i1) {
  const n = poly.length;
  const out = [];
  if (n < 1 || i0 < 0 || i1 < 0) return out;

  let i = i0;
  for (let guard = 0; guard < n + 1; guard++) {
    out.push(poly[i]);
    if (i === i1) break;
    i = (i + 1) % n;
  }
  return out;
}

// Number of edges in forward circular walk i0 -> i1.
function circularEdgeCount(n, i0, i1) {
  if (n <= 0) return 0;
  return (i1 - i0 + n) % n;
}

// Remove consecutive duplicate / near-duplicate points.
function dedupeConsecutiveClosed(poly, eps = 1e-6) {
  if (!Array.isArray(poly) || poly.length < 2) return poly;
  const eps2 = eps * eps;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!p) continue;
    const prev = out[out.length - 1];
    if (!prev || dist2(p, prev) > eps2) out.push(p);
  }

  // Drop duplicated closure point if present.
  if (out.length >= 2 && dist2(out[0], out[out.length - 1]) <= eps2) {
    out.pop();
  }
  return out;
}

// Signed area of a closed polygon (positive for CCW).
function signedArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (!p || !q) continue;
    a += (p.x * q.y - q.x * p.y);
  }
  return 0.5 * a;
}

// Orient a polygon to match the curtain orientation sign.
function orientLike(poly, targetSign) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;
  const s = (signedArea(poly) >= 0) ? 1 : -1;
  if (s === targetSign) return poly;
  const rev = poly.slice().reverse();
  return rev;
}

// Build composite wall by replacing short curtain arcs with bastion chains.
// Returns null on failure; caller can fall back to curtain.
export function buildCompositeWallFromCurtainAndBastions(curtain, bastionPolys) {
  if (!Array.isArray(curtain) || curtain.length < 3) return null;
  if (!Array.isArray(bastionPolys) || bastionPolys.length === 0) return curtain;

  const curtainClean = dedupeConsecutiveClosed(curtain, 1e-6);
  if (curtainClean.length < 3) return null;

  const curtainSign = (signedArea(curtainClean) >= 0) ? 1 : -1;

  // Collect valid bastion splice descriptors.
  const splices = [];
  for (let bi = 0; bi < bastionPolys.length; bi++) {
    let b = bastionPolys[bi];
    if (!Array.isArray(b) || b.length !== 5) continue;

    // Match orientation to curtain so arc direction is consistent.
    b = orientLike(b, curtainSign);

    // Semantic order after orientLike may invert.
    // We must re-identify attachments as the two endpoints of the 5-point chain.
    // We preserve the chain order [0..4] as the bastion arc candidate.
    const B0 = b[0];
    const B1 = b[4];

    const i0 = nearestVertexIndexOnClosed(curtainClean, B0);
    const i1 = nearestVertexIndexOnClosed(curtainClean, B1);
    if (i0 < 0 || i1 < 0 || i0 === i1) continue;

    // Curtain arc lengths in both directions; prefer replacing the shorter one.
    const n = curtainClean.length;
    const fwdEdges = circularEdgeCount(n, i0, i1);
    const revEdges = circularEdgeCount(n, i1, i0);

    // We define the bastion arc in the chain direction 0->4.
    // It should replace the shorter curtain arc between attachments.
    const useForward = (fwdEdges <= revEdges);

    splices.push({
      bi,
      poly: b,
      iStart: useForward ? i0 : i1,
      iEnd:   useForward ? i1 : i0,
      // Arc to insert must start at curtain[iStart] and end at curtain[iEnd].
      // If we reversed direction, also reverse the chain so endpoints match.
      insert: useForward ? b : b.slice().reverse(),
    });
  }

  if (splices.length === 0) return curtainClean;

  // Sort splices by start index to walk in a stable order.
  splices.sort((a, b) => a.iStart - b.iStart);

  // Reject overlaps by tracking covered curtain ranges.
  // We build a final list of non-overlapping splices in index order.
  const accepted = [];
  const n = curtainClean.length;

  // Helper: check if forward circular arc from s->e overlaps any accepted.
  function overlapsAny(s, e) {
    const len = circularEdgeCount(n, s, e);
    for (const r of accepted) {
      const lenR = circularEdgeCount(n, r.iStart, r.iEnd);

      // Convert both arcs to a list of visited indices for small n only.
      // This stays deterministic and safe, and n is typically modest.
      const visited = new Set();
      let i = s;
      for (let guard = 0; guard < len + 1; guard++) {
        visited.add(i);
        if (i === e) break;
        i = (i + 1) % n;
      }

      i = r.iStart;
      for (let guard = 0; guard < lenR + 1; guard++) {
        if (visited.has(i)) return true;
        if (i === r.iEnd) break;
        i = (i + 1) % n;
      }
    }
    return false;
  }

  for (const s of splices) {
    if (overlapsAny(s.iStart, s.iEnd)) continue;
    accepted.push(s);
  }

  if (accepted.length === 0) return curtainClean;

  // Walk the curtain and splice in bastion chains.
  const out = [];
  let curI = 0;

  // Accepted are sorted by iStart already.
  for (const s of accepted) {
    // Add curtain arc from curI to s.iStart (inclusive).
    const arc1 = circularArcInclusive(curtainClean, curI, s.iStart);
    for (let k = 0; k < arc1.length; k++) out.push(arc1[k]);

    // Add bastion insert chain, excluding endpoints (to avoid duplicates).
    const ins = s.insert;
    for (let k = 1; k < ins.length - 1; k++) out.push(ins[k]);

    // Continue from s.iEnd
    curI = s.iEnd;
  }

  // Close the loop by adding remaining curtain arc from curI to 0 (inclusive),
  // then drop the duplicate closure point through dedupeConsecutiveClosed.
  if (curI !== 0) {
    const arc2 = circularArcInclusive(curtainClean, curI, 0);
    for (let k = 0; k < arc2.length; k++) out.push(arc2[k]);
  } else {
    // Ensure at least one full wrap.
    out.push(curtainClean[0]);
  }

  const finalOut = dedupeConsecutiveClosed(out, 1e-6);
  if (!Array.isArray(finalOut) || finalOut.length < 3) return curtainClean;

  return finalOut;
}
