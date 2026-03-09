// docs/src/model/debug/composite_wall_splice_debug.js
//
// Debug helpers for inspecting composite-wall splices between curtain wall
// and bastion polygons. Intended for temporary diagnostics.

function r(v, d = 3) {
  return Number.isFinite(v) ? Number(v.toFixed(d)) : v;
}

function pt(p, d = 3) {
  if (!p) return p;
  return { x: r(p.x, d), y: r(p.y, d) };
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(b.x - a.x, b.y - a.y);
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

function crossAt(poly, i) {
  if (!Array.isArray(poly) || poly.length < 3) return NaN;
  const n = poly.length;
  const a = poly[(i - 1 + n) % n];
  const b = poly[i];
  const c = poly[(i + 1) % n];
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  return abx * bcy - aby * bcx;
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

function sliceWrap(arr, i0, i1) {
  if (!Array.isArray(arr) || !arr.length) return [];
  const n = arr.length;
  const out = [];
  let i = ((i0 % n) + n) % n;
  const stop = ((i1 % n) + n) % n;
  out.push(arr[i]);
  while (i !== stop) {
    i = (i + 1) % n;
    out.push(arr[i]);
    if (out.length > n + 2) break;
  }
  return out;
}

function turnsSummary(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    out.push({
      i,
      cross: r(crossAt(poly, i), 6),
      p: pt(poly[i]),
    });
  }
  return out;
}

function centroid(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

function eastFilter(poly, cx, onlyEast) {
  if (!onlyEast) return true;
  const c = centroid(poly);
  return c && Number.isFinite(cx) ? c.x >= cx : true;
}

export function debugCompositeWallSplices({
  wallCurtainForDraw,
  bastionPolys,
  compositeWall,
  cx,
  onlyEast = false,
  enabled = false,
} = {}) {
  if (!enabled) return;
  if (!Array.isArray(wallCurtainForDraw) || wallCurtainForDraw.length < 3) return;
  if (!Array.isArray(compositeWall) || compositeWall.length < 3) return;
  if (!Array.isArray(bastionPolys) || !bastionPolys.length) return;

  for (let bi = 0; bi < bastionPolys.length; bi++) {
    const poly = bastionPolys[bi];
    if (!Array.isArray(poly) || poly.length < 5) continue;
    if (!eastFilter(poly, cx, onlyEast)) continue;

    const B0 = poly[0];
    const S0 = poly[1];
    const T = poly[2];
    const S1 = poly[3];
    const B1 = poly[4];

    const attach0Curtain = nearestIndex(wallCurtainForDraw, B0);
    const attach1Curtain = nearestIndex(wallCurtainForDraw, B1);

    const attach0Composite = nearestIndex(compositeWall, B0);
    const attach1Composite = nearestIndex(compositeWall, B1);

    console.log("[Warp110] composite bastion input", {
      bi,
      n: poly.length,
      areaSigned: r(signedArea(poly), 6),
      B0: pt(B0),
      S0: pt(S0),
      T: pt(T),
      S1: pt(S1),
      B1: pt(B1),
      baseGap: r(dist(B0, B1), 3),
      shoulderGap: r(dist(S0, S1), 3),
      tipS0: r(dist(T, S0), 3),
      tipS1: r(dist(T, S1), 3),
    });

    console.log("[Warp110] composite splice attach", {
      bi,
      attach0Curtain,
      attach1Curtain,
      attach0Composite,
      attach1Composite,
      B0: pt(B0),
      B1: pt(B1),
      attach0CurtainPt: pt(attach0Curtain >= 0 ? wallCurtainForDraw[attach0Curtain] : null),
      attach1CurtainPt: pt(attach1Curtain >= 0 ? wallCurtainForDraw[attach1Curtain] : null),
      attach0CompositePt: pt(attach0Composite >= 0 ? compositeWall[attach0Composite] : null),
      attach1CompositePt: pt(attach1Composite >= 0 ? compositeWall[attach1Composite] : null),
      dCurtain0: attach0Curtain >= 0 ? r(dist(B0, wallCurtainForDraw[attach0Curtain]), 3) : null,
      dCurtain1: attach1Curtain >= 0 ? r(dist(B1, wallCurtainForDraw[attach1Curtain]), 3) : null,
      dComposite0: attach0Composite >= 0 ? r(dist(B0, compositeWall[attach0Composite]), 3) : null,
      dComposite1: attach1Composite >= 0 ? r(dist(B1, compositeWall[attach1Composite]), 3) : null,
    });

    console.log("[Warp110] composite splice direction", {
      bi,
      forwardArc: [pt(B0), pt(S0), pt(T), pt(S1), pt(B1)],
      reverseArc: [pt(B1), pt(S1), pt(T), pt(S0), pt(B0)],
      curtainSteps:
        (attach0Curtain >= 0 && attach1Curtain >= 0)
          ? ((attach1Curtain - attach0Curtain + wallCurtainForDraw.length) % wallCurtainForDraw.length)
          : null,
      compositeSteps:
        (attach0Composite >= 0 && attach1Composite >= 0)
          ? ((attach1Composite - attach0Composite + compositeWall.length) % compositeWall.length)
          : null,
    });

    if (attach0Composite < 0 || attach1Composite < 0) continue;

    const lo = (Math.min(attach0Composite, attach1Composite) - 3 + compositeWall.length) % compositeWall.length;
    const hi = (Math.max(attach0Composite, attach1Composite) + 3) % compositeWall.length;
    const localChunk = sliceWrap(compositeWall, lo, hi);

    console.log("[Warp110] composite local chunk", {
      bi,
      c0: attach0Composite,
      c1: attach1Composite,
      localN: localChunk.length,
      localAreaSigned: r(signedArea(localChunk), 6),
      localPts: localChunk.map((p, ii) => ({ ii, ...pt(p) })),
      localTurns: turnsSummary(localChunk),
    });

    const badTurns = [];
    for (let ti = 0; ti < localChunk.length; ti++) {
      const cr = crossAt(localChunk, ti);
      if (Number.isFinite(cr) && cr < -1e-3) {
        badTurns.push({
          ti,
          cross: r(cr, 6),
          p: pt(localChunk[ti]),
        });
      }
    }

    if (badTurns.length) {
      console.warn("[Warp110] inward spike candidate", {
        bi,
        badTurns,
        localPts: localChunk.map((p, ii) => ({ ii, ...pt(p) })),
      });
    }
  }
}
