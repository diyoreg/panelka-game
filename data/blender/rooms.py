"""Furniture of the flats in their five styles, room by room. Both plans use it (k5i.py, k9i.py): the flat says where
things go (placement frames F2 against the walls), the style decides what stands there.

Styles (the same names and shares as STYLES in interiors.js, the finishes are in materials.js):
    sov  Soviet: a wall unit with crystal, a carpet on the wall, a ZIL fridge and a gas heater
    xp   the 2000s: laminate, a leather sofa, a beige computer with Windows XP
    eu   the evroremont of the 90s: black lacquer, a corner sofa in velour, a music centre, spots in the ceiling
    mod  the 2010s: white and grey, a flat TV, cube shelves, a laptop, LED panels
    old  the old lady's flat nobody has touched since the 80s: a sideboard of dishes, a TV on legs under a doily,
         an iron bed under a pyramid of pillows, jars and boxes everywhere, a dim bulb
"""
import math

import k5i as K
from k5i import F2, pbox, by, collide, legs

SOVIET = ('sov', 'old')


# ------------------------------------------------------------------ new pieces

def music_center(F, u, v, z):
    """Music centre of the 90s: CD and tape decks, two speakers."""
    F.box(u - 0.14, v, z, u + 0.14, v + 0.28, z + 0.3, 'pk_plastic_black', 'pk_plastic_black')
    F.box(u - 0.1, v + 0.28, z + 0.18, u + 0.1, v + 0.285, z + 0.24, 'pk_glow_green')
    for s in (-1, 1):
        F.box(u + s * 0.3 - 0.09, v, z, u + s * 0.3 + 0.09, v + 0.22, z + 0.3, 'pk_plastic_black', 'pk_plastic_black')
        F.cyl(u + s * 0.3, v + 0.225, z + 0.09, z + 0.21, 0.06, 'pk_dark', 8)


def vcr(F, u, v, z):
    F.box(u - 0.2, v, z, u + 0.2, v + 0.3, z + 0.09, 'pk_plastic_black', 'pk_plastic_black')
    F.box(u + 0.08, v + 0.3, z + 0.04, u + 0.16, v + 0.301, z + 0.06, 'pk_glow_green')


def gorka(F, L=3.0):
    """The wall unit of the 90s: black lacquer, glass display cases, a niche with the TV, the VCR and a music centre."""
    d, h = 0.45, 2.1
    mat = 'pk_gloss_black'
    tvw = 1.15
    side = (L - tvw) / 2
    for u0, u1 in ((-L / 2, -L / 2 + side), (L / 2 - side, L / 2)):
        F.box(u0, 0, 0.05, u1, d, h, mat, mat)
        F.box(u0 + 0.02, d, 0.75, u1 - 0.02, d + 0.01, h - 0.05, 'pk_glass_int')
        for k in range(3):
            z = 0.95 + k * 0.38
            F.box(u0 + 0.05, 0.05, z, u1 - 0.05, d - 0.05, z + 0.02, 'pk_glass_int')
            F.cyl((u0 + u1) / 2 - 0.12, d / 2, z + 0.02, z + 0.16, 0.035, 'pk_crystal', 6)
            F.cyl((u0 + u1) / 2 + 0.12, d / 2, z + 0.02, z + 0.12, 0.05, 'pk_dishes', 8)
        F.box(u0 + 0.02, d, 0.08, u1 - 0.02, d + 0.012, 0.72, mat)
    u0, u1 = -tvw / 2, tvw / 2
    F.box(u0, 0, 0.05, u1, d, 0.55, mat, mat)
    F.box(u0, 0, 1.75, u1, d, h, mat, mat)
    F.box(u0, 0, 0.55, u1, 0.03, 1.75, mat)
    K.tv_crt(F, -0.12, 0.05, 0.55, 0.62, style='xp')
    vcr(F, -0.12, 0.08, 0.33)
    F.box(u0 + 0.03, d, 0.08, u1 - 0.03, d + 0.01, 0.3, 'pk_glass_int')
    music_center(F, 0.38, 0.12, 1.42)
    collide(F, -L / 2, 0, L / 2, d + 0.02, h)


def corner_sofa(F, w=2.2, d=0.9, wing=1.5, side=1, fab='pk_plush'):
    """Corner sofa in velour: the long part against the wall, the wing coming out at one end."""
    F.box(-w / 2, 0.18, 0.1, w / 2, d, 0.44, fab, bot='pk_dark')
    F.box(-w / 2, 0.0, 0.1, w / 2, 0.24, 0.92, fab)
    ue = side * w / 2
    u0, u1 = (ue - side * 0.85, ue) if side > 0 else (ue, ue + 0.85)
    F.box(min(u0, u1), d, 0.1, max(u0, u1), wing, 0.44, fab, bot='pk_dark')
    F.box(ue - side * 0.2 if side > 0 else ue, d, 0.1, ue if side > 0 else ue + 0.2, wing, 0.66, fab)
    F.box(-w / 2, 0, 0.0, w / 2, d - 0.04, 0.1, 'pk_dark')
    for k in range(3):
        uc = -w / 2 + 0.45 + k * 0.55
        F.box(uc - 0.22, 0.24, 0.44, uc + 0.22, 0.4, 0.78, fab)
    collide(F, -w / 2, 0, w / 2, d, 0.45)
    collide(F, -w / 2, 0, w / 2, 0.24, 0.92)
    collide(F, min(u0, u1), d, max(u0, u1), wing, 0.45)


