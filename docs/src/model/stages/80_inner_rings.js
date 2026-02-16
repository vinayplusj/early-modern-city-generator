// docs/src/model/stages/80_inner_rings.js
//
// Stage 80: Inner rings (pre-warp).
// Extracted from generate.js without functional changes.

import { offsetRadial } from "../../geom/offset.js";

/**
 * @param {Array<{x:number,y:number}>} wallBase
 * @param {number} cx
 * @param {number} cy
 * @param {number} wallR
 * @returns {{ ring: Array, ring2: Array }}
 */
export function runInnerRingsStage(wallBase, cx, cy, wallR) {
  const ring = offsetRadial(wallBase, cx, cy, -wallR * 0.06);
  const ring2 = offsetRadial(wallBase, cx, cy, -wallR * 0.13);
  return { ring, ring2 };
}
