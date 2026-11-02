"""Plan of one section of the khrushchyovka with interiors (series 1-464, panel five-storey, no lift).

All sizes in meters. Plan coordinates of a section: x from 0 to W along the building (left to right seen from
the entrance side), y from 0 (outer face of the entrance facade) to D (outer face of the back facade).
Heights z are measured from the ground; floor f has its finished floor at PL + f * FH.

One landing serves three apartments:
    L  three rooms (58 m2): kitchen and bath on the entrance side, living room with a balcony, a bedroom
       walked through the living room, a small room off the hall
    R  two rooms (45 m2): kitchen, bath, living room on the entrance side, bedroom walked through it
    B  one room (32 m2) behind the landing: hall, bath, kitchen on the back side, room with a balcony
The stairwell has two flights per floor: up toward the facade to the half landing under the window,
turn, up to the next floor. Entrance under the first half landing, five steps up to the first floor.
The roof is reached through a hatch over the top landing.

This file is plain data, the game reads it as public/models/k5i_plan.json (written by build_panelka.py).
"""
import sys

NAME = 'k5i'               # asset prefix
BASE = 0                   # its room ids in the game start here (the shaders keep the rooms of every plan in one list)
W, D = 16.0, 11.4
T = 0.35                 # outer walls
END = 0.27               # the end walls of the building stick out this far past the first and last section
PL, FH, FLOORS = 1.1, 2.7, 5
SLAB = 0.22
CEIL = FH - SLAB         # clear height 2.48
DOOR_H = 2.05
ROOF = PL + FLOORS * FH  # 14.6, top of the roof slab
M = 3.2                  # cross wall step

# facade modules, left to right: L room, K kitchen, S stairwell, LB room with a balcony door
FRONT = ['L', 'K', 'S', 'K', 'L']
BACK = ['L', 'LB', 'K', 'LB', 'L']
FRONT_ROOM = [6, 1, 0, 7, 10]
BACK_ROOM = [5, 4, 14, 15, 11]

# stairwell: two lanes, the gap between them, landings
LANE_A = (6.47, 7.87)    # flights up toward the facade
LANE_B = (8.13, 9.53)    # flights up toward the back
STAIR_X = (6.47, 9.53)
Y_MID = 1.85             # half landing: y 0.35 .. 1.85, at floor + 1.35
Y_FL = 3.81              # floor landing: y 3.81 .. 5.53
RISE = FH / 16           # 16 risers per floor, 8 per flight
TREAD = 0.28
VEST_Z = 0.3             # entrance hall floor
ENTRANCE = (7.5, 8.5, VEST_Z, 2.2)
XC = 8.0                 # middle of the stairwell
Y_LAND = 5.53            # the floor landings reach back to this wall
SLAB_HOLES = [(6.33, 0.0, 9.67, Y_LAND)]   # where the floor slabs are open: the stairwell
SOLIDS = []              # solid blocks through every floor (none here)
PANEL = ('Y', 6.75, 7.3, Y_LAND, -1)       # electric panel on the landing: wall axis, from, to, wall face, facing
HATCH = (6.62, 4.42, 7.62, 5.42)   # x0, y0, x1, y1 of the roof hatch over the top landing
LADDER = (6.85, 7.35, 5.35)        # steel ladder up to the hatch: x of its two rails, y of the rungs

