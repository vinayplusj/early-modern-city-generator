# early-modern-city-generator
Early Modern Fantasy City Generator (roughly 1500–1800), inspired by Watabou’s city generator, but with early modern shapes, planning, and defences.

Created in javascript as that is the language I am familiar with through my career in digital analytics. 

Future Plans by Milestone Number
---

### 5 Primary roads (intent + routing on mesh)


* Define required connections: gate↔plaza, plaza↔citadel, plaza↔docks (if present).
* Route on `CityMesh` using a cost model (water, ditch/glacis, citadel avoidance, slope later).
* Output roads as mesh-referenced paths (edge lists + polyline) for stability.
* Move gates to “ward-edge ∩ curtain wall”
* Create Biomes beyond the Outer Boundary with primary roads extending as splines going through them

---

### 6 Region partition and extramural classification

* Partition buildable area into regions using seeded growth on face adjacency (multi-source BFS with weights).
* Explicitly enforce “new town = two adjacent wards.”
* Classify and style outside-the-outer-hull regions (farms, woods, plains, slums) as lightweight fills.

---

### 7 Secondary roads per region

* Generate secondary street networks with a pattern library (grid, radial, organic, ribbon along water).
* Patterns consume: region polygon, primary road fragments, and deterministic fields.
* Output as mesh-referenced paths and junction candidates (not free polylines).

---

### 8 Road graph normalisation and block extraction

* Snap, split, and merge all roads into a single planar road graph.
* Extract blocks as interior faces of the planar graph.
* Classify blocks (intra-mural vs extra-mural, water-adjacent, market-adjacent).

---

### 9 Parcel carving (v1 + region-aware refinements)

* Carve parcels inside blocks with stable, deterministic splitting.
* Enforce frontage to roads where possible.
* Apply region-aware parcel heuristics (commercial near plaza, larger outskirts, irregular slums).

---

### 10 Buildings as symbols

* Place building symbols in parcels with setbacks and basic alignment rules.
* Add landmark symbols (church, arsenal, guildhall, warehouses) driven by anchors/regions.

---

### 11 Labels and styling (v1 + improved placement)

* Add readable labels (districts, gates, landmarks) with collision avoidance.
* Improve label placement using a spine/medial approximation per region for irregular polygons.
* Produce style presets (engineering plan, military map, merchant map) without changing geometry.


---

### 12 Export (SVG/PNG/JSON)

* Export deterministic SVG with layer ids and styling.
* Export versioned JSON schema for mesh + derived layers.
* Export PNG renders (from SVG or direct) with scale bar and legend.

---
