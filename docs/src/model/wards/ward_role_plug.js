// docs/src/model/wards/ward_role_plug.js
// Extraction-only helper for deterministic inner-hole plugging.
// No behaviour changes intended. All dependencies are injected via arguments.

export function proposePlugSeq({
  wardsCopy,
  adj,
  plazaIdx,
  citadelId,
  idToIndex,
  innerIdxsNow,
  maxAddsLeft,
  fortCoreWardIds,
  buildDistrictLoopsFromWards,
}) {
  const depthMax = Math.min(3, maxAddsLeft);
  const beamWidth = 12;
  const candidateLimit = 25;

  const plazaIdx2 = plazaIdx;
  const citadelIdx2 = idToIndex.get(citadelId);

  const isCore = (idx, innerSet) =>
    idx === plazaIdx2 || idx === citadelIdx2 || innerSet.has(idx);

  function orderedCandidates(innerArr) {
    const innerSet = new Set(innerArr);
    const candidateSet = new Set();

    const frontierSeeds = [
      ...innerArr,
      ...(Number.isInteger(plazaIdx2) ? [plazaIdx2] : []),
      ...(Number.isInteger(citadelIdx2) ? [citadelIdx2] : []),
    ];

    for (const u of frontierSeeds) {
      for (const v of (adj[u] || [])) candidateSet.add(v);
    }

    const baseMaxDist = innerArr.length
      ? Math.max(...innerArr.map((i) => wardsCopy[i]?.distToCentre ?? 0))
      : 0;

    let cands = Array.from(candidateSet)
      .filter((v) => !isCore(v, innerSet))
      .sort((a, b) => {
        const da = wardsCopy[a]?.distToCentre ?? Infinity;
        const db = wardsCopy[b]?.distToCentre ?? Infinity;
        if (da !== db) return da - db;
        const ia = wardsCopy[a]?.id ?? 0;
        const ib = wardsCopy[b]?.id ?? 0;
        return ia - ib;
      });

    if (baseMaxDist > 0) {
      cands = cands.filter(
        (v) => (wardsCopy[v]?.distToCentre ?? Infinity) <= baseMaxDist * 1.35
      );
    }

    return cands.slice(0, candidateLimit);
  }

  function score(innerArr) {
    const { holeCount: holes } = buildDistrictLoopsFromWards(
      wardsCopy,
      fortCoreWardIds(innerArr)
    );

    let distSum = 0;
    for (const i of innerArr) distSum += wardsCopy[i]?.distToCentre ?? 1e9;
    return { holes, distSum };
  }

  const base = innerIdxsNow.slice();
  const baseScore = score(base);
  if (baseScore.holes === 0) return [];

  let beam = [{ seq: [], innerArr: base, ...baseScore }];

  for (let depth = 1; depth <= depthMax; depth++) {
    const next = [];

    for (const state of beam) {
      if (state.holes === 0) return state.seq;

      const cand = orderedCandidates(state.innerArr);
      for (const v of cand) {
        const inner2 = state.innerArr.concat([v]);
        const sc = score(inner2);
        next.push({ seq: state.seq.concat([v]), innerArr: inner2, ...sc });
      }
    }

    if (next.length === 0) break;

    next.sort((a, b) => {
      if (a.holes !== b.holes) return a.holes - b.holes;
      if (a.distSum !== b.distSum) return a.distSum - b.distSum;
      const aKey = a.seq.map((i) => String(wardsCopy[i]?.id ?? i)).join(",");
      const bKey = b.seq.map((i) => String(wardsCopy[i]?.id ?? i)).join(",");
      return aKey.localeCompare(bKey);
    });

    beam = next.slice(0, beamWidth);
    if (beam[0].holes === 0) return beam[0].seq;
  }

  const best = beam[0];
  if (best && best.holes < baseScore.holes) return best.seq;
  return [];
}
