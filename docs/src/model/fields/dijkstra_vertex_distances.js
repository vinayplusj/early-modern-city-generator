// docs/src/model/fields/dijkstra_vertex_distances.js
//
// Deterministic multi-source Dijkstra over the CityMesh vertex graph.
//
// Contract:
// - Inputs are only meshAccess callbacks and a list of source vertex ids.
// - Output is a Float64Array of length vertexCount.
// - Deterministic as long as:
//   * meshAccess.iterVertexIds() yields a stable order (or ids are dense 0..N-1)
//   * meshAccess.vertexNeighboursWeighted(vId) yields neighbours in a stable order
//   * edge weights are deterministic and non-negative
//
// Notes:
// - We use a binary min-heap with deterministic tie-breaking:
//   (dist, vertexId). This ensures stable traversal even when distances tie.
//
// No imports; keep dependency-free.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---------- Min-heap (priority queue) ----------
class MinHeap {
  constructor() {
    this._d = []; // items: {k:number, v:number} where k=distance, v=vertexId
  }

  get size() {
    return this._d.length;
  }

  push(item) {
    this._d.push(item);
    this._siftUp(this._d.length - 1);
  }

  pop() {
    const a = this._d;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  _less(i, j) {
    const a = this._d[i];
    const b = this._d[j];
    // Deterministic ordering: primary by distance, secondary by vertex id
    if (a.k !== b.k) return a.k < b.k;
    return a.v < b.v;
  }

  _siftUp(i) {
    const a = this._d;
    while (i > 0) {
      const p = ((i - 1) / 2) | 0;
      if (!this._less(i, p)) break;
      const tmp = a[i];
      a[i] = a[p];
      a[p] = tmp;
      i = p;
    }
  }

  _siftDown(i) {
    const a = this._d;
    const n = a.length;
    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;

      if (l < n && this._less(l, m)) m = l;
      if (r < n && this._less(r, m)) m = r;

      if (m === i) break;
      const tmp = a[i];
      a[i] = a[m];
      a[m] = tmp;
      i = m;
    }
  }
}

// ---------- Helpers ----------
function toIntId(id, label) {
  if (typeof id === "number") {
    assert(Number.isFinite(id), `Non-finite ${label} id: ${id}`);
    return id | 0;
  }
  if (typeof id === "string") {
    assert(/^-?\d+$/.test(id), `Non-integer ${label} id string: "${id}"`);
    return (Number(id) | 0);
  }
  throw new Error(`Unsupported ${label} id type: ${typeof id}`);
}

/**
 * Create a deterministic mapping from vertex ids to dense indices [0..vertexCount-1].
 * If vertex ids are already dense indices, this becomes identity.
 *
 * @param {object} meshAccess
 * @returns {{ids:number[], idToIndex:Map<number,number>}}
 */
function buildVertexIdIndex(meshAccess) {
  assert(meshAccess && typeof meshAccess.getVertexCount === "function", "meshAccess.getVertexCount must be provided.");
  const vertexCount = meshAccess.getVertexCount();
  assert(Number.isFinite(vertexCount) && vertexCount >= 0, `Invalid vertexCount: ${vertexCount}`);

  const ids = [];

  if (typeof meshAccess.iterVertexIds === "function") {
    for (const vId of meshAccess.iterVertexIds()) ids.push(toIntId(vId, "vertex"));
  } else {
    for (let i = 0; i < vertexCount; i++) ids.push(i);
  }

  assert(ids.length === vertexCount, `iterVertexIds length ${ids.length} does not match vertexCount ${vertexCount}.`);

  const idToIndex = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    assert(!idToIndex.has(id), `Duplicate vertex id in iterVertexIds: ${id}`);
    idToIndex.set(id, i);
  }

  return { ids, idToIndex };
}

/**
 * Multi-source Dijkstra on the vertex graph.
 *
 * @param {object} args
 * @param {object} args.meshAccess - must provide getVertexCount() and vertexNeighboursWeighted(vId)
 * @param {Array<number|string>} args.sources - list of vertex ids (or strings convertible to int)
 * @param {number} [args.maxDistance] - optional cap; distances above cap remain computed but can be clamped by caller
 * @returns {Float64Array} distances by dense vertex index (stable order from iterVertexIds or [0..N-1])
 */
export function dijkstraVertexDistances(args) {
  assert(args && args.meshAccess, "dijkstraVertexDistances requires args.meshAccess.");
  const ma = args.meshAccess;

  assert(typeof ma.getVertexCount === "function", "meshAccess.getVertexCount must be a function.");
  assert(typeof ma.vertexNeighboursWeighted === "function", "meshAccess.vertexNeighboursWeighted(vId) must be provided.");

  const vertexCount = ma.getVertexCount();
  assert(Number.isFinite(vertexCount) && vertexCount >= 0, `Invalid vertexCount: ${vertexCount}`);

  const { ids, idToIndex } = buildVertexIdIndex(ma);

  const dist = new Float64Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) dist[i] = Infinity;

  const heap = new MinHeap();

  const sources = Array.isArray(args.sources) ? args.sources : [];
  assert(sources.length > 0, "dijkstraVertexDistances requires at least one source vertex id.");

  // Initialise all sources with distance 0.
  for (let i = 0; i < sources.length; i++) {
    const sid = toIntId(sources[i], "vertex");
    const sIdx = idToIndex.get(sid);
    assert(sIdx != null, `Source vertex id not found in mesh: ${sid}`);
    if (dist[sIdx] > 0) {
      dist[sIdx] = 0;
      heap.push({ k: 0, v: sid });
    }
  }

  const maxDistance = args.maxDistance == null ? Infinity : Number(args.maxDistance);
  assert(Number.isFinite(maxDistance) && maxDistance >= 0, `Invalid maxDistance: ${args.maxDistance}`);

  // Main loop
  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;

    const uId = item.v;
    const uIdx = idToIndex.get(uId);
    if (uIdx == null) continue;

    const du = item.k;
    if (du !== dist[uIdx]) continue; // stale heap entry

    if (du > maxDistance) continue; // optional early stop for bounded fields

    const nbrs = ma.vertexNeighboursWeighted(uId);
    assert(Array.isArray(nbrs), "vertexNeighboursWeighted(vId) must return an Array<{to,w}>.");

    for (let k = 0; k < nbrs.length; k++) {
      const e = nbrs[k];
      assert(e && e.to != null && e.w != null, "Neighbour entry must be {to, w}.");
      const vId = toIntId(e.to, "vertex");
      const w = Number(e.w);

      assert(Number.isFinite(w) && w >= 0, `Edge weight must be finite and >= 0; got ${w}`);

      const vIdx = idToIndex.get(vId);
      if (vIdx == null) continue;

      const nd = du + w;
      if (nd < dist[vIdx]) {
        dist[vIdx] = nd;
        heap.push({ k: nd, v: vId });
      }
    }
  }

  // Replace remaining Infinity (disconnected components) with a large finite value?
  // For now, keep Infinity so callers can decide how to handle it.
  // But we ensure the array is valid Float64Array regardless.

  return dist;
}
