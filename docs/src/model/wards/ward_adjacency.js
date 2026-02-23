// docs/src/model/wards/ward_adjacency.js
//
// Build a deterministic ward adjacency list by detecting shared polygon edges.
//
// Behaviour notes
// - This uses quantised point keys to match shared edges.
// - It is deterministic: adjacency lists are sorted numerically.
// - It accepts wards with either `poly` or `polygon` arrays.

function wardPolyOrNull(w) {
  const a = w?.poly;
  if (Array.isArray(a) && a.length >= 3) return a;

  const b = w?.polygon;
  if (Array.isArray(b) && b.length >= 3) return b;

  return null;
}

function computeBBoxFromWards(wards) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const w of wards) {
    const poly = wardPolyOrNull(w);
    if (!poly) continue;

    for (const p of poly) {
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function edgeKey(aKey, bKey) {
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

/**
 * @param {Array<object>} wards
 * @returns {number[][]} adj where adj[i] is a sorted array of neighbour indices for ward i
 */
export function wardAdjacency(wards) {
  const bbox = computeBBoxFromWards(wards);
  if (!bbox) return wards.map(() => []);

  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const diag = Math.sqrt(dx * dx + dy * dy);

  const eps = Math.max(1e-6, Math.min(1e-2, diag * 2e-6));
  const inv = 1 / eps;

  const keyOf = (p) => `${Math.round(p.x * inv)},${Math.round(p.y * inv)}`;

  // edgeKey -> list of ward indices that have this edge
  const edgeOwners = new Map();

  for (let wi = 0; wi < wards.length; wi++) {
    const poly = wardPolyOrNull(wards[wi]);
    if (!poly) continue;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;

      const aKey = keyOf(a);
      const bKey = keyOf(b);
      if (aKey === bKey) continue;

      const k = edgeKey(aKey, bKey);
      if (!edgeOwners.has(k)) edgeOwners.set(k, []);
      edgeOwners.get(k).push(wi);
    }
  }

  const adj = wards.map(() => new Set());

  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;

    // If more than 2 owners due to quantisation, connect all pairs deterministically.
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i];
        const b = owners[j];
        adj[a].add(b);
        adj[b].add(a);
      }
    }
  }

  return adj.map((s) => Array.from(s).sort((a, b) => a - b));
}