def sofa_mod(F, w=2.1, d=0.92, fab='pk_fabric'):
    """Sofa of the 2010s on thin legs: low arms, loose cushions, a throw."""
    F.box(-w / 2, 0.0, 0.15, w / 2, d, 0.42, fab, bot='pk_dark')
    F.box(-w / 2, 0.0, 0.42, w / 2, 0.22, 0.82, fab)
    for s in (-1, 1):
        F.box(s * w / 2 - (0.16 if s > 0 else 0), 0.0, 0.15, s * w / 2 + (0 if s > 0 else 0.16), d, 0.6, fab)
    for k, mat in enumerate(('pk_cushion_a', 'pk_cushion_b', 'pk_cushion_a')):
        uc = -w / 2 + 0.45 + k * 0.6
        F.box(uc - 0.2, 0.2, 0.42, uc + 0.2, 0.34, 0.8, mat)
    F.box(w / 2 - 0.7, 0.3, 0.42, w / 2 - 0.16, d - 0.05, 0.45, 'pk_cushion_b')
    for su in (-1, 1):
        for vv in (0.08, d - 0.08):
            F.cyl(su * (w / 2 - 0.1), vv, 0.0, 0.15, 0.015, 'pk_wood_oak', 4)
    collide(F, -w / 2, 0, w / 2, d, 0.45)
    collide(F, -w / 2, 0, w / 2, 0.22, 0.82)


def tv_wall_mod(F, w=1.6):
    """A low white unit with a flat TV on the wall over it, a soundbar, a console."""
    F.box(-w / 2, 0, 0.12, w / 2, 0.4, 0.5, 'pk_white_matte', 'pk_white_matte')
    for k in range(3):
        u0 = -w / 2 + k * w / 3
        F.box(u0 + 0.005, 0.4, 0.14, u0 + w / 3 - 0.005, 0.41, 0.48, 'pk_white_matte')
    legs(F, w, 0.4, 0.12, 0.012, 'pk_steel', 0.06)
    tw, th = 1.1, 0.64
    F.box(-tw / 2, 0, 1.0, tw / 2, 0.05, 1.0 + th, 'pk_glass_black', 'pk_glass_black')
    F.quad(-tw / 2 + 0.02, tw / 2 - 0.02, 0.052, 1.02, 0.98 + th, 'pk_screen_tv')
    F.box(-0.4, 0.15, 0.5, 0.4, 0.25, 0.57, 'pk_plastic_black')
    F.box(0.45, 0.08, 0.5, 0.7, 0.3, 0.55, 'pk_plastic_black')
    collide(F, -w / 2, 0, w / 2, 0.42, 0.5)


def kallax(F, w=0.78, h=1.48, d=0.39):
    """White cube shelves with books, baskets and a plant."""
    n = int(round(w / 0.39)), int(round(h / 0.37))
    mat = 'pk_white_matte'
    F.box(-w / 2, 0, 0, w / 2, d, 0.04, mat, mat)
    for j in range(n[1] + 1):
        z = j * (h - 0.04) / n[1]
        F.box(-w / 2, 0, z, w / 2, d, z + 0.04, mat, mat)
    for i in range(n[0] + 1):
        u = -w / 2 + i * (w - 0.04) / n[0]
        F.box(u, 0, 0, u + 0.04, d, h, mat, mat)
    F.box(-w / 2, 0, 0, w / 2, 0.01, h, mat)
    for i in range(n[0]):
        for j in range(n[1]):
            u0 = -w / 2 + 0.04 + i * (w - 0.04) / n[0]
            z0 = 0.04 + j * (h - 0.04) / n[1]
            k = (i + j * 3) % 4
            if k == 0:
                F.box(u0 + 0.03, 0.05, z0, u0 + 0.3, d - 0.05, z0 + 0.26, 'pk_books')
            elif k == 1:
                F.box(u0 + 0.03, 0.06, z0, u0 + 0.31, d - 0.02, z0 + 0.25, 'pk_cushion_b')
    F.cyl(0.1, d / 2, h, h + 0.14, 0.07, 'pk_white_matte', 8, r1=0.06)
    plant_leaves(F, 0.1, d / 2, h + 0.12, 0.3)
    collide(F, -w / 2, 0, w / 2, d, h)


def plant_leaves(F, u, v, z, hgt):
    m = F.m
    x, y = F.pt(u, v)
    for k in range(4):
        a = k * math.pi / 4 + 0.3
        dx, dy = math.cos(a) * 0.16, math.sin(a) * 0.16
        m.face([(x - dx, by(y - dy), F.z + z), (x + dx, by(y + dy), F.z + z), (x + dx * 0.7, by(y + dy * 0.7), F.z + z + hgt),
                (x - dx * 0.7, by(y - dy * 0.7), F.z + z + hgt)], 'pk_plant', [(0, 0), (1, 0), (1, 1), (0, 1)])


def big_plant(F, u, v):
    """A monstera in a tall pot."""
    F.cyl(u, v, 0.0, 0.42, 0.17, 'pk_white_matte', 8, r1=0.2)
    plant_leaves(F, u, v, 0.4, 0.75)
    plant_leaves(F, u + 0.05, v + 0.05, 0.75, 0.6)
    collide(F, u - 0.2, v - 0.2, u + 0.2, v + 0.2, 1.2)


def round_table(F, u, v, r=0.38, h=0.45, mat='pk_white_matte'):
    F.cyl(u, v, h - 0.03, h, r, mat, 12, bot=mat)
    F.cyl(u, v, 0.0, h - 0.03, 0.03, 'pk_steel', 6)
    F.cyl(u, v, 0.0, 0.02, 0.2, 'pk_steel', 8)
    collide(F, u - r, v - r, u + r, v + r, h)


def arc_lamp(m, x, y):
    m.cyl(x, by(y), 0.0, 0.04, 0.17, 8, 'pk_steel')
    m.cyl(x, by(y), 0.04, 1.7, 0.012, 4, 'pk_steel')
    m.cyl(x, by(y), 1.62, 1.82, 0.16, 8, 'pk_white_matte', r1=0.09, bottom='pk_lampshade')
    m.col(x - 0.17, by(y) - 0.17, 0, x + 0.17, by(y) + 0.17, 1.8)


