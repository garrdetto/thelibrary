"""
Driveways for Tello's bake (`bake_map.py`): every house or garage whose drive shows in the aerial photo gets one,
from its wall out to the edge of the road it leaves from.

OpenStreetMap maps only a few of Montello's driveways. The rest are read off the USDA NAIP photo at one metre a pixel
(`naip_fine`, fetched in 1,024 m tiles) together with the 2018 point cloud's canopy:

  - each cell gets a bareness from the photo's vegetation index (mown lawn and fields are green, gravel and pavement
    are not); cells under trees are unknown and cost a little more to cross;
  - the cheapest way from just outside the building to a road (`MCP_Geometric`, walls and water impassable, other
    roads the goal) is the candidate drive;
  - it is kept only when it is bare along most of its open length, barer than the ground either side of it, and not
    running along the road it joins;
  - its width comes from the bare band round it and its surface from its colour: warm and light is gravel, the rest
    (asphalt, concrete) is paved.

Each kept drive stops on the road's edge, so it never lies over the road, and at the wall it serves. Garages are done
first and a house next to a garage that has one is left alone, so a farmstead gets one drive, not three.
"""
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import LineString, Point, box
from shapely.strtree import STRtree

TILE = 1024                  # metres (and pixels) a side of each fine aerial tile
REACH = 260.0                # the longest drive looked for
SERVED = 2.5                 # a building this close to a mapped lane or track already has its drive
STREET_FRONT = 1.6           # a building this close to a street fronts on it (downtown) and needs none
NEAR_GARAGE = 26.0           # a house this close to a garage with a drive shares it
DRIVE_CLASS = 'driveway'


def naip_tile_path(cache, ti, tj, x0, z0):
    return f'{cache}/naip1m/{x0}_{z0}_{ti}_{tj}.tif'


def naip_tiles(area, x0, z0, size):
    n = size // TILE
    out = []
    for tj in range(n):
        for ti in range(n):
            if area.intersects(box(x0 + ti * TILE, z0 + tj * TILE, x0 + (ti + 1) * TILE, z0 + (tj + 1) * TILE)):
                out.append((ti, tj))
    return out


def fetch_naip_fine(cache, area, fetch, x0, z0, e0, n0, size):
    """Downloads the one-metre aerial tiles over `area` (red, green, blue, near infrared)."""
    tiles = naip_tiles(area, x0, z0, size)
    for number, (ti, tj) in enumerate(tiles):
        xmin = e0 + x0 + ti * TILE; ymin = n0 + z0 + tj * TILE
        url = ('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
               f'?bbox={xmin},{ymin},{xmin + TILE},{ymin + TILE}&bboxSR=26916&imageSR=26916&size={TILE},{TILE}'
               '&format=tiff&interpolation=RSP_BilinearInterpolation&f=image')
        fetch(url, naip_tile_path(cache, ti, tj, x0, z0))
        if number % 20 == 0:
            print(f'  fine aerial tile {number + 1}/{len(tiles)}', flush=True)
    return tiles


