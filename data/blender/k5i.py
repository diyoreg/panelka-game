"""Panel blocks with interiors: colliders of the structure, the inside of a section, furniture and door leaves.

build_panelka.py calls init(Mesh), use(plan) and then the build functions. Plans: k5i_plan.py (the khrushchyovka)
and k9i_plan.py (the nine-storey with a lift); use() switches every plan constant below to that plan, so the same
code builds both. Asset names start with the plan's NAME (k5i_shell, k9i_shell ...).
Every asset here is drawn in section coordinates (Blender: x = plan x, y = plan y - D / 2, z up):
    k5i_shell          walls, floors, ceilings, stairs, windows from the inside: all floors of one section
    k5i_<apt>_<style>  furniture and lamps of one apartment, z from its floor (the game lifts it per floor)
    k5i_dr_<kind>      door leaves: hinge at the origin, the leaf runs along +x, the game turns them
"""
import math
import random

import k5i_plan
from k5i_plan import (W, D, T, END, PL, FH, FLOORS, SLAB, CEIL, DOOR_H, ROOF, M, ROOMS, WALLS, DOORS, DOOR_LEAF,
                      FRAME, BAL_DOOR_TOP,
                      SWITCHES, SWITCH_Z, WINDOWS, STAIR_WINDOW, LANE_A, LANE_B, STAIR_X, Y_MID, Y_FL, RISE, TREAD,
                      VEST_Z, ENTRANCE, HATCH, LADDER)

Mesh = None
PLAN = k5i_plan
PREFIX = 'k5i'
# plan constants that use() swaps
_PLAN_NAMES = ('W', 'D', 'T', 'END', 'PL', 'FH', 'FLOORS', 'SLAB', 'CEIL', 'DOOR_H', 'ROOF', 'M', 'ROOMS', 'WALLS',
               'DOORS', 'DOOR_LEAF', 'FRAME', 'BAL_DOOR_TOP', 'SWITCHES', 'SWITCH_Z', 'WINDOWS', 'STAIR_WINDOW',
               'LANE_A', 'LANE_B', 'STAIR_X', 'Y_MID', 'Y_FL', 'RISE', 'TREAD', 'VEST_Z', 'ENTRANCE', 'HATCH',
               'LADDER', 'XC', 'Y_LAND', 'SLAB_HOLES', 'SOLIDS', 'PANEL', 'SOCKETS', 'ELEVATOR')


def init(mesh_cls):
    global Mesh
    Mesh = mesh_cls


def use(plan):
    """Build the next assets for this plan (a module like k5i_plan)."""
    global PLAN, PREFIX
    PLAN, PREFIX = plan, plan.NAME
    g = globals()
    for n in _PLAN_NAMES:
        g[n] = getattr(plan, n)


def rect_minus(r, holes):
    """Rectangle (x0, y0, x1, y1) minus the holes, as a list of rectangles."""
    xs = sorted({r[0], r[2], *[min(max(h[0], r[0]), r[2]) for h in holes], *[min(max(h[2], r[0]), r[2]) for h in holes]})
    ys = sorted({r[1], r[3], *[min(max(h[1], r[1]), r[3]) for h in holes], *[min(max(h[3], r[1]), r[3]) for h in holes]})
    out = []
    for i in range(len(xs) - 1):
        run = None
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            solid = xs[i + 1] - xs[i] > 1e-4 and ys[j + 1] - ys[j] > 1e-4 and \
                not any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes)
            if solid:
                run = (run[0] if run else ys[j], ys[j + 1])
            if (not solid or j == len(ys) - 2) and run:
                out.append((xs[i], run[0], xs[i + 1], run[1]))
                run = None
    return out


def facade_doors(side):
    """Balcony doors in the facade on this side ('front' or 'back')."""
    return [d for d in DOORS if d['wall'] == side]


def by(y):
    return y - D / 2


def pbox(m, x0, y0, z0, x1, y1, z1, side, top=None, bottom=None, col=False):
    """Box in plan coordinates."""
    m.box(min(x0, x1), by(min(y0, y1)), min(z0, z1), max(x0, x1), by(max(y0, y1)), max(z0, z1), side, top, bottom, col)


def pcol(m, x0, y0, z0, x1, y1, z1, ox=0.0):
    m.col(min(x0, x1) + ox, by(min(y0, y1)), min(z0, z1), max(x0, x1) + ox, by(max(y0, y1)), max(z0, z1))


def pquad(m, pts, mat, n, uvs=None):
    m.face_n([(x, by(y), z) for x, y, z in pts], mat, n, uvs)


def floor_z(f):
    return PL + f * FH


# ------------------------------------------------------------------ walls with door holes

def wall_pieces(w, zb, zf, zt):
    """Solid pieces of a wall between zb and zt with door holes from zf to zf + DOOR_H: (a0, a1, z0, z1)."""
    kind, t0, t1, a0, a1, holes = w
    out = []
    a = a0
    for h0, h1 in sorted(holes):
        if h0 > a:
            out.append((a, h0, zb, zt))
        if zb < zf:
            out.append((h0, h1, zb, zf))
        out.append((h0, h1, zf + DOOR_H, zt))
        a = h1
    if a < a1:
        out.append((a, a1, zb, zt))
    return out


def wall_rect(w, a0, a1):
    kind, t0, t1 = w[0], w[1], w[2]
    return (t0, a0, t1, a1) if kind == 'X' else (a0, t0, a1, t1)


def solid_at(x, y, z=0.3):
    """Is there a wall (not a door hole) at this plan point, z above the floor."""
    if x < 0.08 or x > W - 0.08 or y < T or y > D - T:
        side = 'back' if y > D - T else 'front' if y < T else None
        for d in facade_doors(side) if side else []:
            if d['a0'] < x < d['a1']:
                return False
        return True
    for w in WALLS:
        x0, y0, x1, y1 = wall_rect(w, w[3], w[4])
        if x0 <= x <= x1 and y0 <= y <= y1:
            along = y if w[0] == 'X' else x
            if any(h0 < along < h1 for h0, h1 in w[5]) and z < DOOR_H:
                return False
            return True
    return False


# ------------------------------------------------------------------ colliders of the structure

def structure_cols(m, ox, first, last):
    """All colliders of one section, x shifted by ox (building coordinates). Walls, slabs, stairs, roof."""
    def c(x0, y0, z0, x1, y1, z1):
        pcol(m, x0, y0, z0, x1, y1, z1, ox)

    for f in range(FLOORS):
        zf = floor_z(f)
        zb = 0.0 if f == 0 else zf
        for w in WALLS:
            for a0, a1, z0, z1 in wall_pieces(w, zb, zf, zf + FH):
                x0, y0, x1, y1 = wall_rect(w, a0, a1)
                c(x0, y0, z0, x1, y1, z1)
        # floor slab (the basement is solid), the stairwell (and the lift shaft) open
        zs = 0.0 if f == 0 else zf - SLAB
        for (x0, y0, x1, y1) in rect_minus((0.0, 0.0, W, D), SLAB_HOLES):
            c(x0, y0, zs, x1, y1, zf)
        for (x0, y0, x1, y1) in SOLIDS:
            c(x0, y0, zb, x1, y1, zf + FH)
        # facades: gaps for the balcony doors, and on the ground floor the entrance
        for side, t0, t1 in (('front', 0.0, T), ('back', D - T, D)):
            xs = [0.0]
            for d in facade_doors(side):
                xs += [d['a0'], d['a1']]
            xs.append(W)
            for i in range(0, len(xs), 2):
                if side == 'front' and f == 0:
                    e0, e1, ez0, ez1 = ENTRANCE
                    for (a, b) in ((xs[i], min(xs[i + 1], e0)), (max(xs[i], e1), xs[i + 1])):
                        if b > a:
                            c(a, t0, zb, b, t1, zf + FH)
                    if xs[i] < e0 and xs[i + 1] > e1:
                        c(e0, t0, 0.0, e1, t1, ez0)
                        c(e0, t0, ez1, e1, t1, zf + FH)
                    continue
                c(xs[i], t0, zb, xs[i + 1], t1, zf + FH)
            for i in range(1, len(xs) - 1, 2):
                c(xs[i], t0, zf + 2.25, xs[i + 1], t1, zf + FH)
                if f == 0:
                    c(xs[i], t0, 0, xs[i + 1], t1, zf)
    if first:
        c(-END, 0, 0, 0.0, D, ROOF)
    if last:
        c(W, 0, 0, W + END, D, ROOF)
    # roof slab with the hatch
    hx0, hy0, hx1, hy1 = HATCH
    z0, z1 = ROOF - SLAB, ROOF
    c(0, 0, z0, hx0, D, z1)
    c(hx1, 0, z0, W, D, z1)
    c(hx0, 0, z0, hx1, hy0, z1)
    c(hx0, hy1, z0, hx1, D, z1)
    # kerb around the hatch on the roof
    for (x0, y0, x1, y1) in ((hx0 - 0.1, hy0 - 0.1, hx1 + 0.1, hy0), (hx0 - 0.1, hy1, hx1 + 0.1, hy1 + 0.1),
                             (hx0 - 0.1, hy0, hx0, hy1), (hx1, hy0, hx1 + 0.1, hy1)):
        c(x0, y0, z1, x1, y1, z1 + 0.15)
    for col in stair_cols():
        c(*col)


def stair_cols():
    """Treads, landings and rails of the stairwell."""
    out = []
    xa0, xa1 = LANE_A
    xb0, xb1 = LANE_B
    x0, x1 = STAIR_X
    # entrance hall and the solid base under the first flight
    out.append((x0, T, 0, x1, 2.69, VEST_Z))
    for k in range(1, 5):
        top = VEST_Z + k * 0.16
        out.append((xb0, 2.69 + (k - 1) * TREAD, 0, xb1, 2.69 + k * TREAD, top))
    for f in range(FLOORS):
        zf = floor_z(f)
        out.append((x0, Y_FL, zf - 0.2 if f else 0.0, x1, Y_LAND, zf))
        if f == FLOORS - 1:
            # top landing: rail over the drop into the flights below
            out.append((xa0, Y_FL - 0.05, zf, xa1 + 0.13, Y_FL + 0.01, zf + 1.0))
            continue
        for k in range(1, 8):
            top = zf + k * RISE
            out.append((xa0, Y_FL - k * TREAD, 0.0 if f == 0 else top - 0.25, xa1, Y_FL - (k - 1) * TREAD, top))
        zm = zf + 8 * RISE
        out.append((x0, T, zm - 0.2, x1, Y_MID, zm))
        for k in range(1, 8):
            top = zm + k * RISE
            out.append((xb0, Y_MID + (k - 1) * TREAD, top - 0.25, xb1, Y_MID + k * TREAD, top))
        # rails along the well
        out.append((xa1 - 0.02, Y_MID, zf, xa1 + 0.04, Y_FL, zm + 0.95))
        out.append((xb0 - 0.04, Y_MID, zm, xb0 + 0.02, Y_FL, zf + FH + 0.95))
    return out


# ------------------------------------------------------------------ the inside of a section

def windows_of_floor(f):
    """(side, x0, x1, z0, z1, kind) with absolute z: windows and balcony doors of floor f."""
    zf = floor_z(f)
    out = [(s, x0, x1, zf + z0, zf + z1, 'win') for (s, x0, x1, z0, z1, room) in WINDOWS]
    for side in ('front', 'back'):
        for d in facade_doors(side):
            out.append((side, d['a0'], d['a1'], zf + d.get('z0', 0.0), zf + BAL_DOOR_TOP, 'door'))
    if f < FLOORS - 1:
        x0, x1, z0, z1 = STAIR_WINDOW
        out.append(('front', x0, x1, zf + z0, zf + z1, 'stair'))
    return out


def holed_slab(m, axis, t0, t1, a0, a1, z0, z1, holes, mat):
    """Thin wall plate between a0..a1, z0..z1 with rectangular holes (a0, a1, z0, z1), as boxes."""
    us = sorted({a0, a1, *[h[0] for h in holes], *[h[1] for h in holes]})
    zs = sorted({z0, z1, *[min(max(h[2], z0), z1) for h in holes], *[min(max(h[3], z0), z1) for h in holes]})
    for j in range(len(zs) - 1):
        za, zb = zs[j], zs[j + 1]
        if zb - za < 1e-4:
            continue
        zc = (za + zb) / 2
        run = None
        for i in range(len(us) - 1):
            ua, ub = us[i], us[i + 1]
            uc = (ua + ub) / 2
            solid = not any(h[0] < uc < h[1] and h[2] < zc < h[3] for h in holes)
            if solid:
                run = (run[0] if run else ua, ub)
            if (not solid or i == len(us) - 2) and run:
                if axis == 'Y':
                    pbox(m, run[0], t0, za, run[1], t1, zb, mat, bottom=mat)
                else:
                    pbox(m, t0, run[0], za, t1, run[1], zb, mat, bottom=mat)
                run = None


