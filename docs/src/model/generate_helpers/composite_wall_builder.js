// docs/src/model/generate_helpers/composite_wall_builder.js
//
// Composite wall builder: splice bastion polygons into the curtain loop.
// Extracted from: docs/src/model/stages/110_warp_field.js
//

// ---------------- Composite wall builder (curtain + bastions) ----------------
// Build a single outer loop by splicing final bastion polygons into the final curtain loop.
// Assumes bastion point order [B0, S0, T, S1, B1].
// Deterministic; no polygon boolean ops.
import { dist2 } from "../../geom/primitives.js";
import { signedArea } from "../../geom/poly.js";

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
        visited.add(i);                 // include endpoints
        if (i === e) break;
        i = (i + 1) % n;
      }

      i = r.iStart;
      for (let guard = 0; guard < lenR + 1; guard++) {
        if (visited.has(i)) {
          const candEndpoint = (i === s || i === e);
          const accEndpoint  = (i === r.iStart || i === r.iEnd);
        
          // Allow touch only if it is an endpoint for BOTH arcs.
          if (!(candEndpoint && accEndpoint)) return true;
        }
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
  // ---------------- Walk start rotation (prevents double-traversal) ----------------
  // If any accepted splice wraps (iEnd < iStart), starting the walk at 0 can cause
  // a curtain segment to be traversed twice (visual "two loop" effect).
  // Fix: start at the wrap splice end, then rotate accepted splice order accordingly.
  let startIndex = 0;

  const wrapSplices = accepted.filter(s => s.iEnd < s.iStart);
  if (wrapSplices.length > 0) {
    // Deterministic choice: smallest iEnd among wrap splices.
    startIndex = wrapSplices.reduce((best, s) => Math.min(best, s.iEnd), wrapSplices[0].iEnd);
  }

  // Rotate splice order so we process in forward index order starting from startIndex.
  // This avoids an extra wrap across 0 during the main walk.
  let acceptedRot = accepted;
  if (startIndex !== 0) {
    const after = accepted.filter(s => s.iStart >= startIndex);
    const before = accepted.filter(s => s.iStart < startIndex);
    acceptedRot = after.concat(before);
  }
  // Walk the curtain and splice in bastion chains.
  const out = [];
  let curI = startIndex;

  // Walk from startIndex in rotated splice order.
  for (const s of acceptedRot) {
    // Add curtain arc from curI to s.iStart (inclusive).
    const arc1 = circularArcInclusive(curtainClean, curI, s.iStart);
    for (let k = 0; k < arc1.length; k++) out.push(arc1[k]);

  // Add full bastion insert chain including endpoints.
  // B0 and B1 must remain explicit in the stitched wall to prevent
  // shortcutting from the curtain directly to S0/S1 and creating inward spikes.
  const ins = s.insert;
  for (let k = 0; k < ins.length; k++) out.push(ins[k]);
    
    // Add full bastion insert chain including endpoints.
  // B0 and B1 must remain explicit in the stitched wall to prevent
  // shortcutting from the curtain directly to S0/S1 and creating inward spikes.
  if (typeof window !== "undefined" && window.__bastionDebug) {
    console.log("[compositeWall] inserted bastion chain", {
      bi: s.bi,
      iStart: s.iStart,
      iEnd: s.iEnd,
      insertN: ins.length,
      insertPts: ins.map((p, idx) => ({ idx, x: +p.x.toFixed(3), y: +p.y.toFixed(3) })),
    });
  }

    // Continue from s.iEnd
    curI = s.iEnd;
  }

  // Close the loop by adding remaining curtain arc from curI back to startIndex (inclusive),
  // then drop the duplicate closure point through dedupeConsecutiveClosed.
  if (curI !== startIndex) {
    const arc2 = circularArcInclusive(curtainClean, curI, startIndex);
    for (let k = 0; k < arc2.length; k++) out.push(arc2[k]);
  } else {
    // Ensure at least one full wrap.
    out.push(curtainClean[startIndex]);
  }

  const finalOut = dedupeConsecutiveClosed(out, 1e-6);
  if (!Array.isArray(finalOut) || finalOut.length < 3) return curtainClean;

  return finalOut;
}