def laptop(F, u, v, z):
    F.box(u - 0.17, v, z, u + 0.17, v + 0.24, z + 0.02, 'pk_steel')
    F.box(u - 0.17, v, z + 0.02, u + 0.17, v + 0.015, z + 0.24, 'pk_steel')
    F.quad(u - 0.15, u + 0.15, v + 0.017, z + 0.04, z + 0.22, 'pk_screen_xp')


def desk_mod(F, w=1.2, d=0.6):
    F.box(-w / 2, 0, 0.72, w / 2, d, 0.75, 'pk_white_matte', bot='pk_white_matte')
    for su in (-1, 1):
        F.box(su * (w / 2 - 0.03) - 0.015, 0.03, 0, su * (w / 2 - 0.03) + 0.015, d - 0.03, 0.72, 'pk_steel')
    collide(F, -w / 2, 0, w / 2, d, 0.75)


def aquarium(F, w=0.8):
    F.box(-w / 2, 0, 0.0, w / 2, 0.38, 0.72, 'pk_gloss_black', 'pk_gloss_black')
    F.box(-w / 2 + 0.02, 0.02, 0.72, w / 2 - 0.02, 0.36, 1.12, 'pk_aquarium', 'pk_aquarium')
    F.box(-w / 2, 0, 1.12, w / 2, 0.38, 1.18, 'pk_gloss_black', 'pk_gloss_black')
    collide(F, -w / 2, 0, w / 2, 0.38, 1.18)


def spots(m, pts, zc):
    """Halogen spots in a suspended ceiling."""
    for (x, y) in pts:
        m.cyl(x, by(y), zc - 0.012, zc, 0.045, 8, 'pk_chrome')
        m.cyl(x, by(y), zc - 0.014, zc - 0.012, 0.03, 8, 'pk_glow_spot', bottom='pk_glow_spot')


def spot_grid(m, x, y, zc, dx=0.8, dy=1.1):
    spots(m, [(x + i * dx, y + j * dy) for i in (-1, 1) for j in (-1, 1)] + [(x, y)], zc)


def led_panel(m, x, y, zc, r=0.28):
    m.cyl(x, by(y), zc - 0.03, zc, r, 16, 'pk_white_matte', bottom='pk_glow_panel')


def sideboard(F, L=1.5):
    """The old sideboard: cupboards below, glass doors over the good dishes and the crystal above."""
    d = 0.45
    F.box(-L / 2, 0, 0.0, L / 2, d, 0.85, 'pk_veneer', 'pk_veneer')
    F.box(-L / 2, 0, 0.85, L / 2, 0.32, 1.85, 'pk_veneer', 'pk_veneer')
    F.box(-L / 2 + 0.02, 0.32, 0.9, L / 2 - 0.02, 0.33, 1.8, 'pk_glass_int')
    for k in range(2):
        z = 1.05 + k * 0.4
        F.box(-L / 2 + 0.04, 0.04, z, L / 2 - 0.04, 0.3, z + 0.015, 'pk_glass_int')
        for i in range(5):
            u = -L / 2 + 0.2 + i * (L - 0.4) / 4
            if (i + k) % 2:
                F.cyl(u, 0.17, z + 0.015, z + 0.2, 0.04, 'pk_crystal', 6)
            else:
                F.box(u - 0.11, 0.06, z + 0.015, u + 0.11, 0.08, z + 0.24, 'pk_dishes')
    for s in (-1, 1):
        F.box(s * L / 4 - 0.35, d, 0.08, s * L / 4 + 0.35, d + 0.012, 0.8, 'pk_veneer_door')
    # a vase and a doily on it
    doily(F, 0, d / 2 + 0.03, 1.85, 0.2)
    collide(F, -L / 2, 0, L / 2, d, 1.85)


def doily(F, u, v, z, r=0.2):
    F.cyl(u, v, z, z + 0.004, r, 'pk_lace', 10, bot='pk_lace')


def tv_legs(F, u=0.0):
    """A wooden TV on four splayed legs under a lace doily with a vase on it."""
    w = 0.66
    F.box(u - w / 2, 0.05, 0.42, u + w / 2, 0.55, 0.47, 'pk_veneer', bot='pk_veneer')
    for a in (-1, 1):
        for b in (0.1, 0.5):
            F.tube((u + a * (w / 2 - 0.06), b, 0.43), (u + a * (w / 2 + 0.02), b + (0.05 if b > 0.3 else -0.05), 0.0), 0.012, 'pk_veneer', 4)
    K.tv_crt(F, u, 0.05, 0.47, w, style='sov')
    doily(F, u, 0.3, 0.47 + w * 0.78, 0.2)
    F.cyl(u + 0.12, 0.3, 0.47 + w * 0.78, 0.47 + w * 0.78 + 0.22, 0.04, 'pk_crystal', 6)
    collide(F, u - w / 2, 0, u + w / 2, 0.6, 1.0)