def window_inside(m, side, x0, x1, z0, z1, kind, rnd):
    """Frames, glass, sill board and radiator of one window seen from the room."""
    # plane of the exterior glass: 0.2 into the wall from the facade
    if side == 'front':
        yg, inward = T - 0.15, 1
    else:
        yg, inward = D - T + 0.15, -1
    yi = T if side == 'front' else D - T          # inner face of the wall
    fw = 0.06
    def fb(a0, a1, za, zb, d0=0.0, d1=0.07, mat='pk_frame_int'):
        pbox(m, a0, yg + inward * d0, za, a1, yg + inward * d1, zb, mat, bottom=mat)
    # outer frame
    fb(x0, x1, z0, z0 + fw)
    fb(x0, x1, z1 - fw, z1)
    fb(x0, x0 + fw, z0, z1)
    fb(x1 - fw, x1, z0, z1)
    if kind == 'win' or kind == 'stair':
        mid = (x0 + x1) / 2 if (x1 - x0) > 1.3 or kind == 'stair' else x0 + (x1 - x0) * 0.42
        fb(mid - 0.035, mid + 0.035, z0, z1)
        # transom with the vent pane (fortochka) over one half
        zt = z1 - (z1 - z0) * 0.28
        fb(x0, mid, zt - 0.03, zt + 0.03)
        fb(x0 + (mid - x0) * 0.5 - 0.02, x0 + (mid - x0) * 0.5 + 0.02, zt, z1)
        # inner frames of the double glazing: thinner, 0.12 deeper
        fb(x0 + fw, x1 - fw, z0 + fw, z0 + fw + 0.03, 0.12, 0.17)
        fb(mid - 0.025, mid + 0.025, z0, z1, 0.12, 0.17)
        # glass, both panes
        for d in (0.035, 0.145):
            y = yg + inward * d
            pquad(m, [(x0 + fw, y, z0 + fw), (x1 - fw, y, z0 + fw), (x1 - fw, y, z1 - fw), (x0 + fw, y, z1 - fw)],
                  'pk_glass_int', (0, inward, 0))
        # sill board and the radiator under it
        sz = z0 - 0.02
        pbox(m, x0 - 0.06, yi - inward * 0.0, sz - 0.04, x1 + 0.06, yi + inward * 0.24, sz, 'pk_casing', 'pk_casing', 'pk_casing')
        if kind == 'win':
            radiator(m, (x0 + x1) / 2, yi, inward, sz - 0.1, min(1.0, (x1 - x0) - 0.4))
    # reveal linings so the wall cut looks plastered
    for (a0, a1, za, zb) in ((x0 - 0.02, x0, z0, z1), (x1, x1 + 0.02, z0, z1), (x0 - 0.02, x1 + 0.02, z1, z1 + 0.02)):
        pbox(m, a0, yg, za, a1, yi + inward * 0.005, zb, 'pk_casing', bottom='pk_casing')


def radiator(m, xc, yi, inward, top, width, riser=True):
    """Cast iron radiator: sections side by side, two pipes going down to the floor.
    riser: one of them goes on up through the ceiling (in the flats; in the stairwell it would end in the air)."""
    n = max(4, int(width / 0.09))
    z0 = top - 0.55
    for i in range(n):
        x = xc - width / 2 + (i + 0.5) * width / n
        pbox(m, x - 0.035, yi + inward * 0.05, z0, x + 0.035, yi + inward * 0.15, top, 'pk_radiator')
    pbox(m, xc - width / 2, yi + inward * 0.08, z0 + 0.05, xc + width / 2, yi + inward * 0.12, top - 0.05, 'pk_radiator')
    for s in (-1, 1):
        x = xc + s * (width / 2 + 0.08)
        up = s < 0 and riser
        m.cyl(x, by(yi + inward * 0.07), z0 - 0.4 if up else z0, top + 2.4 if up else top, 0.016, 6, 'pk_radiator')


def baseboards(m, zf):
    """Skirting boards along every wall face of every room, broken at the door openings."""
    step = 0.05
    for r in ROOMS:
        if r['kind'] == 0:
            continue
        for (x0, y0, x1, y1) in r['boxes']:
            # each edge of the room box: from a to b, n points into the wall
            for (ax, ay, bx, by_, nx, ny) in ((x0, y0, x1, y0, 0, -1), (x0, y1, x1, y1, 0, 1),
                                              (x0, y0, x0, y1, -1, 0), (x1, y0, x1, y1, 1, 0)):
                L = math.hypot(bx - ax, by_ - ay)
                n = max(1, int(round(L / step)))
                runs, run = [], None
                for i in range(n):
                    t = (i + 0.5) / n
                    px, py = ax + (bx - ax) * t, ay + (by_ - ay) * t
                    if solid_at(px + nx * 0.03, py + ny * 0.03):
                        run = (run[0] if run else i / n, (i + 1) / n)
                    elif run:
                        runs.append(run)
                        run = None
                if run:
                    runs.append(run)
                for t0, t1 in runs:
                    sx0, sy0 = ax + (bx - ax) * t0, ay + (by_ - ay) * t0
                    sx1, sy1 = ax + (bx - ax) * t1, ay + (by_ - ay) * t1
                    if nx:
                        pbox(m, sx0 - nx * 0.014, sy0, zf, sx0, sy1, zf + 0.07, 'pk_baseboard')
                    else:
                        pbox(m, sx0, sy0 - ny * 0.014, zf, sx1, sy0, zf + 0.07, 'pk_baseboard')


def door_frame(b, h0, h1, t0, t1, z0, z1, side, leaf_t):
    """Frame inside an opening: jambs and a head through the whole depth t0..t1, a stop strip behind the leaf.
    b(a0, a1, s0, s1, z0, z1) draws a box in the coordinates of the wall (along, across, height)."""
    j = FRAME
    b(h0, h0 + j, t0, t1, z0, z1)
    b(h1 - j, h1, t0, t1, z0, z1)
    b(h0 + j, h1 - j, t0, t1, z1 - j, z1)
    face = t1 if side > 0 else t0
    s0 = face - side * (leaf_t + 0.006)
    s1 = s0 - side * 0.012
    s0, s1 = min(s0, s1), max(s0, s1)
    b(h0 + j, h0 + j + 0.012, s0, s1, z0, z1 - j)
    b(h1 - j - 0.012, h1 - j, s0, s1, z0, z1 - j)
    b(h0 + j, h1 - j, s0, s1, z1 - j - 0.012, z1 - j)


def opening_trim(m, w, h0, h1, zf):
    """An opening without a door (the lift doorway on the landings): casings on both faces, a lining inside."""
    kind, t0, t1 = w[0], w[1], w[2]
    lift = ELEVATOR and kind == 'Y' and abs(h0 - ELEVATOR['door'][0]) < 1e-6
    mat = 'pk_lift_frame' if lift else 'pk_casing'
    def b(a0, a1, s0, s1, z0, z1):
        if kind == 'X':
            pbox(m, s0, a0, z0, s1, a1, z1, mat, bottom=mat)
        else:
            pbox(m, a0, s0, z0, a1, s1, z1, mat, bottom=mat)
    top = zf + DOOR_H
    b(h0, h0 + 0.02, t0, t1, zf, top)
    b(h1 - 0.02, h1, t0, t1, zf, top)
    b(h0, h1, t0, t1, top - 0.02, top)
    for s0, s1 in ((t0 - 0.012, t0), (t1, t1 + 0.012)):
        b(h0 - 0.07, h0, s0, s1, zf, top + 0.07)
        b(h1, h1 + 0.07, s0, s1, zf, top + 0.07)
        b(h0 - 0.07, h1 + 0.07, s0, s1, top, top + 0.07)
    b(h0, h1, t0, t1, zf, zf + 0.012)


def door_trim(m, w, h0, h1, zf, d):
    """Frame inside a door opening, casings on both faces, threshold."""
    kind, t0, t1 = w[0], w[1], w[2]
    def b(a0, a1, s0, s1, z0, z1):
        if kind == 'X':
            pbox(m, s0, a0, z0, s1, a1, z1, 'pk_casing', bottom='pk_casing')
        else:
            pbox(m, a0, s0, z0, a1, s1, z1, 'pk_casing', bottom='pk_casing')
    door_frame(b, h0, h1, t0, t1, zf, zf + DOOR_H, d['side'], DOOR_LEAF[d['kind']][2])
    for s0, s1 in ((t0 - 0.012, t0), (t1, t1 + 0.012)):
        b(h0 - 0.06, h0, s0, s1, zf, zf + DOOR_H + 0.06)
        b(h1, h1 + 0.06, s0, s1, zf, zf + DOOR_H + 0.06)
        b(h0 - 0.06, h1 + 0.06, s0, s1, zf + DOOR_H, zf + DOOR_H + 0.06)
    # threshold
    b(h0, h1, t0, t1, zf, zf + 0.012)


def build_shell(extra=None):
    m = Mesh(PREFIX + '_shell', 'interior')
    rnd = random.Random(5)
    for f in range(FLOORS):
        zf = floor_z(f)
        zb = 0.0 if f == 0 else zf
        # the top floor ends under the roof slab: up to its top the walls would show through the snow on the roof
        zt = zf + FH if f < FLOORS - 1 else ROOF - SLAB
        for wi, w in enumerate(WALLS):
            for a0, a1, z0, z1 in wall_pieces(w, zb, zf, zt):
                x0, y0, x1, y1 = wall_rect(w, a0, a1)
                # boxes have no bottom face unless asked: the piece over a door hole needs one
                pbox(m, x0, y0, z0, x1, y1, z1, 'pk_wall_int', bottom='pk_wall_int' if z0 > zb + 0.01 else None)
            for h0, h1 in w[5]:
                d = next((d for d in DOORS if d['wall'] == wi and d['a0'] == h0), None)
                if d:
                    door_trim(m, w, h0, h1, zf, d)
                else:
                    opening_trim(m, w, h0, h1, zf)
        for r in ROOMS:
            # the stairwell has its own landings, the lift cab is drawn by the game
            if r['kind'] in (0, 5):
                continue
            for (x0, y0, x1, y1) in r['boxes']:
                pquad(m, [(x0, y0, zf), (x1, y0, zf), (x1, y1, zf), (x0, y1, zf)], 'pk_floor_int', (0, 0, 1))
                zc = zf + CEIL
                pquad(m, [(x0, y0, zc), (x1, y0, zc), (x1, y1, zc), (x0, y1, zc)], 'pk_ceil_int', (0, 0, -1))
        # floor and ceiling inside the door openings
        for w in WALLS:
            for h0, h1 in w[5]:
                x0, y0, x1, y1 = wall_rect(w, h0, h1)
                pquad(m, [(x0, y0, zf + 0.001), (x1, y0, zf + 0.001), (x1, y1, zf + 0.001), (x0, y1, zf + 0.001)], 'pk_floor_int', (0, 0, 1))
        baseboards(m, zf)
        for (side, x0, x1, z0, z1, kind) in windows_of_floor(f):
            window_inside(m, side, x0, x1, z0, z1, kind, rnd)
        for side in ('front', 'back'):
            # inner face of the facade, the casing on it, the frame between the inner face and the glass plane
            yi, ci, (t0, t1) = (D - T, -0.012, (D - T, D - T + 0.15)) if side == 'back' else (T, 0.012, (T - 0.15, T))
            for d in facade_doors(side):
                top = zf + BAL_DOOR_TOP
                for (a0, a1, za, zb_) in ((d['a0'] - 0.06, d['a0'], zf, top + 0.06), (d['a1'], d['a1'] + 0.06, zf, top + 0.06),
                                         (d['a0'] - 0.06, d['a1'] + 0.06, top, top + 0.06)):
                    pbox(m, a0, yi + ci, za, a1, yi, zb_, 'pk_casing', bottom='pk_casing')
                door_frame(lambda a0, a1, s0, s1, z0, z1: pbox(m, a0, s0, z0, a1, s1, z1, 'pk_frame_int', bottom='pk_frame_int'),
                           d['a0'], d['a1'], t0, t1, zf + d.get('z0', 0.0), top, d['side'], DOOR_LEAF['bal'][2])
        for (room, x, y, nx, ny) in SWITCHES:
            switch(m, x, y, zf + SWITCH_Z, nx, ny)
        sockets(m, zf, rnd)
        stair_floor(m, f)
    # inner layer of the facades: 0.2 .. 0.35 from the outer faces, holes where the windows and doors are
    holes_f, holes_b = [], []
    for f in range(FLOORS):
        for (side, x0, x1, z0, z1, kind) in windows_of_floor(f):
            (holes_f if side == 'front' else holes_b).append((x0, x1, z0, z1))
    e0, e1, ez0, ez1 = ENTRANCE
    holes_f.append((e0, e1, ez0, ez1 + 0.35))
    holed_slab(m, 'Y', T - 0.15, T, 0.0, W, VEST_Z, ROOF - SLAB, holes_f, 'pk_wall_int')
    holed_slab(m, 'Y', D - T, D - T + 0.15, 0.0, W, PL, ROOF - SLAB, holes_b, 'pk_wall_int')
    # entrance: jambs, transom frame
    for (a0, a1, za, zb_) in ((e0 - 0.02, e0, ez0, ez1 + 0.35), (e1, e1 + 0.02, ez0, ez1 + 0.35)):
        pbox(m, a0, 0.0, za, a1, T, zb_, 'pk_casing', bottom='pk_casing')
    door_frame(lambda a0, a1, s0, s1, z0, z1: pbox(m, a0, s0, z0, a1, s1, z1, 'pk_metal', bottom='pk_metal'),
               e0, e1, 0.0, T, ez0, ez1, -1, DOOR_LEAF['entr'][2])
    pbox(m, e0, T - 0.15, ez1, e1, T - 0.08, ez1 + 0.05, 'pk_frame_int')
    pquad(m, [(e0, T - 0.12, ez1 + 0.05), (e1, T - 0.12, ez1 + 0.05), (e1, T - 0.12, ez1 + 0.33), (e0, T - 0.12, ez1 + 0.33)], 'pk_glass_int', (0, 1, 0))
    stair_common(m, rnd)
    if extra:
        extra(m)
    return m.finish()