# kinds: 0 stairwell, 1 kitchen, 2 bath, 3 hall, 4 room. apt: 0 stairwell, 1 L, 2 R, 3 B
ROOMS = [
    dict(id=0, apt=0, kind=0, name='stairwell', boxes=[(6.47, 0.35, 9.53, 5.53)], lamp=(8.0, 4.67, 2.36, 6.0)),
    dict(id=1, apt=1, kind=1, name='L kitchen', boxes=[(3.27, 0.35, 6.33, 2.35)], lamp=(4.8, 1.35, 2.3, 4.2)),
    dict(id=2, apt=1, kind=2, name='L bath', boxes=[(3.27, 2.43, 4.97, 4.0)], lamp=(4.4, 3.4, 2.25, 2.8)),
    dict(id=3, apt=1, kind=3, name='L hall', boxes=[(5.05, 2.43, 6.33, 5.53), (3.27, 4.08, 5.05, 5.53)], lamp=(5.6, 4.6, 2.3, 4.0)),
    dict(id=4, apt=1, kind=4, name='L living room', boxes=[(3.27, 5.67, 6.33, 11.05)], lamp=(4.8, 8.36, 2.12, 6.5)),
    dict(id=5, apt=1, kind=4, name='L bedroom', boxes=[(0.08, 5.67, 3.13, 11.05)], lamp=(1.6, 8.36, 2.12, 6.5)),
    dict(id=6, apt=1, kind=4, name='L small room', boxes=[(0.08, 0.35, 3.13, 5.53)], lamp=(1.6, 2.94, 2.12, 6.5)),
    dict(id=7, apt=2, kind=1, name='R kitchen', boxes=[(9.67, 0.35, 12.73, 2.35)], lamp=(11.2, 1.35, 2.3, 4.2)),
    dict(id=8, apt=2, kind=2, name='R bath', boxes=[(11.03, 2.43, 12.73, 4.0)], lamp=(11.6, 3.4, 2.25, 2.8)),
    dict(id=9, apt=2, kind=3, name='R hall', boxes=[(9.67, 2.43, 10.95, 5.53), (10.95, 4.08, 12.73, 5.53)], lamp=(10.4, 4.6, 2.3, 4.0)),
    dict(id=10, apt=2, kind=4, name='R living room', boxes=[(12.87, 0.35, 15.92, 5.53)], lamp=(14.4, 2.94, 2.12, 6.5)),
    dict(id=11, apt=2, kind=4, name='R bedroom', boxes=[(12.87, 5.67, 15.92, 11.05)], lamp=(14.4, 8.36, 2.12, 6.5)),
    dict(id=12, apt=3, kind=3, name='B hall', boxes=[(6.47, 5.67, 9.53, 7.3), (8.25, 7.3, 9.53, 8.97)], lamp=(8.0, 6.45, 2.3, 4.0)),
    dict(id=13, apt=3, kind=2, name='B bath', boxes=[(6.47, 7.38, 8.17, 8.97)], lamp=(7.3, 8.3, 2.25, 2.8)),
    dict(id=14, apt=3, kind=1, name='B kitchen', boxes=[(6.47, 9.05, 9.53, 11.05)], lamp=(8.0, 10.05, 2.3, 4.2)),
    dict(id=15, apt=3, kind=4, name='B room', boxes=[(9.67, 5.67, 12.73, 11.05)], lamp=(11.2, 8.36, 2.12, 6.5)),
]
APTS = {1: 'L', 2: 'R', 3: 'B'}

# Walls of one floor. ('X', x0, x1, y0, y1, holes): a wall across the building, holes are (y0, y1) door openings.
# ('Y', y0, y1, x0, x1, holes): a wall along the building, holes are (x0, x1).
WALLS = [
    ('X', 0.0, 0.08, 0.35, 11.05, []),
    ('X', 15.92, 16.0, 0.35, 11.05, []),
    ('X', 3.13, 3.27, 0.35, 11.05, [(4.25, 5.15), (5.8, 6.7)]),
    ('X', 6.33, 6.47, 0.35, 11.05, [(4.35, 5.3)]),
    ('X', 9.53, 9.67, 0.35, 11.05, [(4.35, 5.3), (5.8, 6.7)]),
    ('X', 12.73, 12.87, 0.35, 11.05, [(4.35, 5.25)]),
    ('Y', 5.53, 5.67, 0.08, 15.92, [(4.2, 5.1), (7.6, 8.55), (13.4, 14.3)]),
    # L partitions
    ('Y', 2.35, 2.43, 3.27, 6.33, [(5.15, 6.05)]),
    ('X', 4.97, 5.05, 2.43, 4.08, [(3.2, 4.0)]),
    ('Y', 4.0, 4.08, 3.27, 4.97, []),
    # R partitions
    ('Y', 2.35, 2.43, 9.67, 12.73, [(9.95, 10.85)]),
    ('X', 10.95, 11.03, 2.43, 4.08, [(3.2, 4.0)]),
    ('Y', 4.0, 4.08, 11.03, 12.73, []),
    # B partitions
    ('Y', 7.3, 7.38, 6.47, 8.25, [(7.3, 8.1)]),
    ('X', 8.17, 8.25, 7.38, 8.97, []),
    ('Y', 8.97, 9.05, 6.47, 9.53, [(8.5, 9.4)]),
]

