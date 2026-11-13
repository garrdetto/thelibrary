#!/usr/bin/env python3
"""
Bakes Montello, Wisconsin into Tello's map files.

  python3 modules-src/tello/tools/bake_map.py [--cache .tello-cache] [--debug out_dir]

Sources (downloaded into the cache on first run, about 800 MB, reused after that):
  - OpenStreetMap (roads, water, land use, places, some buildings), (c) OpenStreetMap contributors, ODbL.
  - USGS 3DEP bare-earth lidar elevation, public domain: the ground and the water levels.
  - The 2018 FEMA/USGS lidar point cloud of Marquette County (the survey the bare-earth model was made from), from
    NOAA Digital Coast's open bucket, public domain: each building's roof shape, eave and ridge height, buildings
    no footprint source has, bridge deck heights, and every tree with its height.
  - USDA NAIP aerial imagery with near infrared (via USGS), public domain: ground cover.
  - Microsoft Global ML Building Footprints, ODbL: the footprints OpenStreetMap lacks.

Outputs (committed, read by the page and by the tests):
  public/modules/tello/montello.bin    grids, 4 m apart: ground height, water surface, bridge decks,
                                       ground cover, distance to pavement, and the trees with their heights
  public/modules/tello/montello.json   roads, bridges, buildings with their measured roofs, places and the frame

The frame: x east and z north in metres from the origin (near City Hall), UTM zone 16N, 1 unit = 1 m.
Needs numpy, scipy, pillow, pyproj, shapely and laspy[lazrs].
"""
import argparse, gzip, json, math, os, struct, sys, urllib.request
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, MultiPolygon
from shapely.ops import linemerge, polygonize, unary_union
from shapely import affinity

# ---------------------------------------------------------------- frame
ORIGIN_LONLAT = (-89.3288, 43.7919)
E0, N0 = 312637, 4851396            # the origin in UTM 16N (EPSG:26916), whole metres
X0, X1, Z0, Z1 = -2500, 1596, -1560, 2536
SIZE = X1 - X0                      # 4096 m square
FINE = 2                            # working rasters
CELL = 4                            # shipped grids
NF = SIZE // FINE + 1               # 2049 fine nodes a side
NC = SIZE // CELL + 1               # 1025 shipped nodes a side
FETCH_BBOX = (-89.375, 43.762, -89.275, 43.822)   # lon0, lat0, lon1, lat1 (wider than the world)
WORLD = box(X0, Z0, X1, Z1)
MS_QUADKEYS = ['030222020', '030222021']
MS_INDEX = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv'

tr = Transformer.from_crs(4326, 26916, always_xy=True)

def project(lon, lat):
    e, n = tr.transform(lon, lat)
    return (e - E0, n - N0)

def fetch(url, path, timeout=240):
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    last = None
    for _ in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'thelibrary-tello-bake/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            return path
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f'could not download {url}: {last}')

# ---------------------------------------------------------------- rasters
def load_dem(cache):
    """Bare-earth elevation on the fine node grid, row 0 = south edge."""
    out = np.zeros((NF, NF), np.float32)
    T = 1024
    for j0 in range(0, NF, T):
        for i0 in range(0, NF, T):
            w = min(T, NF - i0); h = min(T, NF - j0)
            xmin = E0 + X0 + i0 * FINE - FINE / 2; xmax = xmin + w * FINE
            ymax = N0 + Z1 - j0 * FINE + FINE / 2; ymin = ymax - h * FINE
            url = ('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
                   f'?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=26916&imageSR=26916&size={w},{h}'
                   '&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image')
            a = np.array(Image.open(fetch(url, f'{cache}/dem_{i0}_{j0}.tif')), dtype=np.float32)
            out[j0:j0 + h, i0:i0 + w] = a
    return out[::-1].copy()

def load_naip(cache):
    """Red, green, blue and near infrared on the fine node grid (bytes), row 0 = south edge."""
    n = SIZE // FINE
    out = np.zeros((n, n, 4), np.uint8)
    T = 1024
    for j0 in range(0, n, T):
        for i0 in range(0, n, T):
            w = min(T, n - i0); h = min(T, n - j0)
            xmin = E0 + X0 + i0 * FINE; xmax = xmin + w * FINE
            ymax = N0 + Z1 - j0 * FINE; ymin = ymax - h * FINE
            url = ('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
                   f'?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=26916&imageSR=26916&size={w},{h}'
                   '&format=tiff&interpolation=RSP_BilinearInterpolation&f=image')
            out[j0:j0 + h, i0:i0 + w] = np.array(Image.open(fetch(url, f'{cache}/naip_{i0}_{j0}.tif')))[..., :4]
    out = out[::-1]
    return np.pad(out, ((0, 1), (0, 1), (0, 0)), mode='edge')

def raster(geoms, step=FINE, n=NF, value=1, width=None):
    """Polygons (or, with `width`, lines) burnt into an n x n node grid, row 0 = south."""
    img = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(img)
    def px(pts):
        return [((x - X0) / step, (n - 1) - (z - Z0) / step) for x, z in pts]
    def burn(g):
        if g.is_empty:
            return
        if g.geom_type == 'Polygon':
            d.polygon(px(g.exterior.coords), fill=value)
            for hole in g.interiors:
                d.polygon(px(hole.coords), fill=0)
        elif g.geom_type == 'LineString':
            d.line(px(g.coords), fill=value, width=max(1, round((width or step) / step)))
        elif hasattr(g, 'geoms'):
            for part in g.geoms:
                burn(part)
    for g in geoms:
        burn(g)
    return np.array(img)[::-1].copy()

def sample(grid, x, z, step=FINE):
    """Bilinear sample of a node grid at map points (arrays)."""
    n = grid.shape[0]
    u = np.clip((np.asarray(x, float) - X0) / step, 0, n - 1.001)
    v = np.clip((np.asarray(z, float) - Z0) / step, 0, n - 1.001)
    i = np.floor(u).astype(int); j = np.floor(v).astype(int)
    fu = u - i; fv = v - j
    return (grid[j, i] * (1 - fu) * (1 - fv) + grid[j, i + 1] * fu * (1 - fv) + grid[j + 1, i] * (1 - fu) * fv + grid[j + 1, i + 1] * fu * fv)

# ---------------------------------------------------------------- OpenStreetMap
class Osm:
    def __init__(self, path):
        root = ET.parse(path).getroot()
        self.nodes = {}
        self.node_tags = {}
        for n in root.iter('node'):
            self.nodes[n.get('id')] = project(float(n.get('lon')), float(n.get('lat')))
            tags = {t.get('k'): t.get('v') for t in n.findall('tag')}
            if tags:
                self.node_tags[n.get('id')] = tags
        self.ways = {}
        for w in root.iter('way'):
            refs = [nd.get('ref') for nd in w.findall('nd') if nd.get('ref') in self.nodes]
            self.ways[w.get('id')] = (refs, {t.get('k'): t.get('v') for t in w.findall('tag')})
        self.relations = []
        for r in root.iter('relation'):
            members = [(m.get('type'), m.get('ref'), m.get('role')) for m in r.findall('member')]
            self.relations.append((members, {t.get('k'): t.get('v') for t in r.findall('tag')}))

    def pts(self, wid):
        return [self.nodes[r] for r in self.ways[wid][0]]

    def closed(self, wid):
        refs = self.ways[wid][0]
        return len(refs) >= 4 and refs[0] == refs[-1]

    def polygons(self, match):
        """Areas whose tags satisfy `match`: closed ways, and multipolygons pieced together from their members."""
        out = []
        used = set()
        for members, tags in self.relations:
            if tags.get('type') != 'multipolygon' or not match(tags):
                continue
            lines = []
            for kind, ref, _role in members:
                if kind == 'way' and ref in self.ways and len(self.ways[ref][0]) >= 2:
                    lines.append(LineString(self.pts(ref)))
                    used.add(ref)
            out.append((tags, lines))
        for wid, (refs, tags) in self.ways.items():
            if wid in used or not match(tags) or not self.closed(wid):
                continue
            try:
                p = Polygon(self.pts(wid)).buffer(0)
            except Exception:  # noqa: BLE001
                continue
            if not p.is_empty:
                out.append((tags, p))
        return out

def clean(geom):
    geom = geom.buffer(0)
    return geom if not geom.is_empty else None

# ---------------------------------------------------------------- water
STREAM_HALF = {'river': 5.0, 'canal': 2.5, 'stream': 2.5, 'ditch': 2.0, 'drain': 2.0}
MAX_DEPTH = 3.2

