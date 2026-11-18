"""
Golf courses for Tello's bake (`bake_map.py`): White Lake Golf Club, east of White Lake, laid out hole by hole so the
page can draw it as a course now and a later update can play it.

From OpenStreetMap: the course outline (leisure=golf_course), each hole's line from tee to green (golf=hole, with its
`ref` and `par` when tagged), the mapped greens and tees and the clubhouse. From the one-metre NAIP photo and the 2018
point cloud: each fairway is the open, mown grass round the hole's line (no crowns, green in the photo) from the end of
the tee shot to the green, and each bunker the bright bare sand inside the course. Greens and tees OpenStreetMap lacks
are shaped round the line's ends: an oval green across the approach, a tee box in line with the hole.

The record (`golf` in the JSON, one per course): `n` name, `p` outline, `c` the clubhouse door's spot, and `holes`:
`n` number, `par`, `len` metres along the line, `line` (x, z pairs, tee to green), `tee` (x, z, heading toward the
green), `box` the tee box, `green`, `pin` (x, z), `fw` the fairway polygons; `bunkers` (polygons). The bake also
shapes the ground: tees level and a little raised, greens smoothed, bunkers dug in.
"""
import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import unary_union, substring

COURSE_NAME = 'White Lake Golf Club'
GREEN_LEN = 30.0
GREEN_WIDE = 24.0
TEE_LEN = 16.0
TEE_WIDE = 9.0
FAIRWAY_HALF = 20.0


def par_for(length):
    """A hole's par from its length when OpenStreetMap gives none (men's tees: par 3 to 250 yards, par 4 to 470)."""
    yards = length / 0.9144
    return 3 if yards <= 250 else 4 if yards <= 470 else 5


def ellipse(cx, cz, along, across, heading, n=28):
    ux, uz = math.sin(heading), math.cos(heading)
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n
        a = math.cos(t) * along / 2
        b = math.sin(t) * across / 2
        pts.append((cx + ux * a + uz * b, cz + uz * a - ux * b))
    return Polygon(pts)


