// docs/src/model/ctx.js
import { mulberry32 } from "../rng/mulberry32.js";
import { rngFork } from "../rng/rng_fork.js";

export function createCtx({ seed, w, h, site, params }) {
  const canvas = {
    w,
    h,
    cx: w * 0.5,
    cy: h * 0.55,
  };

  // One global RNG is fine for non-geometry UI choices, but stages should use forks.
  const rngGlobal = mulberry32(seed >>> 0);

  const rng = {
    global: rngGlobal,
    fort: rngFork(seed, "stage:fort"),
    wards: rngFork(seed, "stage:wards"),
    anchors: rngFork(seed, "stage:anchors"),
    newTown: rngFork(seed, "stage:newTown"),
    water: rngFork(seed, "stage:water"),   
    outworks: rngFork(seed, "stage:outworks"),
  };

  return {
    seed,
    canvas,
    site: { ...site },
    params: { ...params },
    rng,

    geom: {
      footprint: null,
      wallBase: null,
      wall: null,
    },
    
    wards: {
      seeds: null,
      cells: null,
      roleIndices: null,
    },
    
    // Canonical planar routing mesh (ward-derived Voronoi graph + face topology).
    // Stages should write here, even if some legacy code still passes vorGraph directly.
    mesh: {
      // Core graph (backward-compatible mirror of buildVoronoiPlanarGraph output)
      graph: null,        // { eps, nodes, edges, adj, cells, edgeCells }
    
      // Convenience mirrors (optional but useful for stage-local reads/debug)
      nodes: null,        // graph.nodes
      edges: null,        // graph.edges
      adj: null,          // graph.adj
      cells: null,        // graph.cells
      edgeCells: null,    // graph.edgeCells
    
      // Water snapped to mesh edges/nodes (Stage 70 output / later enrichments)
      water: null,        // mesh-aware water model (or null)
    
      // Future derived topology/products (Milestones 5+)
      routes: null,       // primary/secondary road path products
      regions: null,      // region partition on mesh cells
      blocks: null,       // extracted blocks from road graph
      parcels: null,      // parcel subdivision output
    },
  };
}