def water_bodies(osm, dem):
    """Water areas as polygons (map coordinates), with names where OpenStreetMap has them."""
    is_water = lambda t: t.get('natural') == 'water' or t.get('waterway') == 'riverbank'
    gy, gx = np.gradient(dem, FINE)
    slope = np.hypot(gx, gy)
    big = WORLD.buffer(80, join_style=2)
    out = []
    for tags, g in osm.polygons(is_water):
        if not isinstance(g, list):
            if g.intersects(WORLD):
                out.append((tags.get('name'), g.intersection(big)))
            continue
        # A multipolygon whose far members lie outside the download: close it against the edge of the world and keep
        # the faces the lidar shows as level water (hydro-flattened), which leaves islands and shores out.
        net = unary_union([l.intersection(big) for l in g] + [big.boundary])
        for face in polygonize(net):
            inside = face.intersection(WORLD)
            if inside.is_empty or inside.area < 20:
                continue
            m = raster([inside]) > 0
            if m.sum() >= 4 and float((slope[m] < 0.004).mean()) > 0.5:
                out.append((tags.get('name'), face))
    solid = unary_union([g for _n, g in out])
    for wid, (refs, tags) in osm.ways.items():
        half = STREAM_HALF.get(tags.get('waterway', ''))
        if half is None or len(refs) < 2 or tags.get('tunnel'):
            continue
        line = LineString(osm.pts(wid)).intersection(big)
        if line.is_empty:
            continue
        extra = line.buffer(half, cap_style=2).difference(solid.buffer(0.5))
        if not extra.is_empty and extra.area > 12:
            out.append((tags.get('name'), extra))
    return out

def water_levels(mask_f, dem):
    """Water surface on the shipped grid: the lidar's level under each body, exactly flat where the lidar is."""
    mask_c = ndimage.maximum_filter(mask_f.astype(np.uint8), 3)[::2, ::2] > 0
    dem_c = dem[::2, ::2]
    low = ndimage.percentile_filter(np.where(mask_c, dem_c, 1e6).astype(np.float32), percentile=10, size=9)
    low = np.where(mask_c, np.minimum(low, 1e5), 0)
    labels, count = ndimage.label(mask_c, structure=np.ones((3, 3)))
    level = low.copy()
    for k in range(1, count + 1):
        sel = labels == k
        vals = low[sel]
        if vals.size and np.percentile(vals, 90) - np.percentile(vals, 10) < 0.15:
            level[sel] = float(np.median(vals))
    # Soften the steps (dams, riffles) a little, staying inside the water.
    w = mask_c.astype(np.float32)
    num = ndimage.gaussian_filter(level * w, 1.2)
    den = ndimage.gaussian_filter(w, 1.2)
    smooth = np.where(mask_c, num / np.maximum(den, 1e-6), 0)
    for k in range(1, count + 1):
        sel = labels == k
        vals = level[sel]
        if vals.size and vals.max() - vals.min() < 1e-3:
            smooth[sel] = vals[0]
    return mask_c, smooth

def nearest_fill(values, valid):
    """`values` where valid, elsewhere the value of the nearest valid cell."""
    idx = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    return values[idx[0], idx[1]]

# ---------------------------------------------------------------- roads
# kind: 0 highway (lined), 1 street, 2 lane (driveways, aisles), 3 gravel, 4 walk (concrete), 5 trail (dirt)
ROAD_KIND = ['highway', 'street', 'lane', 'gravel', 'walk', 'trail']
DRIVABLE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track',
            'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
WALKABLE = {'footway', 'path', 'cycleway', 'pedestrian', 'steps', 'bridleway'}
UNPAVED = {'gravel', 'compacted', 'unpaved', 'dirt', 'ground', 'sand', 'grass', 'fine_gravel', 'earth'}

def road_style(tags):
    hw = tags['highway']
    surface = tags.get('surface', '')
    service = tags.get('service', '')
    if hw in ('primary', 'trunk', 'motorway'):
        kind, width = 0, 9.4
    elif hw == 'secondary':
        kind, width = 0, 8.2
    elif hw == 'tertiary':
        kind, width = 0, 7.4
    elif hw.endswith('_link'):
        kind, width = 1, 6.4
    elif hw in ('residential', 'unclassified', 'living_street'):
        kind, width = 1, 6.6
    elif hw == 'service':
        if service == 'driveway':
            kind, width = 2, 3.2
        elif service in ('parking_aisle', 'drive-through'):
            kind, width = 2, 5.0
        elif service == 'alley':
            kind, width = 2, 3.8
        else:
            kind, width = 2, 4.4
    elif hw == 'track':
        kind, width = 3, 3.0
    elif hw in ('footway', 'pedestrian', 'steps', 'cycleway'):
        kind, width = 4, 1.8 if hw != 'pedestrian' else 4.0
    else:
        kind, width = 5, 1.4
    if tags.get('width'):
        try:
            width = max(1.2, min(16.0, float(tags['width'].split()[0])))
        except ValueError:
            pass
    elif tags.get('lanes') and kind <= 1:
        try:
            width = max(width, float(tags['lanes']) * 3.5 + 1.2)
        except ValueError:
            pass
    if surface in UNPAVED:
        kind = 3 if kind <= 3 else 5
    elif kind == 5 and surface in ('asphalt', 'concrete', 'paved', 'paving_stones'):
        kind = 4
    return kind, width

def densify(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, math.ceil(d / step))
        for k in range(1, n + 1):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out

def smooth_run(values, half):
    """Moving average with a triangular window, ends held."""
    n = len(values)
    if n < 3 or half < 1:
        return values.copy()
    k = np.concatenate([np.arange(1, half + 2), np.arange(half, 0, -1)]).astype(float)
    k /= k.sum()
    pad = np.concatenate([np.full(half, values[0]), values, np.full(half, values[-1])])
    return np.convolve(pad, k, mode='valid')

def collect_roads(osm):
    clip = WORLD.buffer(30, join_style=2)
    roads = []
    for wid, (refs, tags) in osm.ways.items():
        hw = tags.get('highway')
        if hw not in DRIVABLE and hw not in WALKABLE:
            continue
        if tags.get('area') == 'yes' or len(refs) < 2 or tags.get('access') == 'no' and hw in WALKABLE:
            continue
        line = LineString(osm.pts(wid))
        part = line.intersection(clip)
        if part.is_empty:
            continue
        kind, width = road_style(tags)
        name = tags.get('name') or ''
        ref = tags.get('ref') or ''
        pieces = list(part.geoms) if hasattr(part, 'geoms') else [part]
        for piece in pieces:
            if piece.geom_type != 'LineString' or piece.length < 3:
                continue
            roads.append({'id': wid, 'kind': kind, 'width': width, 'name': name, 'ref': ref, 'pts': list(piece.coords),
                          'bridge': tags.get('bridge') in ('yes', 'viaduct'), 'oneway': tags.get('oneway') == 'yes', 'class': hw})
    return roads