# Doors of one floor. wall: index into WALLS, or 'back' for the back facade. a0, a1: the opening along the wall.
# hinge: 0 at a0, 1 at a1. side: +1 opens toward the bigger x (X walls) or y (Y walls). z0: sill above the floor.
DOORS = [
    dict(kind='apt', wall=3, a0=4.35, a1=5.3, hinge=1, side=-1, room=3, open=0.0),
    dict(kind='apt', wall=4, a0=4.35, a1=5.3, hinge=1, side=1, room=9, open=0.0),
    dict(kind='apt', wall=6, a0=7.6, a1=8.55, hinge=0, side=1, room=12, open=0.0),
    dict(kind='kit', wall=7, a0=5.15, a1=6.05, hinge=1, side=-1, room=1, open=0.85),
    dict(kind='bath', wall=8, a0=3.2, a1=4.0, hinge=1, side=-1, room=2, open=0.25),
    dict(kind='room', wall=6, a0=4.2, a1=5.1, hinge=1, side=1, room=4, open=0.75),
    dict(kind='room', wall=2, a0=4.25, a1=5.15, hinge=1, side=-1, room=6, open=0.6),
    dict(kind='room', wall=2, a0=5.8, a1=6.7, hinge=0, side=-1, room=5, open=0.6),
    dict(kind='bal', wall='back', a0=3.65, a1=4.45, hinge=0, side=-1, room=4, open=0.0, z0=0.06),
    dict(kind='kit', wall=10, a0=9.95, a1=10.85, hinge=0, side=-1, room=7, open=0.85),
    dict(kind='bath', wall=11, a0=3.2, a1=4.0, hinge=1, side=1, room=8, open=0.25),
    dict(kind='room', wall=5, a0=4.35, a1=5.25, hinge=0, side=1, room=10, open=0.75),
    dict(kind='room', wall=6, a0=13.4, a1=14.3, hinge=0, side=1, room=11, open=0.6),
    dict(kind='bath', wall=13, a0=7.3, a1=8.1, hinge=1, side=1, room=13, open=0.25),
    dict(kind='kit', wall=15, a0=8.5, a1=9.4, hinge=1, side=1, room=14, open=0.85),
    dict(kind='room', wall=4, a0=5.8, a1=6.7, hinge=0, side=1, room=15, open=0.6),
    dict(kind='bal', wall='back', a0=10.05, a1=10.85, hinge=0, side=-1, room=15, open=0.0, z0=0.06),
]
# Every opening gets a frame (korobka): jambs and a head FRAME thick inside the hole, a stop strip behind the leaf.
# The leaf hangs inside the frame with GAP of play on every side and its face flush with the wall face it opens
# toward; LIFT is the gap above the floor (over the threshold).
FRAME, GAP, LIFT = 0.03, 0.003, 0.015
# opening width, leaf height, leaf thickness; the leaf width follows from the opening
DOOR_OPEN = {'apt': (0.95, 2.0, 0.06), 'room': (0.9, 2.0, 0.04), 'kit': (0.9, 2.0, 0.04),
             'bath': (0.8, 2.0, 0.04), 'bal': (0.8, 2.14, 0.06), 'entr': (1.0, 1.86, 0.06)}
DOOR_LEAF = {k: (round(o - 2 * (FRAME + GAP), 3), h, t) for k, (o, h, t) in DOOR_OPEN.items()}
BAL_DOOR_TOP = 2.25      # head of the balcony door opening above the floor

# Light switches: (room, x, y, nx, ny), 1.5 m above the floor on the wall face. Bath switches are in the hall.
SWITCH_Z = 1.5
SWITCHES = [
    (1, 4.95, 2.35, 0, -1), (2, 5.05, 3.0, 1, 0), (3, 6.33, 4.15, -1, 0), (4, 4.0, 5.67, 0, 1),
    (5, 3.13, 6.85, -1, 0), (6, 3.13, 4.05, -1, 0),
    (7, 11.05, 2.35, 0, -1), (8, 10.95, 3.0, -1, 0), (9, 9.67, 4.15, 1, 0), (10, 12.87, 5.4, 1, 0),
    (11, 14.45, 5.67, 0, 1),
    (12, 8.75, 5.67, 0, 1), (13, 7.1, 7.3, 0, -1), (14, 8.3, 9.05, 0, 1), (15, 9.67, 6.85, 1, 0),
]

# Windows of one floor on the facades: (side, x0, x1, z0, z1, room). Balcony doors are in DOORS.
WINDOWS = [
    ('front', 0.85, 2.35, 0.85, 2.3, 6), ('front', 4.2, 5.4, 0.85, 2.3, 1),
    ('front', 10.6, 11.8, 0.85, 2.3, 7), ('front', 13.65, 15.15, 0.85, 2.3, 10),
    ('back', 0.85, 2.35, 0.85, 2.3, 5), ('back', 4.6, 5.8, 0.85, 2.3, 4), ('back', 7.4, 8.6, 0.85, 2.3, 14),
    ('back', 11.0, 12.2, 0.85, 2.3, 15), ('back', 13.65, 15.15, 0.85, 2.3, 11),
]
STAIR_WINDOW = (7.4, 8.6, 1.35 + 0.85, 1.35 + 2.05)   # above every half landing except the top one
# sockets: (room, x, y, nx, ny, height)
SOCKETS = [(1, 3.27, 1.7, 1, 0, 1.1), (4, 6.33, 7.0, -1, 0, 0.3), (4, 3.27, 9.6, 1, 0, 0.3), (5, 0.08, 9.4, 1, 0, 0.3),
           (6, 0.08, 1.0, 1, 0, 0.3), (7, 12.73, 1.7, -1, 0, 1.1), (10, 15.92, 1.2, -1, 0, 0.3), (10, 12.87, 3.95, 1, 0, 0.3),
           (11, 15.92, 9.6, -1, 0, 0.3), (14, 6.47, 10.4, 1, 0, 1.1), (15, 12.73, 9.6, -1, 0, 0.3), (15, 9.67, 10.3, 1, 0, 0.3)]
