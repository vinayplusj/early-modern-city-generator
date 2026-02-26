// docs/src/render/style/style_tokens.js
//
// Style tokens for map rendering.
// Purpose:
// - Provide consistent, scalable line widths and opacities across canvases.
// - Centralize biome (outside filler) styling rules.
// - Keep values deterministic: computed only from baseR (and optional exportScale).
//
// Contract:
// - All widths are in canvas pixels.
// - Do not hardcode colours elsewhere; reference these tokens.
// - Patterns (hatch/stipple) should use the returned spacing values for stability.

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function isFiniteNumber(n) {
  return Number.isFinite(n);
}

/**
 * Compute global width tokens based on baseR.
 * @param {object} args
 * @param {number} args.baseR - city base radius in pixels (or comparable scale)
 * @param {number} [args.exportScale=1] - optional multiplier for export (e.g. 2 for hi-res)
 * @returns {object} tokens
 */
export function makeStyleTokens({ baseR, exportScale = 1 }) {
  const r = isFiniteNumber(baseR) ? baseR : 160;
  const s = isFiniteNumber(exportScale) ? exportScale : 1;

  // "unit" is the stable scaling knob. Clamp keeps usability at extremes.
  const unit = clamp((r / 100) * s, 0.75, 3.25);

  const hairline = clamp(0.75 * s, 0.6 * s, 1.2 * s);
  const thin = clamp(1.0 * unit, 0.9 * s, 2.2 * s);
  const medium = clamp(1.5 * unit, 1.2 * s, 3.5 * s);
  const thick = clamp(2.5 * unit, 2.0 * s, 6.0 * s);
  const heavy = clamp(3.4 * unit, 2.8 * s, 8.0 * s);

  // Pattern spacings in pixels
  const hatchTight = clamp(6 * unit, 5 * s, 12 * s);
  const hatchWide = clamp(10 * unit, 8 * s, 18 * s);
  const stippleStep = clamp(4.5 * unit, 4 * s, 10 * s);

  // Alphas
  const alpha = {
    wardLines: 0.35,
    ditch: 0.6,
    glacis: 0.4,
    roadsPrimary: 0.95,
    roadsSecondary: 0.7,
    outsideFill: 0.18,
    outsideFillStrong: 0.22,
    outsideFillLight: 0.12,
    labelsHalo: 0.85,
  };

  // Colours (greyscale-first). Override later with themes.
  const colour = {
    background: "#f7f3ea",
    ink: "#111111",
    inkSoft: "rgba(0,0,0,0.55)",
    inkFaint: "rgba(0,0,0,0.30)",
    waterFill: "rgba(0,0,0,0.10)",
    waterStroke: "rgba(0,0,0,0.25)",
    roadPrimary: "#111111",
    roadSecondary: "rgba(0,0,0,0.55)",
    wall: "#111111",
    wallDebug: "rgba(0,0,0,0.55)",
    label: "#111111",
    labelHalo: "#f7f3ea",
  };

  // Inside-city layer styling
  const inside = {
    wards: {
      stroke: colour.inkFaint,
      width: hairline,
      alpha: alpha.wardLines,
    },
  
    // Ring1 wards: do not draw ward strokes/fills (roads still render normally).
    // Rendering code must honour this by skipping ward boundary rendering when ward.id is in fortHulls.ring1Ids.
    ring1Wards: {
      drawBoundaries: false,
      drawFills: false,
    },
  
    walls: {
      stroke: colour.wall,
      width: thick,
      alpha: 1.0,
    },
    curtainDebug: {
      stroke: colour.wallDebug,
      width: medium,
      alpha: 0.6,
      dash: [6 * unit, 4 * unit],
    },
    bastionDebug: {
      stroke: colour.inkSoft,
      width: thin,
      alpha: 0.5,
    },
    ditch: {
      stroke: colour.inkSoft,
      width: thin,
      alpha: alpha.ditch,
    },
    glacis: {
      stroke: colour.inkFaint,
      width: hairline,
      alpha: alpha.glacis,
    },
    roads: {
      primary: { stroke: colour.roadPrimary, width: medium, alpha: alpha.roadsPrimary },
      secondary: { stroke: colour.roadSecondary, width: thin, alpha: alpha.roadsSecondary },
    },
    labels: {
      fill: colour.label,
      halo: colour.labelHalo,
      haloWidth: thin,
      haloAlpha: alpha.labelsHalo,
      fontPx: clamp(10 * s, 10, 18),
    },
  };

  // Outside fillers (biomes) styling contract
  const outside = {
    // All outside patterns should be clipped to "outside of outerBoundary".
    common: {
      stroke: colour.inkFaint,
      alpha: alpha.outsideFill,
    },
    biomes: {
      farmland: {
        pattern: "hatch",
        hatch: {
          angleDeg: 20,
          spacingPx: hatchTight,
          stroke: colour.inkFaint,
          alpha: alpha.outsideFill,
          width: hairline,
          // subtle cross bands (field structure)
          secondary: { angleDeg: 110, spacingPx: hatchWide, alpha: 0.08, width: hairline },
        },
      },
    
      // Key names: use safe identifiers in JS. Prefer "broadleaf_forest" in code and map UI labels separately.
      broadleaf_forest: {
        pattern: "stipple",
        stipple: {
          stepPx: stippleStep, // medium density
          dotRadiusPx: clamp(0.9 * hairline, 0.6 * s, 1.4 * s),
          alpha: alpha.outsideFillStrong,
        },
        // faint canopy texture
        overlayHatch: { angleDeg: 45, spacingPx: hatchWide, alpha: 0.08, width: hairline },
      },
    
      coniferous_forest: {
        pattern: "stipple",
        stipple: {
          // denser than broadleaf to read as darker canopy
          stepPx: clamp(stippleStep * 0.85, 3.5 * s, 8.0 * s),
          dotRadiusPx: clamp(1.0 * hairline, 0.7 * s, 1.6 * s),
          alpha: clamp(alpha.outsideFillStrong + 0.03, 0.18, 0.28),
        },
        // a slightly steeper hatch angle to differentiate from broadleaf
        overlayHatch: { angleDeg: 60, spacingPx: hatchWide, alpha: 0.07, width: hairline },
      },
    
      grassland: {
        pattern: "hatch",
        hatch: {
          // near-horizontal lines read as “windswept grass”
          angleDeg: 5,
          spacingPx: clamp(hatchWide * 0.85, 7 * s, 16 * s),
          stroke: colour.inkFaint,
          alpha: clamp(alpha.outsideFillLight + 0.03, 0.10, 0.18),
          width: hairline,
          // occasional cross-lines, very light, to avoid looking like farmland
          secondary: { angleDeg: 95, spacingPx: clamp(hatchWide * 1.6, 12 * s, 28 * s), alpha: 0.04, width: hairline },
        },
      },
    
      desert: {
        pattern: "hatch",
        hatch: {
          angleDeg: -15,
          spacingPx: hatchWide,
          stroke: colour.inkFaint,
          alpha: alpha.outsideFillLight,
          width: hairline,
          // faint dune direction variation
          secondary: { angleDeg: 60, spacingPx: clamp(18 * unit, 14 * s, 28 * s), alpha: 0.06, width: hairline },
        },
      },
    
      wetland: {
        pattern: "hatch",
        hatch: {
          // diagonal reads as “reeds / marsh texture”
          angleDeg: 35,
          spacingPx: clamp(hatchTight * 0.9, 4.5 * s, 10 * s),
          stroke: colour.inkFaint,
          alpha: clamp(alpha.outsideFill + 0.03, 0.14, 0.24),
          width: hairline,
          // crosshatch to suggest tangled vegetation / channels
          secondary: { angleDeg: -35, spacingPx: hatchWide, alpha: 0.07, width: hairline },
        },
        // optional: if you later add a water-adjacent mask, you can overlay sparse stipple there
        // overlayStipple: { stepPx: clamp(stippleStep * 1.4, 6 * s, 14 * s), dotRadiusPx: hairline, alpha: 0.08 }
      },
    
      tundra: {
        pattern: "hatch",
        hatch: {
          // sparse, low-contrast texture
          angleDeg: 0,
          spacingPx: clamp(hatchWide * 1.1, 10 * s, 22 * s),
          stroke: colour.inkFaint,
          alpha: 0.09,
          width: hairline,
          // faint second direction to imply rough ground / permafrost cracks
          secondary: { angleDeg: 90, spacingPx: clamp(hatchWide * 2.0, 14 * s, 32 * s), alpha: 0.04, width: hairline },
        },
      },
    
      mountain: {
        pattern: "hatch",
        hatch: {
          // steeper angle reads as slope shading
          angleDeg: 75,
          spacingPx: clamp(hatchTight * 0.85, 4.5 * s, 10 * s),
          stroke: colour.inkFaint,
          alpha: clamp(alpha.outsideFillStrong, 0.16, 0.26),
          width: hairline,
          // secondary hatch gives “rock texture” without going full crosshatch
          secondary: { angleDeg: 25, spacingPx: clamp(hatchWide * 0.9, 8 * s, 18 * s), alpha: 0.06, width: hairline },
        },
        // optional future: contour lines as separate layer, not part of biome fill
      },
    }

    // Exterior road continuations (Milestone 5): lower alpha than interior roads
    exteriorRoads: {
      primary: { stroke: colour.roadPrimary, width: medium, alpha: 0.75 },
      secondary: { stroke: colour.roadSecondary, width: thin, alpha: 0.55 },
    },
  };

  return {
    baseR: r,
    exportScale: s,
    unit,
    width: { hairline, thin, medium, thick, heavy },
    spacing: { hatchTight, hatchWide, stippleStep },
    alpha,
    colour,
    inside,
    outside,
  };
}