def grade_roads(roads, dem, ground, level_ext, wet, mask_f, last1=None):
    """
    Lays every road's bed into `ground` (shipped grid): level across the road at the centreline's smoothed lidar
    height, easing back to the land over the shoulders. A long water crossing becomes a level bridge deck (the
    ground under it stays the river bed); a short one is filled like a culvert.
    Returns (ground, bridges, culvert mask, how much of each node is road bed).
    """
    n = NC
    sum_w = np.zeros((n, n), np.float32)
    sum_t = np.zeros((n, n), np.float32)
    top_w = np.zeros((n, n), np.float32)
    culvert = np.zeros((n, n), bool)
    bridges = []
    near_water = ndimage.maximum_filter(wet.astype(np.float32), 5)
    for road in roads:
        drivable = road['kind'] <= 3
        pts = densify(road['pts'], 2.0)
        xs = np.array([p[0] for p in pts]); zs = np.array([p[1] for p in pts])
        raw = sample(dem, xs, zs)
        over = sample(mask_f.astype(np.float32), xs, zs) > 0.5
        half = road['width'] / 2
        prof = raw.copy()
        is_deck = np.zeros(len(pts), bool)
        k = 0
        while k < len(pts):
            if not over[k]:
                k += 1
                continue
            a = k
            while k < len(pts) and over[k]:
                k += 1
            b = k - 1
            a0 = max(0, a - 3); b0 = min(len(pts) - 1, b + 3)
            left = raw[a0] if a0 < a else raw[b0]
            right = raw[b0] if b0 > b else raw[a0]
            span = (b - a + 1) * 2.0
            water = float(np.max(sample(level_ext, xs[a:b + 1], zs[a:b + 1], CELL)))
            if span >= 9 or road['bridge']:
                top = max(left, right, water + (1.3 if drivable else 0.9))
                measured = False
                if last1 is not None:
                    # The real deck: the last returns along the span that stand clear of the water.
                    ci = np.clip((xs[a:b + 1] - X0).astype(int), 0, N1 - 1); cj = np.clip((zs[a:b + 1] - Z0).astype(int), 0, N1 - 1)
                    deck = last1[cj, ci]
                    deck = deck[(deck > water + 0.6) & (deck < water + 14)]
                    if deck.size >= max(3, 0.4 * (b - a + 1)):
                        top = float(np.median(deck))
                        measured = True
                prof[a0:b0 + 1] = top
                is_deck[a0:b0 + 1] = True
                bridges.append({'road': road, 'a': a0, 'b': b0, 'y': top, 'measured': measured})
            else:
                for m in range(a0, b0 + 1):
                    t = (m - a0) / max(1, b0 - a0)
                    prof[m] = max(left + (right - left) * t, water + 0.5)
                r = int(math.ceil((half + 2) / CELL))
                for m in range(a, b + 1):
                    i = int(round((xs[m] - X0) / CELL)); j = int(round((zs[m] - Z0) / CELL))
                    culvert[max(0, j - r):j + r + 1, max(0, i - r):i + r + 1] = True
        smoothed = smooth_run(prof, 7 if drivable else 3)
        prof = np.where(is_deck, prof, smoothed)
        close = sample(near_water, xs, zs, CELL) > 0.2
        prof = np.where(close & ~is_deck, np.maximum(prof, sample(level_ext, xs, zs, CELL) + 0.45), prof)
        road['prof'] = prof
        road['dense'] = pts
        road['deck'] = is_deck
        if road['kind'] == 5:
            continue
        core = half + (1.2 if drivable else 0.4)
        blend = 6.0 if drivable else 2.0
        reach = core + blend
        r = int(math.ceil(reach / CELL)) + 1
        strength = 1.0 if drivable else 0.7
        for m in range(len(pts)):
            x = xs[m]; z = zs[m]
            ci = int((x - X0) / CELL); cj = int((z - Z0) / CELL)
            i0 = max(0, ci - r); i1 = min(n - 1, ci + r + 1)
            j0 = max(0, cj - r); j1 = min(n - 1, cj + r + 1)
            if i0 > i1 or j0 > j1:
                continue
            gx = X0 + np.arange(i0, i1 + 1) * CELL
            gz = Z0 + np.arange(j0, j1 + 1) * CELL
            d = np.hypot(gx[None, :] - x, gz[:, None] - z)
            t = np.clip((d - core) / blend, 0, 1)
            w = np.where(d > reach, 0, 1 - t * t * (3 - 2 * t)).astype(np.float32)
            sel = (slice(j0, j1 + 1), slice(i0, i1 + 1))
            w2 = w * w
            sum_w[sel] += w2
            sum_t[sel] += w2 * prof[m]
            top_w[sel] = np.maximum(top_w[sel], w * strength)
    target = sum_t / np.maximum(sum_w, 1e-6)
    graded = ground * (1 - top_w) + target * top_w
    # Water keeps its bed (bridges cross above it); culverts are filled.
    out = np.where(wet & ~culvert, ground, graded)
    return out, bridges, culvert, top_w

# ---------------------------------------------------------------- buildings
def ms_buildings(cache):
    """Microsoft footprints inside the world: (polygon in map coordinates, height or None)."""
    index = fetch(MS_INDEX, f'{cache}/ms-links.csv')
    urls = {}
    with open(index) as f:
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 3 and parts[0] == 'UnitedStates' and parts[1] in MS_QUADKEYS:
                urls[parts[1]] = parts[2]
    lon0, lat0, lon1, lat1 = FETCH_BBOX
    out = []
    for q in MS_QUADKEYS:
        if q not in urls:
            raise SystemExit(f'no Microsoft footprint file for quadkey {q}')
        path = fetch(urls[q], f'{cache}/ms_{q}.csv.gz', timeout=600)
        with gzip.open(path, 'rt') as f:
            for line in f:
                line = line.strip()
                if not line.startswith('{'):
                    continue
                try:
                    feat = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ring = feat['geometry']['coordinates'][0]
                lon, lat = ring[0]
                if not (lon0 < lon < lon1 and lat0 < lat < lat1):
                    continue
                poly = clean(Polygon([project(a, b) for a, b in ring]))
                if poly is None or poly.geom_type != 'Polygon':
                    continue
                h = feat['properties'].get('height', -1)
                out.append((poly, h if h and h > 0 else None))
    return out

def largest_rectangle(grid):
    """The largest all-true axis-aligned rectangle in a boolean grid: (area, row0, col0, row1, col1), ends exclusive."""
    rows, cols = grid.shape
    heights = np.zeros(cols, int)
    best = (0, 0, 0, 0, 0)
    for r in range(rows):
        heights = np.where(grid[r], heights + 1, 0)
        stack = []
        for c in range(cols + 1):
            h = heights[c] if c < cols else 0
            start = c
            while stack and stack[-1][1] >= h:
                s, sh = stack.pop()
                area = sh * (c - s)
                if area > best[0]:
                    best = (area, r - sh + 1, s, r + 1, c)
                start = s
            stack.append((start, h))
    return best

def roof_rects(poly):
    """
    Covers a footprint with up to four rectangles in its own axes (the main block first), each as
    (cx, cz, half length, half width, yaw): what the roofs and the colliders are built from.
    Returns (rects, share of the footprint they cover).
    """
    obb = poly.minimum_rotated_rectangle
    c = list(obb.exterior.coords)
    e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    long = e0 if math.hypot(*e0) >= math.hypot(*e1) else e1
    yaw = math.atan2(long[1], long[0])
    origin = poly.centroid
    local = affinity.rotate(poly, -math.degrees(yaw), origin=origin)
    minx, minz, maxx, maxz = local.bounds
    res = 0.25
    w = max(1, int(math.ceil((maxx - minx) / res))); h = max(1, int(math.ceil((maxz - minz) / res)))
    img = Image.new('L', (w, h), 0)
    ImageDraw.Draw(img).polygon([((x - minx) / res - 0.5, (z - minz) / res - 0.5) for x, z in local.exterior.coords], fill=1)
    grid = np.array(img) > 0
    total = int(grid.sum())
    if total == 0:
        return [], 0.0
    rects = []
    covered = 0
    for _ in range(4):
        area, r0, c0, r1, c1 = largest_rectangle(grid)
        sx = (c1 - c0) * res; sz = (r1 - r0) * res
        if area == 0 or min(sx, sz) < 2.2 or (rects and area < 0.08 * total):
            break
        lx = minx + (c0 + c1) / 2 * res; lz = minz + (r0 + r1) / 2 * res
        p = affinity.rotate(Point(lx, lz), math.degrees(yaw), origin=origin)
        rects.append((p.x, p.y, sx / 2, sz / 2, yaw))
        covered += area
        grid[r0:r1, c0:c1] = False
        if covered > 0.93 * total:
            break
    return rects, covered / total

