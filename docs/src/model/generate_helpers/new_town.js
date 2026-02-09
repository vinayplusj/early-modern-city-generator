// docs/src/model/generate_helpers/new_town.js
//
// New Town placement and targeted bastion flattening.

import { centroid, pointInPoly } from "../../geom/poly.js";
import { polyIntersectsPoly, polyIntersectsPolyBuffered } from "../../geom/intersections.js";

import { generateNewTownGrid } from "../features.js";

export function placeNewTown({
  rng,
  gates,
  bastions,
  cx,
  cy,
  wallR,
  baseR,
  ditchOuter,
  wallBase,
  ditchWidth,
  glacisWidth,
  wallFinal: wallFinalIn,
  bastionPolys: bastionPolysIn,
}) {
  
  let wallFinal = wallFinalIn;
  let bastionPolys = bastionPolysIn;
  const startOffset0 = (ditchWidth + glacisWidth) * 1.6;

  // Wider search improves success rate without breaking determinism.
  const scales = [1.0, 0.92, 0.84, 0.76, 0.70, 0.64];
  const offsetMul = [1.0, 1.12, 1.25, 1.40, 1.55, 1.70];

  // Bastion buffer (explicit). 0.0 means strict geometry only.
  const bastionBuffer = 0.0;

  const stats = {
    tried: 0,
    badPoly: 0,
    centroidInsideDitch: 0,
    crossesDitch: 0,
    hitsWallBase: 0,
    ok: 0,
  };

  if (!Array.isArray(gates) || gates.length === 0) {
    return { newTown: null, primaryGate: null, hitBastions: [], stats, wallFinal, bastionPolys };
  }

  for (const g of gates) {
    for (const om of offsetMul) {
      for (const s of scales) {
        stats.tried++;

        const nt = generateNewTownGrid(g, cx, cy, wallR, baseR, startOffset0 * om, s);
        if (!nt || !nt.poly || nt.poly.length < 3) {
          stats.badPoly++;
          continue;
        }

        // Robust ditch test: centroid outside + no crossing
        const ntC = centroid(nt.poly);
        if (pointInPoly(ntC, ditchOuter)) {
          stats.centroidInsideDitch++;
          continue;
        }
        if (polyIntersectsPoly(nt.poly, ditchOuter)) {
          stats.crossesDitch++;
          continue;
        }

        // Avoid intersecting wall base edges.
        if (polyIntersectsPoly(nt.poly, wallBase)) {
          stats.hitsWallBase++;
          continue;
        }

        // Collect intersecting bastions (do not reject New Town).
        const hitBastions = [];
        for (let i = 0; i < (bastions?.length || 0); i++) {
          const b = bastions[i];
          if (!b || !b.pts || b.pts.length < 3) continue;
          if (polyIntersectsPolyBuffered(b.pts, nt.poly, bastionBuffer)) {
            hitBastions.push(i);
          }
        }

        // If a bastion overlaps the New Town, hide its polygon so it does not render over it.
        // (Fast Option A. Clipping can be added later.)
        const hitSet = new Set(hitBastions);
        
        const bastionPolysOut = (bastionPolys || []).map((poly, i) => {
          if (!Array.isArray(poly) || poly.length < 3) return poly;
          return hitSet.has(i) ? null : poly; // hide intersecting bastions
        });
        
        console.log("NEW TOWN HIT BASTIONS", { hitBastions, count: hitBastions.length });
        
        stats.ok++;
        return {
          newTown: nt,
          primaryGate: g,
          hitBastions,
          stats,
          wallFinal,
          bastionPolys: bastionPolysOut,
        };
      }
    }
  }  
  
  return {
    newTown: null,
    primaryGate: gates[0] || null,
    hitBastions: [],
    stats,
    wallFinal,
    bastionPolys,
  };
}
