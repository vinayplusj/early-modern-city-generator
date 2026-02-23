// docs/src/model/generate_helpers/warp_apply.js
// Warp application helpers (shim).
//
// Phase 1 (thinning): behaviour-preserving re-export.
// Purpose: allow generate_helpers/* to import apply functions from a local helper
// module, while the real implementation still lives behind ../warp.js.
//
// Later, when docs/src/model/warp.js becomes a thin facade over warp_apply.js,
// this file can be updated to point directly at ../warp_apply.js (or removed).

export { buildWarpField, warpPolylineRadial, warpPointRadial } from "../warp.js";