def rect(cx, cz, along, across, heading):
    ux, uz = math.sin(heading), math.cos(heading)
    a, b = along / 2, across / 2
    return Polygon([(cx + ux * sa * a + uz * sb * b, cz + uz * sa * a - ux * sb * b) for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def mask_poly(mask, ox, oz, simplify=0.8):
    """The largest outline of a one-metre mask (row 0 = south, south-west corner at ox, oz) as a polygon."""
    lab, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    js, is_ = np.nonzero(lab == k)
    cells = [box(ox + i, oz + j, ox + i + 1, oz + j + 1) for i, j in zip(is_, js)]
    g = unary_union(cells).buffer(0.6).buffer(-0.6).simplify(simplify)
    if g.geom_type != 'Polygon':
        g = max(getattr(g, 'geoms', []), key=lambda p: p.area, default=None)
    return g if g is not None and not g.is_empty else None


def burn(polys, ox, oz, w, h):
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    for g in polys:
        for part in getattr(g, 'geoms', [g]):
            if part.is_empty or part.geom_type != 'Polygon':
                continue
            d.polygon([(x - ox - 0.5, (h - 1) - (z - oz - 0.5)) for x, z in part.exterior.coords], fill=1)
    return np.array(img)[::-1] > 0


def order_holes(holes, club):
    """Hole numbers from `ref` where every hole has one, else a round from the clubhouse: each next tee the nearest to the last green."""
    if holes and all(h['ref'] is not None for h in holes):
        return sorted(holes, key=lambda h: h['ref'])
    left = list(holes)
    out = []
    at = club
    while left:
        nxt = min(left, key=lambda h: math.hypot(h['line'].coords[0][0] - at[0], h['line'].coords[0][1] - at[1]))
        left.remove(nxt)
        out.append(nxt)
        at = nxt['line'].coords[-1]
    return out


def golf_layout(osm, course, naip_fine, ndsm, water, roads, buildings, frame):
    """The course record (see the module's notes) and the shapes the bake grades the ground for."""
    x0, z0, size = frame
    holes = []
    for wid, (refs, tags) in osm.ways.items():
        if tags.get('golf') != 'hole' or len(refs) < 2:
            continue
        line = LineString(osm.pts(wid))
        if not course.buffer(40).contains(line.centroid):
            continue
        ref = tags.get('ref')
        par = tags.get('par')
        holes.append({'line': line, 'ref': int(ref) if ref and ref.isdigit() else None, 'par': int(par) if par and par.isdigit() else None})
    areas = {'green': [], 'tee': [], 'bunker': []}
    club = None
    for wid, (refs, tags) in osm.ways.items():
        kind = tags.get('golf')
        if kind in areas and osm.closed(wid):
            p = Polygon(osm.pts(wid)).buffer(0)
            if not p.is_empty and course.buffer(40).contains(p.centroid):
                areas[kind].append(p)
        elif kind == 'clubhouse' and osm.closed(wid):
            club = Polygon(osm.pts(wid)).centroid
    if club is None:
        club = course.representative_point()
    holes = order_holes(holes, (club.x, club.y))
    bx0, bz0, bx1, bz1 = course.buffer(30).bounds
    i0 = max(0, int(bx0 - x0)); j0 = max(0, int(bz0 - z0)); i1 = min(size, int(bx1 - x0) + 1); j1 = min(size, int(bz1 - z0) + 1)
    w, h = i1 - i0, j1 - j0
    ox, oz = x0 + i0, z0 + j0
    img = naip_fine.window(i0, j0, w, h).astype(np.float32)
    ndvi = (img[..., 3] - img[..., 0]) / (img[..., 3] + img[..., 0] + 1)
    light = img[..., :3].mean(axis=2)
    tall = np.asarray(ndsm[j0:j1, i0:i1], np.float32) > 1.5
    hard = burn([LineString(r['pts']).buffer(r['width'] / 2 + 0.5) for r in roads if LineString(r['pts']).intersects(course.buffer(40))] +
                [b['poly'].buffer(1.0) for b in buildings if b['poly'].intersects(course.buffer(40))] + ([water] if not water.is_empty else []), ox, oz, w, h)
    inside = burn([course], ox, oz, w, h)
    grass = inside & ~tall & ~hard & (ndvi > 0.18)
    sand = inside & ~tall & ~hard & (ndvi < -0.12) & (light > 145)
    out_holes = []
    shapes = {'greens': [], 'tees': [], 'bunkers': []}
    for number, hole in enumerate(holes, start=1):
        line = hole['line']
        length = line.length
        par = hole['par'] or par_for(length)
        (tx, tz), (gx, gz) = line.coords[0], line.coords[-1]
        a = line.coords[1] if len(line.coords) > 1 else (gx, gz)
        b = line.coords[-2] if len(line.coords) > 1 else (tx, tz)
        tee_head = math.atan2(a[0] - tx, a[1] - tz)
        green_head = math.atan2(gx - b[0], gz - b[1])
        green = next((g for g in areas['green'] if g.distance(Point(gx, gz)) < 12), None)
        if green is None:
            green = ellipse(gx, gz, GREEN_LEN if par > 3 else GREEN_LEN * 0.9, GREEN_WIDE, green_head)
        tee = next((t for t in areas['tee'] if t.distance(Point(tx, tz)) < 12), None)
        if tee is None:
            tee = rect(tx, tz, TEE_LEN, TEE_WIDE, tee_head)
        pin = green.centroid
        fairways = []
        if par > 3 and length > 120:
            start = min(length * 0.4, 150.0 if par == 4 else 190.0)
            corridor = substring(line, start, max(start + 20, length - GREEN_LEN * 0.55)).buffer(FAIRWAY_HALF, cap_style=1)
            near = burn([corridor], ox, oz, w, h) & grass
            near = ndimage.binary_opening(near, iterations=2)
            fw = mask_poly(near, ox, oz, 1.0)
            want = corridor.area
            if fw is None or fw.area < 0.35 * want:
                fw = substring(line, start, max(start + 20, length - GREEN_LEN * 0.55)).buffer(FAIRWAY_HALF * 0.75, cap_style=1)
            fw = fw.difference(green.buffer(2.5)).difference(tee.buffer(4))
            fw = fw.buffer(3).buffer(-3).simplify(0.8)
            for part in getattr(fw, 'geoms', [fw]):
                if part.geom_type == 'Polygon' and part.area > 150:
                    fairways.append(part)
        out_holes.append({'n': number, 'par': par, 'len': round(length, 1), 'line': [round(v, 1) for xy in line.coords for v in xy],
                          'tee': [round(tx, 1), round(tz, 1), round(tee_head, 3)], 'box': flat_ring(tee), 'green': flat_ring(green),
                          'pin': [round(pin.x, 1), round(pin.y, 1)], 'fw': [flat_ring(f) for f in fairways]})
        shapes['greens'].append(green)
        shapes['tees'].append(tee)
    lab, n = ndimage.label(ndimage.binary_opening(sand, iterations=1))
    bunkers = []
    for k in range(1, n + 1):
        cells = lab == k
        area = int(cells.sum())
        if area < 8 or area > 900:
            continue
        js, is_ = np.nonzero(cells)
        hull = MultiPoint([(ox + i + 0.5, oz + j + 0.5) for i, j in zip(is_, js)]).minimum_rotated_rectangle
        if hull.geom_type != 'Polygon':
            continue
        c = list(hull.exterior.coords)
        sides = sorted([math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1])])
        if sides[0] < 3.0 or sides[1] / max(sides[0], 0.1) > 5.5:
            continue
        p = mask_poly(cells, ox, oz, 0.6)
        if p is not None and p.area >= 15:
            bunkers.append(p.buffer(0.8).buffer(-0.4))
    # Sand on a course lies by its greens and along its holes; bare dirt in the yards inside the outline is not a bunker.
    play_lines = unary_union([h['line'].buffer(32) for h in holes] + [g.buffer(25) for g in shapes['greens']])
    bunkers = [b for b in bunkers if play_lines.contains(b.centroid)]
    bunkers += [b for b in areas['bunker']]
    shapes['bunkers'] = bunkers
    record = {'n': COURSE_NAME, 'p': flat_ring(course.simplify(1.5)), 'c': [round(club.x, 1), round(club.y, 1)], 'holes': out_holes,
              'bunkers': [flat_ring(b) for b in bunkers if b.geom_type == 'Polygon']}
    return record, shapes


