// docs/src/model/mesh/city_mesh/invariants.js
//
// CityMesh invariants for Milestone 4.7.
// These checks are intentionally strict and throw on failure.
// Keep them deterministic and side-effect free.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertInt(n, msg) {
  assert(Number.isInteger(n), msg);
}

function assertFinite(n, msg) {
  assert(Number.isFinite(n), msg);
}

function assertPoint(p, msg) {
  assert(p && typeof p === "object", msg);
  assertFinite(p.x, `${msg} (x)`);
  assertFinite(p.y, `${msg} (y)`);
}

function walkLoop(halfEdges, startId, nextKey, maxSteps) {
  const visited = new Set();
  let cur = startId;

  for (let i = 0; i < maxSteps; i++) {
    if (visited.has(cur)) break;
    visited.add(cur);

    const he = halfEdges[cur];
    assert(he, `[CityMesh] invariant: missing halfEdge ${cur} during loop walk`);
    cur = he[nextKey];
    assertInt(cur, `[CityMesh] invariant: halfEdge ${he.id} has invalid ${nextKey}`);
  }

  return { visited, end: cur };
}

/**
 * @param {object} mesh
 * @param {object} [opts]
 * @param {boolean} [opts.requireBoundaryLoops=true]
 */
export function assertCityMesh(mesh, opts = {}) {
  const requireBoundaryLoops = opts.requireBoundaryLoops !== false;

  assert(mesh && typeof mesh === "object", "[CityMesh] invariant: mesh is required");
  const { vertices, halfEdges, faces, boundaryLoops } = mesh;

  assert(Array.isArray(vertices), "[CityMesh] invariant: mesh.vertices must be an array");
  assert(Array.isArray(halfEdges), "[CityMesh] invariant: mesh.halfEdges must be an array");
  assert(Array.isArray(faces), "[CityMesh] invariant: mesh.faces must be an array");
  assert(Array.isArray(boundaryLoops), "[CityMesh] invariant: mesh.boundaryLoops must be an array");

  // ---- Vertex checks ----
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    assert(v && typeof v === "object", `[CityMesh] invariant: vertex ${i} missing`);
    assertInt(v.id, `[CityMesh] invariant: vertex ${i} missing integer id`);
    assertFinite(v.x, `[CityMesh] invariant: vertex ${v.id} has invalid x`);
    assertFinite(v.y, `[CityMesh] invariant: vertex ${v.id} has invalid y`);

    if (v.outgoing != null) {
      assertInt(v.outgoing, `[CityMesh] invariant: vertex ${v.id} outgoing must be int or null`);
      assert(v.outgoing >= 0 && v.outgoing < halfEdges.length, `[CityMesh] invariant: vertex ${v.id} outgoing out of range`);
      const he = halfEdges[v.outgoing];
      assert(he && he.origin === v.id, `[CityMesh] invariant: vertex ${v.id} outgoing halfEdge origin mismatch`);
    }
  }

  // ---- Half-edge checks ----
  for (let i = 0; i < halfEdges.length; i++) {
    const he = halfEdges[i];
    assert(he && typeof he === "object", `[CityMesh] invariant: halfEdge ${i} missing`);
    assertInt(he.id, `[CityMesh] invariant: halfEdge ${i} missing integer id`);
    assert(he.id === i, `[CityMesh] invariant: halfEdge id mismatch at index ${i} (id=${he.id})`);

    assertInt(he.origin, `[CityMesh] invariant: halfEdge ${he.id} missing origin`);
    assertInt(he.to, `[CityMesh] invariant: halfEdge ${he.id} missing to`);
    assertInt(he.edgeId, `[CityMesh] invariant: halfEdge ${he.id} missing edgeId`);
    assertInt(he.face, `[CityMesh] invariant: halfEdge ${he.id} missing face`);

    assertInt(he.next, `[CityMesh] invariant: halfEdge ${he.id} missing next`);
    assertInt(he.prev, `[CityMesh] invariant: halfEdge ${he.id} missing prev`);

    assert(he.next >= 0 && he.next < halfEdges.length, `[CityMesh] invariant: halfEdge ${he.id} next out of range`);
    assert(he.prev >= 0 && he.prev < halfEdges.length, `[CityMesh] invariant: halfEdge ${he.id} prev out of range`);

    // prev/next consistency
    assert(halfEdges[he.next].prev === he.id, `[CityMesh] invariant: halfEdge ${he.id} next.prev mismatch`);
    assert(halfEdges[he.prev].next === he.id, `[CityMesh] invariant: halfEdge ${he.id} prev.next mismatch`);

    // twin symmetry (if present)
    if (he.twin != null) {
      assertInt(he.twin, `[CityMesh] invariant: halfEdge ${he.id} twin must be int or null`);
      assert(he.twin >= 0 && he.twin < halfEdges.length, `[CityMesh] invariant: halfEdge ${he.id} twin out of range`);
      const tw = halfEdges[he.twin];
      assert(tw && tw.twin === he.id, `[CityMesh] invariant: halfEdge ${he.id} twin symmetry failed`);
      assert(tw.edgeId === he.edgeId, `[CityMesh] invariant: halfEdge ${he.id} twin edgeId mismatch`);
      assert(tw.origin === he.to && tw.to === he.origin, `[CityMesh] invariant: halfEdge ${he.id} twin direction mismatch`);
    } else {
      // boundary: must have boundaryLoop id assigned later if boundaryLoops are required
      if (requireBoundaryLoops) {
        assertInt(he.boundaryLoop, `[CityMesh] invariant: boundary halfEdge ${he.id} missing boundaryLoop id`);
      }
    }
  }

  // ---- Face checks: loop closure and membership ----
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    assert(f && typeof f === "object", `[CityMesh] invariant: face ${i} missing`);
    assertInt(f.id, `[CityMesh] invariant: face ${i} missing integer id`);
    assertInt(f.anyHalfEdge, `[CityMesh] invariant: face ${f.id} missing anyHalfEdge`);
    assert(Array.isArray(f.halfEdges), `[CityMesh] invariant: face ${f.id} halfEdges must be array`);
    assert(f.halfEdges.length >= 3, `[CityMesh] invariant: face ${f.id} must have >= 3 halfEdges`);

    // Walk next pointers exactly n steps and return to start
    const start = f.anyHalfEdge;
    const n = f.halfEdges.length;

    let cur = start;
    for (let k = 0; k < n; k++) {
      const he = halfEdges[cur];
      assert(he, `[CityMesh] invariant: face ${f.id} references missing halfEdge ${cur}`);
      assert(he.face === f.id, `[CityMesh] invariant: face ${f.id} loop contains halfEdge from face ${he.face}`);
      cur = he.next;
    }
    assert(cur === start, `[CityMesh] invariant: face ${f.id} loop does not close in ${n} steps`);
  }

  // ---- Boundary loops ----
  if (requireBoundaryLoops) {
    assert(boundaryLoops.length >= 1, "[CityMesh] invariant: expected at least one boundary loop");

    const seenBoundaryHalfEdges = new Set();

    for (const loop of boundaryLoops) {
      assert(loop && typeof loop === "object", "[CityMesh] invariant: boundary loop missing");
      assertInt(loop.id, "[CityMesh] invariant: boundary loop missing id");
      assert(Array.isArray(loop.halfEdges), `[CityMesh] invariant: boundary loop ${loop.id} halfEdges must be array`);
      assert(loop.halfEdges.length >= 3, `[CityMesh] invariant: boundary loop ${loop.id} too small`);

      if (Array.isArray(loop.polygon)) {
        for (const p of loop.polygon) assertPoint(p, `[CityMesh] invariant: boundary loop ${loop.id} polygon point invalid`);
      }

      // Each boundary half-edge must:
      // - exist
      // - be boundary (twin null)
      // - belong to this loop id
      for (const heId of loop.halfEdges) {
        assertInt(heId, `[CityMesh] invariant: boundary loop ${loop.id} contains non-int halfEdge id`);
        assert(heId >= 0 && heId < halfEdges.length, `[CityMesh] invariant: boundary loop ${loop.id} halfEdge id out of range`);
        const he = halfEdges[heId];
        assert(he.twin == null, `[CityMesh] invariant: boundary loop ${loop.id} contains non-boundary halfEdge ${heId}`);
        assert(he.boundaryLoop === loop.id, `[CityMesh] invariant: boundary halfEdge ${heId} boundaryLoop mismatch`);
        assert(!seenBoundaryHalfEdges.has(heId), `[CityMesh] invariant: boundary halfEdge ${heId} appears in multiple loops`);
        seenBoundaryHalfEdges.add(heId);
      }

      // Loop closure by walking the loop’s own ordering (cheap check)
      // Verify consecutive half-edges connect: to of prev == origin of next
      for (let i = 0; i < loop.halfEdges.length; i++) {
        const a = halfEdges[loop.halfEdges[i]];
        const b = halfEdges[loop.halfEdges[(i + 1) % loop.halfEdges.length]];
        assert(a.to === b.origin, `[CityMesh] invariant: boundary loop ${loop.id} is not continuous at index ${i}`);
      }
    }

    // Ensure all boundary half-edges are assigned to some loop
    for (const he of halfEdges) {
      if (he.twin == null) {
        assert(seenBoundaryHalfEdges.has(he.id), `[CityMesh] invariant: boundary halfEdge ${he.id} not present in any boundary loop`);
      }
    }
  }

  return true;
}
