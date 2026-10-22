"""Pixelizes CC0 textures from ambientCG and generates pixel foliage.

Texture source: https://ambientcg.com (CC0 license).
Download the *_1K-JPG.zip archives, unpack *_Color.jpg into a SRC folder and run:
    python3 tools/pixelize_textures.py <SRC>
Output: public/tex/*.png
"""
import sys
import os
import random
from PIL import Image, ImageDraw, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'tex')
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'

# game name: (ambientCG asset, size in pixels, color count, saturation, brightness)
TEXTURES = {
    'metal':       ('Metal032', 32, 8, 0.5, 1.0),
    'snow':        ('Snow004', 64, 10, 0.25, 1.0),
    'snow_packed': ('Snow006', 64, 10, 0.3, 0.95),
    'panel':       ('Concrete046', 64, 10, 0.25, 0.95),
    'panel_b':     ('Concrete031', 64, 10, 0.3, 1.05),
    'tiles':       ('Tiles036', 32, 8, 0.3, 1.0),
    'brick_white': ('Bricks066', 64, 10, 0.25, 1.15),
    'brick_red':   ('Bricks051', 64, 14, 0.8, 0.85),
    'metal_green': ('PaintedMetal006', 64, 14, 0.75, 0.9),
    'metal_white': ('PaintedMetal013', 64, 12, 0.6, 1.0),
    'rust':        ('Rust007', 32, 10, 0.8, 0.8),
    'wood_dark':   ('PaintedWood008C', 32, 10, 0.7, 1.0),
    'planks':      ('Planks021', 32, 10, 0.6, 0.85),
    'bark_poplar': ('Bark015', 32, 10, 0.4, 0.8),
}


def find(asset):
    for f in os.listdir(SRC):
        if f.startswith(asset + '_') and f.endswith('_Color.jpg'):
            return os.path.join(SRC, f)
    raise FileNotFoundError(asset)


def birch(seed=3):
    """Birch bark: chalk white with black dashes across the trunk (u around, v up)."""
    rnd = random.Random(seed)
    n = 32
    im = Image.new('RGB', (n, n))
    px = im.load()
    for y in range(n):
        for x in range(n):
            v = 205 + rnd.randint(-14, 10)
            px[x, y] = (v, v, v - 6)
    for _ in range(22):
        x, y = rnd.randrange(n), rnd.randrange(n)
        w = rnd.randint(3, 9)
        dark = rnd.choice([(28, 26, 24), (48, 44, 40), (70, 66, 60)])
        for k in range(w):
            px[(x + k) % n, y] = dark
            if rnd.random() < 0.4:
                px[(x + k) % n, (y + 1) % n] = dark
    return im


def twigs(seed=5):
    """Bare winter twigs with frost on top, alpha tested. Branches grow from the bottom center."""
    rnd = random.Random(seed)
    n = 64
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def grow(x, y, ang, length, depth):
        if depth == 0 or length < 2:
            return
        import math
        x2 = x + math.cos(ang) * length
        y2 = y - math.sin(ang) * length
        dark = (46, 38, 34, 255) if depth > 2 else (64, 54, 48, 255)
        d.line([(x, y), (x2, y2)], fill=dark, width=1)
        # frost on the upper side
        if rnd.random() < 0.6:
            d.point((int(x2), int(y2) - 1), fill=(222, 222, 226, 255))
        for _ in range(rnd.randint(2, 3)):
            grow(x2, y2, ang + rnd.uniform(-0.75, 0.75), length * rnd.uniform(0.55, 0.78), depth - 1)

    import math
    for k in range(7):
        x = 8 + k * 8 + rnd.uniform(-3, 3)
        grow(x, 63, math.pi / 2 + (32 - x) / 60 + rnd.uniform(-0.3, 0.3), rnd.uniform(15, 21), 7)
    return im


def spruce(seed=9):
    """Spruce bough seen from above and the side: dark needles, snow on top, ragged alpha edge."""
    rnd = random.Random(seed)
    n = 64
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    px = im.load()
    for y in range(n):
        for x in range(n):
            # fan shape: wide at the bottom of the card
            half = (y / n) * 30 + 2
            if abs(x - 31.5) > half or rnd.random() < 0.12:
                continue
            edge = abs(x - 31.5) / half
            if edge > 0.8 and rnd.random() < 0.5:
                continue
            g = rnd.choice([(14, 30, 22), (20, 40, 28), (26, 50, 32), (12, 24, 18)])
            # needle stripes
            if (x + y // 2) % 3 == 0:
                g = (g[0] + 8, g[1] + 12, g[2] + 8)
            px[x, y] = g + (255,)
    # snow lumps on top
    for _ in range(60):
        x, y = rnd.randrange(8, 56), rnd.randrange(10, 60)
        if px[x, y][3] and rnd.random() < 0.8:
            for k in range(rnd.randint(1, 4)):
                if 0 <= x + k < n:
                    px[x + k, y] = (226, 228, 232, 255)
    return im


def pixelize(path, size, colors, sat, bright):
    im = Image.open(path).convert('RGB')
    im = im.resize((size, size), Image.BOX)
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Brightness(im).enhance(bright)
    im = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return im.convert('RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (asset, size, colors, sat, bright) in TEXTURES.items():
        try:
            im = pixelize(find(asset), size, colors, sat, bright)
        except FileNotFoundError:
            print('skip', name, '(no', asset, 'in', SRC + ')')
            continue
        im.save(os.path.join(OUT, name + '.png'))
        print('ok', name)
    birch().save(os.path.join(OUT, 'birch.png'))
    twigs().save(os.path.join(OUT, 'twigs.png'))
    spruce().save(os.path.join(OUT, 'spruce.png'))
    print('ok birch, twigs, spruce')


if __name__ == '__main__':
    main()
