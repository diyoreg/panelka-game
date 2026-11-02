"""The nine-storey with interiors (k9i_plan.py): furniture of its four flats in every style, the garbage chute and
the lift (cab, door leaves, the lamps of its buttons).

The structure, the stairwell and the shell come from k5i.py after k5i.use(k9i_plan); build_panelka.py calls
build_furniture() and build_lift() right after that.
"""
import random

import k5i as K
from k5i import F2, pbox, by
import k9i_plan as P

STYLES = ('sov', 'xp', 'eu', 'mod', 'old')


def front_wing(m, st, rnd, mir):
    """Kitchen, bath and hall of A (or of D, the same rooms turned over)."""
    import rooms
    W = P.W
    mx = (lambda x: W - x) if mir else (lambda x: x)
    rooms.kitchen(m, st, rnd, F2(m, 6.07, 0.5, 'E', mir), 2.2, F2(m, 7.6, 0.55, 'S', mir), (mx(7.5), 1.55),
                  radio=F2(m, 8.93, 1.6, 'W', mir), clock=F2(m, 8.93, 2.2, 'W', mir),
                  seats=((0.25, 0.8), (-0.75, 0.3) if mir else (0.75, 0.3)))
    rooms.window_dressing(m, st, rnd, 'front', min(mx(6.9), mx(8.1)), max(mx(6.9), mx(8.1)), short=True)
    # the bath door swings in over the free floor by the tub; the toilet and the basin stand on the far wall
    rooms.bath(m, st, F2(m, 6.07, 3.565, 'E', mir), F2(m, 7.05, 4.6, 'N', mir), F2(m, 7.55, 4.6, 'N', mir),
               lamp=(mx(6.93), 3.7), line=(min(mx(6.1), mx(7.75)), max(mx(6.1), mx(7.75)), 3.0, P.CEIL), tub_len=1.4)
    m.cyl(mx(6.13), by(4.5), 0.0, P.CEIL, 0.03, 6, 'pk_metal')
    rooms.hall(m, st, F2(m, 8.93, 5.2, 'W', mir), F2(m, 8.93, 3.2, 'W', mir), (mx(8.3), 4.6), coat_len=0.6)
    pbox(m, min(mx(8.0), mx(8.6)), 4.0, 0.0, max(mx(8.0), mx(8.6)), 4.85, 0.01, 'pk_mat')


def back_wing(m, st, rnd, mir):
    """Hall and corridor, bath, kitchen, living room and bedroom of B (or of C, turned over)."""
    import rooms
    W = P.W
    mx = (lambda x: W - x) if mir else (lambda x: x)
    rooms.hall(m, st, F2(m, 8.93, 7.9, 'W', mir), F2(m, 7.88, 8.0, 'E', mir), (mx(6.0), 6.17), coat_len=1.2)
    pbox(m, min(mx(8.05), mx(8.75)), 5.8, 0.0, max(mx(8.05), mx(8.75)), 6.65, 0.01, 'pk_mat')
    # the tub along the wall away from the door, the toilet and the basin at the far end
    rooms.bath(m, st, F2(m, 6.07, 8.19, 'E', mir), F2(m, 7.4, 8.88, 'N', mir), F2(m, 7.8, 7.75, 'W', mir),
               lamp=(mx(6.93), 7.8), line=(min(mx(6.1), mx(7.75)), max(mx(6.1), mx(7.75)), 7.2, P.CEIL), tub_len=1.38)
    m.cyl(mx(7.7), by(6.85), 0.0, P.CEIL, 0.03, 6, 'pk_metal')
    rooms.kitchen(m, st, rnd, F2(m, 6.07, 9.2, 'E', mir), 2.4, F2(m, 7.6, 11.52, 'N', mir), (mx(7.5), 10.3),
                  radio=F2(m, 8.93, 10.2, 'W', mir), clock=F2(m, 8.93, 10.8, 'W', mir), rev=True,
                  seats=((-0.75, 0.3) if mir else (0.75, 0.3), (0.2, 0.85)))
    rooms.window_dressing(m, st, rnd, 'back', min(mx(6.9), mx(8.1)), max(mx(6.9), mx(8.1)), short=True)
    # living room with the balcony
    rooms.living(m, st, rnd, F2(m, 3.07, 8.9, 'E', mir), F2(m, 5.93, 9.2, 'W', mir), F2(m, 4.85, 9.2, 'W', mir),
                 (mx(4.5), 9.2), unit_len=2.9, corner=F2(m, 5.93, 10.95, 'W', mir), desk=F2(m, 5.0, 11.55, 'N', mir),
                 rug=F2(m, 4.5, 7.8, 'S', mir), floorlamp=(mx(3.4), 7.1), sofa_side=-1)
    rooms.window_dressing(m, st, rnd, 'back', min(mx(3.45), mx(5.6)), max(mx(3.45), mx(5.6)))
    # bedroom
    rooms.bedroom(m, st, rnd, F2(m, 0.08, 9.3, 'E', mir), F2(m, 0.7, 6.75, 'S', mir), F2(m, 2.93, 11.0, 'W', mir),
                  (mx(1.5), 9.2), ward_max=1.3, carpet=F2(m, 0.08, 9.3, 'E', mir))
    rooms.window_dressing(m, st, rnd, 'back', min(mx(0.75), mx(2.25)), max(mx(0.75), mx(2.25)), plants=False)