def iron_bed(F, w=1.2, L=2.0):
    """An iron bed with nickel knobs, a lace valance and a pyramid of pillows."""
    F.box(-w / 2, 0.02, 0.32, w / 2, L - 0.02, 0.38, 'pk_iron')
    F.box(-w / 2 + 0.02, 0.04, 0.38, w / 2 - 0.02, L - 0.04, 0.58, 'pk_linen')
    F.box(-w / 2 - 0.005, 0.3, 0.12, w / 2 + 0.005, L - 0.02, 0.6, 'pk_bedding')
    F.box(-w / 2 - 0.01, 0.3, 0.1, w / 2 + 0.01, L - 0.01, 0.3, 'pk_lace')
    for v, hgt in ((0.0, 1.15), (L - 0.03, 0.85)):
        for s in (-1, 1):
            F.cyl(s * (w / 2 - 0.02), v + 0.015, 0.0, hgt, 0.018, 'pk_iron', 6)
            F.cyl(s * (w / 2 - 0.02), v + 0.015, hgt, hgt + 0.05, 0.03, 'pk_chrome', 6)
        for k in range(4):
            z = 0.45 + k * (hgt - 0.5) / 3
            F.tube((-w / 2, v + 0.015, z), (w / 2, v + 0.015, z), 0.008, 'pk_iron', 4)
    # pillows, big to small, the top one standing on its corner under a lace cover
    for k, (pw, ph) in enumerate(((0.62, 0.16), (0.5, 0.14), (0.38, 0.12))):
        z = 0.6 + sum((0.16, 0.14, 0.12)[:k])
        F.box(-pw / 2, 0.06, z, pw / 2, 0.06 + pw * 0.8, z + ph, 'pk_linen' if k < 2 else 'pk_lace')
    collide(F, -w / 2, 0, w / 2, L, 0.6)
    collide(F, -w / 2, 0, w / 2, 0.05, 1.2)


def bed_style(F, st, w=1.6, L=2.0):
    """The double bed of every style, headboard against the wall."""
    if st == 'old':
        iron_bed(F, min(w, 1.3), L)
        return
    if st == 'eu':
        F.box(-w / 2, 0, 0.12, w / 2, L, 0.36, 'pk_gloss_black')
        F.box(-w / 2 + 0.03, 0.03, 0.36, w / 2 - 0.03, L - 0.03, 0.5, 'pk_linen')
        F.box(-w / 2 + 0.01, 0.45, 0.47, w / 2 - 0.01, L - 0.01, 0.55, 'pk_bedding_eu')
        for s in (-1, 1):
            F.box(s * w / 4 - 0.3, 0.06, 0.5, s * w / 4 + 0.3, 0.4, 0.62, 'pk_bedding_eu')
        F.box(-w / 2 - 0.1, 0, 0.0, w / 2 + 0.1, 0.06, 1.1, 'pk_gloss_black')
        F.box(-w / 2 + 0.1, 0.06, 0.7, w / 2 - 0.1, 0.065, 1.0, 'pk_mirror')
        collide(F, -w / 2, 0, w / 2, L, 0.55)
        collide(F, -w / 2 - 0.1, 0, w / 2 + 0.1, 0.07, 1.1)
        return
    if st == 'mod':
        F.box(-w / 2 - 0.05, 0, 0.0, w / 2 + 0.05, L + 0.05, 0.3, 'pk_fabric_grey')
        F.box(-w / 2 + 0.02, 0.05, 0.3, w / 2 - 0.02, L, 0.5, 'pk_linen')
        F.box(-w / 2 + 0.01, 0.6, 0.47, w / 2 - 0.01, L + 0.01, 0.54, 'pk_cushion_b')
        for s in (-1, 1):
            F.box(s * w / 4 - 0.3, 0.08, 0.5, s * w / 4 + 0.3, 0.45, 0.66, 'pk_linen')
        F.box(-w / 2 - 0.05, 0, 0.3, w / 2 + 0.05, 0.08, 1.2, 'pk_fabric_grey')
        collide(F, -w / 2 - 0.05, 0, w / 2 + 0.05, L + 0.05, 0.5)
        collide(F, -w / 2 - 0.05, 0, w / 2 + 0.05, 0.08, 1.2)
        return
    K.bed(F, w, L, style=st)


def chest_style(F, st, w=0.9, tv=False):
    mat = {'eu': 'pk_gloss_black', 'mod': 'pk_white_matte'}.get(st)
    if not mat:
        K.chest(F, w, tv=tv)
        return
    d, h = 0.45, 0.82
    F.box(-w / 2, 0, 0.06, w / 2, d, h, mat, mat)
    for i in range(3):
        z = 0.09 + i * 0.24
        F.box(-w / 2 + 0.02, d, z, w / 2 - 0.02, d + 0.01, z + 0.22, mat)
        F.box(-0.1, d + 0.01, z + 0.18, 0.1, d + 0.02, z + 0.19, 'pk_steel' if st == 'mod' else 'pk_brass')
    if st == 'mod':
        F.cyl(0.25, 0.22, h, h + 0.16, 0.08, 'pk_white_matte', 8, r1=0.06)
        plant_leaves(F, 0.25, 0.22, h + 0.14, 0.3)
    else:
        F.cyl(0.25, 0.22, h, h + 0.35, 0.06, 'pk_crystal', 6, r1=0.03)
    collide(F, -w / 2, 0, w / 2, d, h)


def wardrobe_style(F, st, w=1.2, d=0.6):
    if st in SOVIET:
        K.wardrobe(F, w, d)
    elif st == 'xp':
        K.wardrobe(F, w, d, sliding=True)
    else:
        # sliding doors: black lacquer and mirrors in the 90s, white and a mirror in the 2010s
        frame = 'pk_gloss_black' if st == 'eu' else 'pk_white_matte'
        F.box(-w / 2, 0, 0, w / 2, d, 2.4, frame, frame)
        n = 2 if w < 1.8 else 3
        for i in range(n):
            u0 = -w / 2 + 0.03 + i * (w - 0.06) / n
            u1 = u0 + (w - 0.06) / n
            mat = 'pk_mirror' if (i % 2 == 0) == (st == 'eu') else frame
            F.quad(u0 + 0.01, u1 - 0.01, d + 0.012, 0.08, 2.32, mat, uv=True)
            F.box(u1 - 0.01, d, 0.05, u1 + 0.01, d + 0.02, 2.35, 'pk_steel' if st == 'mod' else 'pk_brass')
        collide(F, -w / 2, 0, w / 2, d + 0.02, 2.4)


