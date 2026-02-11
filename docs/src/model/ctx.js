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
  };
}