class FineNaip:
    """One-metre aerial windows (row 0 = south), stitched from the cached tiles."""

    def __init__(self, cache, x0, z0, size):
        self.cache, self.x0, self.z0, self.n = cache, x0, z0, size // TILE
        self.loaded = {}

    def tile(self, ti, tj):
        key = (ti, tj)
        if key not in self.loaded:
            path = naip_tile_path(self.cache, ti, tj, self.x0, self.z0)
            if not (0 <= ti < self.n and 0 <= tj < self.n) or not os.path.exists(path):
                arr = None
            else:
                arr = np.array(Image.open(path))[..., :4][::-1].copy()
            if len(self.loaded) > 24:
                self.loaded.pop(next(iter(self.loaded)))
            self.loaded[key] = arr
        return self.loaded[key]

    def window(self, i0, j0, w, h):
        """Cells i0..i0+w, j0..j0+h counted in metres from the frame's south-west corner."""
        out = np.zeros((h, w, 4), np.uint8)
        for tj in range(j0 // TILE, (j0 + h - 1) // TILE + 1):
            for ti in range(i0 // TILE, (i0 + w - 1) // TILE + 1):
                t = self.tile(ti, tj)
                if t is None:
                    continue
                a0 = max(i0, ti * TILE); a1 = min(i0 + w, (ti + 1) * TILE)
                b0 = max(j0, tj * TILE); b1 = min(j0 + h, (tj + 1) * TILE)
                out[b0 - j0:b1 - j0, a0 - i0:a1 - i0] = t[b0 - tj * TILE:b1 - tj * TILE, a0 - ti * TILE:a1 - ti * TILE]
        return out


def burn(polys, ox, oz, w, h):
    """Polygons into an h x w one-metre mask whose south-west corner is (ox, oz), row 0 = south."""
    from PIL import ImageDraw
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    for g in polys:
        for part in getattr(g, 'geoms', [g]):
            if part.is_empty or part.geom_type != 'Polygon':
                continue
            d.polygon([(x - ox - 0.5, (h - 1) - (z - oz - 0.5)) for x, z in part.exterior.coords], fill=1)
            for hole in part.interiors:
                d.polygon([(x - ox - 0.5, (h - 1) - (z - oz - 0.5)) for x, z in hole.coords], fill=0)
    return np.array(img)[::-1] > 0


def chaikin(pts, rounds=2):
    """Rounds a polyline's corners, keeping its ends."""
    for _ in range(rounds):
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


def surface_of(rgb):
    """'gravel' or 'paved' from the drive's mean colour: gravel is light and warm, asphalt dark, concrete light and grey."""
    r, g, b = (float(v) for v in rgb)
    light = (r + g + b) / 3
    warm = r - b
    return 'gravel' if light > 105 and warm > 9 else 'paved'


def find_driveways(cache, buildings, roads, ndsm, water_f, near_city, frame, stats=None):
    """
    The drives the aerial photo shows (see the module's notes), as road records for the bake: kind 2 (paved lane) or 3
    (gravel), class `driveway`. `ndsm` is the point cloud's height over the bare earth on one-metre cells, `water_f`
    the fine water mask, `frame` (x0, z0, size, fine).
    """
    from skimage.graph import MCP_Geometric
    x0, z0, size, fine = frame
    naip = FineNaip(cache, x0, z0, size)
    drivable = [r for r in roads if r['kind'] <= 3]
    road_polys = [LineString(r['pts']).buffer(r['width'] / 2, cap_style=2) for r in drivable]
    road_tree = STRtree(road_polys)
    lines = [LineString(r['pts']) for r in drivable]
    polys = [b['poly'] for b in buildings]
    b_tree = STRtree(polys)
    garages = [i for i, b in enumerate(buildings) if b['kind'] == 'garage']
    houses = [i for i, b in enumerate(buildings) if b['kind'] == 'house']
    # Work tile by tile so the aerial tiles stay loaded.
    order = sorted(garages, key=lambda i: (int(polys[i].centroid.y // TILE), int(polys[i].centroid.x // TILE))) + \
        sorted(houses, key=lambda i: (int(polys[i].centroid.y // TILE), int(polys[i].centroid.x // TILE)))
    made = []
    made_polys = []
    with_drive = set()
    counts = {'tried': 0, 'served': 0, 'street': 0, 'shared': 0, 'far': 0, 'nopath': 0, 'rejected': 0, 'kept': 0}
    for done, bi in enumerate(order):
        b = buildings[bi]
        poly = polys[bi]
        c = poly.centroid
        if not near_city.contains(c):
            continue
        counts['tried'] += 1
        near = [int(k) for k in road_tree.query(poly.buffer(REACH))]
        if not near:
            counts['far'] += 1
            continue
        if any(drivable[k]['kind'] >= 2 and road_polys[k].distance(poly) < SERVED for k in near):
            counts['served'] += 1
            continue
        if any(drivable[k]['kind'] <= 1 and road_polys[k].distance(poly) < STREET_FRONT for k in near):
            counts['street'] += 1
            continue
        if any(m.distance(poly) < 6.0 for m in made_polys[-400:]):
            counts['shared'] += 1
            continue
        if b['kind'] == 'house' and any(buildings[g]['kind'] == 'garage' and g in with_drive and polys[g].distance(poly) < NEAR_GARAGE for g in b_tree.query(poly.buffer(NEAR_GARAGE))):
            counts['shared'] += 1
            continue
        gap = min(road_polys[k].distance(poly) for k in near)
        if gap > REACH - 20:
            counts['far'] += 1
            continue
        pad = gap + 30
        bx0, bz0, bx1, bz1 = poly.bounds
        i0 = int(math.floor(bx0 - pad - x0)); j0 = int(math.floor(bz0 - pad - z0))
        i1 = int(math.ceil(bx1 + pad - x0)); j1 = int(math.ceil(bz1 + pad - z0))
        i0 = max(0, i0); j0 = max(0, j0); i1 = min(size, i1); j1 = min(size, j1)
        w = i1 - i0; h = j1 - j0
        if w < 8 or h < 8:
            continue
        ox = x0 + i0; oz = z0 + j0
        img = naip.window(i0, j0, w, h).astype(np.float32)
        if not img[..., 3].any():
            counts['nopath'] += 1
            continue
        red = img[..., 0]; nir = img[..., 3]
        ndvi = (nir - red) / (nir + red + 1)
        light = img[..., :3].mean(axis=2)
        bare = np.clip((0.12 - ndvi) / 0.2, 0, 1) * np.clip((light - 45) / 30, 0, 1)
        tall = np.asarray(ndsm[j0:j1, i0:i1], np.float32)
        canopy = tall > 2.2
        win = box(ox, oz, ox + w, oz + h)
        others = [polys[int(k)] for k in b_tree.query(win) if int(k) != bi]
        walls = burn([p.buffer(2.0) for p in others], ox, oz, w, h)
        fj = (np.arange(j0, j1) // fine).clip(0, water_f.shape[0] - 1); fi = (np.arange(i0, i1) // fine).clip(0, water_f.shape[1] - 1)
        wet = water_f[np.ix_(fj, fi)]
        on_road = burn([road_polys[k] for k in near], ox, oz, w, h)
        cost = 0.35 + 7.0 * (1 - bare) ** 2
        cost = np.where(canopy, 2.6, cost)
        cost = np.where(walls | wet, np.inf, cost)
        self_mask = burn([poly], ox, oz, w, h)
        ring = burn([poly.buffer(1.6)], ox, oz, w, h) & ~self_mask & ~walls & ~wet & ~on_road
        starts = np.argwhere(ring)
        edge = on_road & ~ndimage.binary_erosion(on_road)
        ends = np.argwhere(edge & ~walls)
        if not len(starts) or not len(ends):
            counts['nopath'] += 1
            continue
        cost = np.where(self_mask, np.inf, cost)
        cost = np.where(on_road, 0.35, cost)
        try:
            mcp = MCP_Geometric(cost, fully_connected=True)
            acc, _tb = mcp.find_costs(starts, ends, find_all_ends=False)
        except Exception:  # noqa: BLE001
            counts['nopath'] += 1
            continue
        hit = ends[np.argmin(acc[ends[:, 0], ends[:, 1]])]
        if not np.isfinite(acc[hit[0], hit[1]]):
            counts['nopath'] += 1
            continue
        path = np.array(mcp.traceback(tuple(hit)))
        inner = ~on_road[path[:, 0], path[:, 1]]
        path = path[inner]
        if len(path) < 3:
            counts['street'] += 1
            continue
        length = float(np.sum(np.hypot(*np.diff(path, axis=0).T))) + 1
        open_ = ~canopy[path[:, 0], path[:, 1]]
        sb = bare[path[:, 0], path[:, 1]]
        if open_.sum() < max(3, 0.45 * len(path)):
            counts['rejected'] += 1
            continue
        bare_share = float((sb[open_] > 0.5).mean())
        core = np.zeros((h, w), bool)
        core[path[:, 0], path[:, 1]] = True
        near_band = ndimage.binary_dilation(core, iterations=1)
        side = ndimage.binary_dilation(core, iterations=7) & ~ndimage.binary_dilation(core, iterations=4) & ~canopy & ~walls & ~on_road & ~self_mask
        contrast = float(bare[near_band & ~canopy].mean() - (bare[side].mean() if side.any() else 0))
        along_road = float(ndimage.binary_dilation(on_road, iterations=3)[path[:, 0], path[:, 1]].mean())
        ok = bare_share >= 0.72 and along_road < 0.35 and (contrast >= 0.22 or (length < 22 and bare_share > 0.85))
        if not ok or length > REACH:
            counts['rejected'] += 1
            continue
        band = ndimage.binary_dilation(core, iterations=4) & (bare > 0.5) & ~canopy & ~walls & ~self_mask & ~on_road
        lab, _n = ndimage.label(band)
        touching = np.unique(lab[core & band])
        width = float(np.isin(lab, touching[touching > 0]).sum()) / max(1.0, float(open_.sum())) if touching.size else 3.2
        width = max(2.8, min(5.5, width))
        px = img[path[:, 0], path[:, 1], :3][open_ & (sb > 0.5)]
        kind_name = surface_of(np.median(px, axis=0)) if len(px) else 'paved'
        pts = [(ox + p[1] + 0.5, oz + p[0] + 0.5) for p in path]
        line = LineString(pts).simplify(1.2)
        pts = list(line.coords)
        # The house end: just outside the wall.
        start = Point(pts[0])
        on_wall = poly.exterior.interpolate(poly.exterior.project(start))
        dx, dz = start.x - on_wall.x, start.y - on_wall.y
        dl = math.hypot(dx, dz) or 1.0
        pts[0] = (on_wall.x + dx / dl * 0.6, on_wall.y + dz / dl * 0.6)
        # The road end: on the road's edge, square to it.
        last = Point(pts[-1])
        k = min(near, key=lambda k: lines[k].distance(last))
        road_line = lines[k]
        foot = road_line.interpolate(road_line.project(last))
        dx, dz = last.x - foot.x, last.y - foot.y
        dl = math.hypot(dx, dz)
        if dl < 0.3:
            prev = Point(pts[-2]) if len(pts) > 1 else start
            dx, dz = prev.x - foot.x, prev.y - foot.y
            dl = math.hypot(dx, dz) or 1.0
        edge_pt = (foot.x + dx / dl * drivable[k]['width'] / 2, foot.y + dz / dl * drivable[k]['width'] / 2)
        approach = (foot.x + dx / dl * (drivable[k]['width'] / 2 + min(4.0, width)), foot.y + dz / dl * (drivable[k]['width'] / 2 + min(4.0, width)))
        while len(pts) > 1 and math.hypot(pts[-1][0] - foot.x, pts[-1][1] - foot.y) < drivable[k]['width'] / 2 + min(4.0, width) + 0.5:
            pts.pop()
        pts = chaikin(pts + [approach]) + [edge_pt]
        if len(pts) < 2 or LineString(pts).length < 3:
            counts['rejected'] += 1
            continue
        drive = LineString(pts)
        if any(o.intersects(drive.buffer(width / 2 + 0.3)) for o in others):
            counts['rejected'] += 1
            continue
        made.append({'id': f'drive-{len(made)}', 'kind': 3 if kind_name == 'gravel' else 2, 'width': round(width, 1), 'name': '', 'ref': '',
                     'pts': [(float(x), float(z)) for x, z in pts], 'bridge': False, 'oneway': False, 'class': DRIVE_CLASS, 'drive': True})
        made_polys.append(drive.buffer(width / 2))
        with_drive.add(bi)
        counts['kept'] += 1
        if done % 250 == 0:
            print(f'  driveways {done + 1}/{len(order)}: {counts}', flush=True)
    if stats is not None:
        stats.update(counts)
    return made