def switch(m, x, y, z, nx, ny):
    """Rocker switch on a round box, the old Soviet kind."""
    w, h, d = 0.075, 0.075, 0.025
    if nx:
        pbox(m, x, y - w / 2, z - h / 2, x + nx * d, y + w / 2, z + h / 2, 'pk_switch')
        pbox(m, x + nx * d, y - 0.015, z - 0.022, x + nx * (d + 0.008), y + 0.015, z + 0.022, 'pk_switch_key')
    else:
        pbox(m, x - w / 2, y, z - h / 2, x + w / 2, y + ny * d, z + h / 2, 'pk_switch')
        pbox(m, x - 0.015, y + ny * d, z - 0.022, x + 0.015, y + ny * (d + 0.008), z + 0.022, 'pk_switch_key')


def sockets(m, zf, rnd):
    for (room, x, y, nx, ny, z) in SOCKETS:
        if nx:
            pbox(m, x, y - 0.04, zf + z - 0.04, x + nx * 0.02, y + 0.04, zf + z + 0.04, 'pk_switch')
        else:
            pbox(m, x - 0.04, y, zf + z - 0.04, x + 0.04, y + ny * 0.02, zf + z + 0.04, 'pk_switch')


# ------------------------------------------------------------------ stairwell

def flight(m, xa, xb, y_start, dy, z_start, n, base=None):
    """n treads going from y_start in direction dy (+1 or -1), each RISE higher. base: solid down to this z."""
    for k in range(1, n + 1):
        ya = y_start + dy * (k - 1) * TREAD
        yb = y_start + dy * k * TREAD
        top = z_start + k * RISE
        if base is not None:
            pbox(m, xa, ya, base, xb, yb, top, 'pk_stair_side', 'pk_stair')
            continue
        # sloped soffit: bottom of a tread follows the line under the inner corners
        lo_front = z_start + (k - 1) * RISE - 0.14
        lo_back = z_start + (k - 2) * RISE - 0.14
        y0, y1 = (ya, yb) if dy > 0 else (yb, ya)
        zb0, zb1 = (lo_back, lo_front) if dy > 0 else (lo_front, lo_back)
        c = [(xa, by(y0), zb0), (xb, by(y0), zb0), (xb, by(y1), zb1), (xa, by(y1), zb1),
             (xa, by(y0), top), (xb, by(y0), top), (xb, by(y1), top), (xa, by(y1), top)]
        m.hexa(c, 'pk_stair_side', 'pk_stair', 'pk_ceil_int')


def railing(m, x, y0, z0, y1, z1, n):
    """Balusters along a flight or a landing edge and a wooden handrail on top."""
    for i in range(n + 1):
        t = i / n
        y, z = y0 + (y1 - y0) * t, z0 + (z1 - z0) * t
        pbox(m, x - 0.01, y - 0.01, z, x + 0.01, y + 0.01, z + 0.9, 'pk_rail')
    m.tube((x, by(y0), z0 + 0.92), (x, by(y1), z1 + 0.92), 0.03, 0.03, 'pk_handrail', 6)


def stair_floor(m, f):
    zf = floor_z(f)
    xa0, xa1 = LANE_A
    xb0, xb1 = LANE_B
    x0, x1 = STAIR_X
    # floor landing: tiles on top, whitewash underneath; the first one is solid down to the ground (as its collider),
    # otherwise the gap between the flights looks under it at the snow
    pbox(m, x0, Y_FL, 0.0 if f == 0 else zf - 0.2, x1, Y_LAND, zf, 'pk_stair_side', 'pk_floor_int', 'pk_ceil_int')
    # bulb under the landing above (or the roof)
    zc = zf + FH - 0.2 if f < FLOORS - 1 else ROOF - SLAB
    yl = (Y_FL + Y_LAND) / 2
    m.cyl(XC, by(yl), zc - 0.12, zc, 0.006, 4, 'pk_rail')
    m.cyl(XC, by(yl), zc - 0.2, zc - 0.12, 0.035, 8, 'pk_lampshade', r1=0.025)
    # electric panel
    ax, p0, p1, face, n = PANEL
    if ax == 'Y':
        pbox(m, p0, face + n * 0.07, zf + 1.35, p1, face, zf + 2.05, 'pk_metal_green', 'pk_metal_green')
        pbox(m, p1 - 0.08, face + n * 0.075, zf + 1.65, p1 - 0.04, face + n * 0.07, zf + 1.75, 'pk_rail')
    else:
        pbox(m, face + n * 0.07, p0, zf + 1.35, face, p1, zf + 2.05, 'pk_metal_green', 'pk_metal_green')
        pbox(m, face + n * 0.075, p1 - 0.08, zf + 1.65, face + n * 0.07, p1 - 0.04, zf + 1.75, 'pk_rail')
    # a bell by every flat door and a mat in front of it
    for (ax, face, n, a0, a1) in landing_doors():
        a = a1 + 0.11 if landing_span(ax)[0] < a1 + 0.14 < landing_span(ax)[1] else a0 - 0.11
        if ax == 'X':
            pbox(m, face, a - 0.03, zf + 1.45, face + n * 0.02, a + 0.03, zf + 1.53, 'pk_switch')
            pbox(m, face + n * 0.03, a0 + 0.05, zf, face + n * 0.53, a1 - 0.05, zf + 0.012, 'pk_mat')
        else:
            pbox(m, a - 0.03, face, zf + 1.45, a + 0.03, face + n * 0.02, zf + 1.53, 'pk_switch')
            pbox(m, a0 + 0.05, face + n * 0.03, zf, a1 - 0.05, face + n * 0.48, zf + 0.012, 'pk_mat')
    if f == FLOORS - 1:
        # across the whole edge, from the wall to the rail of the flight coming up
        xr = xb0 - 0.01
        for i in range(8):
            x = xa0 + 0.05 + i * (xr - 0.05 - xa0 - 0.05) / 7
            # on the slab, by its edge
            pbox(m, x - 0.01, Y_FL + 0.01, zf, x + 0.01, Y_FL + 0.03, zf + 0.9, 'pk_rail')
        m.tube((xa0, by(Y_FL + 0.02), zf + 0.92), (xr, by(Y_FL + 0.02), zf + 0.92), 0.03, 0.03, 'pk_handrail', 6)
        # the handrail of the flight ends lower: it turns up to meet this one
        m.tube((xr, by(Y_FL), zf - RISE + 0.92), (xr, by(Y_FL + 0.02), zf + 0.92), 0.03, 0.03, 'pk_handrail', 6)
        return
    zm = zf + 8 * RISE
    flight(m, xa0, xa1, Y_FL, -1, zf, 7, base=(VEST_Z if f == 0 else None))
    pbox(m, x0, T, zm - 0.2, x1, Y_MID, zm, 'pk_stair_side', 'pk_floor_int', 'pk_ceil_int')
    flight(m, xb0, xb1, Y_MID, 1, zm, 7)
    railing(m, xa1 + 0.01, Y_FL, zf, Y_MID, zm - RISE, 7)
    railing(m, xb0 - 0.01, Y_MID, zm, Y_FL, zf + FH - RISE, 7)
    # radiator on the half landing under the window
    radiator(m, XC, T, 1, zm + 0.75, 1.0, riser=False)


def landing_span(ax):
    """The floor landing along a wall of this axis: plan y for X walls, plan x for Y walls."""
    return (Y_FL, Y_LAND) if ax == 'X' else STAIR_X


def landing_doors():
    """Flat doors on the floor landing: (wall axis, landing face of the wall, normal into the landing, a0, a1)."""
    out = []
    yc = (Y_FL + Y_LAND) / 2
    for d in DOORS:
        if d['kind'] != 'apt':
            continue
        w = WALLS[d['wall']]
        if w[0] == 'X':
            face, n = (w[2], 1) if XC > w[2] else (w[1], -1)
        else:
            face, n = (w[2], 1) if yc > w[2] else (w[1], -1)
        out.append((w[0], face, n, d['a0'], d['a1']))
    return out


def stair_common(m, rnd):
    x0, x1 = STAIR_X
    xa0, xa1 = LANE_A
    xb0, xb1 = LANE_B
    # entrance hall floor and the five steps up to the first floor
    ye = Y_FL - 4 * TREAD
    rise = (PL - VEST_Z) / 5
    pbox(m, x0, T, 0.0, x1, ye, VEST_Z, 'pk_stair_side', 'pk_floor_int')
    for k in range(1, 5):
        pbox(m, xb0, ye + (k - 1) * TREAD, 0.0, xb1, ye + k * TREAD, VEST_Z + k * rise, 'pk_stair_side', 'pk_stair')
    railing(m, xb0 - 0.01, ye, VEST_Z, Y_FL, PL - rise, 4)
    # basement door in the base of the first flight
    pbox(m, x0 + 0.28, Y_MID - 0.04, VEST_Z, x0 + 1.08, Y_MID + 0.01, VEST_Z + 0.85, 'pk_door_base')
    pbox(m, x0 + 0.95, Y_MID - 0.06, VEST_Z + 0.4, x0 + 1.0, Y_MID - 0.04, VEST_Z + 0.48, 'pk_rail')
    # mailboxes on the wall of the entrance hall
    for i in range(3):
        for j in range(5):
            y = 0.55 + j * 0.24
            z = 1.05 + i * 0.3
            pbox(m, x0, y, z, x0 + 0.2, y + 0.22, z + 0.27, 'pk_mailbox', 'pk_mailbox')
            pbox(m, x0 + 0.2, y + 0.03, z + 0.17, x0 + 0.205, y + 0.19, z + 0.2, 'pk_rail')
    pbox(m, xa1, ye, 0.0, xb0, Y_FL, VEST_Z, 'pk_stair_side', 'pk_stair')
    pbox(m, x1 - 0.12, 0.7, 0.45, x1, 1.6, 0.95, 'pk_radiator')
    # bulb over the entrance hall, under the first half landing
    zh = PL + 8 * RISE - 0.2
    m.cyl(XC, by(1.2), zh - 0.12, zh, 0.006, 4, 'pk_rail')
    m.cyl(XC, by(1.2), zh - 0.2, zh - 0.12, 0.035, 8, 'pk_lampshade', r1=0.025)
    # ceiling of the stairwell under the roof, with the hatch
    hx0, hy0, hx1, hy1 = HATCH
    zc = ROOF - SLAB
    for (a0, b0, a1, b1) in ((x0, T, x1, hy0), (x0, hy1, x1, Y_LAND), (x0, hy0, hx0, hy1), (hx1, hy0, x1, hy1)):
        pquad(m, [(a0, b0, zc), (a1, b0, zc), (a1, b1, zc), (a0, b1, zc)], 'pk_ceil_int', (0, 0, -1))
    # steel ladder up to the hatch, against the back wall of the landing
    ztop = floor_z(FLOORS - 1)
    lx0, lx1, ly = LADDER
    for x in (lx0, lx1):
        pbox(m, x - 0.02, ly - 0.02, ztop, x + 0.02, ly + 0.02, zc, 'pk_rail')
        pbox(m, x - 0.02, ly + 0.02, zc - 0.3, x + 0.02, Y_LAND, zc - 0.26, 'pk_rail')
    for i in range(9):
        z = ztop + 0.3 + i * 0.28
        m.htube(lx0, by(ly), z, lx1, by(ly), z, 0.012, 'pk_rail', 4)


