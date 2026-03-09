// docs/src/model/generate_helpers/bastion_interval_prune.js
//
// Deterministically prune bastions whose reserved curtain intervals overlap
// or come too close. This runs before composite-wall assembly.

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function nearestIndex(polyline, p) {
  if (!Array.isArray(polyline) || !polyline.length || !p) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = dist(polyline[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function signedArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return NaN;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function circularForwardSpan(i0, i1, n) {
  return ((i1 - i0 + n) % n);
}

function intervalsTooClose(a, b, n, gap) {
  // Expand each interval by gap on both sides in circular index space,
  // then test if any endpoint of one lies inside the other.
  const a0 = (a.iStart - gap + n) % n;
  const a1 = (a.iEnd + gap) % n;
  const b0 = (b.iStart - gap + n) % n;
  const b1 = (b.iEnd + gap) % n;

  function inForwardArc(x, i0, i1) {
    const dx = (x - i0 + n) % n;
    const span = (i1 - i0 + n) % n;
    return dx <= span;
  }

  return (
    inForwardArc(a.iStart, b0, b1) ||
    inForwardArc(a.iEnd,   b0, b1) ||
    inForwardArc(b.iStart, a0, a1) ||
    inForwardArc(b.iEnd,   a0, a1)
  );
}

export function pruneBastionsByCurtainIntervals({
  curtain,
  bastions,
  minGapSamples = 3,
  debug = false,
} = {}) {
  const curtainOk = Array.isArray(curtain) && curtain.length >= 8;
  const bastionsOk = Array.isArray(bastions) && bastions.length > 0;

  if (!curtainOk || !bastionsOk) {
    return {
      bastionsOut: Array.isArray(bastions) ? bastions : [],
      kept: [],
      dropped: [],
    };
  }

  const n = curtain.length;
  const candidates = [];

  for (let bi = 0; bi < bastions.length; bi++) {
    const poly = bastions[bi];
    if (!Array.isArray(poly) || poly.length < 5) continue;

    const B0 = poly[0];
    const B1 = poly[4];
    const i0 = nearestIndex(curtain, B0);
    const i1 = nearestIndex(curtain, B1);
    if (i0 < 0 || i1 < 0) continue;

    const fwd = circularForwardSpan(i0, i1, n);
    const rev = circularForwardSpan(i1, i0, n);
    const useForward = fwd <= rev;

    const iStart = useForward ? i0 : i1;
    const iEnd = useForward ? i1 : i0;
    const span = useForward ? fwd : rev;
    const area = Math.abs(signedArea(poly));

    candidates.push({
      bi,
      poly,
      iStart,
      iEnd,
      span,
      area,
    });
  }

  // Deterministic priority:
  // 1) larger area wins
  // 2) larger span wins
  // 3) lower bi wins
  candidates.sort((a, b) =>
    (b.area - a.area) ||
    (b.span - a.span) ||
    (a.bi - b.bi)
  );

  const kept = [];
  const dropped = [];

  for (const cand of candidates) {
    let conflict = false;
    for (const k of kept) {
      if (intervalsTooClose(cand, k, n, minGapSamples)) {
        conflict = true;
        break;
      }
    }
    if (conflict) dropped.push(cand);
    else kept.push(cand);
  }

  // Restore original bastion order in output
  kept.sort((a, b) => a.bi - b.bi);

  if (debug) {
    console.info("[Warp110] bastion interval prune", {
      minGapSamples,
      kept: kept.map(x => ({ bi: x.bi, iStart: x.iStart, iEnd: x.iEnd, span: x.span, area: x.area })),
      dropped: dropped.map(x => ({ bi: x.bi, iStart: x.iStart, iEnd: x.iEnd, span: x.span, area: x.area })),
    });
  }

  return {
    bastionsOut: kept.map(x => x.poly),
    kept,
    dropped,
  };
}