def collect_buildings(osm, ms, water, roads, dem):
    """Every building: OpenStreetMap's where it has one, Microsoft's footprint elsewhere (and its height for both)."""
    inner = WORLD.buffer(-24)
    osm_b = []
    for wid, (refs, tags) in osm.ways.items():
        if 'building' not in tags or not osm.closed(wid):
            continue
        poly = clean(Polygon(osm.pts(wid)))
        if poly is None or poly.geom_type != 'Polygon' or not inner.contains(poly.centroid):
            continue
        osm_b.append({'poly': poly, 'tags': tags, 'height': None, 'src': 'osm'})
    from shapely.strtree import STRtree
    tree = STRtree([b['poly'] for b in osm_b]) if osm_b else None
    out = list(osm_b)
    for poly, h in ms:
        if not inner.contains(poly.centroid):
            continue
        dup = False
        if tree is not None:
            for idx in tree.query(poly):
                other = osm_b[int(idx)]
                inter = poly.intersection(other['poly']).area
                if inter > 0.3 * min(poly.area, other['poly'].area):
                    dup = True
                    if h:
                        other['height'] = max(other['height'] or 0, h)
            if dup:
                continue
        out.append({'poly': poly, 'tags': {}, 'height': h, 'src': 'ms'})
    # Zones and points that say what a building is.
    zones = {}
    for key in ('commercial', 'retail', 'industrial', 'residential'):
        polys = [g for _t, g in osm.polygons(lambda t, key=key: t.get('landuse') == key) if not isinstance(g, list)]
        zones[key] = unary_union(polys) if polys else Polygon()
    named = []
    for nid, tags in osm.node_tags.items():
        if tags.get('name') and any(k in tags for k in ('amenity', 'shop', 'office', 'tourism', 'leisure')):
            named.append((Point(osm.nodes[nid]), tags))
    main = [LineString(r['pts']) for r in roads if r['class'] in ('primary', 'secondary')]
    main_union = unary_union(main) if main else LineString()
    result = []
    for b in out:
        poly = b['poly'].simplify(0.35)
        if poly.geom_type != 'Polygon' or poly.area < 9:
            continue
        if water.contains(poly.centroid):
            continue
        tags = dict(b['tags'])
        for pt, t in named:
            if poly.buffer(1.5).contains(pt):
                for k, v in t.items():
                    tags.setdefault(k, v)
        area = poly.area
        c = poly.centroid
        kind_tag = tags.get('building', 'yes')
        downtown = main_union.distance(poly) < 22 and math.hypot(c.x - 150, c.y - 30) < 520
        if kind_tag == 'roof' or tags.get('amenity') == 'fuel' and kind_tag == 'roof':
            kind = 'canopy'
        elif tags.get('amenity') == 'place_of_worship' or kind_tag in ('church', 'chapel'):
            kind = 'church'
        elif tags.get('amenity') in ('school', 'social_facility', 'townhall', 'police', 'fire_station', 'post_office', 'library', 'courthouse') or kind_tag in ('school', 'civic', 'public', 'hospital'):
            kind = 'civic'
        elif kind_tag in ('garage', 'garages', 'carport'):
            kind = 'garage'
        elif kind_tag in ('shed', 'hut'):
            kind = 'shed'
        elif kind_tag in ('industrial', 'warehouse', 'barn', 'farm_auxiliary') or zones['industrial'].contains(c):
            kind = 'industrial' if area > 120 else 'shed'
        elif kind_tag in ('commercial', 'retail') or any(k in tags for k in ('shop', 'office')) or tags.get('amenity') in ('restaurant', 'bar', 'pub', 'bank', 'cinema', 'cafe', 'fast_food', 'veterinary') or tags.get('tourism') in ('motel', 'hotel') or zones['commercial'].contains(c) or zones['retail'].contains(c):
            kind = 'store' if area > 45 else 'shed'
        elif kind_tag in ('house', 'residential', 'detached', 'apartments', 'cabin', 'bungalow'):
            kind = 'house'
        elif area < 38:
            kind = 'shed'
        elif area < 72 and b['src'] == 'ms':
            kind = 'garage'
        elif area > 900:
            kind = 'industrial'
        elif downtown and area > 90:
            kind = 'store'
        else:
            kind = 'house'
        rects, share = roof_rects(poly)
        if not rects:
            continue
        seed = int(abs(c.x * 7.31 + c.y * 3.17) * 10) % 100000
        h = b['height']
        if kind == 'shed':
            wall = min(2.6, h) if h else 2.3
            wall = max(2.1, wall)
        elif kind == 'garage':
            wall = max(2.5, min(3.2, h or 2.7))
        elif kind == 'canopy':
            wall = max(4.6, min(5.6, h or 5.0))
        elif kind == 'house':
            two = (h is not None and h > 5.4) or (h is None and seed % 10 < 3 and area > 70)
            wall = 5.5 if two else 2.9
        elif kind == 'church':
            wall = max(5.5, min(9.0, (h or 7.0)))
        else:
            wall = max(3.6, min(13.0, h or (4.2 if area < 600 else 6.0)))
            wall = round(wall / 0.2) * 0.2
        ex = np.array(poly.exterior.coords)
        base = sample(dem, ex[:, 0], ex[:, 1])
        ring = [(float(x), float(z)) for x, z in ex[:-1]]
        if Polygon(ring).exterior.is_ccw is False:
            ring.reverse()
        result.append({'poly': poly, 'ring': ring, 'kind': kind, 'wall': float(wall), 'rects': rects, 'share': share, 'name': tags.get('name', ''),
                       'floor': float(np.median(base)), 'area': area, 'seed': seed, 'src': b['src'], 'tags': tags})
    return result

def lidar_building(poly, dem):
    """A building the point cloud shows but no footprint source has: an outbuilding, usually."""
    poly = poly.simplify(0.3)
    rects, share = roof_rects(poly)
    if not rects:
        return None
    area = poly.area
    c = poly.centroid
    kind = 'shed' if area < 38 else 'garage' if area < 85 else 'industrial' if area > 700 else 'house'
    ex = np.array(poly.exterior.coords)
    ring = [(float(x), float(z)) for x, z in ex[:-1]]
    if Polygon(ring).exterior.is_ccw is False:
        ring.reverse()
    return {'poly': poly, 'ring': ring, 'kind': kind, 'wall': 2.6, 'rects': rects, 'share': share, 'name': '', 'floor': float(np.median(sample(dem, ex[:, 0], ex[:, 1]))),
            'area': area, 'seed': int(abs(c.x * 7.31 + c.y * 3.17) * 10) % 100000, 'src': 'lidar', 'tags': {}}

def pads(buildings, lots, ground, lock):
    """Levels the ground under each building and parking lot (a graded yard), leaving road beds (`lock`) alone."""
    n = NC
    for item in buildings + lots:
        poly = item['poly']
        minx, minz, maxx, maxz = poly.bounds
        i0 = max(0, int((minx - 8 - X0) / CELL)); i1 = min(n - 1, int((maxx + 8 - X0) / CELL) + 1)
        j0 = max(0, int((minz - 8 - Z0) / CELL)); j1 = min(n - 1, int((maxz + 8 - Z0) / CELL) + 1)
        if i0 >= i1 or j0 >= j1:
            continue
        sub = ground[j0:j1 + 1, i0:i1 + 1]
        gx = X0 + np.arange(i0, i1 + 1) * CELL
        gz = Z0 + np.arange(j0, j1 + 1) * CELL
        d = np.empty(sub.shape, np.float32)
        for a, z in enumerate(gz):
            for b_, x in enumerate(gx):
                p = Point(x, z)
                d[a, b_] = 0 if poly.contains(p) else poly.exterior.distance(p)
        inside = d < 2.5
        if not inside.any():
            # A small footprint between nodes: take the nearest nodes' mean as its floor and leave the land alone.
            item['floor'] = float(sample(ground, [poly.centroid.x], [poly.centroid.y], CELL)[0])
            continue
        free = lock[j0:j1 + 1, i0:i1 + 1] < 0.5
        level = float(np.median(sub[inside])) if (inside & free).sum() == 0 else float(np.median(sub[inside & free]))
        t = np.clip((d - 2.5) / 6.0, 0, 1)
        w = (1 - t * t * (3 - 2 * t)) * (1 - lock[j0:j1 + 1, i0:i1 + 1])
        sub[:] = sub * (1 - w) + level * w
        item['floor'] = level
    for item in buildings:
        ex = np.array(item['poly'].exterior.coords)
        edge = sample(ground, ex[:, 0], ex[:, 1], CELL)
        item['floor'] = float(max(item['floor'], np.percentile(edge, 80))) + 0.12
        item['low'] = float(edge.min())

# ---------------------------------------------------------------- lidar point cloud
LIDAR_LIST = 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9015/urllist_wi2018_3county_m9015.txt'
N1 = SIZE   # one-metre cells a side