# ------------------------------------------------------------------ furniture

FACE = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}


class F2:
    """Placement frame of one piece of furniture. (x, y): middle of its back edge, against the wall.
    face: where its front looks (N toward the entrance facade, S toward the back, E, W).
    Local u runs across the front, v from the wall into the room, z up from the floor. mir mirrors the
    plan around the middle of the section (the R apartment is the L one turned over)."""

    def __init__(self, m, x, y, face, mir=False, z=0.0):
        self.m, self.x, self.y, self.z, self.mir = m, x, y, z, mir
        self.f = FACE[face]
        self.r = (-self.f[1], self.f[0])

    def at(self, du, dv=0.0, dz=0.0):
        """The same frame moved du along the wall (and dv out from it, dz up)."""
        g = F2.__new__(F2)
        g.__dict__.update(self.__dict__)
        g.x = self.x + self.r[0] * du + self.f[0] * dv
        g.y = self.y + self.r[1] * du + self.f[1] * dv
        g.z = self.z + dz
        return g

    def pt(self, u, v):
        x = self.x + self.r[0] * u + self.f[0] * v
        y = self.y + self.r[1] * u + self.f[1] * v
        return (W - x if self.mir else x), y

    def box(self, u0, v0, z0, u1, v1, z1, mat, top=None, bot=None, col=False):
        ax, ay = self.pt(u0, v0)
        bx, by_ = self.pt(u1, v1)
        pbox(self.m, ax, ay, self.z + z0, bx, by_, self.z + z1, mat, top, bot, col)

    def cyl(self, u, v, z0, z1, r, mat, n=8, r1=None, top=None, bot=None):
        x, y = self.pt(u, v)
        self.m.cyl(x, by(y), self.z + z0, self.z + z1, r, n, mat, top, r1, bottom=bot)

    def tube(self, a, b, r, mat, n=6):
        ax, ay = self.pt(a[0], a[1])
        bx, by_ = self.pt(b[0], b[1])
        self.m.tube((ax, by(ay), self.z + a[2]), (bx, by(by_), self.z + b[2]), r, r, mat, n)

    def normal(self, sign=1):
        fx, fy = self.f
        return ((-fx if self.mir else fx) * sign, fy * sign, 0)

    def quad(self, u0, u1, v, z0, z1, mat, uv=True, back=False):
        """Upright quad facing the front (or the back) with 0..1 UVs."""
        pts = [self.pt(u0, v), self.pt(u1, v)]
        p = [(pts[0][0], pts[0][1], self.z + z0), (pts[1][0], pts[1][1], self.z + z0),
             (pts[1][0], pts[1][1], self.z + z1), (pts[0][0], pts[0][1], self.z + z1)]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)] if uv else None
        pquad(self.m, p, mat, self.normal(-1 if back else 1), uvs)

    def flat(self, u0, v0, u1, v1, z, mat):
        """Flat rug on the floor with 0..1 UVs."""
        a, b, c, d = self.pt(u0, v0), self.pt(u1, v0), self.pt(u1, v1), self.pt(u0, v1)
        pquad(self.m, [(a[0], a[1], self.z + z), (b[0], b[1], self.z + z), (c[0], c[1], self.z + z), (d[0], d[1], self.z + z)],
              mat, (0, 0, 1), [(0, 0), (1, 0), (1, 1), (0, 1)])


def legs(F, w, d, h, r=0.02, mat='pk_wood_dark', inset=0.05, v0=0.0):
    for su in (-1, 1):
        for vv in (v0 + inset, v0 + d - inset):
            F.cyl(su * (w / 2 - inset), vv, 0, h, r, mat, 5)


# --- living room

def sofa(F, w=1.95, d=0.9, fab='pk_fabric', frame='pk_veneer', leather=False):
    """Sofa bed: seat, back, wooden side boards (or plain leather arms in the 2000s)."""
    arm = 0.18 if leather else 0.07
    F.box(-w / 2 + arm, 0.2, 0.12, w / 2 - arm, d - 0.02, 0.42, fab, bot='pk_dark')
    F.box(-w / 2 + arm, 0.0, 0.12, w / 2 - arm, 0.24, 0.9, fab)
    for s in (-1, 1):
        u0, u1 = (s * (w / 2 - arm), s * w / 2)
        F.box(min(u0, u1), 0.0, 0.08 if leather else 0.04, max(u0, u1), d, 0.62 if leather else 0.66, fab if leather else frame)
    # the cushions: a seam halfway along
    F.box(-0.006, 0.2, 0.42, 0.006, d - 0.04, 0.425, 'pk_dark')
    F.box(-w / 2, 0.02, 0.0, w / 2, d - 0.04, 0.12, 'pk_dark')
    collide(F, -w / 2, 0, w / 2, d, 0.44)
    collide(F, -w / 2, 0, w / 2, 0.24, 0.9)


def collide(F, u0, v0, u1, v1, z1, z0=0.0):
    ax, ay = F.pt(u0, v0)
    bx, by_ = F.pt(u1, v1)
    pcol(F.m, min(ax, bx), min(ay, by_), F.z + z0, max(ax, bx), max(ay, by_), F.z + z1)


def armchair(F, fab='pk_fabric', leather=False):
    w, d = 0.76, 0.8
    F.box(-0.3, 0.18, 0.15, 0.3, d - 0.04, 0.42, fab)
    F.box(-0.3, 0.0, 0.15, 0.3, 0.2, 0.86, fab)
    for u0, u1 in ((-0.38, -0.3), (0.3, 0.38)):
        F.box(u0, 0.0, 0.15, u1, d, 0.6, fab if leather else 'pk_veneer')
    legs(F, w, d, 0.15, 0.02)
    collide(F, -w / 2, 0, w / 2, d, 0.6)


def stenka(F, L=3.3, tv=True, books=True):
    """The wall unit: wardrobe, glass cabinet with the good dishes and crystal, TV niche, books, cupboards on top."""
    d, h = 0.45, 2.2
    lo, hi = 0.8, 1.82          # the open middle between the low cupboards and the mezzanine
    secs = [('wardrobe', 0.8), ('glass', 0.8)] + ([('tv', 0.85)] if tv else [('glass', 0.85)]) + [('books', L - 2.45)]
    u = -L / 2
    for kind, w in secs:
        u0, u1 = u, u + w
        # mezzanine cupboards along the top of every section
        F.box(u0, 0, hi, u1, d, h, 'pk_veneer', 'pk_veneer')
        F.box(u0 + 0.01, d, hi + 0.02, u0 + w / 2 - 0.003, d + 0.01, h - 0.02, 'pk_veneer_door')
        F.box(u0 + w / 2 + 0.003, d, hi + 0.02, u1 - 0.01, d + 0.01, h - 0.02, 'pk_veneer_door')
        if kind == 'wardrobe':
            F.box(u0, 0, 0.05, u1, d, hi, 'pk_veneer', 'pk_veneer')
            F.box(u0 + 0.01, d, 0.08, u0 + w / 2 - 0.003, d + 0.012, hi - 0.02, 'pk_veneer_door')
            F.box(u0 + w / 2 + 0.003, d, 0.08, u1 - 0.01, d + 0.012, hi - 0.02, 'pk_veneer_door')
            for s_ in (-1, 1):
                F.box(u0 + w / 2 + s_ * 0.05 - 0.008, d + 0.012, 1.0, u0 + w / 2 + s_ * 0.05 + 0.008, d + 0.04, 1.14, 'pk_chrome')
            u = u1
            continue
        # low cupboard with two doors
        F.box(u0, 0, 0.05, u1, d, lo, 'pk_veneer', 'pk_veneer')
        F.box(u0 + 0.01, d, 0.08, u0 + w / 2 - 0.003, d + 0.012, lo - 0.02, 'pk_veneer_door')
        F.box(u0 + w / 2 + 0.003, d, 0.08, u1 - 0.01, d + 0.012, lo - 0.02, 'pk_veneer_door')
        F.box(u0 + w / 2 - 0.06, d + 0.012, lo - 0.2, u0 + w / 2 + 0.06, d + 0.025, lo - 0.18, 'pk_chrome')
        # open frame: back, sides
        F.box(u0, 0, lo, u1, 0.02, hi, 'pk_veneer')
        F.box(u0, 0, lo, u0 + 0.02, d, hi, 'pk_veneer')
        F.box(u1 - 0.02, 0, lo, u1, d, hi, 'pk_veneer')
        if kind == 'glass':
            # glass shelves with the tea set, crystal and a row of plates standing up
            for z in (1.15, 1.48):
                F.box(u0 + 0.02, 0.02, z - 0.008, u1 - 0.02, d - 0.03, z, 'pk_glass_int')
            for i, z in enumerate((lo, 1.15, 1.48)):
                n = int((w - 0.1) / 0.11)
                for k in range(n):
                    uu = u0 + 0.08 + k * 0.11
                    if (k + i) % 3 == 0:
                        F.cyl(uu, d * 0.55, z, z + 0.16, 0.035, 'pk_crystal', 6, r1=0.045)
                    elif (k + i) % 3 == 1:
                        F.box(uu - 0.04, 0.04, z, uu + 0.04, 0.06, z + 0.2, 'pk_dishes')
                    else:
                        F.cyl(uu, d * 0.5, z, z + 0.08, 0.035, 'pk_dishes', 6, r1=0.04)
            F.quad(u0 + 0.02, u1 - 0.02, d + 0.004, lo, hi, 'pk_glass_int', uv=False)
            F.box(u0 + 0.02, d, lo, u1 - 0.02, d + 0.01, lo + 0.02, 'pk_veneer')
            F.box(u0 + w / 2 - 0.004, d, lo, u0 + w / 2 + 0.004, d + 0.01, hi, 'pk_veneer')
        elif kind == 'tv':
            tv_crt(F, u0 + w / 2, 0.06, lo, 0.6, style='sov')
            # a lace doily and a porcelain figure on the TV
            F.box(u0 + 0.15, 0.1, lo + 0.47, u1 - 0.15, 0.4, lo + 0.474, 'pk_linen')
            F.cyl(u0 + w / 2 + 0.15, 0.25, lo + 0.474, lo + 0.6, 0.03, 'pk_dishes', 6, r1=0.015)
        else:
            for z in (lo, 1.15, 1.48):
                F.box(u0 + 0.02, 0.02, z, u1 - 0.02, d - 0.02, z + 0.015, 'pk_veneer', 'pk_veneer')
                F.box(u0 + 0.04, 0.05, z + 0.015, u1 - 0.04 - (0.12 if z > 1 else 0), 0.3, z + 0.015 + 0.24, 'pk_books')
        u = u1
    collide(F, -L / 2, 0, L / 2, d + 0.02, h)


def tv_crt(F, u, v, z, w=0.6, style='sov'):
    """CRT television: a wooden case with a bulging screen in the Soviet flat, black plastic in the 2000s."""
    h, d = w * 0.78, w * 0.8
    case = 'pk_veneer' if style == 'sov' else 'pk_plastic_black'
    F.box(u - w / 2, v + d * 0.35, z, u + w / 2, v + d, z + h, case, case)
    F.box(u - w * 0.35, v, z + h * 0.12, u + w * 0.35, v + d * 0.35, z + h * 0.88, case)
    sw = w * (0.38 if style == 'sov' else 0.42)
    F.quad(u - sw, u + sw * (0.75 if style == 'sov' else 1.0), v + d + 0.004, z + h * 0.18, z + h * 0.86, 'pk_screen_tv')
    if style == 'sov':
        F.box(u + sw * 0.8, v + d, z + h * 0.2, u + w / 2 - 0.03, v + d + 0.01, z + h * 0.85, 'pk_dark')
        for k in range(3):
            F.cyl(u + w * 0.42, v + d + 0.01, z + h * (0.65 - k * 0.18), z + h * (0.65 - k * 0.18) + 0.01, 0.018, 'pk_chrome', 6)


