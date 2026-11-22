"""Traces assets-src/brand/fox-dollar-source.jpg into the site's fox dollar sign.

Writes public/fonts/fox-dollar.woff2 (one glyph at U+0024, family 'TL Fox Dollar'),
public/images/fox-dollar.svg and public/fox-dollar.js (the font inlined).
Needs: pip install fonttools brotli opencv-python-headless numpy
Run: python scripts/brand/build-fox-dollar.py
"""
import base64
import pathlib

import cv2
import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets-src/brand/fox-dollar-source.jpg'
FAMILY = 'TL Fox Dollar'
UPM = 1000
TOP, BOTTOM = 790, -100
SIDE = 40
SCALE_UP = 4

gray = cv2.imread(str(SOURCE), cv2.IMREAD_GRAYSCALE)
gray = cv2.resize(gray, None, fx=SCALE_UP, fy=SCALE_UP, interpolation=cv2.INTER_CUBIC)
gray = cv2.GaussianBlur(gray, (5, 5), 0)
_, ink = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)
contours, hierarchy = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
min_area = 30 * SCALE_UP * SCALE_UP
kept = [(c, h) for c, h in zip(contours, hierarchy[0]) if abs(cv2.contourArea(c)) >= min_area]
points = np.vstack([c.reshape(-1, 2) for c, _ in kept])
x0, y0 = points.min(axis=0)
x1, y1 = points.max(axis=0)
scale = (TOP - BOTTOM) / float(y1 - y0)
width = (x1 - x0) * scale


def to_font(c):
    poly = cv2.approxPolyDP(c, 0.6 * SCALE_UP, True).reshape(-1, 2)
    return [(round(SIDE + (x - x0) * scale), round(TOP - (y - y0) * scale)) for x, y in poly]


def area(poly):
    return sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1])) / 2


outlines = []
for c, h in kept:
    poly = to_font(c)
    if len(poly) < 3:
        continue
    hole = h[3] != -1
    clockwise = area(poly) < 0
    if clockwise == hole:
        poly.reverse()
    outlines.append((poly, hole))

pen = TTGlyphPen(None)
for poly, _ in outlines:
    pen.moveTo(poly[0])
    for p in poly[1:]:
        pen.lineTo(p)
    pen.closePath()
glyph = pen.glyph()
advance = round(width + 2 * SIDE)

empty = TTGlyphPen(None).glyph()
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(['.notdef', 'dollar'])
fb.setupCharacterMap({0x24: 'dollar'})
fb.setupGlyf({'.notdef': empty, 'dollar': glyph})
fb.setupHorizontalMetrics({'.notdef': (500, 0), 'dollar': (advance, SIDE)})
fb.setupHorizontalHeader(ascent=900, descent=-200)
fb.setupNameTable({'familyName': FAMILY, 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=900, sTypoDescender=-200, usWinAscent=900, usWinDescent=200)
fb.setupPost()
fb.font.flavor = 'woff2'
font_path = ROOT / 'public/fonts/fox-dollar.woff2'
font_path.parent.mkdir(parents=True, exist_ok=True)
fb.save(str(font_path))

view_w, view_h = advance, TOP - BOTTOM
d = ' '.join('M' + ' L'.join(f'{x} {TOP - y}' for x, y in poly) + ' Z' for poly, _ in outlines)
(ROOT / 'public/images/fox-dollar.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w} {view_h}"><path fill="currentColor" fill-rule="nonzero" d="{d}"/></svg>\n'
)

data = base64.b64encode(font_path.read_bytes()).decode()
template = (ROOT / 'scripts/brand/fox-dollar.template.js').read_text()
(ROOT / 'public/fox-dollar.js').write_text(template.replace('__FONT__', data).replace('__FAMILY__', FAMILY))
print(f'{len(outlines)} outlines, advance {advance}, font {font_path.stat().st_size} bytes')
