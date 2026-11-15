# Montello places

Where every business and landmark the Fox Lake work needs stands in Tello's map frame (`public/modules/tello/montello.json`,
baked by `modules-src/tello/tools/bake_map.py`). Map frame: x east, z north, metres from the origin by City Hall (UTM 16N
312637 E, 4851396 N). The frame is 16,384 m square, x -8600..7784 and z -7700..8684; its centre is (-408, 492). The
playable area is the City of Montello (x -2237..1323, z -1466..2472) widened by three miles (4,828 m).

Sources: OpenStreetMap (ODbL) ids and tags; street addresses from each business's own site or a directory, geocoded
with Nominatim (OpenStreetMap) where OpenStreetMap has no mapped business; the NAIP aerial photo and the 2018 lidar for
footprints, parking lots, fields and the ramp (all public domain). No Google Maps, Earth or Street View, no logos or
brand colours: names are plain lettering only. Positions read off the aerial photo are accurate to a few metres and say so.

How to read the tables: `x, z` is the place's point in the JSON `pois` (a node, the middle of a mapped way, or the
middle of the matched footprint). `door` is the front door (`d`: x, z, the way it faces in degrees from north) and the
street it faces (`s`); `building #n` is the index into the JSON `buildings` (`i`) with its kind and area; `back lot` is a
spot ten metres behind the building (`b`), on the line from the door through the building's middle, for a depot or a back
lot. Fuel stations whose canopy OpenStreetMap does not map get four pumps in front of the door (`pumpsApprox`).

## What the owner asked for, and where it is

