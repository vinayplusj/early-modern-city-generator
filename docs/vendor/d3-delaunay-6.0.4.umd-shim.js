// ES module shim around the UMD global loaded by index.html.
// This keeps the rest of the codebase using ESM imports.

const d3 = globalThis.d3;

if (!d3 || !d3.Delaunay) {
  throw new Error("d3-delaunay UMD was not loaded. Check index.html script order.");
}

export const Delaunay = d3.Delaunay;
export const Voronoi = d3.Voronoi;