def flat_ring(poly):
    coords = list(poly.exterior.coords)[:-1]
    return [round(v, 1) for xy in coords for v in xy]


def shape_ground(ground, shapes, cell_xy, cell):
    """Tees level and 25 cm proud, greens smoothed with a gentle crown, bunkers dug 35 cm in (on the shipped grid)."""
    gx, gz = cell_xy
    n = ground.shape[0]

    def nodes(poly, pad):
        x0_, z0_, x1_, z1_ = poly.bounds
        i0 = max(0, int((x0_ - pad - gx) / cell)); i1 = min(n - 1, int((x1_ + pad - gx) / cell) + 1)
        j0 = max(0, int((z0_ - pad - gz) / cell)); j1 = min(n - 1, int((z1_ + pad - gz) / cell) + 1)
        xs = gx + np.arange(i0, i1 + 1) * cell
        zs = gz + np.arange(j0, j1 + 1) * cell
        d = np.array([[0.0 if poly.contains(Point(x, z)) else poly.exterior.distance(Point(x, z)) for x in xs] for z in zs], np.float32)
        return (slice(j0, j1 + 1), slice(i0, i1 + 1)), d

    def ease(d, core, blend):
        t = np.clip((d - core) / blend, 0, 1)
        return 1 - t * t * (3 - 2 * t)

    for tee in shapes['tees']:
        sel, d = nodes(tee, 8)
        sub = ground[sel]
        on = d < 1.0
        level = float(np.median(sub[on])) if on.any() else float(np.median(sub))
        wgt = ease(d, 1.0, 5.0)
        sub[:] = sub * (1 - wgt) + (level + 0.25) * wgt
    for green in shapes['greens']:
        sel, d = nodes(green, 10)
        sub = ground[sel]
        smooth = ndimage.gaussian_filter(sub, 1.2)
        c = green.centroid
        r = math.sqrt(green.area / math.pi)
        zs = gz + np.arange(sel[0].start, sel[0].stop) * cell
        xs = gx + np.arange(sel[1].start, sel[1].stop) * cell
        rr = np.hypot(xs[None, :] - c.x, zs[:, None] - c.y) / max(r, 1.0)
        crown = 0.18 * np.clip(1 - rr * rr, 0, 1)
        wgt = ease(d, 1.5, 6.0)
        sub[:] = sub * (1 - wgt) + (smooth + crown) * wgt
    for bunker in shapes['bunkers']:
        sel, d = nodes(bunker, 3)
        sub = ground[sel]
        inside = np.array([[1.0 if bunker.contains(Point(gx + i * cell, gz + j * cell)) else 0.0 for i in range(sel[1].start, sel[1].stop)] for j in range(sel[0].start, sel[0].stop)], np.float32)
        sub[:] = sub - 0.35 * np.maximum(inside, ease(d, 0.0, 2.0) * 0.6)
    return ground