def lidar_tiles(cache):
    """The 2018 FEMA/USGS point cloud tiles (1 km, UTM 16N, NAVD88 metres) that cover the map, from NOAA's open bucket."""
    listing = fetch(LIDAR_LIST, f'{cache}/lidar/urllist.txt')
    want = {(e, n) for e in range((E0 + X0) // 1000, (E0 + X1) // 1000 + 1) for n in range((N0 + Z0) // 1000, (N0 + Z1) // 1000 + 1)}
    out = []
    with open(listing) as f:
        for line in f:
            url = line.strip()
            if not url.endswith('.copc.laz'):
                continue
            tile = url.rsplit('_', 1)[-1].split('.')[0]      # 16TCP312851
            if len(tile) == 11 and tile.startswith('16TCP') and (int(tile[5:8]), int(tile[8:11]) + 4000) in want:
                out.append(fetch(url, f"{cache}/lidar/{url.rsplit('/', 1)[-1]}", timeout=1500))
    if len(out) != len(want):
        raise SystemExit(f'expected {len(want)} lidar tiles, found {len(out)}')
    return out

def cell_reduce(idx, values, size, fn, fill):
    """Per-cell reduction (fn = np.maximum or np.add) of `values` at flat cell indices `idx`."""
    out = np.full(size, fill, np.float32)
    if idx.size == 0:
        return out
    order = np.argsort(idx, kind='stable')
    si = idx[order]
    starts = np.flatnonzero(np.r_[True, si[1:] != si[:-1]])
    out[si[starts]] = fn.reduceat(values[order], starts)
    return out

def load_lidar(cache, keep_mask):
    """
    The point cloud as one-metre rasters (row 0 = south): `top` the highest above-ground return, `last` the highest
    last return (the roof under an overhanging tree), `count` above-ground returns, `multi` those from pulses with
    more than one return (leaves and branches, not roofs) and `ground` ground returns. Also returns the above-ground
    last returns that fall on `keep_mask` cells (the buildings), as an (n, 3) array of map x, map z, elevation.
    Noise and water classes are dropped.
    """
    import laspy
    stamp = f'{cache}/lidar_rasters_{int(keep_mask.sum())}.npz'
    if os.path.exists(stamp):
        z = np.load(stamp)
        return {k: z[k] for k in ('top', 'last', 'count', 'multi', 'ground')}, z['points']
    n = N1
    top = np.full(n * n, -1e9, np.float32); last = np.full(n * n, -1e9, np.float32)
    count = np.zeros(n * n, np.float32); multi = np.zeros(n * n, np.float32); ground = np.zeros(n * n, np.float32)
    kept = []
    flat_keep = keep_mask.ravel()
    for path in lidar_tiles(cache):
        las = laspy.read(path)
        x = np.asarray(las.x) - E0; y = np.asarray(las.y) - N0; z = np.asarray(las.z).astype(np.float32)
        cls = np.asarray(las.classification); rn = np.asarray(las.return_number); nr = np.asarray(las.number_of_returns)
        inside = (x >= X0) & (x < X1) & (y >= Z0) & (y < Z1)
        idx = ((y[inside] - Z0).astype(np.int64)) * n + (x[inside] - X0).astype(np.int64)
        x = x[inside]; y = y[inside]; z = z[inside]; cls = cls[inside]; rn = rn[inside]; nr = nr[inside]
        g = (cls == 2) | (cls == 20)
        ground += cell_reduce(idx[g], np.ones(int(g.sum()), np.float32), n * n, np.add, 0)
        a = cls == 1
        top = np.maximum(top, cell_reduce(idx[a], z[a], n * n, np.maximum, -1e9))
        count += cell_reduce(idx[a], np.ones(int(a.sum()), np.float32), n * n, np.add, 0)
        m = a & (nr > 1)
        multi += cell_reduce(idx[m], np.ones(int(m.sum()), np.float32), n * n, np.add, 0)
        l = a & (rn == nr)
        last = np.maximum(last, cell_reduce(idx[l], z[l], n * n, np.maximum, -1e9))
        k = l & flat_keep[idx]
        kept.append(np.stack([x[k].astype(np.float32), y[k].astype(np.float32), z[k]], axis=1))
    rasters = {'top': top.reshape(n, n), 'last': last.reshape(n, n), 'count': count.reshape(n, n), 'multi': multi.reshape(n, n), 'ground': ground.reshape(n, n)}
    points = np.concatenate(kept) if kept else np.zeros((0, 3), np.float32)
    np.savez(stamp, points=points, **rasters)
    return rasters, points

def cell_dem(dem):
    """The bare-earth height at every one-metre cell centre."""
    c = X0 + np.arange(N1) + 0.5
    r = Z0 + np.arange(N1) + 0.5
    gx, gz = np.meshgrid(c, r)
    return sample(dem, gx.ravel(), gz.ravel()).reshape(N1, N1).astype(np.float32)

# Roof types: 0 flat, 1 gable with the ridge along the rectangle's first axis, 2 gable with the ridge along its second
# axis, 3 hip, 4..7 a single slope whose high side is toward +second, -second, +first, -first axis. -1 = not measured.
ROOF_UNKNOWN = -1

def fit_roof(du, dv, h, hx, hz):
    """The roof shape that best explains points (du, dv along the rectangle's axes, h above the floor): (type, eave, ridge)."""
    def solve(feature):
        a = np.stack([np.ones_like(h), feature], axis=1)
        keep = np.ones(h.size, bool)
        coef = np.array([float(np.median(h)), 0.0])
        for _ in range(3):
            coef, *_ = np.linalg.lstsq(a[keep], h[keep], rcond=None)
            res = h - a @ coef
            mad = np.median(np.abs(res[keep] - np.median(res[keep]))) + 0.03
            keep = np.abs(res) < 3.5 * 1.4826 * mad
            if keep.sum() < 6:
                keep[:] = True
                break
        res = (h - a @ coef)[keep]
        return coef, float(np.sqrt(np.mean(res * res)))
    flat_level = float(np.median(h))
    flat_rms = float(np.sqrt(np.mean(np.minimum((h - flat_level) ** 2, 4.0))))
    def ridge(across, half):
        # The ridge is rarely dead centre under the footprint: try it at nine offsets and keep the best.
        best_fit = None
        for off in np.linspace(-0.45, 0.45, 9) * half:
            fit = solve(-np.abs(across - off))
            if best_fit is None or fit[1] < best_fit[1]:
                best_fit = fit
        return best_fit
    fits = {}
    fits[1] = (ridge(dv, hz), hz)                     # ridge along first axis: falls away across the second
    fits[2] = (ridge(du, hx), hx)
    long_first = hx >= hz
    reach = (np.maximum(np.abs(dv), np.abs(du) - (hx - hz)) if long_first else np.maximum(np.abs(du), np.abs(dv) - (hz - hx)))
    fits[3] = (solve(-np.maximum(reach, 0)), min(hx, hz))
    fits[4] = (solve(dv), hz); fits[6] = (solve(du), hx)
    best = None
    for kind, ((coef, rms), half) in fits.items():
        slope = float(coef[1])
        if kind in (1, 2, 3):
            if slope < 0.1 or slope > 2.2:
                continue
            score = rms * (1.0 if kind != 3 else 1.12)
            eave = float(coef[0] - slope * half); ridge = float(coef[0])
        else:
            if abs(slope) < 0.07 or abs(slope) > 1.2:
                continue
            score = rms * 1.35
            eave = float(coef[0] - abs(slope) * half); ridge = float(coef[0] + abs(slope) * half)
            if slope < 0:
                kind += 1
        if best is None or score < best[0]:
            best = (score, kind, eave, ridge, rms)
    if best is None or flat_rms < 0.22 or flat_rms < best[4] * 1.15 or best[2] < 1.2 or best[3] - best[2] < 0.3:
        return 0, flat_level, flat_level
    return best[1], best[2], best[3]

def measure_roofs(buildings, points, nlast, dem):
    """
    Each building's real roof from the point cloud: per covering rectangle its type, eave and ridge (metres above
    the building's own ground), from the last returns on it. Sets `roofs` (parallel to `rects`), `wall` (the main
    block's eave) and `seen` (the share of the footprint standing above 1.6 m in 2018).
    """
    order = np.lexsort((np.floor(points[:, 0] / 16), np.floor(points[:, 1] / 16)))
    pts = points[order]
    key = (np.floor(pts[:, 1] / 16).astype(np.int64) + 4096) * 8192 + np.floor(pts[:, 0] / 16).astype(np.int64) + 4096
    uniq, starts = np.unique(key, return_index=True)
    ends = np.r_[starts[1:], key.size]
    bins = {int(k): (int(a), int(b)) for k, a, b in zip(uniq, starts, ends)}
    measured = 0
    for b in buildings:
        poly = b['poly']
        minx, minz, maxx, maxz = poly.bounds
        base = float(np.median(sample(dem, *np.array(poly.exterior.coords).T)))
        i0 = max(0, int(minx - X0)); i1 = min(N1, int(maxx - X0) + 1); j0 = max(0, int(minz - Z0)); j1 = min(N1, int(maxz - Z0) + 1)
        sub = nlast[j0:j1, i0:i1]
        if sub.size:
            gx, gz = np.meshgrid(X0 + np.arange(i0, i1) + 0.5, Z0 + np.arange(j0, j1) + 0.5)
            from shapely import contains_xy
            inside = contains_xy(poly, gx, gz)
            b['seen'] = float((sub[inside] > 1.6).mean()) if inside.any() else 0.0
        else:
            inside = None
            b['seen'] = 0.0
        chunks = []
        for bj in range(int(math.floor(minz / 16)), int(math.floor(maxz / 16)) + 1):
            for bi in range(int(math.floor(minx / 16)), int(math.floor(maxx / 16)) + 1):
                span = bins.get((bj + 4096) * 8192 + bi + 4096)
                if span:
                    chunks.append(pts[span[0]:span[1]])
        near = np.concatenate(chunks) if chunks else np.zeros((0, 3), np.float32)
        if near.shape[0] < 8 and inside is not None and inside.any():
            # No stored points (a building found in the lidar itself): use the raster's cells as points.
            sel = inside & (sub > 1.6)
            near = np.stack([gx[sel], gz[sel], sub[sel] + base], axis=1).astype(np.float32) if sel.any() else near
        roofs = []
        for (cx, cz, hx, hz, yaw) in b['rects']:
            c = math.cos(yaw); sn = math.sin(yaw)
            dx = near[:, 0] - cx; dz = near[:, 1] - cz
            du = dx * c + dz * sn; dv = -dx * sn + dz * c
            h = near[:, 2] - base
            sel = (np.abs(du) <= hx - 0.2) & (np.abs(dv) <= hz - 0.2) & (h > 1.5) & (h < 40)
            if sel.sum() < max(10, 0.6 * hx * hz * 4):
                roofs.append((ROOF_UNKNOWN, 0.0, 0.0))
                continue
            kind, eave, ridge = fit_roof(du[sel], dv[sel], h[sel].astype(np.float64), hx, hz)
            roofs.append((kind, max(1.6, eave), max(1.6, ridge)))
        b['roofs'] = roofs
        b['base'] = base
        if roofs and roofs[0][0] != ROOF_UNKNOWN:
            b['wall'] = float(roofs[0][1])
            measured += 1
    return measured

def find_buildings(nlast, ndsm, count, multi, taken, water_f, road_sdf1):
    """
    Buildings the footprint sources miss, straight from the point cloud: patches at least 2.2 m up whose surface is
    solid (one return per pulse) and planar, clear of mapped footprints, roads and water. Returns polygons.
    """
    share = multi / np.maximum(count, 1)
    d2x = np.abs(np.roll(nlast, 1, 1) + np.roll(nlast, -1, 1) - 2 * nlast)
    d2z = np.abs(np.roll(nlast, 1, 0) + np.roll(nlast, -1, 0) - 2 * nlast)
    planar = (d2x < 0.3) & (d2z < 0.3)
    solid = (nlast > 2.2) & (nlast < 25) & (share < 0.3) & (ndsm - nlast < 0.7) & (count > 0)
    water1 = np.repeat(np.repeat(water_f[:-1, :-1], 2, 0), 2, 1)
    cand = solid & ~taken & ~water1 & (road_sdf1 > 0.5)
    cand = ndimage.binary_opening(cand, structure=np.ones((3, 3)))
    labels, n = ndimage.label(cand)
    out = []
    if n == 0:
        return out
    idx = np.arange(1, n + 1)
    area = ndimage.sum(cand, labels, idx)
    flat = ndimage.sum(planar & cand, labels, idx)
    slices = ndimage.find_objects(labels)
    from shapely.geometry import MultiPoint
    for k, sl in enumerate(slices):
        if area[k] < 22 or area[k] > 4000 or flat[k] / area[k] < 0.62:
            continue
        js, is_ = np.nonzero(labels[sl] == k + 1)
        xs = X0 + sl[1].start + is_ + 0.5; zs = Z0 + sl[0].start + js + 0.5
        rect = MultiPoint(list(zip(xs, zs))).minimum_rotated_rectangle
        if rect.geom_type != 'Polygon':
            continue
        rect = rect.buffer(0.5, join_style=2)
        c = list(rect.exterior.coords)
        side = sorted([math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1])])
        if area[k] / rect.area < 0.62 or side[0] < 3.2 or side[1] / side[0] > 6:
            continue
        out.append(rect)
    return out