def coffee_table(F, w=1.0, d=0.5, h=0.5, glass=False):
    F.box(-w / 2, 0, h - 0.03, w / 2, d, h, 'pk_glass_int' if glass else 'pk_veneer', bot='pk_veneer')
    F.box(-w / 2 + 0.05, 0.05, h - 0.33, w / 2 - 0.05, d - 0.05, h - 0.31, 'pk_veneer')
    legs(F, w, d, h - 0.03, 0.022)
    collide(F, -w / 2, 0, w / 2, d, h)


def floor_lamp(m, x, y, z, shade='pk_lampshade'):
    m.cyl(x, by(y), z, z + 0.03, 0.16, 8, 'pk_rail')
    m.cyl(x, by(y), z, z + 1.35, 0.012, 4, 'pk_chrome')
    m.cyl(x, by(y), z + 1.3, z + 1.62, 0.24, 8, shade, r1=0.13)
    m.col(x - 0.16, by(y) - 0.16, z, x + 0.16, by(y) + 0.16, z + 1.6)


def chandelier(m, x, y, zc, style='sov'):
    if style == 'sov':
        m.cyl(x, by(y), zc - 0.45, zc, 0.008, 4, 'pk_chrome')
        m.cyl(x, by(y), zc - 0.5, zc - 0.42, 0.05, 6, 'pk_brass')
        for k in range(5):
            a = k * 2 * math.pi / 5
            px, py = x + math.cos(a) * 0.3, y + math.sin(a) * 0.3
            m.tube((x, by(y), zc - 0.46), (px, by(py), zc - 0.4), 0.008, 0.008, 'pk_brass', 4)
            m.cyl(px, by(py), zc - 0.5, zc - 0.36, 0.05, 6, 'pk_lampshade', r1=0.09)
    else:
        m.cyl(x, by(y), zc - 0.07, zc, 0.3, 12, 'pk_lampshade', r1=0.3, bottom='pk_lampshade')
        m.cyl(x, by(y), zc - 0.075, zc - 0.07, 0.31, 12, 'pk_chrome')


def plafond(m, x, y, zc, r=0.15):
    m.cyl(x, by(y), zc - 0.12, zc, r * 0.7, 8, 'pk_lampshade', r1=r, bottom='pk_lampshade')


def bed(F, w=1.6, L=2.0, fab='pk_bedding', head=True, style='sov'):
    """Bed with the headboard against the wall (v = 0)."""
    frame = 'pk_veneer' if style == 'sov' else 'pk_veneer_light'
    F.box(-w / 2, 0, 0.12, w / 2, L, 0.36, frame)
    F.box(-w / 2 + 0.03, 0.03, 0.36, w / 2 - 0.03, L - 0.03, 0.5, 'pk_linen')
    F.box(-w / 2 + 0.01, 0.45, 0.47, w / 2 - 0.01, L - 0.01, 0.55, fab)
    for s in ((-1, 1) if w > 1.2 else (0,)):
        uc = s * w / 4
        F.box(uc - 0.3 if w > 1.2 else -0.32, 0.06, 0.5, uc + 0.3 if w > 1.2 else 0.32, 0.4, 0.62, 'pk_linen')
    if head:
        F.box(-w / 2, 0, 0.0, w / 2, 0.05, 1.0 if style == 'sov' else 0.9, frame)
    F.box(-w / 2, L - 0.04, 0.0, w / 2, L, 0.6 if style == 'sov' else 0.4, frame)
    collide(F, -w / 2, 0, w / 2, L, 0.55)
    collide(F, -w / 2, 0, w / 2, 0.06, 1.0)


def bed_along(F, L=2.0, w=0.9, fab='pk_bedding', style='sov'):
    """Single bed with its long side against the wall: u runs along the bed, the head at -u."""
    frame = 'pk_veneer' if style == 'sov' else 'pk_veneer_light'
    F.box(-L / 2, 0, 0.12, L / 2, w, 0.36, frame)
    F.box(-L / 2 + 0.03, 0.03, 0.36, L / 2 - 0.03, w - 0.03, 0.5, 'pk_linen')
    F.box(-L / 2 + 0.45, 0.01, 0.47, L / 2 - 0.01, w - 0.01, 0.55, fab)
    F.box(-L / 2 + 0.06, 0.15, 0.5, -L / 2 + 0.42, w - 0.15, 0.62, 'pk_linen')
    F.box(-L / 2, 0, 0, -L / 2 + 0.05, w, 0.85, frame)
    F.box(L / 2 - 0.05, 0, 0, L / 2, w, 0.6, frame)
    collide(F, -L / 2, 0, L / 2, w, 0.55)


def nightstand(F, lamp=True):
    F.box(-0.2, 0, 0, 0.2, 0.38, 0.5, 'pk_veneer', 'pk_veneer')
    F.box(-0.18, 0.38, 0.28, 0.18, 0.39, 0.46, 'pk_veneer_door')
    F.box(-0.04, 0.39, 0.36, 0.04, 0.405, 0.38, 'pk_chrome')
    if lamp:
        F.cyl(0, 0.2, 0.5, 0.52, 0.07, 'pk_brass', 6)
        F.cyl(0, 0.2, 0.52, 0.72, 0.012, 'pk_brass', 4)
        F.cyl(0, 0.2, 0.68, 0.84, 0.11, 'pk_lampshade_f', 8, r1=0.07)
    collide(F, -0.2, 0, 0.2, 0.38, 0.5)


def wardrobe(F, w=1.2, d=0.6, h=1.9, sliding=False):
    if sliding:
        F.box(-w / 2, 0, 0, w / 2, d, 2.4, 'pk_veneer_light', 'pk_veneer_light')
        n = 2 if w < 1.8 else 3
        for i in range(n):
            u0 = -w / 2 + 0.03 + i * (w - 0.06) / n
            u1 = u0 + (w - 0.06) / n
            F.quad(u0 + 0.01, u1 - 0.01, d + 0.012, 0.08, 2.32, 'pk_mirror' if i % 2 == 0 else 'pk_veneer_light', uv=True)
            F.box(u1 - 0.01, d, 0.05, u1 + 0.01, d + 0.02, 2.35, 'pk_chrome')
        collide(F, -w / 2, 0, w / 2, d + 0.02, 2.4)
        return
    F.box(-w / 2, 0, 0.08, w / 2, d, h, 'pk_veneer', 'pk_veneer')
    F.box(-w / 2 + 0.01, d, 0.1, w / 2 - 0.01, d + 0.012, h - 0.02, 'pk_veneer_door')
    F.box(-0.004, d + 0.012, 0.12, 0.004, d + 0.016, h - 0.04, 'pk_dark')
    for s in (-1, 1):
        F.box(s * 0.06 - 0.008, d + 0.012, 0.95, s * 0.06 + 0.008, d + 0.04, 1.1, 'pk_chrome')
    legs(F, w, d, 0.08, 0.02)
    # a suitcase on top
    F.box(-w / 2 + 0.1, 0.05, h, -w / 2 + 0.75, 0.5, h + 0.18, 'pk_leather')
    collide(F, -w / 2, 0, w / 2, d + 0.02, h + 0.2)


def trumo(F):
    """Dressing table with a three-part mirror."""
    F.box(-0.5, 0, 0.0, 0.5, 0.42, 0.75, 'pk_veneer', 'pk_veneer')
    F.box(-0.48, 0.42, 0.45, 0.48, 0.43, 0.72, 'pk_veneer_door')
    F.box(-0.3, 0.02, 0.75, 0.3, 0.05, 1.65, 'pk_veneer')
    F.quad(-0.27, 0.27, 0.058, 0.8, 1.6, 'pk_mirror')
    for s in (-1, 1):
        F.box(s * 0.3 if s > 0 else -0.5, 0.02, 0.75, 0.5 if s > 0 else -0.3, 0.05, 1.35, 'pk_veneer')
        F.quad(s * 0.31 if s > 0 else -0.48, 0.48 if s > 0 else -0.31, 0.058, 0.8, 1.3, 'pk_mirror')
    # perfume and a jewellery box
    F.cyl(-0.2, 0.25, 0.75, 0.86, 0.025, 'pk_crystal', 6)
    F.cyl(-0.12, 0.28, 0.75, 0.83, 0.02, 'pk_crystal', 6)
    F.box(0.1, 0.15, 0.75, 0.25, 0.27, 0.82, 'pk_veneer_door')
    collide(F, -0.5, 0, 0.5, 0.42, 0.75)


def chair(F, u, v, face_back=False, mat='pk_veneer'):
    """Wooden chair centered at (u, v) of the frame, its back toward -v (or +v)."""
    s = -1 if face_back else 1
    F.box(u - 0.2, v - 0.2, 0.43, u + 0.2, v + 0.2, 0.46, mat, bot=mat)
    for a in (-1, 1):
        for b in (-1, 1):
            F.cyl(u + a * 0.17, v + b * 0.17, 0, 0.43, 0.015, mat, 4)
    vb = v - s * 0.19
    F.box(u - 0.19, min(vb, vb + s * 0.03), 0.46, u + 0.19, max(vb, vb + s * 0.03), 0.9, mat)
    collide(F, u - 0.2, v - 0.2, u + 0.2, v + 0.2, 0.46)


def stool(F, u, v):
    F.box(u - 0.16, v - 0.16, 0.42, u + 0.16, v + 0.16, 0.45, 'pk_wood', bot='pk_wood')
    for a in (-1, 1):
        for b in (-1, 1):
            F.box(u + a * 0.13 - 0.018, v + b * 0.13 - 0.018, 0, u + a * 0.13 + 0.018, v + b * 0.13 + 0.018, 0.42, 'pk_wood')
    F.box(u - 0.13, v - 0.005, 0.12, u + 0.13, v + 0.005, 0.15, 'pk_wood')
    collide(F, u - 0.16, v - 0.16, u + 0.16, v + 0.16, 0.45)


def office_chair(F, u, v):
    for k in range(5):
        a = k * 2 * math.pi / 5
        F.tube((u, v, 0.08), (u + math.cos(a) * 0.3, v + math.sin(a) * 0.3, 0.05), 0.018, 'pk_plastic_black', 4)
    F.cyl(u, v, 0.08, 0.42, 0.025, 'pk_chrome', 6)
    F.box(u - 0.23, v - 0.22, 0.42, u + 0.23, v + 0.22, 0.5, 'pk_fabric_dark')
    F.box(u - 0.21, v + 0.2, 0.55, u + 0.21, v + 0.26, 1.05, 'pk_fabric_dark')
    F.box(u - 0.02, v + 0.18, 0.45, u + 0.02, v + 0.22, 0.6, 'pk_plastic_black')
    collide(F, u - 0.3, v - 0.3, u + 0.3, v + 0.3, 0.5)


def desk(F, w=1.2, d=0.6, style='sov'):
    top = 'pk_veneer' if style == 'sov' else 'pk_veneer_light'
    F.box(-w / 2, 0, 0.72, w / 2, d, 0.75, top, bot=top)
    F.box(w / 2 - 0.42, 0.02, 0.0, w / 2 - 0.02, d - 0.02, 0.72, top)
    for i in range(3):
        z = 0.08 + i * 0.21
        F.box(w / 2 - 0.4, d - 0.02, z, w / 2 - 0.04, d - 0.01, z + 0.19, 'pk_veneer_door')
        F.box(w / 2 - 0.25, d - 0.01, z + 0.12, w / 2 - 0.19, d + 0.01, z + 0.14, 'pk_chrome')
    F.box(-w / 2 + 0.02, 0.02, 0.0, -w / 2 + 0.05, d - 0.02, 0.72, top)
    F.box(-w / 2 + 0.05, 0.02, 0.3, w / 2 - 0.42, 0.04, 0.7, top)
    collide(F, -w / 2, 0, w / 2, d, 0.75)


def table_lamp(F, u, v, z):
    F.cyl(u, v, z, z + 0.03, 0.08, 'pk_paint_green', 6)
    F.tube((u, v, z + 0.03), (u + 0.05, v + 0.12, z + 0.38), 0.008, 'pk_chrome', 4)
    F.cyl(u + 0.05, v + 0.14, z + 0.3, z + 0.42, 0.09, 'pk_lampshade_f', 8, r1=0.04)