def furnish_A(m, st):
    import rooms
    rnd = random.Random(41 + STYLES.index(st) * 7)
    front_wing(m, st, rnd, False)
    # the one room: the sofa bed is the bed
    rooms.living(m, st, rnd, F2(m, 3.07, 3.0, 'E'), F2(m, 5.93, 2.6, 'W'), F2(m, 4.9, 2.6, 'W'), (4.5, 2.94),
                 unit_len=2.6, corner=F2(m, 5.93, 4.05, 'W'), desk=F2(m, 5.0, 0.52, 'S'), rug=F2(m, 4.5, 1.6, 'S'),
                 floorlamp=(3.4, 4.6), sofa_side=1)
    rooms.wardrobe_style(F2(m, 3.7, 5.53, 'N'), st, 1.2)
    rooms.window_dressing(m, st, rnd, 'front', 3.45, 5.6)


def furnish_B(m, st):
    import rooms
    rnd = random.Random(51 + STYLES.index(st) * 7)
    back_wing(m, st, rnd, False)
    # the small room on the entrance side, off the corridor
    rooms.small_room(m, st, rnd, F2(m, 0.08, 3.0, 'E'), F2(m, 1.5, 0.52, 'S'), F2(m, 2.93, 2.5, 'W'),
                     F2(m, 2.32, 5.53, 'N'), (1.5, 2.94), rug=F2(m, 1.5, 2.0, 'S'))
    rooms.window_dressing(m, st, rnd, 'front', 0.75, 2.25)


def furnish_C(m, st):
    rnd = random.Random(61 + STYLES.index(st) * 7)
    back_wing(m, st, rnd, True)


def furnish_D(m, st):
    import rooms
    rnd = random.Random(71 + STYLES.index(st) * 7)
    front_wing(m, st, rnd, True)
    # living room with the balcony, the bedroom walked through it
    rooms.living(m, st, rnd, F2(m, 17.93, 4.15, 'W'), F2(m, 15.07, 2.5, 'E'), F2(m, 16.1, 2.5, 'E'), (16.5, 2.94),
                 unit_len=2.5, corner=F2(m, 15.07, 4.0, 'E'), desk=F2(m, 16.0, 0.52, 'S'), rug=F2(m, 16.5, 1.6, 'S'),
                 floorlamp=(17.7, 1.4), sofa_side=-1)
    rooms.window_dressing(m, st, rnd, 'front', 15.4, 17.55)
    rooms.bedroom(m, st, rnd, F2(m, 20.92, 3.6, 'W'), F2(m, 19.5, 5.53, 'N'), F2(m, 18.07, 1.0, 'E'), (19.5, 2.94),
                  ward_max=1.6, carpet=F2(m, 20.92, 3.6, 'W'))
    rooms.window_dressing(m, st, rnd, 'front', 18.75, 20.25, plants=False)


