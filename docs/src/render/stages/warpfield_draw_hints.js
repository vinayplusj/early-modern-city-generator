// docs/src/render/stages/warpfield_draw_hints.js
//
// Apply draw style hints for warpfield outputs.
// Extracted from: docs/src/model/stages/110_warp_field.js
//
// Behaviour: identical to the inlined "Draw style hints (consumed by renderer)" block.
//
// AUDIT (sha256 of extracted helper block, LF newlines):
// TODO_REPLACE_WITH_REAL_SHA256

/**
 * Mutates warpWall and warpOutworks by attaching draw style hints consumed by the renderer.
 *
 * @param {object} args
 * @param {object|null} args.warpWall
 * @param {object|null} args.warpOutworks
 * @returns {void}
 */
export function applyWarpfieldDrawHints({ warpWall, warpOutworks }) {
  // ---- Draw style hints (consumed by renderer) ----
  if (warpWall) {
    // Warped curtain wall (inner/warped reference)
    warpWall.drawCurtain = {
      stroke: "#00ff00", // debug green (pick what you want)
      width: 3,
    };

    // Final composite wall (bastioned outline)
    warpWall.drawComposite = {
      stroke: "#6e8190", // normal wall grey (pick what you want)
      width: 3,
    };
  }

  // Outworks (bastions, ravelins, etc.): light orange
  if (warpOutworks) {
    warpOutworks.draw = {
      stroke: "#b5aea1", // light orange
      width: 2,
    };
  }
}
