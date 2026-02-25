// docs/src/model/stages/075_city_mesh_graph_audit.js
//
// Stage 075: CityMesh ↔ GraphView audit (debug-only).
//
// Purpose (Milestone 4.7 migration correctness):
// Prove that the routing graph (GraphView) is consistent with CityMesh topology.
//
// This stage is side-effect free. It throws on invariant failures when enabled.
// Enable via ctx.params.meshAuditEnabled === true (recommended), or reuse ctx.params.warpDebugEnabled.
//
// Inputs (expected on ctx.state.routingMesh):
// - cityMesh: { vertices[], halfEdges[], faces[], boundaryLoops[] }
// - graph:    { nodes[], edges[], adj[], cells[], edgeCells[] }
//
// Output:
// - ctx.state.meshAudit = { ok:true, stats:{...} } when enabled and passes
//
// Notes:
// - This audit is deterministic and intended for developer builds.
// - It is safe to run on every generate when meshAuditEnabled is true.

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function keyUndirected(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildCityMeshEdgeEndpointMap(cityMesh) {
  // edgeId -> { a, b, faces:Set<number>, heCount:number }
  const map = new Map();

  const halfEdges = cityMesh?.halfEdges || [];
  for (let i = 0; i < halfEdges.length; i++) {
    const he = halfEdges[i];
    if (!he) continue;
    const edgeId = he.edgeId;
    if (!Number.isInteger(edgeId)) continue;

    const a = Math.min(he.origin, he.to);
    const b = Math.max(he.origin, he.to);

    let rec = map.get(edgeId);
    if (!rec) {
      rec = { a, b, faces: new Set(), heCount: 0 };
      map.set(edgeId, rec);
    } else {
      // Endpoints must match for the same undirected edge id
      if (rec.a !== a || rec.b !== b) {
        throw new Error(
          `[EMCG][075] CityMesh edgeId ${edgeId} has inconsistent endpoints: ` +
          `(${rec.a},${rec.b}) vs (${a},${b})`
        );
      }
    }

    if (Number.isInteger(he.face)) rec.faces.add(he.face);
    rec.heCount += 1;
  }

  return map;
}

function validateAdjacencySymmetry(graph) {
  const adj = graph.adj || [];
  // Build fast lookup: u|v|edgeId present?
  const seen = new Set();

  for (let u = 0; u < adj.length; u++) {
    const list = adj[u];
    if (!Array.isArray(list)) continue;

    for (const step of list) {
      if (!step) continue;
      const v = step.to;
      const edgeId = step.edgeId;
      if (!Number.isInteger(v) || !Number.isInteger(edgeId)) continue;

      seen.add(`${u}|${v}|${edgeId}`);
    }
  }

  // Verify reverse edges exist
  for (let u = 0; u < adj.length; u++) {
    const list = adj[u];
    if (!Array.isArray(list)) continue;

    for (const step of list) {
      if (!step) continue;
      const v = step.to;
      const edgeId = step.edgeId;
      if (!Number.isInteger(v) || !Number.isInteger(edgeId)) continue;

      if (!seen.has(`${v}|${u}|${edgeId}`)) {
        throw new Error(`[EMCG][075] Adjacency not symmetric for ${u} -> ${v} (edgeId ${edgeId}).`);
      }
    }
  }
}

function validateGraphEdgeEndpoints(graph, cityEdgeMap) {
  const edges = graph.edges || [];

  for (let edgeId = 0; edgeId < edges.length; edgeId++) {
    const e = edges[edgeId];
    if (!e) continue;

    // Graph contract in your repo generally uses id==index. Still allow mismatch but check by e.id.
    const gid = Number.isInteger(e.id) ? e.id : edgeId;

    // CityMesh must have a record for any non-null graph edge
    const rec = cityEdgeMap.get(gid);
    if (!rec) {
      throw new Error(`[EMCG][075] Graph edgeId ${gid} not found in CityMesh half-edges.`);
    }

    const a = Math.min(e.a, e.b);
    const b = Math.max(e.a, e.b);

    if (a !== rec.a || b !== rec.b) {
      throw new Error(
        `[EMCG][075] Edge endpoints mismatch for edgeId ${gid}: ` +
        `graph (${a},${b}) vs CityMesh (${rec.a},${rec.b})`
      );
    }
  }
}

function validateEdgeCells(graph, cityEdgeMap) {
  const edgeCells = graph.edgeCells || [];
  const edges = graph.edges || [];

  for (let edgeId = 0; edgeId < edgeCells.length; edgeId++) {
    const inc = edgeCells[edgeId];
    if (!Array.isArray(inc)) continue;

    if (inc.length > 2) {
      throw new Error(`[EMCG][075] graph.edgeCells[${edgeId}] has ${inc.length} incident faces (>2).`);
    }

    const e = edges[edgeId];
    if (!e) continue;

    const gid = Number.isInteger(e.id) ? e.id : edgeId;
    const rec = cityEdgeMap.get(gid);
    if (!rec) continue;

    // Compare sets (order independent). Graph view sorts inc ascending; still compare as sets.
    const gset = new Set(inc);
    const cset = rec.faces;

    // graph edgeCells may omit faces if your GraphView omitted disabled faces; treat mismatch as error
    if (gset.size !== cset.size) {
      throw new Error(
        `[EMCG][075] edgeCells mismatch for edgeId ${gid}: graph has ${gset.size}, CityMesh has ${cset.size}`
      );
    }

    for (const f of cset) {
      if (!gset.has(f)) {
        throw new Error(`[EMCG][075] edgeCells mismatch for edgeId ${gid}: missing face ${f} in graph.edgeCells.`);
      }
    }
  }
}

function validateFaceBoundaryRoundTrip(graph) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const cells = graph.cells || [];

  // Validate a sample of faces for speed; in debug you can validate all.
  // Deterministic sample: take up to 25 faces with smallest ids that exist.
  const faceIds = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) faceIds.push(i);
    if (faceIds.length >= 25) break;
  }

  for (const fid of faceIds) {
    const c = cells[fid];
    if (!c) continue;

    const nodeIds = c.nodeIds;
    const edgeIds = c.edgeIds;

    assert(Array.isArray(nodeIds) && Array.isArray(edgeIds), `[EMCG][075] cell ${fid} missing nodeIds/edgeIds.`);
    assert(nodeIds.length === edgeIds.length, `[EMCG][075] cell ${fid} nodeIds/edgeIds length mismatch.`);
    assert(nodeIds.length >= 3, `[EMCG][075] cell ${fid} has < 3 vertices.`);

    for (let i = 0; i < nodeIds.length; i++) {
      const aId = nodeIds[i];
      const bId = nodeIds[(i + 1) % nodeIds.length];
      const edgeId = edgeIds[i];

      const a = nodes[aId];
      const b = nodes[bId];
      assert(a && b, `[EMCG][075] cell ${fid} references missing node(s) ${aId},${bId}.`);
      assert(isFinitePoint(a) && isFinitePoint(b), `[EMCG][075] cell ${fid} node(s) have invalid coords.`);

      const e = edges[edgeId];
      assert(e, `[EMCG][075] cell ${fid} references missing edge ${edgeId}.`);

      // Edge endpoints must match this boundary step ignoring direction
      const ea = e.a;
      const eb = e.b;
      const ok = (ea === aId && eb === bId) || (ea === bId && eb === aId);
      assert(ok, `[EMCG][075] cell ${fid} boundary edge ${edgeId} endpoints do not match nodes (${aId},${bId}).`);
    }
  }
}

