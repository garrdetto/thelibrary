# Tello model sources

Every model in this folder is original geometry made in Blender by the scripts in `modules-src/tello/tools/`
(`build-montello.py`, `build-town-kit.py`). Nothing is traced from a photograph or taken from another model, and
no logos, trademarks or brand colours appear on any of them: a business name is plain lettering on a dark board,
drawn by the page.

| File | Made by | Reference used |
| --- | --- | --- |
| `downtown-kit.glb`, `quarry.glb` | `build-montello.py` | The owner's photos and drives of downtown Montello and the granite park (see the module README). |
| `house-kit.glb` | `build-town-kit.py house` | General Midwestern house parts (double-hung windows, porches, gutters, chimneys). Sizes are checked against the lidar footprints and roof heights in `public/modules/tello/montello.json` (USGS 3DEP / FEMA 2018 point cloud, public domain). |
| `places-kit.glb` | `build-town-kit.py places` | Generic fuel dispensers and canopy fittings, a school bus (the regulation yellow is a safety colour, not a brand), parking lot lights, a loading dock door, a rooftop unit. Lot outlines, school lots and the bus lot are read off the USDA NAIP aerial photo (public domain) by `bake_map.py`; stall sizes are the common 2.7 by 5.5 m. |
| `fields-kit.glb` | `build-town-kit.py fields` | Regulation diamond sizes (90 ft and 60 ft base paths, 60 ft 6 in and 43 ft pitching distances, chain-link fencing). Where each diamond stands and which way it opens come from the NAIP aerial photo (public domain) and the bake's pitch records. |

Imagery used for checking placement (never copied into the game): USDA NAIP aerial imagery (public domain), OpenStreetMap
(ODbL), USGS 3DEP lidar (public domain). Google Maps, Earth and Street View were not used.
