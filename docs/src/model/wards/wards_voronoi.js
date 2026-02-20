  for (let id = 0; id < wardSeeds.length; id++) {
    const seed = wardSeeds[id];

    // d3-delaunay returns an array of [x, y] points or null
    const cell = voronoi.cellPolygon(id);

    /** @type {Point[]|null} */
    let poly = null;

    if (cell && cell.length >= 3) {
      poly = [];
      // cellPolygon repeats the first point at the end in many cases.
      for (let i = 0; i < cell.length; i++) {
        const pt = cell[i];
        poly.push({ x: pt[0], y: pt[1] });
      }

      poly = dropClosingPoint(poly);

      if (p.clipToFootprint) {
        poly = tryClipToFootprint(poly, footprintPoly);
      }

      // After closing-point removal and optional clipping, require at least a triangle.
      if (!Array.isArray(poly) || poly.length < 3) {
        poly = null;
      }
    }

    const centroid = poly ? polygonCentroid(poly) : null;
    const area = poly ? Math.abs(polygonSignedArea(poly)) : null;

    wards.push({
      id,
      seed,
      poly,
      centroid,
      area,
      distToCentre: dist(seed, centre),
    });
  }

  return { wardSeeds, wards };