def build_furniture():
    out = []
    for apt, fn in (('A', furnish_A), ('B', furnish_B), ('C', furnish_C), ('D', furnish_D)):
        for st in STYLES:
            m = K.Mesh('k9i_%s_%s' % (apt, st), 'interior')
            fn(m, st)
            out.append(m.finish())
    return out


# ------------------------------------------------------------------ the stairwell extras and the lift

def shell_extra(m):
    """Added to k9i_shell: the call button of the lift and an enamel floor number on every landing, the garbage
    chute through the half landings."""
    E = P.ELEVATOR
    cx, cz = E['call']
    yw = E['wall'][0]
    d0, d1 = E['door']
    for f in range(P.FLOORS):
        zf = P.PL + f * P.FH
        # call button: a plate, the black button, the lamp over it (lit by the game when called)
        pbox(m, cx - 0.045, yw - 0.015, zf + cz - 0.1, cx + 0.045, yw, zf + cz + 0.16, 'pk_lift_frame', 'pk_lift_frame')
        pbox(m, cx - 0.018, yw - 0.027, zf + cz - 0.02, cx + 0.018, yw - 0.015, zf + cz + 0.02, 'pk_plastic_black')
        pbox(m, cx - 0.011, yw - 0.02, zf + cz + 0.08, cx + 0.011, yw - 0.015, zf + cz + 0.1, 'pk_lamp_off')
        # the floor number over the doors, from an atlas of digits
        xc = (d0 + d1) / 2
        n = f + 1
        uv = [(n / 10, 0), ((n + 1) / 10, 0), ((n + 1) / 10, 1), (n / 10, 1)]
        y = yw - 0.004
        K.pquad(m, [(xc - 0.12, y, zf + 2.17), (xc + 0.12, y, zf + 2.17), (xc + 0.12, y, zf + 2.43), (xc - 0.12, y, zf + 2.43)],
                'pk_floornum', (0, -1, 0), uv)
    # the garbage chute in the corner by the entrance, with a hopper on every half landing
    x0, y0, x1, y1 = P.SOLIDS[0]
    xc, yc = (x0 + x1) / 2, (y0 + y1) / 2
    m.cyl(xc, by(yc), 0.0, P.ROOF - P.SLAB, 0.17, 10, 'pk_chute')
    for f in range(P.FLOORS - 1):
        zm = P.PL + f * P.FH + 8 * P.RISE
        pbox(m, xc - 0.17, y1, zm + 0.72, xc + 0.17, y1 + 0.1, zm + 1.06, 'pk_chute', 'pk_chute', 'pk_chute')
        pbox(m, xc - 0.08, y1 + 0.1, zm + 0.98, xc + 0.08, y1 + 0.13, zm + 1.0, 'pk_rail')
        # a ring of rings: the joints of the pipe
        m.cyl(xc, by(yc), zm + 1.6, zm + 1.66, 0.185, 10, 'pk_chute')


def lamp(name, mat):
    m = K.Mesh(name, 'interior')
    m.box(-0.012, -0.012, -0.012, 0.012, 0.012, 0.012, mat, mat, mat)
    return m.finish()