def sewing_machine(F, u=0.0):
    """A treadle sewing machine on its iron stand, covered with a cloth."""
    F.box(u - 0.45, 0, 0.72, u + 0.45, 0.45, 0.76, 'pk_veneer', bot='pk_veneer')
    for s in (-1, 1):
        F.box(u + s * 0.38 - 0.02, 0.05, 0.0, u + s * 0.38 + 0.02, 0.4, 0.72, 'pk_iron')
    F.box(u - 0.3, 0.12, 0.08, u + 0.3, 0.35, 0.11, 'pk_iron')
    F.box(u - 0.25, 0.1, 0.76, u + 0.2, 0.32, 1.05, 'pk_dermantin')
    collide(F, u - 0.45, 0, u + 0.45, 0.45, 0.76)


def boxes(F, u0, u1, v, rnd, high=0.7):
    """Boxes, bundles of newspapers and a suitcase stacked against a wall."""
    u = u0
    while u < u1 - 0.3:
        w = rnd.uniform(0.3, 0.55)
        h = rnd.uniform(0.2, high)
        mat = rnd.choice(('pk_cardboard', 'pk_cardboard', 'pk_newspaper', 'pk_leather'))
        F.box(u, v, 0.0, min(u + w, u1), v + rnd.uniform(0.3, 0.45), h, mat, mat)
        if rnd.random() < 0.5:
            F.box(u + 0.04, v + 0.03, h, min(u + w, u1) - 0.04, v + 0.28, h + rnd.uniform(0.1, 0.25), 'pk_newspaper', 'pk_newspaper')
        collide(F, u, v, min(u + w, u1), v + 0.45, h)
        u += w + 0.02


def jars(m, side, x0, x1, zf, rnd):
    """Jars of pickles and jam on the window sill."""
    y = K.T + 0.1 if side == 'front' else K.D - K.T - 0.1
    for i in range(rnd.randint(3, 6)):
        x = x0 + 0.15 + (x1 - x0 - 0.3) * rnd.random()
        r = rnd.uniform(0.04, 0.06)
        m.cyl(x, by(y + rnd.uniform(-0.04, 0.04)), zf + 0.83, zf + 0.83 + rnd.uniform(0.12, 0.2), r, 6, 'pk_jar')


def calendar(F, z=1.4):
    F.quad(-0.17, 0.17, 0.012, z, z + 0.45, 'pk_poster_a')


def poster(F, w=0.6, h=0.8, z=1.3, mat='pk_poster_b'):
    F.box(-w / 2 - 0.02, 0, z - 0.02, w / 2 + 0.02, 0.02, z + h + 0.02, 'pk_plastic_black')
    F.quad(-w / 2, w / 2, 0.022, z, z + h, mat)


def hood(F, w=0.6, z=1.6, mat='pk_steel'):
    F.box(-w / 2, 0, z, w / 2, 0.5, z + 0.12, mat, mat, mat)
    F.box(-0.14, 0, z + 0.12, 0.14, 0.25, 2.3, mat, mat)


def hob_cabinet(F, w=0.6, glass=True):
    """Built-in oven under a hob: the 2010s kitchen."""
    F.box(-w / 2, 0, 0.08, w / 2, 0.58, 0.82, 'pk_kitchen', 'pk_kitchen')
    F.box(-w / 2 + 0.03, 0.58, 0.15, w / 2 - 0.03, 0.6, 0.65, 'pk_glass_black')
    F.box(-w / 2 + 0.08, 0.6, 0.6, w / 2 - 0.08, 0.63, 0.62, 'pk_steel')
    F.box(-w / 2, 0, 0.82, w / 2, 0.62, 0.86, 'pk_counter', 'pk_glass_black' if glass else 'pk_counter')
    for a in (-1, 1):
        for b in (0.18, 0.42):
            F.cyl(a * 0.13, b, 0.86, 0.861, 0.07 if b < 0.3 else 0.09, 'pk_dark', 12)
    collide(F, -w / 2, 0, w / 2, 0.62, 0.86)


def fridge_steel(F):
    F.box(-0.3, 0, 0.0, 0.3, 0.66, 1.95, 'pk_steel', 'pk_steel')
    F.box(-0.298, 0.66, 0.02, 0.298, 0.672, 1.2, 'pk_steel')
    F.box(-0.298, 0.66, 1.21, 0.298, 0.672, 1.93, 'pk_steel')
    F.box(0.22, 0.672, 0.85, 0.24, 0.7, 1.55, 'pk_plastic_black')
    # magnets and a child's drawing
    F.box(-0.15, 0.672, 1.4, 0.05, 0.674, 1.62, 'pk_paper')
    collide(F, -0.3, 0, 0.3, 0.7, 1.95)


def microwave(F, u, v, z):
    F.box(u - 0.24, v, z, u + 0.24, v + 0.36, z + 0.27, 'pk_plastic_grey', 'pk_plastic_grey')
    F.quad(u - 0.21, u + 0.07, v + 0.362, z + 0.04, z + 0.23, 'pk_dark', uv=False)


def kitchen_tv(F, u, v, z):
    K.tv_crt(F, u, v, z, 0.36, style='xp')


def buffet(F, w=0.9):
    """The old kitchen dresser: cupboard below, a shelf with glass doors above, a gap for the bread bin."""
    F.box(-w / 2, 0, 0.0, w / 2, 0.5, 0.85, 'pk_paint_white', 'pk_counter')
    F.box(-w / 2, 0, 1.25, w / 2, 0.3, 2.1, 'pk_paint_white', 'pk_paint_white')
    F.box(-w / 2 + 0.02, 0.3, 1.3, w / 2 - 0.02, 0.31, 2.05, 'pk_glass_int')
    F.box(-0.25, 0.05, 0.86, 0.1, 0.35, 1.05, 'pk_plastic_brown')
    for i in range(4):
        F.cyl(-w / 2 + 0.15 + i * 0.2, 0.15, 1.3, 1.48, 0.05, 'pk_dishes', 6)
    collide(F, -w / 2, 0, w / 2, 0.5, 2.1)


