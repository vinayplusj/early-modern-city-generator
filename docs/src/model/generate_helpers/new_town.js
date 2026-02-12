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
  const bastionBuffer = 1.5;

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

      // If a bastion overlaps the New Town, delete it.
      // Deletion has two parts:
      // 1) Hide its bastion polygon (bastionPolysOut[i] = null)
      // 2) Flatten its wall protrusion back to a straight shoulder-to-shoulder segment
      const hitSet = new Set(hitBastions);
      
      // 1) Hide intersecting bastion polygons (render-layer fix)
      const bastionPolysOut = (bastionPolys || []).map((poly, i) => {
        if (!Array.isArray(poly) || poly.length < 3) return poly;
        return hitSet.has(i) ? null : poly;
      });
      
      // 2) Remove intersecting bastion protrusions from the wall polyline (geometry-layer fix)
      const wallFinalOut = (bastions || []).flatMap((b, i) => {
        if (!b || !Array.isArray(b.pts) || b.pts.length < 2) return [];
      
        if (!hitSet.has(i)) return b.pts;
      
        // Flatten: keep only the two shoulder points.
        // Fallback to endpoints if shoulders are missing.
        const s0 = (Array.isArray(b.shoulders) && b.shoulders[0]) ? b.shoulders[0] : b.pts[0];
        const s1 = (Array.isArray(b.shoulders) && b.shoulders[1]) ? b.shoulders[1] : b.pts[b.pts.length - 1];
        return [s0, s1];
      });
        
      // Sanity: keep wall usable as a polygon-like loop.
      // Remove adjacent duplicates and ensure we still have enough points to draw.
      const cleanedWall = [];
      for (const p of wallFinalOut) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const last = cleanedWall[cleanedWall.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
        cleanedWall.push(p);
      }

      // If cleaning made it unusable, fall back to the incoming wall.
      const wallFinalSafe = (cleanedWall.length >= 8) ? cleanedWall : wallFinal;
        
      stats.ok++;
      return {
        newTown: nt,
        primaryGate: g,
        hitBastions,
        stats,
        wallFinal: wallFinalSafe,
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