/**
 * Run the audit when enabled.
 * @param {object} env
 */
export function runCityMeshGraphAuditStage(env) {
  const ctx = env?.ctx;
  if (!ctx) throw new Error("[EMCG][075] Missing ctx.");

  const enabled = Boolean(ctx.params?.meshAuditEnabled) || Boolean(ctx.params?.warpDebugEnabled);
  if (!enabled) {
    // Keep state predictable: do not write anything when disabled.
    return;
  }

  const routingMesh = ctx.state?.routingMesh;
  if (!routingMesh) throw new Error("[EMCG][075] Missing ctx.state.routingMesh.");

  const cityMesh = routingMesh.cityMesh;
  const graph = routingMesh.graph;

  if (!cityMesh) throw new Error("[EMCG][075] Missing routingMesh.cityMesh.");
  if (!graph) throw new Error("[EMCG][075] Missing routingMesh.graph.");

  // Basic shape checks
  assert(Array.isArray(graph.nodes), "[EMCG][075] routingMesh.graph.nodes must be an array.");
  assert(Array.isArray(graph.edges), "[EMCG][075] routingMesh.graph.edges must be an array.");
  assert(Array.isArray(graph.adj), "[EMCG][075] routingMesh.graph.adj must be an array.");
  assert(Array.isArray(graph.cells), "[EMCG][075] routingMesh.graph.cells must be an array.");
  assert(Array.isArray(graph.edgeCells), "[EMCG][075] routingMesh.graph.edgeCells must be an array.");

  // Build CityMesh edge map and validate against graph
  const cityEdgeMap = buildCityMeshEdgeEndpointMap(cityMesh);

  validateAdjacencySymmetry(graph);
  validateGraphEdgeEndpoints(graph, cityEdgeMap);
  validateEdgeCells(graph, cityEdgeMap);
  validateFaceBoundaryRoundTrip(graph);

  // Stats for debugging / introspection
  const stats = {
    nodes: graph.nodes.filter(Boolean).length,
    edges: graph.edges.filter(Boolean).length,
    faces: graph.cells.filter(Boolean).length,
    cityHalfEdges: Array.isArray(cityMesh.halfEdges) ? cityMesh.halfEdges.length : 0,
    cityBoundaryLoops: Array.isArray(cityMesh.boundaryLoops) ? cityMesh.boundaryLoops.length : 0,
  };

  ctx.state.meshAudit = { ok: true, stats };
}
