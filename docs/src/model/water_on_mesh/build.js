// docs/src/model/water_on_mesh/build.js

import { clampInt, isFiniteNumber, polylineLengthSq } from "./util.js";
import { resamplePolylineUniform } from "./resample.js";
import { makeLengthOnlyWeightFn, snapPolylineToNodes, routeNodesAsPolyline } from "./routing.js";
import { applyWaterFlagsToEdges } from "./flags.js";

import { snapPointToGraph as snapPointToGraphDefault } from "../mesh/voronoi_planar_graph.js";
import { dijkstra as dijkstraDefault, pathNodesToPolyline as pathNodesToPolylineDefault } from "../routing/shortest_path.js";

/**
 * Behaviour-preserving split of the original buildWaterOnMesh.
 */
export function buildWaterOnMesh({
  graph,
  waterModel,

  // Optional overrides (kept for compatibility)
  dijkstra: dijkstraOverride,
  pathNodesToPolyline: pathNodesToPolylineOverride,
  snapPointToGraph: snapPointToGraphOverride,

  params,
} = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.adj)) {
    throw new Error("buildWaterOnMesh: graph with nodes/edges/adj is required");
  }

  const dijkstra = (typeof dijkstraOverride === "function") ? dijkstraOverride : dijkstraDefault;
  const pathNodesToPolyline = (typeof pathNodesToPolylineOverride === "function")
    ? pathNodesToPolylineOverride
    : pathNodesToPolylineDefault;
  const snapPointToGraph = (typeof snapPointToGraphOverride === "function")
    ? snapPointToGraphOverride
    : snapPointToGraphDefault;

  if (typeof dijkstra !== "function" || typeof pathNodesToPolyline !== "function" || typeof snapPointToGraph !== "function") {
    throw new Error("buildWaterOnMesh: routing helpers are not available");
  }

  const p = (params && typeof params === "object") ? params : {};

  const waterSnapDist = isFiniteNumber(p.waterSnapDist) ? p.waterSnapDist : 60;
  const waterSplitEdges = (p.waterSplitEdges !== false);
  const coastTargetPoints = Number.isInteger(p.coastTargetPoints) ? clampInt(p.coastTargetPoints, 8, 400) : 48;
  const riverTargetPoints = Number.isInteger(p.riverTargetPoints) ? clampInt(p.riverTargetPoints, 8, 600) : 64;
  const mutateGraphFlags = (p.mutateGraphFlags !== false);

  const wm = waterModel && typeof waterModel === "object" ? waterModel : { kind: "none" };
  const kind = (typeof wm.kind === "string") ? wm.kind : "none";

  const coastIn = Array.isArray(wm.shoreline) ? wm.shoreline : (Array.isArray(wm.coast) ? wm.coast : null);
  const riverIn = Array.isArray(wm.river) ? wm.river : null;

  const out = {
    ...wm,
    kind,
    shorelineOnMesh: null,
    riverOnMesh: null,
    shorelineEdgeIds: [],
    riverEdgeIds: [],
  };

  const hasCoast = Array.isArray(coastIn) && coastIn.length >= 2 && polylineLengthSq(coastIn) > 1e-6;
  const hasRiver = Array.isArray(riverIn) && riverIn.length >= 2 && polylineLengthSq(riverIn) > 1e-6;

  if (!hasCoast && !hasRiver) return out;

  const snapCfg = {
    graph,
    maxSnapDist: waterSnapDist,
    splitEdges: waterSplitEdges,
  };

  const weightLen = makeLengthOnlyWeightFn(graph);

  if (hasCoast) {
    const coastSampled = resamplePolylineUniform(coastIn, coastTargetPoints);
    const coastNodes = snapPolylineToNodes({ graph, polyline: coastSampled, snapPointToGraph, snapCfg });

    const coastRouted = routeNodesAsPolyline({
      graph,
      snappedNodes: coastNodes,
      dijkstra,
      pathNodesToPolyline,
      weightFn: weightLen,
      blockedEdgeIds: null,
    });

    if (Array.isArray(coastRouted.polyline) && coastRouted.polyline.length >= 2) {
      out.shorelineOnMesh = coastRouted.polyline;
      out.shorelineEdgeIds = coastRouted.usedEdgeIds;
      if (mutateGraphFlags) applyWaterFlagsToEdges(graph, out.shorelineEdgeIds, "isWater");
    }
  }

  if (hasRiver) {
    const riverSampled = resamplePolylineUniform(riverIn, riverTargetPoints);
    const riverNodes = snapPolylineToNodes({ graph, polyline: riverSampled, snapPointToGraph, snapCfg });

    const riverRouted = routeNodesAsPolyline({
      graph,
      snappedNodes: riverNodes,
      dijkstra,
      pathNodesToPolyline,
      weightFn: weightLen,
      blockedEdgeIds: null,
    });

    if (Array.isArray(riverRouted.polyline) && riverRouted.polyline.length >= 2) {
      out.riverOnMesh = riverRouted.polyline;
      out.riverEdgeIds = riverRouted.usedEdgeIds;
      if (mutateGraphFlags) applyWaterFlagsToEdges(graph, out.riverEdgeIds, "isWater");
    }
  }

  return out;
}