def washer(F, small=False):
    """A washing machine: a front loader, or the little 'Malyutka' tub of the old flat."""
    if small:
        F.cyl(0, 0.25, 0.0, 0.5, 0.2, 'pk_enamel', 10, r1=0.22, bot='pk_enamel')
        F.cyl(0, 0.25, 0.5, 0.53, 0.23, 'pk_paint_blue', 10)
        collide(F, -0.22, 0.03, 0.22, 0.47, 0.53)
        return
    F.box(-0.3, 0, 0.0, 0.3, 0.5, 0.85, 'pk_enamel', 'pk_enamel')
    ax, ay = F.pt(0, 0.5)
    nx, ny = F.normal()[0], F.normal()[1]
    F.m.tube((ax, by(ay), F.z + 0.42), (ax + nx * 0.03, by(ay + ny * 0.03), F.z + 0.42), 0.17, 0.17, 'pk_glass_int', 12)
    F.box(-0.28, 0.5, 0.72, 0.28, 0.505, 0.82, 'pk_plastic_grey')
    collide(F, -0.3, 0, 0.3, 0.52, 0.85)


def laundry(m, x0, x1, y, zc):
    """A line across the bath with laundry drying."""
    pbox(m, x0, y - 0.005, zc - 0.32, x1, y + 0.005, zc - 0.31, 'pk_rail')
    x = x0 + 0.1
    for mat in ('pk_towel', 'pk_linen', 'pk_bedding_b', 'pk_linen'):
        if x + 0.3 > x1:
            break
        pbox(m, x, y - 0.006, zc - 0.85, x + 0.3, y + 0.006, zc - 0.32, mat)
        x += 0.36


def hall_unit(F, st, L=1.4):
    """Hall furniture: a coat rack and a mirror, or a hall wardrobe with a mirror door (the 90s, the 2010s)."""
    if st in SOVIET or st == 'xp':
        K.coat_rack(F, L)
        return
    mat = 'pk_gloss_black' if st == 'eu' else 'pk_white_matte'
    d = 0.32
    F.box(-L / 2, 0, 0, L / 2, d, 2.2, mat, mat)
    F.quad(-L / 2 + 0.04, -0.02, d + 0.012, 0.1, 2.1, 'pk_mirror')
    F.box(0.02, d, 0.1, L / 2 - 0.04, d + 0.012, 2.1, mat)
    F.box(0.08, d + 0.012, 0.95, 0.1, d + 0.04, 1.2, 'pk_steel' if st == 'mod' else 'pk_brass')
    collide(F, -L / 2, 0, L / 2, d + 0.02, 2.2)


# ------------------------------------------------------------------ rooms

def ceiling_light(m, st, x, y, zc, kind='room'):
    """The lamp of a room: chandelier, plafond, spots or an LED panel, by the style."""
    if st == 'eu':
        if kind == 'room':
            spot_grid(m, x, y, zc)
        else:
            spots(m, [(x - 0.4, y), (x + 0.4, y)], zc)
    elif st == 'mod':
        led_panel(m, x, y, zc, 0.3 if kind == 'room' else 0.2)
    elif kind == 'room':
        K.chandelier(m, x, y, zc, 'xp' if st == 'xp' else 'sov')
    else:
        K.plafond(m, x, y, zc, 0.17 if kind == 'kitchen' else 0.14)


def window_dressing(m, st, rnd, side, x0, x1, short=False, plants=True):
    K.curtains(m, side, x0, x1, 0.0, 'sov' if st in SOVIET else 'xp', short=short)
    if st == 'old':
        jars(m, side, x0, x1, 0.0, rnd)
    elif plants and st != 'mod':
        K.plants(m, side, x0, x1, 0.0, rnd)