TREE_MODEL_HEIGHT = [16.2, 11.87, 11.89]   # pine, hardwood, birch at scale 1

def detect_trees(ndsm, count, ground, blocked, sdf_f, bldg_dist_f, rng):
    """
    Individual trees from the canopy height model: one at every crown top, with its real height. Dense crowns with
    little ground showing through in the leaf-off survey are conifers. Every tree near buildings is kept; farther
    out only the tallest in each patch, so the far woods stay drawable.
    Returns (x, z, kind, height) and the cleaned canopy height model.
    """
    chm = np.where(blocked, 0, ndsm).astype(np.float32)
    med = ndimage.median_filter(chm, 3)
    chm = np.where(chm - med > 4, med, chm)             # wires and stray high returns
    smooth = ndimage.gaussian_filter(chm, 1.0)
    peak = (ndimage.maximum_filter(smooth, 5) == smooth) & (smooth > 3.0)
    js, is_ = np.nonzero(peak)
    height = ndimage.maximum_filter(chm, 3)[js, is_]
    x = X0 + is_ + 0.5 + (rng.random(is_.size) - 0.5) * 0.6
    z = Z0 + js + 0.5 + (rng.random(js.size) - 0.5) * 0.6
    far = sample(bldg_dist_f, x, z)
    clear = sample(sdf_f, x, z)
    ok = (clear > 1.3) & (height > 3.0) & (height < 45)
    x, z, height, far, js, is_ = x[ok], z[ok], height[ok], far[ok], js[ok], is_[ok]
    order = np.argsort(-height)
    taken = {}
    keep = np.zeros(height.size, bool)
    for k in order:
        gap = 2.2 + 0.17 * height[k] if far[k] < 150 else (9.0 if far[k] < 450 else 13.0)
        cell = 14.0
        ci = int(x[k] // cell); cj = int(z[k] // cell)
        clash = False
        for a in (ci - 1, ci, ci + 1):
            for b in (cj - 1, cj, cj + 1):
                for (ox, oz) in taken.get((a, b), ()):
                    if (ox - x[k]) ** 2 + (oz - z[k]) ** 2 < gap * gap:
                        clash = True
                        break
                if clash:
                    break
            if clash:
                break
        if clash:
            continue
        keep[k] = True
        taken.setdefault((ci, cj), []).append((x[k], z[k]))
    x, z, height, js, is_ = x[keep], z[keep], height[keep], js[keep], is_[keep]
    g = ndimage.uniform_filter(ground, 5); c = ndimage.uniform_filter(count, 5)
    through = (g / np.maximum(g + c, 1e-3))[js, is_]
    conifer = (through < 0.2) & (height > 5)
    kind = np.where(conifer, 0, np.where((rng.random(x.size) < 0.12) & (height < 17), 2, 1)).astype(np.uint8)
    return x, z, kind, height.astype(np.float32), chm

# ---------------------------------------------------------------- cover and trees
# 0 meadow, 1 lawn, 2 woods, 3 marsh, 4 sand or bare, 5 lot, 6 field, 7 water
COVER = ['meadow', 'lawn', 'woods', 'marsh', 'bare', 'lot', 'field', 'water']

def classify(naip, ndvi, canopy_f, mask_f, sdf_f, bldg_dist_f, zones, wet, level_ext, ground):
    """Ground cover and a dryness tone for each shipped node."""
    V = naip[..., :3].mean(axis=2)
    def to_c(a, size=3):
        return ndimage.uniform_filter(a.astype(np.float32), size)[::2, ::2]
    canopy = to_c(canopy_f, 5)
    nd = to_c(ndvi, 5)
    bright = to_c(V, 5)
    near_b = bldg_dist_f[::2, ::2]
    rough = to_c(np.abs(V - ndimage.uniform_filter(V, 5)), 5)
    cover = np.zeros((NC, NC), np.uint8)
    lawnish = (near_b < 42) | (raster([zones['lawn']], CELL, NC) > 0)
    cover[lawnish] = 1
    field = (raster([zones['farm']], CELL, NC) > 0) | ((near_b > 70) & (canopy < 0.15) & (rough < 4.5) & (nd < 0.2))
    cover[field & ~lawnish] = 6
    bare = (nd < -0.02) & (bright > 120) & (canopy < 0.2) & (near_b > 25)
    cover[bare] = 4
    cover[canopy > 0.5] = 2
    low = (ground - level_ext) < 0.55
    near_water = ndimage.maximum_filter(wet.astype(np.uint8), 9) > 0
    marsh = (raster([zones['wetland']], CELL, NC) > 0) | (low & near_water & (canopy < 0.5) & ~lawnish)
    cover[marsh & (cover != 2)] = 3
    cover[raster([zones['lot']], CELL, NC) > 0] = 5
    cover[wet] = 7
    tone = np.clip((bright - 88) / 70, 0, 1) * np.clip(1 - (nd - 0.02) / 0.3, 0, 1)
    return cover, (tone * 255).astype(np.uint8), (np.clip(canopy, 0, 1) * 255).astype(np.uint8)

# ---------------------------------------------------------------- places
POI_KIND = [
    ('fuel', lambda t: t.get('amenity') == 'fuel' or t.get('shop') == 'convenience'),
    ('food', lambda t: t.get('amenity') in ('restaurant', 'bar', 'pub', 'cafe', 'fast_food') or t.get('shop') == 'confectionery'),
    ('lodging', lambda t: t.get('tourism') in ('motel', 'hotel', 'camp_site')),
    ('school', lambda t: t.get('amenity') == 'school'),
    ('civic', lambda t: t.get('amenity') in ('townhall', 'police', 'fire_station', 'post_office', 'courthouse', 'social_facility') or 'office' in t and t.get('office') == 'government'),
    ('church', lambda t: t.get('amenity') == 'place_of_worship'),
    ('park', lambda t: t.get('leisure') in ('park', 'pitch', 'slipway') or t.get('tourism') in ('attraction', 'artwork') or t.get('landuse') == 'cemetery' or t.get('amenity') == 'grave_yard'),
    ('shop', lambda t: 'shop' in t or t.get('amenity') in ('bank', 'cinema', 'veterinary') or 'office' in t or t.get('leisure') == 'dance'),
]

def collect_pois(osm, bodies):
    out = []
    seen = set()
    def add(name, tags, x, z):
        if not name or not (X0 + 30 < x < X1 - 30 and Z0 + 30 < z < Z1 - 30):
            return
        kind = next((k for k, test in POI_KIND if test(tags)), None)
        if kind is None:
            return
        key = (name, round(x / 40), round(z / 40))
        if key in seen:
            return
        seen.add(key)
        out.append({'n': name, 'k': kind, 'x': round(x, 1), 'z': round(z, 1)})
    for nid, tags in osm.node_tags.items():
        add(tags.get('name'), tags, *osm.nodes[nid])
    for wid, (refs, tags) in osm.ways.items():
        if tags.get('name') and 'highway' not in tags and 'waterway' not in tags and len(refs) >= 3:
            c = Polygon(osm.pts(wid)).centroid if osm.closed(wid) else LineString(osm.pts(wid)).centroid
            add(tags.get('name'), tags, c.x, c.y)
    waters = {}
    for name, g in bodies:
        inside = g.intersection(WORLD)
        if name and not inside.is_empty and inside.area > waters.get(name, (0, None))[0]:
            waters[name] = (inside.area, inside.representative_point())
    for name, (_a, p) in waters.items():
        out.append({'n': name, 'k': 'water', 'x': round(p.x, 1), 'z': round(p.y, 1)})
    return out

# ---------------------------------------------------------------- output
BASE = 228.0   # elevation (m) of y = 0, below the deepest river bed

def building_out(b):
    """One building for the JSON: each rectangle carries its roof type and its eave and ridge above the floor."""
    lift = b['base'] - b['floor']          # the lidar measured from the natural ground; the floor sits on the graded yard
    rects = []
    for (cx, cz, hx, hz, yaw), (kind, eave, ridge) in zip(b['rects'], b['roofs']):
        if kind == ROOF_UNKNOWN:
            rects.append([round(cx, 1), round(cz, 1), round(hx, 2), round(hz, 2), round(yaw, 4), -1, 0, 0])
        else:
            e = round(max(1.6, eave + lift), 2)
            top = e if kind == 0 else round(max(e + 0.3, ridge + lift), 2)
            rects.append([round(cx, 1), round(cz, 1), round(hx, 2), round(hz, 2), round(yaw, 4), kind, e, top])
    known = rects[0][5] >= 0
    out = {'k': b['kind'], 'h': round(rects[0][6] if known else b['wall'], 2), 'f': round(b['floor'] - BASE, 2), 'l': round(b['low'] - BASE, 2), 's': b['seed'], 'p': flat(b['ring']), 'r': rects}
    if b['name']:
        out['n'] = b['name']
    if known:
        out['m'] = 1
    return out

def flat(pts, digits=1):
    out = []
    for x, z in pts:
        out.append(round(float(x), digits)); out.append(round(float(z), digits))
    return out

def write_bin(path, sections):
    header = {'sections': []}
    blobs = []
    offset = 0
    for name, kind, side, arr in sections:
        raw = np.ascontiguousarray(arr).tobytes()
        header['sections'].append({'name': name, 'type': kind, 'side': side, 'count': int(arr.size), 'offset': offset, 'bytes': len(raw)})
        blobs.append(raw)
        offset += len(raw)
    head = json.dumps(header, separators=(',', ':')).encode()
    body = b'TELLO\x01' + struct.pack('<I', len(head)) + head + b''.join(blobs)
    with open(path, 'wb') as f:
        f.write(gzip.compress(body, 9, mtime=0))
    return len(body)

def debug_images(out_dir, cover, ground, wet, roads, buildings, trees):
    os.makedirs(out_dir, exist_ok=True)
    pal = np.array([[150, 160, 90], [110, 150, 80], [60, 95, 55], [105, 125, 85], [200, 185, 150], [120, 120, 120], [190, 175, 110], [60, 100, 140]], np.uint8)
    img = pal[cover]
    gy, gx = np.gradient(ground, CELL)
    shade = np.clip(1 + (gx - gy) * 2.5, 0.6, 1.4)
    img = np.clip(img * shade[..., None], 0, 255).astype(np.uint8)
    big = Image.fromarray(img[::-1]).resize((2050, 2050), Image.NEAREST)
    d = ImageDraw.Draw(big)
    s = 2050 / SIZE
    def px(x, z):
        return ((x - X0) * s, (Z1 - z) * s)
    for b in buildings:
        col = {'house': (200, 120, 90), 'store': (220, 60, 60), 'industrial': (150, 110, 170), 'civic': (230, 170, 50), 'church': (250, 250, 250), 'garage': (170, 140, 120), 'shed': (140, 120, 100), 'canopy': (255, 255, 0)}[b['kind']]
        d.polygon([px(x, z) for x, z in b['ring']], fill=col)
    for r in roads:
        col = [(40, 40, 40), (70, 70, 70), (100, 100, 100), (160, 140, 110), (230, 230, 220), (150, 110, 70)][r['kind']]
        d.line([px(x, z) for x, z in r['pts']], fill=col, width=max(1, round(r['width'] * s)))
    big.save(f'{out_dir}/map.png')
    tx, tz, tk, _ts = trees
    timg = Image.new('RGB', (2050, 2050), (20, 20, 20))
    td = ImageDraw.Draw(timg)
    for x, z, k in zip(tx, tz, tk):
        p = px(x, z)
        td.point(p, fill=[(40, 140, 60), (150, 200, 80), (230, 220, 120)][k])
    timg.save(f'{out_dir}/trees.png')

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', default='.tello-cache')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', '..', 'public', 'modules', 'tello'))
    ap.add_argument('--debug', default='')
    args = ap.parse_args()
    cache = args.cache
    os.makedirs(cache, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    lon0, lat0, lon1, lat1 = FETCH_BBOX
    osm = Osm(fetch(f'https://api.openstreetmap.org/api/0.6/map?bbox={lon0},{lat0},{lon1},{lat1}', f'{cache}/montello.osm'))
    dem = load_dem(cache)
    naip = load_naip(cache).astype(np.float32)
    rng = np.random.default_rng(20261113)

    # Water: bodies, surface level, beds.
    bodies = water_bodies(osm, dem)
    water = unary_union([g for _n, g in bodies]).intersection(WORLD)
    mask_f = raster([water]) > 0
    wet_wide, level = water_levels(mask_f, dem)
    level_ext = nearest_fill(level, wet_wide)
    dist = ndimage.distance_transform_edt(mask_f) * FINE
    depth_f = np.where(mask_f, np.clip(0.12 + 0.11 * dist, 0, MAX_DEPTH), 0)
    depth = depth_f[::2, ::2].astype(np.float32).copy()
    gy, gx = np.gradient(level_ext, CELL)
    depth = np.where(np.hypot(gx, gy) > 0.04, np.minimum(depth, 0.28), depth)   # chutes at the dams run shallow and white
    wet = depth > 0
    ground = ndimage.gaussian_filter(dem, 0.8)[::2, ::2].astype(np.float32).copy()
    ground = np.where(wet, np.minimum(ground, level_ext - depth), ground)

    # Roads, then yards and lots.
    roads = collect_roads(osm)
    ms = ms_buildings(cache)
    buildings = collect_buildings(osm, ms, water, roads, dem)

    # The 2018 point cloud: what stands on the ground. Roofs, buildings no footprint source has, bridge decks, trees.
    lid, roof_points = load_lidar(cache, raster([b['poly'].buffer(1.0) for b in buildings], 1, N1) > 0)
    dem1 = cell_dem(dem)
    ndsm = np.clip(np.where(lid['top'] > -1e8, lid['top'], dem1) - dem1, 0, 80).astype(np.float32)
    nlast = np.clip(np.where(lid['last'] > -1e8, lid['last'], dem1) - dem1, 0, 80).astype(np.float32)
    road_dist1 = ndimage.distance_transform_edt(~(raster([LineString(r['pts']).buffer(r['width'] / 2) for r in roads], 1, N1) > 0)).astype(np.float32)
    extra = find_buildings(nlast, ndsm, lid['count'], lid['multi'], raster([b['poly'].buffer(2.0) for b in buildings], 1, N1) > 0, mask_f, road_dist1)
    inner = WORLD.buffer(-24)
    found = [b for b in (lidar_building(p, dem) for p in extra if inner.contains(p.centroid)) if b]
    buildings += found
    measured = measure_roofs(buildings, roof_points, nlast, dem)

    ground, bridges, culvert, road_w = grade_roads(roads, dem, ground, level_ext, wet, mask_f, lid['last'])
    wet = wet & ~culvert
    depth = np.where(wet, depth, 0)
    lots = []
    for tags, g in osm.polygons(lambda t: t.get('amenity') == 'parking'):
        if isinstance(g, list) or not WORLD.buffer(-30).contains(g.centroid) or g.geom_type != 'Polygon':
            continue
        lots.append({'poly': g.simplify(0.3), 'floor': 0.0})
    pads(buildings, lots, ground, road_w)
    # A low bank around every shore so the water's edge never hangs over lower ground.
    shore = (ndimage.maximum_filter(wet.astype(np.uint8), 5) > 0) & ~wet
    ground = np.where(shore, np.maximum(ground, level_ext + 0.14), ground)
    ground = np.where(wet, np.minimum(ground, level_ext - depth), ground)

    # Hard surfaces (1 m raster): distance to pavement and walls, for grass, trees and shoulders.
    NH = SIZE + 1
    hard_geoms = [LineString(r['pts']).buffer(r['width'] / 2, cap_style=1) for r in roads]
    hard_geoms += [b['poly'] for b in buildings] + [l['poly'] for l in lots]
    hard = raster(hard_geoms, 1, NH) > 0
    sdf1 = (ndimage.distance_transform_edt(~hard) - ndimage.distance_transform_edt(hard)).astype(np.float32)
    sdf_f = sdf1[::2, ::2]
    bldg = raster([b['poly'] for b in buildings if b['kind'] not in ('shed',)], FINE, NF) > 0
    bldg_dist_f = (ndimage.distance_transform_edt(~bldg) * FINE).astype(np.float32)

    # Trees and cover: every crown in the point cloud, and the ground under them.
    R, NIR = naip[..., 0], naip[..., 3]
    ndvi = (NIR - R) / (NIR + R + 1)
    water1 = np.repeat(np.repeat(mask_f[:-1, :-1], 2, 0), 2, 1)
    blocked = (raster([b['poly'].buffer(1.5) for b in buildings], 1, N1) > 0) | water1 | (lid['count'] == 0)
    for b in bridges:
        line = LineString(b['road']['dense'][b['a']:b['b'] + 1])
        blocked |= raster([line.buffer(b['road']['width'] / 2 + 2.5)], 1, N1) > 0
    tx, tz, tk, th, chm = detect_trees(ndsm, lid['count'], lid['ground'], blocked, sdf_f, bldg_dist_f, rng)
    crowns = (chm > 3.0).reshape(N1 // 2, 2, N1 // 2, 2).max(axis=(1, 3))
    canopy_f = np.pad(crowns, ((0, 1), (0, 1)), mode='edge') & ~mask_f & (sdf_f > 0.5)
    def zone(test):
        polys = [g for _t, g in osm.polygons(test) if not isinstance(g, list)]
        return unary_union(polys).intersection(WORLD) if polys else Polygon()
    zones = {
        'lawn': zone(lambda t: t.get('landuse') in ('residential', 'cemetery', 'religious', 'recreation_ground', 'commercial', 'retail') or t.get('leisure') in ('park', 'pitch', 'playground', 'garden') or t.get('amenity') in ('school', 'grave_yard')),
        'farm': zone(lambda t: t.get('landuse') in ('farmland', 'orchard', 'meadow')),
        'wetland': zone(lambda t: t.get('natural') == 'wetland'),
        'lot': unary_union([l['poly'] for l in lots]) if lots else Polygon(),
    }
    cover, tone, canopy = classify(naip, ndvi, canopy_f, mask_f, sdf_f, bldg_dist_f, zones, wet, level_ext, ground)
    pois = collect_pois(osm, bodies)

    # ---- write
    g16 = np.clip(np.round((ground - BASE) * 100), 0, 65535).astype('<u2')
    near = ndimage.maximum_filter(wet.astype(np.uint8), 5) > 0
    w16 = np.where(near, np.clip(np.round((level_ext - BASE) * 100), 1, 65535), 0).astype('<u2')
    clear = np.clip(np.round(sdf_f * 4), -127, 127).astype('i1')
    tree_x = np.round((tx - X0) * 10).astype('<u2')
    tree_z = np.round((tz - Z0) * 10).astype('<u2')
    tree_s = (tk.astype(np.uint8) << 6).astype('u1')
    tree_h = np.clip(np.round(th * 4), 1, 255).astype('u1')
    raw = write_bin(os.path.join(args.out, 'montello.bin'), [
        ('ground', 'u16', NC, g16), ('water', 'u16', NC, w16), ('cover', 'u8', NC, cover), ('tone', 'u8', NC, tone), ('canopy', 'u8', NC, canopy),
        ('clear', 'i8', NF, clear), ('treeX', 'u16', 0, tree_x), ('treeZ', 'u16', 0, tree_z), ('treeS', 'u8', 0, tree_s), ('treeH', 'u8', 0, tree_h),
    ])
    road_index = {id(r): i for i, r in enumerate(roads)}
    doc = {
        'version': 1,
        'name': 'Montello, Wisconsin',
        'frame': {'lon': ORIGIN_LONLAT[0], 'lat': ORIGIN_LONLAT[1], 'utmZone': 16, 'utmE': E0, 'utmN': N0, 'x0': X0, 'z0': Z0, 'size': SIZE, 'cell': CELL, 'fine': FINE, 'base': BASE},
        'roads': [{'k': r['kind'], 'w': round(r['width'], 1), 'n': r['name'] or r['ref'], 'c': r['class'], 'p': flat(r['pts'])} for r in roads],
        'bridges': [{'r': road_index[id(b['road'])], 'k': b['road']['kind'], 'w': round(b['road']['width'], 1), 'y': round(b['y'] - BASE, 2), **({'m': 1} if b['measured'] else {}),
                     'p': flat(b['road']['dense'][b['a']:b['b'] + 1])} for b in bridges],
        'buildings': [building_out(b) for b in buildings],
        'lots': [{'f': round(l['floor'] - BASE, 2), 'p': flat(list(l['poly'].exterior.coords)[:-1])} for l in lots],
        'pois': pois,
        'sources': [
            'Roads, water, land use and places © OpenStreetMap contributors (ODbL)',
            'Elevation: USGS 3D Elevation Program lidar',
            'Ground cover from USDA NAIP aerial imagery',
            'Building footprints: OpenStreetMap and Microsoft Global ML Building Footprints (ODbL)',
            'Roof shapes, building and tree heights, bridge decks: 2018 FEMA/USGS lidar point cloud (NOAA Digital Coast)',
        ],
    }
    kinds = {}
    for b in buildings:
        kinds[b['kind']] = kinds.get(b['kind'], 0) + 1
    roof_names = {-1: 'unmeasured', 0: 'flat', 1: 'gable', 2: 'gable', 3: 'hip', 4: 'shed', 5: 'shed', 6: 'shed', 7: 'shed'}
    roof_kinds = {}
    for b in buildings:
        name = roof_names[b['roofs'][0][0]]
        roof_kinds[name] = roof_kinds.get(name, 0) + 1
    doc['stats'] = {
        'roads': len(roads), 'roadKm': round(sum(LineString(r['pts']).length for r in roads) / 1000, 1), 'bridges': len(bridges),
        'bridgesMeasured': sum(1 for b in bridges if b['measured']),
        'buildings': len(buildings), 'buildingsFromOsm': sum(1 for b in buildings if b['src'] == 'osm'), 'buildingsFromLidar': len(found), 'buildingKinds': kinds,
        'roofsMeasured': measured, 'roofKinds': roof_kinds, 'buildingsNotStandingIn2018': sum(1 for b in buildings if b['seen'] < 0.2),
        'waterBodies': len(bodies), 'waterShare': round(float(wet.mean()), 4), 'trees': int(tx.size), 'treeKinds': [int((tk == k).sum()) for k in range(3)],
        'treeHeightMedian': round(float(np.median(th)), 1), 'treeHeightMax': round(float(th.max()), 1), 'lots': len(lots), 'places': len(pois),
        'lowest': round(float(ground.min() - BASE), 2), 'highest': round(float(ground.max() - BASE), 2),
    }
    with open(os.path.join(args.out, 'montello.json'), 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(json.dumps(doc['stats'], indent=1))
    print('montello.bin', os.path.getsize(os.path.join(args.out, 'montello.bin')), 'bytes packed,', raw, 'raw; montello.json', os.path.getsize(os.path.join(args.out, 'montello.json')))
    if args.debug:
        debug_images(args.debug, cover, ground, wet, roads, buildings, (tx, tz, tk, th))

if __name__ == '__main__':
    main()
