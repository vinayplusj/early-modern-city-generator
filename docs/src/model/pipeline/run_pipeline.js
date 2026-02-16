// docs/src/model/pipeline/run_pipeline.js
//
// Pipeline runner for the city generator.
// Phase 1: no-op runner. It exists only to create a stable refactor seam.
// Later phases will call stage modules in a strict order.

export function runPipeline(ctx) {
  // Intentionally do nothing in Phase 1.
  // All work still happens inside generate.js.
  return ctx;
}
