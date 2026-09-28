#!/usr/bin/env python3
"""Render every app icon and splash image from the mmyway mark's vector geometry.

    pip install pillow && python3 scripts/generate-icons.py

The mark is five flat polygons on a 4x4 grid (an arrow stepping up and to the right), so each
size is drawn from the geometry rather than resized from a bitmap. Outputs, all under assets/:

  logo.svg                        master: white mark on the indigo tile
  icon.png                        1024, opaque. Expo's `icon`: iOS light icon, pre-Android 8 launcher
  android/adaptive-foreground.png 1024, transparent, white mark inside the 66dp-of-108dp safe
                                  zone; also the monochrome layer for Android 13+ themed icons
  ios/icon-dark.png               1024, transparent, iOS 18 dark appearance
  ios/icon-tinted.png             1024, transparent, iOS 18 tinted appearance (greyscale)
  ios/AppIcon.appiconset/         every iPhone/iPad/App Store size + Contents.json, for Xcode
  splash/splash-light.png         1024, transparent: the mark in a circle, for expo-splash-screen
  splash/splash-dark.png          same, dark scheme

Colours for the splash follow src/ui/theme.ts (bg/surface/accent); keep them in step with
app.config.js's backgroundColor values.
"""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
SS = 4  # supersampling factor for anti-aliased edges

TILE = '#3746BB'  # icon background (android adaptiveIcon.backgroundColor too)
WHITE = '#FFFFFF'
SPLASH_LIGHT = {'circle': '#FFFFFF', 'mark': '#2D2E68'}  # on theme light bg #F5F5F3
SPLASH_DARK = {'circle': '#191B1F', 'mark': '#8B95F7'}  # on theme dark bg #0F1013

GRID = 4
MARK = [
    [(2, 0), (4, 0), (4, 2), (3, 2), (3, 1), (2, 1)],  # top-right hook
    [(1, 1), (2, 1), (2, 2), (0, 2)],  # upper slanted step
    [(2, 2), (3, 2), (3, 3), (1, 3)],  # lower slanted step
    [(0, 3), (1, 3), (1, 4), (0, 4)],  # bottom-left square
    [(2, 3), (3, 3), (2, 4)],  # bottom triangle
]

# Mark width as a share of the canvas. iOS/legacy: the tile's rounded corners stay clear of the
# hook's sharp corner. Adaptive: 46dp of 108dp keeps the far corners (at 2*sqrt(2) grid units from
# centre) inside the 66dp safe circle every launcher mask respects.
ICON_SCALE = 0.64
ADAPTIVE_SCALE = 46 / 108
SPLASH_SCALE = 0.5


def render(size, scale, mark, bg=None, circle=None):
    big = size * SS
    im = Image.new('RGBA', (big, big), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if circle:
        d.ellipse((0, 0, big - 1, big - 1), fill=circle)
    unit = big * scale / GRID
    off = (big - unit * GRID) / 2
    for poly in MARK:
        d.polygon([(off + x * unit, off + y * unit) for x, y in poly], fill=mark)
    im = im.resize((size, size), Image.LANCZOS)
    return im.convert('RGB') if bg else im  # iOS rejects an alpha channel on the light icon


def save(im, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)


def svg():
    polys = '\n'.join(
        '    <polygon points="%s"/>' % ' '.join('%g,%g' % (x, y) for x, y in p) for p in MARK
    )
    pad = GRID * (1 / ICON_SCALE - 1) / 2
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g">\n'
        '  <rect x="%g" y="%g" width="100%%" height="100%%" fill="%s"/>\n'
        '  <g fill="%s">\n%s\n  </g>\n</svg>\n'
        % (-pad, -pad, GRID + 2 * pad, GRID + 2 * pad, -pad, -pad, TILE, WHITE, polys)
    )


# (idiom, point size, scales). Xcode's classic "all sizes" set.
APPICONSET = [
    ('iphone', 20, (2, 3)),
    ('iphone', 29, (2, 3)),
    ('iphone', 40, (2, 3)),
    ('iphone', 60, (2, 3)),
    ('ipad', 20, (1, 2)),
    ('ipad', 29, (1, 2)),
    ('ipad', 40, (1, 2)),
    ('ipad', 76, (1, 2)),
    ('ipad', 83.5, (2,)),
    ('ios-marketing', 1024, (1,)),
]


def appiconset():
    images, rendered = [], {}
    for idiom, pt, scales in APPICONSET:
        for s in scales:
            px = int(pt * s)
            name = 'icon-%d.png' % px
            if px not in rendered:
                rendered[px] = True
                save(render(px, ICON_SCALE, WHITE, bg=TILE), 'ios', 'AppIcon.appiconset', name)
            images.append(
                {'filename': name, 'idiom': idiom, 'scale': '%dx' % s, 'size': '%gx%g' % (pt, pt)}
            )
    contents = {'images': images, 'info': {'author': 'xcode', 'version': 1}}
    with open(os.path.join(ROOT, 'ios', 'AppIcon.appiconset', 'Contents.json'), 'w') as f:
        json.dump(contents, f, indent=2)
        f.write('\n')


def main():
    os.makedirs(ROOT, exist_ok=True)
    with open(os.path.join(ROOT, 'logo.svg'), 'w') as f:
        f.write(svg())
    save(render(1024, ICON_SCALE, WHITE, bg=TILE), 'icon.png')
    save(render(1024, ADAPTIVE_SCALE, WHITE), 'android', 'adaptive-foreground.png')
    save(render(1024, ICON_SCALE, SPLASH_DARK['mark']), 'ios', 'icon-dark.png')
    save(render(1024, ICON_SCALE, WHITE), 'ios', 'icon-tinted.png')
    appiconset()
    save(render(1024, SPLASH_SCALE, SPLASH_LIGHT['mark'], circle=SPLASH_LIGHT['circle']),
         'splash', 'splash-light.png')
    save(render(1024, SPLASH_SCALE, SPLASH_DARK['mark'], circle=SPLASH_DARK['circle']),
         'splash', 'splash-dark.png')


if __name__ == '__main__':
    main()