def pc(F, u, v, z, tower_u=None):
    """Beige computer of the early 2000s: CRT monitor showing Windows XP, keyboard, mouse, speakers, tower."""
    F.box(u - 0.06, v + 0.02, z, u + 0.06, v + 0.14, z + 0.04, 'pk_plastic_beige')
    F.box(u - 0.17, v + 0.0, z + 0.06, u + 0.17, v + 0.22, z + 0.36, 'pk_plastic_beige')
    F.box(u - 0.21, v + 0.22, z + 0.04, u + 0.21, v + 0.36, z + 0.42, 'pk_plastic_beige')
    F.quad(u - 0.17, u + 0.17, v + 0.366, z + 0.09, z + 0.36, 'pk_screen_xp')
    F.box(u - 0.23, v + 0.4, z, u + 0.23, v + 0.55, z + 0.03, 'pk_plastic_beige')
    F.box(u - 0.21, v + 0.41, z + 0.03, u + 0.21, v + 0.53, z + 0.035, 'pk_keys')
    F.box(u + 0.3, v + 0.42, z, u + 0.5, v + 0.58, z + 0.003, 'pk_paint_blue')
    F.box(u + 0.37, v + 0.47, z + 0.003, u + 0.43, v + 0.53, z + 0.025, 'pk_plastic_beige')
    for s in (-1, 1):
        F.box(u + s * 0.32 - 0.05, v + 0.1, z, u + s * 0.32 + 0.05, v + 0.18, z + 0.18, 'pk_plastic_black')
    if tower_u is not None:
        F.box(tower_u - 0.1, v + 0.05, 0, tower_u + 0.1, v + 0.5, 0.43, 'pk_plastic_beige', 'pk_plastic_beige')
        F.box(tower_u - 0.08, v + 0.5, 0.3, tower_u + 0.08, v + 0.505, 0.4, 'pk_dark')
        F.box(tower_u - 0.02, v + 0.5, 0.1, tower_u + 0.02, v + 0.505, 0.14, 'pk_glow_green')


def tv_stand(F, w=1.1, tv_w=0.72):
    F.box(-w / 2, 0, 0.0, w / 2, 0.5, 0.5, 'pk_plastic_black', 'pk_plastic_black')
    F.box(-w / 2 + 0.03, 0.5, 0.06, w / 2 - 0.03, 0.505, 0.44, 'pk_glass_int')
    F.box(-0.22, 0.08, 0.26, 0.22, 0.4, 0.34, 'pk_plastic_black')
    F.box(-0.2, 0.4, 0.28, -0.12, 0.401, 0.3, 'pk_glow_green')
    tv_crt(F, 0, 0.02, 0.5, tv_w, style='xp')
    collide(F, -w / 2, 0, w / 2, 0.5, 0.5)


def bookshelf(F, w=0.8, d=0.32, h=1.9, style='sov'):
    mat = 'pk_veneer' if style == 'sov' else 'pk_veneer_light'
    F.box(-w / 2, 0, 0, -w / 2 + 0.02, d, h, mat)
    F.box(w / 2 - 0.02, 0, 0, w / 2, d, h, mat)
    F.box(-w / 2, 0, 0, w / 2, 0.01, h, mat)
    n = 5
    for i in range(n + 1):
        z = i * (h - 0.02) / n
        F.box(-w / 2, 0, z, w / 2, d, z + 0.02, mat, mat)
        if i < n:
            F.box(-w / 2 + 0.03, 0.02, z + 0.02, w / 2 - 0.03 - (0.15 if i % 2 else 0), d - 0.06, z + 0.02 + 0.22 + 0.04 * (i % 2), 'pk_books')
    collide(F, -w / 2, 0, w / 2, d, h)


def chest(F, w=0.9, d=0.45, h=0.85, tv=False):
    F.box(-w / 2, 0, 0.05, w / 2, d, h, 'pk_veneer_light', 'pk_veneer_light')
    for i in range(3):
        z = 0.08 + i * 0.26
        F.box(-w / 2 + 0.02, d, z, w / 2 - 0.02, d + 0.01, z + 0.24, 'pk_veneer_door')
        F.box(-0.08, d + 0.01, z + 0.15, 0.08, d + 0.025, z + 0.17, 'pk_chrome')
    if tv:
        tv_crt(F, 0, 0.0, h, 0.5, style='xp')
    collide(F, -w / 2, 0, w / 2, d, h)


def wall_carpet(F, w=2.0, z0=0.9, z1=2.1):
    F.box(-w / 2, 0, z0, w / 2, 0.01, z1, 'pk_carpet_edge')
    F.quad(-w / 2, w / 2, 0.012, z0, z1, 'pk_carpet')


def curtains(m, side, x0, x1, zf, style='sov', short=False):
    """Rod, net curtain over the whole window and heavy drapes at the sides."""
    if side == 'front':
        yw, s = T, 1
    else:
        yw, s = D - T, -1
    zt = zf + 2.38
    pbox(m, x0 - 0.3, yw + s * 0.11, zt - 0.02, x1 + 0.3, yw + s * 0.13, zt, 'pk_brass' if style == 'sov' else 'pk_chrome')
    z0 = zf + (0.85 if short else 0.05)
    y = yw + s * 0.1
    pquad(m, [(x0 - 0.1, y, z0), (x1 + 0.1, y, z0), (x1 + 0.1, y, zt - 0.03), (x0 - 0.1, y, zt - 0.03)], 'pk_tulle', (0, s, 0),
          [(0, 0), (1, 0), (1, 1), (0, 1)])
    if short:
        return
    for xa, xb in ((x0 - 0.32, x0 + 0.02), (x1 - 0.02, x1 + 0.32)):
        n = 4
        for i in range(n):
            a = xa + i * (xb - xa) / n
            b = a + (xb - xa) / n
            d0 = 0.03 + (0.03 if i % 2 else 0)
            pbox(m, a, yw + s * (0.12 + d0), zf + 0.02, b, yw + s * (0.14 + d0), zt - 0.03, 'pk_drape')


def plants(m, side, x0, x1, zf, rnd):
    """Pots on the window sill: aloe, a geranium, violets."""
    y = T + 0.12 if side == 'front' else D - T - 0.12
    n = rnd.randint(1, 3)
    for i in range(n):
        x = x0 + 0.2 + (x1 - x0 - 0.4) * (i + 0.5) / n + rnd.uniform(-0.05, 0.05)
        z = zf + 0.83
        m.cyl(x, by(y), z, z + 0.12, 0.05, 6, 'pk_terracotta', r1=0.065)
        h = rnd.uniform(0.12, 0.3)
        for k in range(3):
            a = k * math.pi / 3 + rnd.uniform(0, 0.5)
            dx, dy = math.cos(a) * 0.09, math.sin(a) * 0.09
            m.face([(x - dx, by(y - dy), z + 0.1), (x + dx, by(y + dy), z + 0.1), (x + dx * 0.6, by(y + dy * 0.6), z + 0.1 + h),
                    (x - dx * 0.6, by(y - dy * 0.6), z + 0.1 + h)], 'pk_plant', [(0, 0), (1, 0), (1, 1), (0, 1)])


# --- kitchen and bath

def fridge_zil(F):
    F.box(-0.3, 0, 0.06, 0.3, 0.6, 1.36, 'pk_enamel', bot='pk_enamel')
    m = F.m
    ax, ay = F.pt(-0.29, 0.01)
    bx, by_ = F.pt(0.29, 0.6)
    m.pillow(min(ax, bx), by(min(ay, by_)), F.z + 1.33, max(ax, bx), by(max(ay, by_)), F.z + 1.47, 'pk_enamel', 1, 0.35, 3, 0.0)
    F.box(-0.29, 0.6, 0.1, 0.29, 0.612, 1.32, 'pk_enamel')
    F.box(0.2, 0.612, 0.85, 0.25, 0.66, 1.05, 'pk_chrome')
    F.box(-0.12, 0.612, 1.2, 0.04, 0.618, 1.24, 'pk_chrome')
    F.box(-0.3, 0.02, 0.0, 0.3, 0.55, 0.06, 'pk_dark')
    # a radio and a bread box on top
    F.box(-0.2, 0.15, 1.45, 0.1, 0.4, 1.6, 'pk_plastic_brown')
    collide(F, -0.3, 0, 0.3, 0.66, 1.47)


def fridge_modern(F):
    F.box(-0.3, 0, 0.02, 0.3, 0.64, 1.85, 'pk_enamel', 'pk_enamel')
    F.box(-0.295, 0.64, 0.04, 0.295, 0.652, 1.2, 'pk_enamel')
    F.box(-0.295, 0.64, 1.21, 0.295, 0.652, 1.83, 'pk_enamel')
    for z0, z1 in ((0.8, 1.15), (1.25, 1.5)):
        F.box(0.22, 0.652, z0, 0.25, 0.68, z1, 'pk_plastic_grey')
    # microwave on top
    F.box(-0.25, 0.1, 1.85, 0.25, 0.48, 2.12, 'pk_plastic_grey', 'pk_plastic_grey')
    F.quad(-0.22, 0.08, 0.486, 1.89, 2.08, 'pk_dark', uv=False)
    collide(F, -0.3, 0, 0.3, 0.68, 1.85)


def stove(F, oven_glass=True, kettle=True, style='sov'):
    """Gas stove: white enamel, four burners, oven, a kettle on it."""
    F.box(-0.25, 0, 0.05, 0.25, 0.6, 0.85, 'pk_enamel', 'pk_stove_top')
    F.box(-0.25, 0.0, 0.85, 0.25, 0.04, 1.0 if style == 'sov' else 0.9, 'pk_enamel')
    for a in (-1, 1):
        for b in (0.18, 0.42):
            F.cyl(a * 0.12, b, 0.85, 0.87, 0.055, 'pk_rail', 8)
            F.cyl(a * 0.12, b, 0.87, 0.875, 0.035, 'pk_metal', 8)
    F.box(-0.22, 0.6, 0.18, 0.22, 0.612, 0.62, 'pk_enamel')
    F.quad(-0.15, 0.15, 0.62, 0.32, 0.55, 'pk_dark', uv=False)
    F.box(-0.18, 0.612, 0.6, 0.18, 0.64, 0.61, 'pk_chrome')
    for k in range(4):
        F.cyl(-0.18 + k * 0.12, 0.62, 0.72, 0.74, 0.02, 'pk_plastic_black', 6)
    F.box(-0.25, 0.0, 0.0, 0.25, 0.58, 0.05, 'pk_dark')
    if kettle:
        F.cyl(0.12, 0.18, 0.875, 1.05, 0.09, 'pk_kettle', 8, r1=0.07)
        F.cyl(0.12, 0.18, 1.05, 1.08, 0.03, 'pk_rail', 6)
        F.tube((0.12, 0.25, 0.92), (0.12, 0.33, 1.02), 0.012, 'pk_kettle', 4)
        F.cyl(-0.12, 0.42, 0.875, 1.0, 0.11, 'pk_enamel_pot', 8)
    collide(F, -0.25, 0, 0.25, 0.64, 0.9)


def sink_cabinet(F, style='sov'):
    body = 'pk_enamel' if style == 'sov' else 'pk_kitchen'
    F.box(-0.3, 0, 0.06, 0.3, 0.58, 0.82, body, body)
    F.box(-0.29, 0.58, 0.1, -0.005, 0.59, 0.8, body)
    F.box(0.005, 0.58, 0.1, 0.29, 0.59, 0.8, body)
    F.box(-0.3, 0, 0.82, 0.3, 0.6, 0.86, 'pk_chrome' if style == 'sov' else 'pk_counter')
    F.box(-0.2, 0.12, 0.86, 0.2, 0.48, 0.866, 'pk_sink_well')
    F.cyl(0, 0.06, 0.86, 1.05, 0.012, 'pk_chrome', 6)
    F.tube((0, 0.06, 1.05), (0, 0.22, 1.02), 0.012, 'pk_chrome', 4)
    for s in (-1, 1):
        F.cyl(s * 0.07, 0.05, 0.94, 0.97, 0.022, 'pk_chrome', 6)
    F.box(-0.3, 0.0, 0.0, 0.3, 0.55, 0.06, 'pk_dark')
    collide(F, -0.3, 0, 0.3, 0.6, 0.86)


def gas_heater(F):
    """Gas water heater (kolonka) over the sink with its flue going up."""
    F.box(-0.17, 0.0, 1.3, 0.17, 0.24, 1.95, 'pk_enamel', 'pk_enamel', 'pk_enamel')
    F.quad(-0.05, 0.05, 0.245, 1.45, 1.53, 'pk_glow_flame', uv=False)
    F.cyl(0.08, 0.242, 1.38, 1.4, 0.02, 'pk_plastic_black', 6)
    F.cyl(0, 0.12, 1.95, 2.48, 0.06, 'pk_metal', 8)
    F.tube((-0.12, 0.08, 1.3), (-0.12, 0.08, 1.05), 0.012, 'pk_chrome', 4)


