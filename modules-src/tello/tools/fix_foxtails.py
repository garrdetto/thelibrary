"""
One-off fix to the baked map (public/modules/tello/montello.json and montello.bin), written 2026-11-15 and mirrored in
bake_map.py (EXTRA_PLACES, EXTRA_LOTS, EXTRA_DRIVES) so a re-bake gives the same result.

The first bake put Foxtails Gentlemen's Club on the wrong footprint: building 2111 on State Highway 23 is Napralla Tire
(W2922 State Road 23). Foxtails (N4305 16th Road) is the long building just north of it, 2404. This:

  - names 2111 Napralla Tire and adds its place (shop:tyres, door on the highway side);
  - makes 2404 the club (a store named Foxtails Gentlemen's Club) and moves the place and its door onto it, facing 16th Road;
  - removes the paved "Foxtails lot" in front of the tire shop and puts the ground under it back to the grass round it;
  - adds Napralla Tire's dirt driveway from the highway to its door;
  - adds Foxtails' own parking lot, the asphalt between its front and 16th Road (photos from 16th Road and East Park
    Street show it), and paves the ground under it.

    python modules-src/tello/tools/fix_foxtails.py      (idempotent: a second run changes nothing)
"""
import gzip
import json
import os
import struct
from collections import Counter

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
JSON_PATH = os.path.join(ROOT, 'public', 'modules', 'tello', 'montello.json')
BIN_PATH = os.path.join(ROOT, 'public', 'modules', 'tello', 'montello.bin')

FOXTAILS = "Foxtails Gentlemen's Club"
NAPRALLA = 'Napralla Tire'
TIRE_SHOP = 2111
CLUB = 2404
OLD_LOT = 'Foxtails lot'
COVER_LOT = 5
NEW_LOT = 'Foxtails parking lot'
SIDEWALK = 2.6
ROAD_EDGE_X = 1739.0
DRIVE = {'k': 5, 'w': 8.0, 'n': 'Napralla Tire driveway', 'c': 'track', 'p': [1672.2, 338.8, 1686.6, 322.2, 1702.1, 304.4]}
YARD = {'k': 5, 'w': 11.0, 'n': 'Napralla Tire yard', 'c': 'track', 'p': [1663.4, 328.6, 1671.6, 335.1, 1681.5, 342.8]}


def inside(poly, x, z):
    hit = False
    n = len(poly) // 2
    for i in range(n):
        ax, az = poly[2 * i], poly[2 * i + 1]
        bx, bz = poly[2 * ((i + 1) % n)], poly[2 * ((i + 1) % n) + 1]
        if (az > z) != (bz > z) and x < ax + (z - az) * (bx - ax) / (bz - az):
            hit = not hit
    return hit


def club_lot(doc):
    """The lot in front of the club: from its sidewalk out to 16th Road's edge, the length of the building plus 4 m each end."""
    import math
    b = doc['buildings'][CLUB]
    angle = b['r'][0][4]
    ux, uz = math.cos(angle), math.sin(angle)
    if abs(uz) < abs(ux):
        ux, uz = -uz, ux
    if uz < 0:
        ux, uz = -ux, -uz
    ax, az = -uz, ux
    pts = list(zip(b['p'][0::2], b['p'][1::2]))
    across = [x * ax + z * az for x, z in pts]
    along = [x * ux + z * uz for x, z in pts]
    a0 = min(across) - SIDEWALK
    s0, s1 = min(along) - 4, max(along) + 4
    def at(a, s):
        return (a * ax + s * ux, a * az + s * uz)
    out = []
    for s in (s0, s1):
        x, z = at(a0, s)
        far = a0 - (ROAD_EDGE_X - x) / max(1e-6, -ax)
        out.append((x, z, far, s))
    ring = [at(a0, s0), at(out[0][2], s0), at(out[1][2], s1), at(a0, s1)]
    return [round(v, 1) for p in ring for v in p]


def fix_doc(doc):
    b = doc['buildings']
    shop, club = b[TIRE_SHOP], b[CLUB]
    shop['n'] = NAPRALLA
    club['k'] = 'store'
    club['n'] = FOXTAILS
    pois = doc['pois']
    fox = next(p for p in pois if p['n'] == FOXTAILS)
    fox.update({'x': 1690.6, 'z': 432.0, 'd': [1695.2, 432.3, 1.461], 's': '16th Road', 'i': CLUB, 'b': [1677.0, 430.0]})
    if not any(p['n'] == NAPRALLA for p in pois):
        at = pois.index(fox)
        pois.insert(at + 1, {'n': NAPRALLA, 'k': 'shop', 't': 'shop:tyres', 'x': 1661.5, 'z': 346.5, 'd': [1670.9, 340.3, 2.425], 's': 'State Highway 23', 'i': TIRE_SHOP, 'b': [1650.0, 357.0]})
    lot = next((l for l in doc['lots'] if l.get('n') == OLD_LOT), None)
    if lot:
        doc['lots'].remove(lot)
    if not any(l.get('n') == NEW_LOT for l in doc['lots']):
        doc['lots'].append({'f': 0.0, 'p': club_lot(doc), 'n': NEW_LOT})
    if not any(r.get('n') == DRIVE['n'] for r in doc['roads']):
        doc['roads'].append(dict(DRIVE))
    for road in (DRIVE, YARD):
        have = next((r for r in doc['roads'] if r.get('n') == road['n']), None)
        if have is None:
            doc['roads'].append(dict(road))
        else:
            have.update(road)
    doc['stats']['lots'] = len(doc['lots'])
    doc['stats']['roads'] = len(doc['roads'])
    doc['stats']['places'] = len(pois)
    return lot