VIEW = (14.4, 0.95, 3)   # the title camera: plan x, y at a window and the floor
ELEVATOR = None          # the five-storey has no lift


def module_center(j):
    return j * M + M / 2


def wall_box(w):
    """Plan rectangle of a wall."""
    if w[0] == 'X':
        return (w[1], w[3], w[2], w[4])
    return (w[3], w[1], w[4], w[2])


def as_json():
    return export(sys.modules[__name__])


def export(P):
    """What the game needs from the plan module P: sizes, rooms, doors with their hinges, switches, windows."""
    doors = []
    for i, d in enumerate(P.DOORS):
        if d['wall'] == 'back':
            t0, t1, axis = P.D - P.T, P.D - P.T + 0.15, 'Y'
        elif d['wall'] == 'front':
            t0, t1, axis = P.T - 0.15, P.T, 'Y'
        else:
            w = P.WALLS[d['wall']]
            t0, t1, axis = w[1], w[2], w[0]
        assert abs(d['a1'] - d['a0'] - DOOR_OPEN[d['kind']][0]) < 1e-6, d
        # the hinge axis: the corner of the leaf on the face it opens toward, inside the frame
        face = (t1 if d['side'] > 0 else t0) - d['side'] * 0.002
        ha = d['a1'] - FRAME - GAP if d['hinge'] else d['a0'] + FRAME + GAP
        along = -1.0 if d['hinge'] else 1.0
        if axis == 'X':
            hinge, closed = (face, ha), (0.0, along)
            opened = (float(d['side']), 0.0)
        else:
            hinge, closed = (ha, face), (along, 0.0)
            opened = (0.0, float(d['side']))
        w_, h_, t_ = DOOR_LEAF[d['kind']]
        doors.append(dict(kind=d['kind'], hinge=[round(hinge[0], 4), round(hinge[1], 4)], closed=closed, opened=opened,
                          width=w_, height=h_, thick=t_, z0=d.get('z0', 0.0) + LIFT, room=d['room'], open=d['open'],
                          span=[d['a0'], d['a1']], axis=axis))
    E = P.ENTRANCE
    return dict(
        name=P.NAME, base=P.BASE, apts=P.APTS, xc=P.XC, yLand=P.Y_LAND, view=P.VIEW, elevator=P.ELEVATOR,
        W=P.W, D=P.D, T=P.T, END=P.END, PL=P.PL, FH=P.FH, FLOORS=P.FLOORS, CEIL=P.CEIL, ROOF=P.ROOF, VEST_Z=P.VEST_Z,
        rooms=[dict(id=r['id'], apt=r['apt'], kind=r['kind'], name=r['name'], boxes=r['boxes'], lamp=r['lamp']) for r in P.ROOMS],
        doors=doors,
        entrance=dict(kind='entr', hinge=[E[1] - FRAME - GAP, 0.002], closed=(-1.0, 0.0), opened=(0.0, -1.0),
                      width=DOOR_LEAF['entr'][0], height=DOOR_LEAF['entr'][1], thick=DOOR_LEAF['entr'][2],
                      z=E[2] + 0.005, span=[E[0], E[1]]),
        hatch=dict(box=P.HATCH, z=P.ROOF - P.SLAB),
        ladder=dict(x0=P.LADDER[0], x1=P.LADDER[1], y=P.LADDER[2], z0=P.PL + (P.FLOORS - 1) * P.FH, ceil=P.ROOF - P.SLAB),
        switches=[dict(room=s[0], x=s[1], y=s[2], z=P.SWITCH_Z, n=[s[3], s[4]]) for s in P.SWITCHES],
        stair=dict(laneA=P.LANE_A, laneB=P.LANE_B, yMid=P.Y_MID, yFloor=P.Y_FL, rise=P.RISE, tread=P.TREAD),
    )