def living(m, st, rnd, unit, sofa, table, lamp, unit_len=3.0, unit2=None, corner=None, desk=None, rug=None,
           floorlamp=None, sofa_side=1):
    """Living room. unit: the wall for the wall unit (or the TV), unit2: a second spot along it, sofa: the wall
    opposite, table: in front of the sofa, corner: a spot for an armchair, desk: a spot for a desk by the window,
    rug: its middle, lamps."""
    desk = desk or corner
    if st == 'sov':
        K.stenka(unit, unit_len)
        K.sofa(sofa)
        K.wall_carpet(sofa, 2.0, 0.95, 2.2)
        K.coffee_table(table, 1.0, 0.5)
        if corner:
            K.armchair(corner)
        if floorlamp:
            K.floor_lamp(m, *floorlamp, 0.0, 'pk_lampshade_f')
        if rug:
            rug.flat(-0.9, 0.0, 0.9, 2.6, 0.006, 'pk_carpet')
    elif st == 'xp':
        K.sofa(sofa, 2.1, 0.95, 'pk_leather', leather=True)
        K.tv_stand(unit)
        unit.box(-0.6, 0, 1.45, 0.6, 0.25, 1.48, 'pk_veneer_light', 'pk_veneer_light', 'pk_veneer_light')
        if unit2:
            K.bookshelf(unit2, 0.8, 0.35, 1.9, 'xp')
        K.coffee_table(table, 0.9, 0.55, 0.45, glass=True)
        if desk:
            K.desk(desk, 1.2, 0.6, 'xp')
            K.pc(desk, -0.05, 0.02, 0.75, tower_u=-0.45)
            K.office_chair(desk, 0.0, 1.0)
        if rug:
            rug.flat(-0.8, 0.0, 0.8, 2.2, 0.006, 'pk_rug')
    elif st == 'eu':
        gorka(unit, min(unit_len, 3.0))
        corner_sofa(sofa, 2.2, 0.9, 1.4, sofa_side)
        # the low table stands clear of the wing of the sofa
        t = table.at(-sofa_side * 0.55)
        t.box(-0.45, 0, 0.42, 0.45, 0.55, 0.45, 'pk_glass_black', bot='pk_gloss_black')
        legs(t, 0.9, 0.55, 0.42, 0.02, 'pk_chrome')
        collide(t, -0.45, 0, 0.45, 0.55, 0.45)
        if corner:
            aquarium(corner)
        if rug:
            rug.flat(-0.9, 0.0, 0.9, 2.4, 0.006, 'pk_rug_eu')
    elif st == 'mod':
        tv_wall_mod(unit, min(unit_len, 1.8))
        if unit2:
            kallax(unit2)
        sofa_mod(sofa)
        round_table(table, 0, 0.32, 0.34)
        if desk:
            desk_mod(desk, 1.1, 0.55)
            laptop(desk, 0.0, 0.1, 0.75)
            K.chair(desk, 0.0, 0.85, face_back=True, mat='pk_white_matte')
        if floorlamp:
            arc_lamp(m, *floorlamp)
        if rug:
            rug.flat(-0.9, 0.0, 0.9, 2.2, 0.006, 'pk_rug_mod')
    else:
        sideboard(unit, min(unit_len, 1.6))
        if unit2:
            tv_legs(unit2)
        K.sofa(sofa)
        K.wall_carpet(sofa, 2.0, 0.95, 2.2)
        sofa.box(-0.7, 0.3, 0.42, 0.3, 0.85, 0.44, 'pk_lace')
        table.box(-0.45, 0, 0.7, 0.45, 0.5, 0.74, 'pk_lace', bot='pk_veneer')
        table.box(-0.4, 0.05, 0.0, 0.4, 0.45, 0.7, 'pk_veneer')
        table.box(-0.2, 0.1, 0.74, 0.15, 0.4, 0.8, 'pk_newspaper', 'pk_newspaper')
        collide(table, -0.45, 0, 0.45, 0.5, 0.74)
        if corner:
            K.armchair(corner)
            corner.box(-0.3, 0.15, 0.42, 0.3, 0.75, 0.44, 'pk_drape')
        if floorlamp:
            K.floor_lamp(m, *floorlamp, 0.0, 'pk_lampshade_f')
        if rug:
            rug.flat(-0.9, 0.0, 0.9, 2.6, 0.006, 'pk_carpet')
    ceiling_light(m, st, *lamp, K.CEIL)


def bedroom(m, st, rnd, bed, ward, dresser, lamp, bed_w=1.6, ward_w=1.2, ward_max=1.6, carpet=None, ns=True, chair=True):
    """Bedroom: the bed's headboard wall, a wardrobe, a dresser (trumo, chest), the carpet on the wall."""
    bed_style(bed, st, bed_w)
    if ns and st != 'old':
        half = min(bed_w, 1.3 if st == 'old' else bed_w) / 2
        K.nightstand(bed.at(-half - 0.23), lamp=st in ('sov', 'xp', 'eu'))
        K.nightstand(bed.at(half + 0.23), lamp=False)
    if st == 'sov':
        K.wardrobe(ward, ward_w)
        K.trumo(dresser)
        if chair:
            K.chair(dresser, 0.0, 0.75)
        if carpet:
            K.wall_carpet(carpet, 2.0, 0.85, 2.05)
    elif st == 'xp':
        K.wardrobe(ward, min(max(ward_w, 1.38), ward_max), sliding=True)
        K.chest(dresser, tv=True)
    elif st == 'eu':
        wardrobe_style(ward, st, min(max(ward_w, 1.6), ward_max))
        chest_style(dresser, st)
    elif st == 'mod':
        wardrobe_style(ward, st, min(max(ward_w, 1.6), ward_max))
        chest_style(dresser, st)
        poster(bed.at(0), 0.9, 0.6, 1.35)
    else:
        K.wardrobe(ward, ward_w)
        K.trumo(dresser)
        if carpet:
            K.wall_carpet(carpet, 2.0, 0.85, 2.05)
    ceiling_light(m, st, *lamp, K.CEIL)


def small_room(m, st, rnd, bed, desk, shelf, ward, lamp, rug=None):
    """The small room: a child's room in most flats, a box room in the old lady's."""
    if st == 'old':
        K.bed_along(bed, style='sov', fab='pk_bedding_b')
        sewing_machine(desk)
        boxes(shelf, -0.7, 0.7, 0.0, rnd, 0.9)
        K.wardrobe(ward)
        if rug:
            rug.flat(-0.6, 0.0, 0.6, 1.6, 0.006, 'pk_carpet')
    elif st == 'mod':
        K.bed_along(bed, style='xp', fab='pk_cushion_b')
        desk_mod(desk, 1.2, 0.6)
        laptop(desk, 0.0, 0.1, 0.75)
        K.office_chair(desk, 0.0, 1.0)
        kallax(shelf, 1.17, 1.48)
        wardrobe_style(ward, st, 1.2)
        poster(bed.at(0.2), 0.5, 0.7, 1.2, 'pk_poster_a')
        if rug:
            rug.flat(-0.6, 0.0, 0.6, 1.6, 0.006, 'pk_rug_mod')
    elif st == 'eu':
        K.bed_along(bed, style='xp', fab='pk_bedding_eu')
        desk.box(-0.6, 0, 0.72, 0.6, 0.6, 0.75, 'pk_gloss_black', bot='pk_gloss_black')
        legs(desk, 1.2, 0.6, 0.72, 0.02, 'pk_chrome')
        collide(desk, -0.6, 0, 0.6, 0.6, 0.75)
        K.tv_crt(desk, 0.0, 0.05, 0.75, 0.5, style='xp')
        desk.box(-0.45, 0.35, 0.75, -0.25, 0.5, 0.79, 'pk_plastic_black')
        K.chair(desk, 0.0, 0.85, face_back=True, mat='pk_gloss_black')
        K.bookshelf(shelf, 1.2, 0.3, 1.8, 'xp')
        wardrobe_style(ward, st, 1.2)
        poster(bed.at(0.2), 0.5, 0.7, 1.2)
        if rug:
            rug.flat(-0.6, 0.0, 0.6, 1.6, 0.006, 'pk_rug_eu')
    else:
        K.bed_along(bed, style=st, fab='pk_bedding_b')
        if st == 'sov':
            K.desk(desk)
            K.table_lamp(desk, -0.4, 0.2, 0.75)
            desk.cyl(0.25, 0.25, 0.75, 0.78, 0.05, 'pk_veneer', 6)
            desk.cyl(0.25, 0.25, 0.78, 0.95, 0.008, 'pk_chrome', 4)
            desk.cyl(0.25, 0.25, 0.95, 1.15, 0.0, 'pk_globe', 10, r1=0.1)
            desk.box(-0.1, 0.1, 0.75, 0.2, 0.32, 0.77, 'pk_paper')
            K.chair(desk, 0.0, 0.85)
        else:
            K.desk(desk, 1.3, 0.6, 'xp')
            K.pc(desk, 0.05, 0.02, 0.75, tower_u=0.48)
            K.office_chair(desk, 0.0, 1.0)
        K.bookshelf(shelf, 1.4, 0.3, 1.8, st)
        K.wardrobe(ward)
        if rug:
            rug.flat(-0.7, 0.0, 0.7, 1.8, 0.006, 'pk_carpet' if st == 'sov' else 'pk_rug')
    ceiling_light(m, st, *lamp, K.CEIL)