def read_grids():
    raw = gzip.decompress(open(BIN_PATH, 'rb').read())
    assert raw[:6] == b'TELLO'
    head_len = struct.unpack('<I', raw[6:10])[0]
    header = json.loads(raw[10:10 + head_len])
    return raw, header, 10 + head_len


def section(raw, header, base, name, dtype):
    sec = next(s for s in header['sections'] if s['name'] == name)
    n = sec['side']
    return sec, np.frombuffer(raw, dtype, sec['count'], base + sec['offset']).copy().reshape(n, n)


def cells_in(doc, poly):
    f = doc['frame']
    cell = f['cell']
    xs, zs = poly[0::2], poly[1::2]
    i0, i1 = int((min(xs) - f['x0']) // cell) - 1, int((max(xs) - f['x0']) // cell) + 2
    j0, j1 = int((min(zs) - f['z0']) // cell) - 1, int((max(zs) - f['z0']) // cell) + 2
    return [(j, i) for j in range(j0, j1) for i in range(i0, i1) if inside(poly, f['x0'] + (i + 0.5) * cell, f['z0'] + (j + 0.5) * cell)]


def pave_club_lot(doc):
    """Ground under the club's lot becomes lot cover; its floor is the lowest ground under it, so the asphalt drapes."""
    lot = next(l for l in doc['lots'] if l.get('n') == NEW_LOT)
    raw, header, base = read_grids()
    sec, cover = section(raw, header, base, 'cover', np.uint8)
    _g, ground = section(raw, header, base, 'ground', np.uint16)
    cells = cells_in(doc, lot['p'])
    lot['f'] = round(float(min(ground[j, i] for j, i in cells)) / 100, 2)
    for j, i in cells:
        cover[j, i] = COVER_LOT
    body = bytearray(raw)
    body[base + sec['offset']: base + sec['offset'] + sec['bytes']] = cover.tobytes()
    with open(BIN_PATH, 'wb') as out:
        out.write(gzip.compress(bytes(body), 9, mtime=0))
    return len(cells)


def fix_cover(doc, lot):
    raw = gzip.decompress(open(BIN_PATH, 'rb').read())
    assert raw[:6] == b'TELLO\x01'
    head_len = struct.unpack('<I', raw[6:10])[0]
    header = json.loads(raw[10:10 + head_len])
    base = 10 + head_len
    sec = next(s for s in header['sections'] if s['name'] == 'cover')
    n = sec['side']
    cover = np.frombuffer(raw, np.uint8, sec['count'], base + sec['offset']).copy().reshape(n, n)
    f = doc['frame']
    cell = f['cell']
    poly = lot['p']
    xs, zs = poly[0::2], poly[1::2]
    i0, i1 = int((min(xs) - f['x0']) // cell) - 1, int((max(xs) - f['x0']) // cell) + 2
    j0, j1 = int((min(zs) - f['z0']) // cell) - 1, int((max(zs) - f['z0']) // cell) + 2
    cells = [(j, i) for j in range(j0, j1) for i in range(i0, i1) if cover[j, i] == COVER_LOT and inside(poly, f['x0'] + (i + 0.5) * cell, f['z0'] + (j + 0.5) * cell)]
    ring = Counter(int(cover[j, i]) for j in range(j0 - 3, j1 + 3) for i in range(i0 - 3, i1 + 3) if cover[j, i] != COVER_LOT and not (j0 <= j < j1 and i0 <= i < i1))
    grass = ring.most_common(1)[0][0] if ring else 0
    for j, i in cells:
        cover[j, i] = grass
    body = bytearray(raw)
    body[base + sec['offset']: base + sec['offset'] + sec['bytes']] = cover.tobytes()
    with open(BIN_PATH, 'wb') as out:
        out.write(gzip.compress(bytes(body), 9, mtime=0))
    return len(cells), grass


def main():
    doc = json.load(open(JSON_PATH, encoding='utf-8'))
    lot = fix_doc(doc)
    if lot:
        changed, grass = fix_cover(doc, lot)
        print(f'cover: {changed} lot cells back to cover {grass}')
    print(f'club lot: {pave_club_lot(doc)} cells paved')
    with open(JSON_PATH, 'w', encoding='utf-8') as out:
        json.dump(doc, out, separators=(',', ':'))
    print('montello.json fixed')


if __name__ == '__main__':
    main()