def build_lift():
    """The moving parts of the lift, in the frame of the section: the cab (its floor at z = 0), the left leaf of
    the cab doors and of the landing doors (the game moves them and puts the right leaf a leaf over), the ropes
    (1 m tall, the game stretches them), the lamps of the buttons."""
    E = P.ELEVATOR
    sx0, sy0, sx1, sy1 = E['shaft']
    cx0, cy0, cx1, cy1 = E['cab']
    d0, d1 = E['door']
    H = E['cab_h']
    t = 0.04
    out = []
    m = K.Mesh('k9i_cab', 'interior')
    # floor, ceiling with a frosted lamp, the walls: laminate inside, painted steel outside
    pbox(m, cx0 - t, cy0 - 0.12, -0.12, cx1 + t, cy1 + t, 0.0, 'pk_metal', 'pk_lift_floor', 'pk_metal')
    pbox(m, cx0 - t, cy0 - 0.12, H, cx1 + t, cy1 + t, H + 0.06, 'pk_metal', 'pk_metal', 'pk_lift_ceil')
    pbox(m, (cx0 + cx1) / 2 - 0.25, (cy0 + cy1) / 2 - 0.12, H - 0.03, (cx0 + cx1) / 2 + 0.25, (cy0 + cy1) / 2 + 0.12, H,
         'pk_lift_lamp', 'pk_lift_lamp', 'pk_lift_lamp')
    for (x0, y0, x1, y1) in ((cx0 - t, cy0 - 0.12, cx0, cy1 + t), (cx1, cy0 - 0.12, cx1 + t, cy1 + t), (cx0, cy1, cx1, cy1 + t)):
        pbox(m, x0, y0, 0.0, x1, y1, H, 'pk_lift_wall')
    # the front: panels beside the doorway and over it
    for (x0, x1) in ((cx0, d0), (d1, cx1)):
        pbox(m, x0, cy0 - 0.12, 0.0, x1, cy0, H, 'pk_lift_wall')
    pbox(m, d0, cy0 - 0.12, 2.0, d1, cy0, H, 'pk_lift_wall', bottom='pk_lift_wall')
    # a rubber skirting and a steel sill at the door
    pbox(m, d0, cy0 - 0.12, 0.0, d1, cy0, 0.01, 'pk_steel')
    # the panel of buttons on the right wall by the door, with labels
    pv0, pv1, pz0, pz1 = cy0 + 0.05, cy0 + 0.21, 0.82, 1.56
    x = cx1 - 0.001
    K.pquad(m, [(x, pv0, pz0), (x, pv1, pz0), (x, pv1, pz1), (x, pv0, pz1)], 'pk_lift_panel', (-1, 0, 0),
            [(1, 0), (0, 0), (0, 1), (1, 1)])
    yb = cy0 + 0.13
    for (h, mat) in [(0.88, 'pk_paint_yellow'), (0.95, 'pk_paint_red')] + [(1.02 + f * 0.06, 'pk_plastic_black') for f in range(P.FLOORS)]:
        m.htube(x, by(yb), h, x - 0.012, by(yb), h, 0.014, mat, 8)
    # the door operator on the roof of the cab, the guide shoes
    pbox(m, d0 - 0.1, cy0 - 0.1, H + 0.06, d1 + 0.1, cy0 + 0.25, H + 0.26, 'pk_metal', 'pk_metal')
    for xx in (cx0 - t - 0.06, cx1 + t):
        pbox(m, xx, (cy0 + cy1) / 2 - 0.08, H - 0.2, xx + 0.06, (cy0 + cy1) / 2 + 0.08, H + 0.05, 'pk_rail')
    out.append(m.finish())
    # a leaf of the cab doors, inside the front wall, and of the landing doors, on the shaft side of the wall
    leaf = (d1 - d0) / 2 + 0.01
    m = K.Mesh('k9i_cabdoor', 'interior')
    pbox(m, d0, cy0, 0.0, d0 + leaf, cy0 + 0.03, 2.0, 'pk_lift_door', 'pk_lift_door', 'pk_lift_door')
    out.append(m.finish())
    yw = E['wall'][1]
    m = K.Mesh('k9i_shaftdoor', 'interior')
    pbox(m, d0, yw + 0.005, 0.0, d0 + leaf, yw + 0.035, 2.05, 'pk_lift_door', 'pk_lift_door', 'pk_lift_door')
    # a little window of wired glass in the leaf
    pbox(m, d0 + 0.12, yw + 0.003, 1.3, d0 + 0.28, yw + 0.037, 1.6, 'pk_glass_door', 'pk_glass_door', 'pk_glass_door')
    out.append(m.finish())
    # four ropes over the cab, 1 m tall
    m = K.Mesh('k9i_cable', 'interior')
    xc, yc = (cx0 + cx1) / 2, (cy0 + cy1) / 2
    for dx in (-0.06, -0.02, 0.02, 0.06):
        pbox(m, xc + dx - 0.006, yc - 0.006, 0.0, xc + dx + 0.006, yc + 0.006, 1.0, 'pk_rail')
    out.append(m.finish())
    out.append(lamp('k9i_lamp', 'pk_glow_red'))
    out.append(lamp('k9i_lamp_y', 'pk_glow_yellow'))
    return out