| Request | Place | OSM id | Real address | Notes |
| --- | --- | --- | --- | --- |
| Kwik Trip, the gas station | Kwik Trip | node 7307637191 (store), way 1299934119 (fuel) | 99 E Montello St | Building #42 with its pumps. |
| BP, a working gas station | BP | way 1300403135 | 326 Main St | South Main Street, west of the True Value centre (building #34); pumps in front, none mapped. |
| Mobil, a working gas station | Mobil | node 7141515903 | 128 Church St | East of town on Church Street; building #1104; pumps in front, none mapped. |
| Freitag's, a working grocery with a parking lot | Freitag's Food Center | none (not mapped) | 628 Main St, south side of town | Matched to the large footprint building #533 (about 55 by 75 m); two lots outlined from the aerial photo (see below). |
| Freight depot behind Freitag's | back of Freitag's | - | - | `b` of Freitag's: (314, -1348), the east side; the aerial photo shows a rail line along the back near z -1340. |
| Yahooz is a working bar | Yahooz Sports Bar & Grill | node 12041313902 | 60 W Montello St | Building #126. |
| Town Pump is a working bar | Weezie's Town Pump | node 12041325192 | W Montello St | Building #115. |
| Lakeside is a working bar | Drew's Lakeside Bar & Grill | none (not mapped) | 219 W Water St, over Buffalo Lake | Footprint #3124 matched to the geocoded address (Nominatim way 6917735). |
| The casino/bar goes inside Foxtails | Foxtails Gentlemen's Club ("The Foxtail") | none (not mapped) | N4305 16th Rd, east of town on State Highway 23 | The club's building is read off the aerial photo: footprint #2111 (184 m2) beside the highway about 80 m west of where 16th Road crosses it at (1744, 345), with a car lot south of it. The old casino moves inside this building. |
| Police station where the sheriff really is | Marquette County Sheriff Department | node 7140542678 | 67 W Park St (courthouse at 77 W Park St) | Building #183 (2,159 m2), the courthouse and jail block on West Park Street. |
| Fire station and municipal building | Montello Fire Department, City Hall, Police | node 7886974850 | 20 Underwood Ave | One building, #159, with the fire bays; door on Underwood Avenue. |
| The dealership downtown on Main Street (UTV and fishing boat) | H A Freitag & Son (`shop=car`) | node 7140534366 | 41 Main St | Building #177 (1,064 m2), door on Main Street. |

Bear Paw Lake things move to Lake Montello: the lake is OpenStreetMap relation 3540095 (level 238.71 m), Buffalo Lake is
relation 3539703 (234.81 m) and the Fox River runs between them and below the dam (233.28 m).

## Lots, ball fields and launches

OpenStreetMap maps no parking lot at any school and no ball diamond anywhere in Montello, so the bake adds them from the
aerial photo (`EXTRA_LOTS`, `EXTRA_PITCHES`, `EXTRA_SLIPWAYS` in `bake_map.py`; each lot is clipped to the footprints, put
in the JSON `lots` with a name `n`, levelled like any lot and counted as pavement by the clearance field).

| Lot | Bounds x0, z0 to x1, z1 | Notes |
| --- | --- | --- |
| Montello school west lot | 374, 476 to 450, 523 | Big lot in front of the high school, off the street to the north. |
| Montello school west paved court | 427, 440 to 451, 476 | Paved court south of it. |
| Montello school north lot | 535, 505 to 692, 524 | Staff and visitor lot along the school's north side. |
| Montello school north-east lot | 615, 475 to 692, 505 | Continues the lot east of the gym. |
| Montello school bus lot | 692, 485 to 796, 524 | Buses parked in a row beside the bus garage. |
| Montello school south-west lot | 465, 345 to 520, 390 | Paved yard south of the classrooms (lower confidence). |
| St John's Lutheran School lot | 795, -78 to 838, -48 | In front of the school. |
| Freitag's Food Center lot | 228, -1370 to 272, -1285 | Customer lot between Main Street and the store. |
| Freitag's Food Center service yard | 280, -1405 to 345, -1357 | Paved yard south of the store. |
| Foxtails lot | 1647, 283 to 1690, 338 | Car lot south of the club. |

Ball fields (JSON `pitches`; a diamond carries `home`, `mound`, `heading` (home to second base, radians clockwise from
north), `infield` radius and `outfield` radius from home; the outline `p` is the infield dirt):

| Field | Home | Heading | Notes |
| --- | --- | --- | --- |
| Montello ballfield (baseball) | 419.5, 235.8 | -0.363 | School ground north of Park Street. The infield arc fits a 29.7 m circle (a 95-foot infield); outfield 85 m. |
| Lake Montello park diamond, north (softball) | 23.0, 603.0 | 0.0 | Park on the lake shore. Round infield skin of 18 m, outfield 65 m; a fence curves along the left-field line. |
| Lake Montello park diamond, south (softball) | 20.0, 503.0 | 0.96 | Same park, 100 m south; read less clearly, so approximate. Infield 15 m, outfield 55 m. |
| Montello school courts (tennis) | box 392, 442 to 425, 475 | - | Beside the west lot. |
| Montello school track | box 688, 305 to 762, 480 | - | The oval running track and field east of the school (not a ball diamond). |

Boat launches (JSON `slipways`; `h` is the bearing out to the water in radians where known):

| Launch | x, z | Notes |
| --- | --- | --- |
| Lake Montello shore launch | -35, 458 | A gravel ramp and path at the lake's south-east shore beside the park, read off the aerial photo, facing west (`h` -1.571). Not verified on the ground. |
| slipway (OpenStreetMap) | -84, -448 | On the water south of town below the dam. |
| slipway (OpenStreetMap) | -6979, -1671 | Far west on Buffalo Lake, outside the walkable ring. |

## Lakes and other water

Representative points of the named water bodies in the JSON `pois` (kind `water`): Lake Montello (-1021, 1605) with its
south basin along Lake Avenue, Buffalo Lake (-4284, -1425), the Fox River (1232, -731), Mud Lake (2768, 3336), White Lake
(5975, 2026), Spring Lake (2185, 2369), Kilby Lake (-1982, 1373), Echo Lake (-2494, 2006), Moon Lake (-3052, 1601) and more
out to Grand River Flowage (5684, -7149). Andy Krakow Memorial Fishing Area (170, -736) and Montello Granite Park (173, 112)
are the parks by the river and falls.

## Streets bent round buildings

`avoid_buildings` eased 18 streets round the houses, garages, sheds, churches and civic and industrial buildings their width
would run into: the corner house at (-78, -14) by the fire station, where West Montello Street meets Underwood Avenue going
toward downtown, no longer sits in the road. Storefronts on the downtown streets are not moved (`data/Streets.ts`).

## Generated tables

Straight from the baked JSON. `scripts/montello-places.mjs` writes `maplestreet/shared/MontelloPlaces.ts` from the same
data, including `MONTELLO_SHERIFF`, `MONTELLO_DEALER` and `MONTELLO_DEPOT` (behind Freitag's).

### Gas stations

| Name | OSM type | x, z | Notes |
| --- | --- | --- | --- |
| Mobil | fuel | 909, 361 | door 898, 362 facing 286 deg on Church Street; building #1104 store 312 m2 at 907, 362; back lot 924, 363; 4 pumps (placed in front, no canopy mapped) |
| Kwik Trip | shop:convenience | 280, 29 | door 286, 13 facing 196 deg on East Montello Street; building #42 store 775 m2 at 285, 35; back lot 283, 61; 4 pumps |
| Kwik Trip | fuel | 260, 17 | door 286, 13 facing 196 deg on East Montello Street; building #42 store 775 m2 at 285, 35; back lot 283, 61; 4 pumps |
| BP | fuel | 226, -913 | door 235, -899 facing 271 deg on Main Street; building #34 store 916 m2 at 252, -902; back lot 276, -906; 4 pumps |

### Grocery and dealership

| Name | OSM type | x, z | Notes |
| --- | --- | --- | --- |
| H A Freitag & Son | shop:car | 110, -98 | door 123, -87 facing 77 deg on Main Street; building #177 store 1064 m2 at 108, -97; back lot 81, -114 |
| Dollar General | shop:variety_store | 913, 285 | door 914, 294 facing 17 deg on no named street; building #2143 store 875 m2 at 911, 282; back lot 905, 262 |
| True Value Holliday Shopping Center | shop:convenience | 252, -902 | door 235, -899 facing 271 deg on no named street; building #34 store 916 m2 at 252, -902; back lot 276, -907; 4 pumps |
| Freitag's Food Center | shop:supermarket | 292, -1327 | door 269, -1272 facing 314 deg on Main Street; building #533 store 3351 m2 at 292, -1310; back lot 314, -1348 |

### Bars

| Name | OSM type | x, z | Notes |
| --- | --- | --- | --- |
| Rivers Edge Saloon & Eatery | pub | 70, 1 | door 70, 4 facing 344 deg on West Montello Street; building #135 store 133 m2 at 72, -6; back lot 77, -24 |
| Tambears | bar | 26, -13 | door 25, -10 facing 344 deg on West Montello Street; building #131 store 128 m2 at 29, -22; back lot 35, -43 |
| Yahooz Sports Bar & Grill | bar | -5, -21 | door -6, -19 facing 344 deg on West Montello Street; building #126 store 233 m2 at -2, -32; back lot 5, -54 |
| Weezie's Town Pump | bar | 16, 9 | door 16, 6 facing 162 deg on West Montello Street; building #115 store 231 m2 at 12, 22; back lot 5, 46 |
| Drew's Lakeside Bar & Grill | bar | -260, -779 | door -263, -786 facing 184 deg on West Water Street; building #3124 store 108 m2 at -260, -779; back lot -254, -763 |
| Foxtails Gentlemen's Club | nightclub | 1662, 346 | door 1671, 340 facing 139 deg on State Highway 23; building #2111 store 184 m2 at 1662, 346; back lot 1644, 357 |

### Civic

| Name | OSM type | x, z | Notes |
| --- | --- | --- | --- |
| Marquette County Sheriff Department | police | -80, 178 | door -45, 173 facing 175 deg on West Park Street; building #183 civic 2159 m2 at -82, 188; back lot -131, 205 |
| United States Post Office | post_office | 317, 2 | door 326, 9 facing 100 deg on no named street; building #40 civic 365 m2 at 315, 13; back lot 298, 19 |
| Montello Fire Department | fire_station | -127, 27 | door -121, 18 facing 74 deg on Underwood Avenue; building #159 civic 885 m2 at -135, 14; back lot -156, 6 |
| Montello City Hall | townhall | -131, 0 | door -121, 18 facing 74 deg on Underwood Avenue; building #159 civic 885 m2 at -135, 14; back lot -156, 6 |
| Montello Police | police | -122, 7 | door -121, 18 facing 74 deg on Underwood Avenue; building #159 civic 885 m2 at -135, 14; back lot -156, 6 |

### Schools

| Name | OSM type | x, z | Notes |
| --- | --- | --- | --- |
| Saint Johns Lutheran School | school | 808, -82 | door 811, -65 facing 11 deg on no named street; building #2826 civic 1403 m2 at 798, -77; back lot 777, -95 |
| Forest Lane Elementary School | school | 489, 483 | door 606, 484 facing 90 deg on no named street; building #1869 civic 17030 m2 at 554, 454; back lot 458, 397 |
| Montello Junior-Senior High School | school | 622, 448 | door 606, 484 facing 90 deg on no named street; building #1869 civic 17030 m2 at 554, 454; back lot 458, 397 |
| High Marq Environmental Charter School | school | 520, 500 | door 606, 484 facing 90 deg on no named street; building #1869 civic 17030 m2 at 554, 454; back lot 458, 397 |
| Montello Junior/Senior High & Forest Lane Community School | school | 487, 396 | door 606, 484 facing 90 deg on no named street; building #1869 civic 17030 m2 at 554, 454; back lot 458, 397 |