def wall_cabinet(F, w, z0=1.55, z1=2.15, d=0.32, mat='pk_veneer'):
    F.box(-w / 2, 0, z0, w / 2, d, z1, mat, mat, mat)
    F.box(-0.004, d, z0 + 0.03, 0.004, d + 0.004, z1 - 0.03, 'pk_dark')
    for s in (-1, 1):
        F.box(s * 0.05 - 0.008, d, z0 + 0.06, s * 0.05 + 0.008, d + 0.02, z0 + 0.16, 'pk_chrome')


def kitchen_run(F, L, z_top=0.86):
    """2000s kitchen: base cabinets and a counter along a wall, u from -L/2 to L/2."""
    F.box(-L / 2, 0, 0.08, L / 2, 0.58, z_top - 0.04, 'pk_kitchen', 'pk_kitchen')
    n = max(1, int(round(L / 0.45)))
    for i in range(n):
        u0 = -L / 2 + i * L / n
        F.box(u0 + 0.005, 0.58, 0.1, u0 + L / n - 0.005, 0.592, z_top - 0.06, 'pk_kitchen_door')
        F.box(u0 + L / n / 2 - 0.06, 0.592, z_top - 0.16, u0 + L / n / 2 + 0.06, 0.605, z_top - 0.14, 'pk_chrome')
    F.box(-L / 2, 0, z_top - 0.04, L / 2, 0.62, z_top, 'pk_counter', 'pk_counter')
    F.box(-L / 2, 0, 0, L / 2, 0.52, 0.08, 'pk_dark')
    collide(F, -L / 2, 0, L / 2, 0.62, z_top)


def kitchen_table(F, w=0.9, d=0.6, oilcloth=True):
    F.box(-w / 2, 0, 0.72, w / 2, d, 0.75, 'pk_oilcloth' if oilcloth else 'pk_veneer_light', bot='pk_wood')
    if oilcloth:
        F.box(-w / 2 - 0.01, -0.01, 0.62, w / 2 + 0.01, d + 0.01, 0.72, 'pk_oilcloth')
    legs(F, w, d, 0.72, 0.022, 'pk_wood')
    # a sugar bowl and cups
    F.cyl(-0.15, d / 2, 0.75, 0.83, 0.05, 'pk_dishes', 6)
    F.cyl(0.12, d / 2 - 0.1, 0.75, 0.82, 0.035, 'pk_dishes', 6)
    collide(F, -w / 2, 0, w / 2, d, 0.75)


def bathtub(F, L=1.5, w=0.7):
    """Cast iron tub along the wall: u along the tub, v across."""
    h = 0.58
    F.box(-L / 2, 0, 0.0, L / 2, 0.05, h, 'pk_enamel', 'pk_enamel')
    F.box(-L / 2, w - 0.06, 0.0, L / 2, w, h, 'pk_enamel', 'pk_enamel')
    F.box(-L / 2, 0.05, 0.0, -L / 2 + 0.07, w - 0.06, h, 'pk_enamel', 'pk_enamel')
    F.box(L / 2 - 0.07, 0.05, 0.0, L / 2, w - 0.06, h, 'pk_enamel', 'pk_enamel')
    F.box(-L / 2 + 0.07, 0.05, 0.0, L / 2 - 0.07, w - 0.06, 0.18, 'pk_enamel', 'pk_tub_inside')
    # mixer with a long spout and the shower hose hanging on the wall
    F.box(-L / 2 + 0.55, 0.0, h + 0.15, -L / 2 + 0.75, 0.05, h + 0.2, 'pk_chrome')
    F.tube((-L / 2 + 0.65, 0.05, h + 0.17), (-L / 2 + 0.65, 0.3, h + 0.15), 0.012, 'pk_chrome', 4)
    F.tube((-L / 2 + 0.6, 0.05, h + 0.17), (-L / 2 + 0.3, 0.05, h + 1.3), 0.012, 'pk_chrome', 4)
    F.cyl(-L / 2 + 0.3, 0.06, h + 1.3, h + 1.4, 0.04, 'pk_chrome', 6)
    # basin and a wash bowl on the edge
    F.cyl(L / 2 - 0.25, w / 2, 0.18, 0.3, 0.2, 'pk_enamel_pot', 8, r1=0.24)
    collide(F, -L / 2, 0, L / 2, w, h)


def toilet(F):
    F.box(-0.18, 0.0, 0.42, 0.18, 0.18, 0.78, 'pk_enamel', 'pk_enamel')
    F.box(-0.04, 0.18, 0.7, 0.04, 0.2, 0.74, 'pk_chrome')
    F.box(-0.13, 0.15, 0.0, 0.13, 0.62, 0.38, 'pk_enamel', 'pk_enamel')
    F.box(-0.18, 0.18, 0.38, 0.18, 0.65, 0.41, 'pk_plastic_black', 'pk_plastic_black')
    F.box(-0.17, 0.0, 0.78, 0.17, 0.19, 0.8, 'pk_enamel')
    collide(F, -0.18, 0, 0.18, 0.65, 0.41)
    collide(F, -0.18, 0, 0.18, 0.2, 0.8)


def bath_sink(F, cabinet=False):
    if cabinet:
        F.box(-0.25, 0, 0.0, 0.25, 0.42, 0.78, 'pk_kitchen', 'pk_kitchen')
    else:
        F.cyl(0, 0.2, 0.0, 0.72, 0.07, 'pk_enamel', 6)
    F.box(-0.25, 0, 0.72, 0.25, 0.45, 0.85, 'pk_enamel', 'pk_enamel')
    F.box(-0.18, 0.1, 0.85, 0.18, 0.38, 0.856, 'pk_sink_well')
    F.cyl(0, 0.04, 0.85, 1.0, 0.012, 'pk_chrome', 6)
    F.tube((0, 0.04, 1.0), (0, 0.16, 0.97), 0.01, 'pk_chrome', 4)
    F.quad(-0.22, 0.22, 0.012, 1.15, 1.7, 'pk_mirror')
    F.box(-0.24, 0, 1.08, 0.24, 0.12, 1.1, 'pk_glass_int')
    F.cyl(-0.12, 0.06, 1.1, 1.2, 0.03, 'pk_paint_blue', 6)
    F.cyl(0.1, 0.06, 1.1, 1.22, 0.025, 'pk_paint_red', 6)
    collide(F, -0.25, 0, 0.25, 0.45, 0.85)


def towel_rail(F, z=1.1):
    F.tube((-0.25, 0.06, z), (0.25, 0.06, z), 0.016, 'pk_chrome', 6)
    F.tube((-0.25, 0.06, z + 0.4), (0.25, 0.06, z + 0.4), 0.016, 'pk_chrome', 6)
    for s in (-1, 1):
        F.tube((s * 0.25, 0.06, z), (s * 0.25, 0.06, z + 0.4), 0.016, 'pk_chrome', 6)
    F.box(-0.18, 0.04, z + 0.05, 0.05, 0.09, z + 0.42, 'pk_towel')


def coat_rack(F, L=1.5):
    """Hooks with coats, hats on the shelf above, shoes under."""
    F.box(-L / 2, 0, 1.55, L / 2, 0.02, 1.7, 'pk_veneer')
    F.box(-L / 2, 0, 1.78, L / 2, 0.28, 1.8, 'pk_veneer', 'pk_veneer', 'pk_veneer')
    n = int(L / 0.32)
    for i in range(n):
        u = -L / 2 + (i + 0.5) * L / n
        F.box(u - 0.01, 0.02, 1.6, u + 0.01, 0.08, 1.62, 'pk_chrome')
        if i % 3 != 2:
            mat = ('pk_coat_a', 'pk_coat_b', 'pk_coat_c')[i % 3]
            F.box(u - 0.17, 0.03, 0.75 + (i % 2) * 0.12, u + 0.17, 0.26, 1.6, mat)
            F.box(u - 0.15, 0.25, 1.3, u + 0.15, 0.28, 1.58, mat)
    F.box(-L / 2 + 0.1, 0.03, 1.8, -L / 2 + 0.4, 0.25, 1.92, 'pk_coat_c')
    F.cyl(L / 2 - 0.3, 0.15, 1.8, 1.9, 0.12, 'pk_fur', 8, r1=0.1)
    F.box(-L / 2, 0, 0.0, L / 2, 0.3, 0.02, 'pk_veneer')
    for i in range(int(L / 0.22)):
        u = -L / 2 + 0.11 + i * 0.22
        F.box(u - 0.05, 0.03, 0.02, u + 0.05, 0.3, 0.12 + (0.25 if i % 3 == 0 else 0), 'pk_leather')
    collide(F, -L / 2, 0, L / 2, 0.3, 1.95)


def mirror_shelf(F, phone=True):
    F.quad(-0.25, 0.25, 0.017, 1.05, 1.8, 'pk_mirror')
    F.box(-0.28, 0, 1.02, 0.28, 0.01, 1.83, 'pk_veneer')
    F.box(-0.25, 0, 0.92, 0.25, 0.2, 0.95, 'pk_veneer', 'pk_veneer', 'pk_veneer')
    if phone:
        F.box(-0.1, 0.03, 0.95, 0.1, 0.18, 1.02, 'pk_plastic_red')
        F.box(-0.11, 0.06, 1.02, 0.11, 0.13, 1.06, 'pk_plastic_red')
        F.cyl(0, 0.12, 1.02, 1.03, 0.04, 'pk_paper', 6)


def wall_clock(F, z=1.95):
    ax, ay = F.pt(0, 0.015)
    F.m.tube((ax, by(ay), F.z + z), (ax + (F.normal()[0]) * 0.03, by(ay + F.normal()[1] * 0.03), F.z + z), 0.13, 0.13, 'pk_clock', 10)


def radio_point(F, z=1.6):
    """The wired radio every Soviet kitchen had on the wall."""
    F.box(-0.12, 0, z, 0.12, 0.09, z + 0.16, 'pk_plastic_brown', 'pk_plastic_brown')
    F.quad(-0.1, 0.02, 0.095, z + 0.03, z + 0.13, 'pk_grille')
    F.cyl(0.07, 0.092, z + 0.07, z + 0.09, 0.02, 'pk_paper', 6)


# ------------------------------------------------------------------ rooms

def sink_insert(F):
    F.box(-0.25, 0.1, 0.86, 0.25, 0.5, 0.866, 'pk_sink_well')
    F.cyl(0, 0.05, 0.86, 1.08, 0.014, 'pk_chrome', 6)
    F.tube((0, 0.05, 1.08), (0, 0.25, 1.02), 0.012, 'pk_chrome', 4)


STYLES = ('sov', 'xp', 'eu', 'mod', 'old')


def left_wing(m, st, rnd, mir):
    """Kitchen, bath and hall of L (or of R, the same rooms turned over)."""
    import rooms
    mx = (lambda x: W - x) if mir else (lambda x: x)
    rooms.kitchen(m, st, rnd, F2(m, 3.27, 0.4, 'E', mir), 1.92, F2(m, 4.8, 0.55, 'S', mir), (mx(4.8), 1.35),
                  radio=F2(m, 6.33, 1.0, 'W', mir), clock=F2(m, 6.33, 1.8, 'W', mir))
    rooms.window_dressing(m, st, rnd, 'front', 10.6 if mir else 4.2, 11.8 if mir else 5.4, short=True)
    rooms.bath(m, st, F2(m, 3.27, 3.21, 'E', mir), F2(m, 4.19, 2.43, 'S', mir), F2(m, 4.7, 2.43, 'S', mir),
               rail=F2(m, 4.97, 2.75, 'W', mir), lamp=(mx(4.4), 3.4),
               line=(min(mx(3.35), mx(4.9)), max(mx(3.35), mx(4.9)), 3.75, CEIL))
    m.cyl(mx(3.33), by(2.5), 0.0, CEIL, 0.03, 6, 'pk_metal')
    m.cyl(mx(3.42), by(2.5), 0.0, CEIL, 0.025, 6, 'pk_metal')
    pbox(m, min(mx(4.95), mx(4.45)), 2.88, 0.0, max(mx(4.95), mx(4.45)), 3.3, 0.01, 'pk_mat')
    rooms.hall(m, st, F2(m, 4.12, 4.08, 'S', mir), F2(m, 6.33, 3.05, 'W', mir), (mx(5.6), 4.6))
    pbox(m, min(mx(6.3), mx(5.6)), 4.45, 0.0, max(mx(6.3), mx(5.6)), 5.2, 0.01, 'pk_mat')