def kitchen(m, st, rnd, run, L, table, lamp, radio=None, clock=None, rev=False, tw=0.9, td=0.6,
            seats=((0.25, 0.8), (-0.82, 0.33))):
    """Kitchen along one wall: run is the frame at the start of the wall (u grows along it), L its free length,
    rev starts the row from the far end (the sink by the window). The table with two seats, the radio and the clock."""
    at = lambda u: run.at(L - u if rev else u)
    if st in SOVIET:
        # sink with the gas heater over it, the stove, the fridge
        K.sink_cabinet(at(0.47))
        K.gas_heater(at(0.42))
        K.stove(at(1.03), kettle=True)
        K.fridge_zil(at(1.62))
        if st == 'old':
            K.wall_cabinet(at(1.03), 0.6, 1.55, 2.15, mat='pk_paint_white')
            if L > 2.6:
                buffet(at(L - 0.46), 0.9)
        else:
            K.wall_cabinet(at(1.62), 0.6, 1.62, 2.2)
        K.kitchen_table(table, tw, td)
        for (u, v) in seats:
            K.stool(table, u, v)
        if radio:
            K.radio_point(radio)
        if clock:
            if st == 'old':
                calendar(clock)
            else:
                K.wall_clock(clock)
    else:
        # base cabinets with the sink, the stove (a hob in the 2010s), the fridge
        cab = max(0.6, L - 1.26)
        K.kitchen_run(at(cab / 2), cab)
        K.sink_insert(at(cab / 2))
        if st == 'mod':
            hob_cabinet(at(cab + 0.3))
            hood(at(cab + 0.3))
            fridge_steel(at(cab + 0.96))
        else:
            K.stove(at(cab + 0.25), style='xp', kettle=(st == 'eu'))
            at(cab + 0.25).box(-0.3, 0, 1.6, 0.3, 0.5, 1.75, 'pk_chrome', 'pk_chrome')
            K.fridge_modern(at(cab + 0.96))
            if st == 'eu' and cab > 1.0:
                # a little TV on the counter, by the stove
                kitchen_tv(at(cab - 0.2), 0.0, 0.05, 0.86)
        K.wall_cabinet(at(cab / 2), cab, 1.45, 2.15, mat='pk_kitchen')
        K.kitchen_table(table, max(tw, 0.8), td, oilcloth=False)
        for (u, v) in seats:
            K.chair(table, u, v, mat={'eu': 'pk_gloss_black', 'mod': 'pk_white_matte'}.get(st, 'pk_veneer_light'))
        if clock:
            K.wall_clock(clock)
    ceiling_light(m, st, *lamp, K.CEIL, 'kitchen')


def bath(m, st, tub, toilet, sink, rail=None, washer_at=None, lamp=None, line=None, tub_len=1.5):
    """Combined bath: the tub along a wall, the toilet, the basin, a towel rail, a washing machine in the newer
    flats, laundry on a line in the old one."""
    K.bathtub(tub, tub_len)
    K.toilet(toilet)
    K.bath_sink(sink, cabinet=st not in SOVIET)
    if rail:
        K.towel_rail(rail)
    if washer_at and st != 'sov':
        washer(washer_at, small=(st == 'old'))
    if line and st == 'old':
        laundry(m, *line)
    if lamp:
        if st == 'mod':
            led_panel(m, lamp[0], lamp[1], K.CEIL, 0.15)
        elif st == 'eu':
            spots(m, [lamp], K.CEIL)
        else:
            K.plafond(m, lamp[0], lamp[1], K.CEIL, 0.12)


def hall(m, st, coat, mirror, lamp, coat_len=1.5, phone=None):
    hall_unit(coat, st, coat_len)
    if mirror:
        if st in SOVIET or st == 'xp':
            K.mirror_shelf(mirror, phone=st in SOVIET)
        elif st == 'mod':
            # a tall mirror in a thin oak frame, flat on the wall (the halls are narrow)
            mirror.box(-0.27, 0, 0.35, 0.27, 0.015, 1.95, 'pk_wood_oak')
            mirror.quad(-0.24, 0.24, 0.022, 0.38, 1.92, 'pk_mirror')
    ceiling_light(m, st, *lamp, K.CEIL, 'hall')