def furnish_L(m, st):
    import rooms
    rnd = random.Random(11 + STYLES.index(st) * 7)
    left_wing(m, st, rnd, False)
    rooms.living(m, st, rnd, F2(m, 6.33, 8.25, 'W'), F2(m, 3.27, 8.2, 'E'), F2(m, 4.35, 8.2, 'E'), (4.8, 8.36),
                 unit_len=3.3, unit2=F2(m, 6.33, 9.6, 'W'), corner=F2(m, 4.98, 10.72, 'N'), desk=F2(m, 5.25, 10.92, 'N'),
                 rug=F2(m, 4.8, 7.0, 'S'), floorlamp=(3.5, 9.62))
    rooms.window_dressing(m, st, rnd, 'back', 3.65, 5.8)
    rooms.bedroom(m, st, rnd, F2(m, 0.08, 8.2, 'E'), F2(m, 1.09, 5.67, 'S'), F2(m, 3.13, 10.0, 'W'), (1.6, 8.36),
                  ward_max=2.0, carpet=F2(m, 0.08, 8.2, 'E'))
    rooms.window_dressing(m, st, rnd, 'back', 0.85, 2.35, plants=False)
    rooms.small_room(m, st, rnd, F2(m, 0.08, 3.2, 'E'), F2(m, 1.55, 0.52, 'S'), F2(m, 3.13, 1.7, 'W'),
                     F2(m, 0.68, 5.53, 'N'), (1.6, 2.94), rug=F2(m, 1.6, 2.0, 'S'))
    rooms.window_dressing(m, st, rnd, 'front', 0.85, 2.35)


def furnish_R(m, st):
    import rooms
    rnd = random.Random(21 + STYLES.index(st) * 7)
    left_wing(m, st, rnd, True)
    # living room on the entrance side
    rooms.living(m, st, rnd, F2(m, 12.87, 2.25, 'E'), F2(m, 15.92, 2.4, 'W'), F2(m, 14.65, 2.4, 'W'), (14.4, 2.94),
                 unit_len=3.3, unit2=F2(m, 12.87, 1.1, 'E'), corner=F2(m, 15.92, 4.2, 'W'), desk=F2(m, 14.4, 0.52, 'S'),
                 rug=F2(m, 14.3, 1.2, 'S'), floorlamp=(15.65, 0.75))
    rooms.window_dressing(m, st, rnd, 'front', 13.65, 15.15)
    rooms.bedroom(m, st, rnd, F2(m, 15.92, 8.4, 'W'), F2(m, 15.2, 5.67, 'S'), F2(m, 12.87, 9.9, 'E'), (14.4, 8.36),
                  ward_max=1.38, carpet=F2(m, 15.92, 8.4, 'W'))
    rooms.window_dressing(m, st, rnd, 'back', 13.65, 15.15, plants=False)


def furnish_B(m, st):
    import rooms
    rnd = random.Random(31 + STYLES.index(st) * 7)
    rooms.hall(m, st, F2(m, 6.47, 6.45, 'E'), F2(m, 6.78, 7.3, 'N'), (8.0, 6.45), coat_len=1.2)
    pbox(m, 7.65, 5.72, 0.0, 8.45, 6.2, 0.01, 'pk_mat')
    rooms.bath(m, st, F2(m, 6.47, 8.17, 'E'), F2(m, 7.45, 8.97, 'N'), F2(m, 8.17, 8.5, 'W'), lamp=(7.3, 8.3),
               line=(6.5, 8.1, 7.6, CEIL))
    m.cyl(6.52, by(8.92), 0.0, CEIL, 0.03, 6, 'pk_metal')
    rooms.kitchen(m, st, rnd, F2(m, 6.47, 9.05, 'E'), 2.0, F2(m, 8.05, 10.92, 'N'), (8.0, 10.05),
                  radio=F2(m, 9.53, 10.0, 'W'), clock=F2(m, 9.53, 10.6, 'W'), rev=True, seats=((-0.8, 0.3), (0.2, 0.85)))
    rooms.window_dressing(m, st, rnd, 'back', 7.4, 8.6, short=True)
    rooms.living(m, st, rnd, F2(m, 9.67, 8.5, 'E'), F2(m, 12.73, 8.0, 'W'), F2(m, 11.43, 8.0, 'W'), (11.2, 8.36),
                 unit_len=3.0, unit2=F2(m, 9.67, 10.0, 'E'), corner=F2(m, 11.48, 10.72, 'N'), desk=F2(m, 11.6, 10.92, 'N'),
                 rug=F2(m, 11.0, 7.0, 'S'), floorlamp=(12.45, 9.45))
    rooms.wardrobe_style(F2(m, 11.2, 5.67, 'S'), st, 1.2)
    rooms.window_dressing(m, st, rnd, 'back', 10.05, 12.2)


def build_furniture():
    out = []
    for apt, fn in (('L', furnish_L), ('R', furnish_R), ('B', furnish_B)):
        for st in STYLES:
            m = Mesh('k5i_%s_%s' % (apt, st), 'interior')
            fn(m, st)
            out.append(m.finish())
    return out


# ------------------------------------------------------------------ door leaves

def leaf_box(m, x0, x1, y0, y1, z0, z1, mat, top=None):
    m.box(x0, y0, z0, x1, y1, z1, mat, top or mat, mat)


def handles(m, w, t, z=1.0, mat='pk_chrome'):
    for s in (-1, 1):
        y = s * (t / 2 + 0.03)
        m.box(w - 0.1, min(y, s * t / 2), z - 0.012, w - 0.05, max(y, s * t / 2), z + 0.012, mat, mat, mat)
        m.box(w - 0.16, y - 0.012, z - 0.012, w - 0.05, y + 0.012, z + 0.012, mat, mat, mat)


def build_doors():
    out = []
    # apartment entrance: padded brown leatherette with rows of upholstery nails, a peephole and a number
    w, h, t = DOOR_LEAF['apt']
    m = Mesh('k5i_dr_apt', 'door')
    leaf_box(m, 0, w, -t / 2, t / 2, 0, h, 'pk_dermantin')
    for s in (-1, 1):
        y = s * (t / 2 + 0.004)
        for (a, b) in ((0.08, h - 0.08),):
            for zz in (a, b):
                m.box(0.08, min(y, y - s * 0.004), zz - 0.004, w - 0.08, max(y, y - s * 0.004), zz + 0.004, 'pk_brass')
            for xx in (0.08, w - 0.08):
                m.box(xx - 0.004, min(y, y - s * 0.004), a, xx + 0.004, max(y, y - s * 0.004), b, 'pk_brass')
        for k in range(4):
            zz = 0.35 + k * 0.42
            m.box(w * 0.3, min(y, y - s * 0.004), zz - 0.004, w * 0.7, max(y, y - s * 0.004), zz + 0.004, 'pk_brass')
    m.tube((w / 2, -t / 2 - 0.01, 1.52), (w / 2, t / 2 + 0.01, 1.52), 0.012, 0.012, 'pk_chrome', 6)
    m.box(w / 2 - 0.05, -t / 2 - 0.006, 1.62, w / 2 + 0.05, -t / 2, 1.7, 'pk_brass', 'pk_brass', 'pk_brass')
    handles(m, w, t, 1.0)
    m.box(w - 0.14, -t / 2 - 0.006, 1.12, w - 0.08, -t / 2, 1.22, 'pk_chrome', 'pk_chrome', 'pk_chrome')
    out.append(m.finish())
    # interior doors: white paint, panels, glass in the room doors, all glass in the kitchen, a small pane in the bath
    for kind in ('room', 'kit', 'bath'):
        w, h, t = DOOR_LEAF[kind]
        m = Mesh('k5i_dr_' + kind, 'door')
        fr = 0.09
        if kind == 'bath':
            leaf_box(m, 0, w, -t / 2, t / 2, 0, h, 'pk_door_int')
            m.box(w * 0.3, -t / 2 - 0.002, 1.6, w * 0.7, t / 2 + 0.002, 1.85, 'pk_glass_door', 'pk_glass_door', 'pk_glass_door')
            handles(m, w, t, 1.0)
            # bolt on the inside
            m.box(w - 0.2, -t / 2 - 0.02, 1.25, w - 0.08, -t / 2, 1.28, 'pk_chrome', 'pk_chrome', 'pk_chrome')
        else:
            glass_from = 0.12 if kind == 'kit' else 0.95
            leaf_box(m, 0, fr, -t / 2, t / 2, 0, h, 'pk_door_int')
            leaf_box(m, w - fr, w, -t / 2, t / 2, 0, h, 'pk_door_int')
            leaf_box(m, fr, w - fr, -t / 2, t / 2, h - fr, h, 'pk_door_int')
            leaf_box(m, fr, w - fr, -t / 2, t / 2, 0, glass_from, 'pk_door_int')
            if kind == 'room':
                leaf_box(m, fr, w - fr, -t / 2, t / 2, 0.9, 0.98, 'pk_door_int')
                m.box(fr + 0.06, -t / 2 - 0.004, 0.15, w - fr - 0.06, -t / 2, 0.8, 'pk_door_int', 'pk_door_int', 'pk_door_int')
                m.box(fr + 0.06, t / 2, 0.15, w - fr - 0.06, t / 2 + 0.004, 0.8, 'pk_door_int', 'pk_door_int', 'pk_door_int')
            g0 = 0.98 if kind == 'room' else glass_from
            m.box(fr, -0.006, g0, w - fr, 0.006, h - fr, 'pk_glass_door', 'pk_glass_door', 'pk_glass_door')
            # glazing bars
            mid = (g0 + h - fr) / 2
            leaf_box(m, fr, w - fr, -0.012, 0.012, mid - 0.015, mid + 0.015, 'pk_door_int')
            if kind == 'kit':
                for zz in (g0 + (h - fr - g0) * 0.25, g0 + (h - fr - g0) * 0.75):
                    leaf_box(m, fr, w - fr, -0.012, 0.012, zz - 0.015, zz + 0.015, 'pk_door_int')
            handles(m, w, t, 1.0)
        out.append(m.finish())
    # balcony door: white painted frame, glass on top, a panel below
    w, h, t = DOOR_LEAF['bal']
    m = Mesh('k5i_dr_bal', 'door')
    fr = 0.08
    leaf_box(m, 0, fr, -t / 2, t / 2, 0, h, 'pk_frame_int')
    leaf_box(m, w - fr, w, -t / 2, t / 2, 0, h, 'pk_frame_int')
    leaf_box(m, fr, w - fr, -t / 2, t / 2, h - fr, h, 'pk_frame_int')
    leaf_box(m, fr, w - fr, -t / 2, t / 2, 0, 0.75, 'pk_frame_int')
    m.box(fr, -0.004, 0.75, w - fr, 0.004, h - fr, 'pk_glass_int', 'pk_glass_int', 'pk_glass_int')
    leaf_box(m, fr, w - fr, -0.015, 0.015, 1.35, 1.39, 'pk_frame_int')
    handles(m, w, t, 1.05, 'pk_frame_int')
    out.append(m.finish())
    # entrance door of the building: painted steel with a code lock, opens to the street
    w, h, t = DOOR_LEAF['entr']
    m = Mesh('k5i_dr_entr', 'door')
    leaf_box(m, 0, w, -t / 2, t / 2, 0, h, 'pk_door')
    for s in (-1, 1):
        y = s * (t / 2 + 0.006)
        for (z0, z1) in ((0.15, 0.85), (1.0, 1.75)):
            m.box(0.12, min(y, s * t / 2), z0, w - 0.12, max(y, s * t / 2), z1, 'pk_door', 'pk_door', 'pk_door')
    handles(m, w, t, 1.0, 'pk_rail')
    m.box(w - 0.22, -t / 2 - 0.02, 1.2, w - 0.08, -t / 2, 1.42, 'pk_metal', 'pk_metal', 'pk_metal')
    out.append(m.finish())
    # roof hatch: a steel lid, hinge along x at the origin, the lid runs along +y
    hx0, hy0, hx1, hy1 = HATCH
    m = Mesh('k5i_hatch', 'door')
    m.box(-0.02, 0.0, 0.0, hx1 - hx0 + 0.02, hy1 - hy0 + 0.04, 0.05, 'pk_metal', 'pk_snow', 'pk_metal')
    m.box(0.2, hy1 - hy0 - 0.05, -0.12, hx1 - hx0 - 0.2, hy1 - hy0 - 0.03, 0.0, 'pk_rail', 'pk_rail', 'pk_rail')
    out.append(m.finish())
    return out
