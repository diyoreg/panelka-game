"""Plan of one section of the nine-storey with interiors and a lift (series II-49, panel, 1965-1985).

Same conventions as k5i_plan.py: plan x from 0 to W along the building (left to right seen from the entrance side),
y from 0 (outer face of the entrance facade) to D (outer face of the back facade), heights from the ground; floor f
has its finished floor at PL + f * FH. Cross walls stand on the 3.0 m module, a wall along the middle splits the
flats on the entrance side from the ones on the back.

One landing serves four flats:
    A  one room (33 m2) on the entrance side, left: kitchen, combined bath, hall, the room with a balcony
       (the flat doors open out onto the landing, the halls are narrow)
    B  three rooms (62 m2) on the back, left: a corridor along the middle wall leads to all three rooms (all
       separate), the living room has a balcony, the small room looks out to the entrance side
    C  two rooms (46 m2) on the back, right: corridor, separate rooms, balcony from the living room
    D  two rooms (48 m2) on the entrance side, right: the bedroom walked through the living room, balcony
The stairwell is the middle module: two flights per floor, the entrance under the first half landing, five steps
up to the first floor, a garbage chute on the half landings. Behind the floor landing the lift shaft (one cab of
320 kg, 1.0 m/s, doors opening in the middle) serves every floor from the first; its machine room stands on the
roof. Behind the shaft the module is solid (ventilation and the counterweight), the back facade there is blank.
"""
import sys

from k5i_plan import DOOR_OPEN, DOOR_LEAF, FRAME, GAP, LIFT, BAL_DOOR_TOP, export  # noqa: F401  shared door sizes

NAME = 'k9i'
BASE = 16                # room ids in the game: k5i has 0..15
W, D = 21.0, 12.0
T = 0.35
END = 0.3
PL, FH, FLOORS = 1.0, 2.8, 9
SLAB = 0.16
CEIL = FH - SLAB         # clear height 2.64
DOOR_H = 2.05
ROOF = PL + FLOORS * FH  # 26.2
M = 3.0

# facade modules, left to right: L room, LB room with a balcony door, K kitchen, S stairwell, X blank
FRONT = ['L', 'LB', 'K', 'S', 'K', 'LB', 'L']
BACK = ['L', 'LB', 'K', 'X', 'K', 'LB', 'L']

# stairwell in the middle module, the same steps as in the five-storey
LANE_A = (9.07, 10.37)
LANE_B = (10.63, 11.93)
STAIR_X = (9.07, 11.93)
XC = 10.5
Y_MID = 1.85
Y_FL = 3.81
Y_LAND = 6.8             # the floor landing reaches back to the wall of the lift shaft
RISE = FH / 16
TREAD = 0.28
VEST_Z = 0.25
ENTRANCE = (10.0, 11.0, VEST_Z, 2.2)
HATCH = (9.22, 5.69, 10.22, 6.69)
LADDER = (9.45, 9.95, Y_LAND - 0.18)
PANEL = ('X', 5.05, 5.6, 11.93, -1)        # electric panel on the right wall of the landing, between the doors

# the lift: shaft (inside of its walls), the doorway in the landing wall, the cab (inside), the call button
ELEVATOR = dict(
    shaft=(9.6, 6.94, 11.4, 8.74), wall=(6.8, 6.94), door=(10.1, 10.9), cab=(9.85, 7.12, 11.15, 8.42), cab_h=2.15,
    call=(11.12, 1.1), speed=1.0, pit=0.0,
)
SLAB_HOLES = [(8.93, 0.0, 12.07, Y_LAND), (9.6, 6.94, 11.4, 8.74)]
SOLIDS = [(11.56, 0.36, 11.92, 0.7)]   # the garbage chute in the corner by the entrance, through every floor

# kinds: 0 stairwell, 1 kitchen, 2 bath, 3 hall, 4 room, 5 lift cab. apt: 0 stairwell, 1 A, 2 B, 3 C, 4 D
ROOMS = [
    dict(id=0, apt=0, kind=0, name='stairwell', boxes=[(9.07, 0.35, 11.93, 6.8)], lamp=(10.5, 5.3, 2.44, 6.5)),
    dict(id=1, apt=0, kind=5, name='lift cab', boxes=[(9.6, 6.94, 11.4, 8.74)], lamp=(10.5, 7.77, 2.05, 3.0)),
    dict(id=2, apt=1, kind=1, name='A kitchen', boxes=[(6.07, 0.35, 8.93, 2.75)], lamp=(7.5, 1.55, 2.5, 4.2)),
    dict(id=3, apt=1, kind=2, name='A bath', boxes=[(6.07, 2.83, 7.8, 4.6)], lamp=(6.93, 3.7, 2.42, 2.8)),
    dict(id=4, apt=1, kind=3, name='A hall', boxes=[(7.88, 2.83, 8.93, 5.53), (6.07, 4.68, 7.88, 5.53)], lamp=(8.3, 4.6, 2.5, 4.0)),
    dict(id=5, apt=1, kind=4, name='A room', boxes=[(3.07, 0.35, 5.93, 5.53)], lamp=(4.5, 2.94, 2.3, 6.5)),
    dict(id=6, apt=2, kind=3, name='B hall', boxes=[(7.88, 5.67, 8.93, 8.88), (0.08, 5.67, 7.88, 6.67)], lamp=(6.0, 6.17, 2.5, 6.5)),
    dict(id=7, apt=2, kind=2, name='B bath', boxes=[(6.07, 6.75, 7.8, 8.88)], lamp=(6.93, 7.8, 2.42, 2.8)),
    dict(id=8, apt=2, kind=1, name='B kitchen', boxes=[(6.07, 8.96, 8.93, 11.65)], lamp=(7.5, 10.3, 2.5, 4.2)),
    dict(id=9, apt=2, kind=4, name='B living room', boxes=[(3.07, 6.75, 5.93, 11.65)], lamp=(4.5, 9.2, 2.3, 6.5)),
    dict(id=10, apt=2, kind=4, name='B bedroom', boxes=[(0.08, 6.75, 2.93, 11.65)], lamp=(1.5, 9.2, 2.3, 6.5)),
    dict(id=11, apt=2, kind=4, name='B small room', boxes=[(0.08, 0.35, 2.93, 5.53)], lamp=(1.5, 2.94, 2.3, 6.5)),
    dict(id=12, apt=3, kind=3, name='C hall', boxes=[(12.07, 5.67, 13.12, 8.88), (13.12, 5.67, 20.92, 6.67)], lamp=(15.0, 6.17, 2.5, 6.5)),
    dict(id=13, apt=3, kind=2, name='C bath', boxes=[(13.2, 6.75, 14.93, 8.88)], lamp=(14.07, 7.8, 2.42, 2.8)),
    dict(id=14, apt=3, kind=1, name='C kitchen', boxes=[(12.07, 8.96, 14.93, 11.65)], lamp=(13.5, 10.3, 2.5, 4.2)),
    dict(id=15, apt=3, kind=4, name='C living room', boxes=[(15.07, 6.75, 17.93, 11.65)], lamp=(16.5, 9.2, 2.3, 6.5)),
    dict(id=16, apt=3, kind=4, name='C bedroom', boxes=[(18.07, 6.75, 20.92, 11.65)], lamp=(19.5, 9.2, 2.3, 6.5)),
    dict(id=17, apt=4, kind=1, name='D kitchen', boxes=[(12.07, 0.35, 14.93, 2.75)], lamp=(13.5, 1.55, 2.5, 4.2)),
    dict(id=18, apt=4, kind=2, name='D bath', boxes=[(13.2, 2.83, 14.93, 4.6)], lamp=(14.07, 3.7, 2.42, 2.8)),
    dict(id=19, apt=4, kind=3, name='D hall', boxes=[(12.07, 2.83, 13.12, 5.53), (13.12, 4.68, 14.93, 5.53)], lamp=(12.7, 4.6, 2.5, 4.0)),
    dict(id=20, apt=4, kind=4, name='D living room', boxes=[(15.07, 0.35, 17.93, 5.53)], lamp=(16.5, 2.94, 2.3, 6.5)),
    dict(id=21, apt=4, kind=4, name='D bedroom', boxes=[(18.07, 0.35, 20.92, 5.53)], lamp=(19.5, 2.94, 2.3, 6.5)),
]
APTS = {1: 'A', 2: 'B', 3: 'C', 4: 'D'}

# Walls of one floor, as in k5i_plan.py. Named, so the doors can point at them.
_W = [
    ('end_l', ('X', 0.0, 0.08, 0.35, 11.65, [])),
    ('end_r', ('X', 20.92, 21.0, 0.35, 11.65, [])),
    # cross walls on the entrance side
    ('x3f', ('X', 2.93, 3.07, 0.35, 5.53, [])),
    ('x6f', ('X', 5.93, 6.07, 0.35, 5.53, [(4.62, 5.52)])),
    ('core_l', ('X', 8.93, 9.07, 0.35, 11.65, [(3.95, 4.9), (5.75, 6.7)])),
    ('core_r', ('X', 11.93, 12.07, 0.35, 11.65, [(3.95, 4.9), (5.75, 6.7)])),
    ('x15f', ('X', 14.93, 15.07, 0.35, 5.53, [(4.62, 5.52)])),
    ('x18f', ('X', 17.93, 18.07, 0.35, 5.53, [(2.0, 2.9)])),
    # cross walls on the back, behind the corridors
    ('x3b', ('X', 2.93, 3.07, 6.75, 11.65, [])),
    ('x6b', ('X', 5.93, 6.07, 6.75, 11.65, [])),
    ('x15b', ('X', 14.93, 15.07, 6.75, 11.65, [])),
    ('x18b', ('X', 17.93, 18.07, 6.75, 11.65, [])),
    # the middle wall
    ('mid_l', ('Y', 5.53, 5.67, 0.08, 8.93, [(1.0, 1.9)])),
    ('mid_r', ('Y', 5.53, 5.67, 12.07, 20.92, [])),
    # A
    ('a_kit', ('Y', 2.75, 2.83, 6.07, 8.93, [(7.85, 8.75)])),
    ('a_bath_x', ('X', 7.8, 7.88, 2.83, 4.68, [(3.2, 4.0)])),
    ('a_bath_y', ('Y', 4.6, 4.68, 6.07, 7.8, [])),
    # B: the corridor, the bath, the kitchen
    ('b_corr', ('Y', 6.67, 6.75, 0.08, 7.8, [(1.5, 2.4), (4.5, 5.4), (6.4, 7.2)])),
    ('b_bath', ('X', 7.8, 7.88, 6.67, 8.88, [])),
    ('b_kit', ('Y', 8.88, 8.96, 6.07, 8.93, [(7.95, 8.85)])),
    # C, the B arrangement turned over
    ('c_corr', ('Y', 6.67, 6.75, 13.2, 20.92, [(13.8, 14.6), (15.6, 16.5), (18.6, 19.5)])),
    ('c_bath', ('X', 13.12, 13.2, 6.67, 8.88, [])),
    ('c_kit', ('Y', 8.88, 8.96, 12.07, 14.93, [(12.15, 13.05)])),
    # D, the A arrangement turned over
    ('d_kit', ('Y', 2.75, 2.83, 12.07, 14.93, [(12.25, 13.15)])),
    ('d_bath_x', ('X', 13.12, 13.2, 2.83, 4.68, [(3.2, 4.0)])),
    ('d_bath_y', ('Y', 4.6, 4.68, 13.2, 14.93, [])),
    # the lift shaft: its front wall with the doorway, the walls beside it, the solid block behind it
    ('shaft_f', ('Y', 6.8, 6.94, 9.07, 11.93, [(10.1, 10.9)])),
    ('shaft_l', ('X', 9.07, 9.6, 6.94, 8.74, [])),
    ('shaft_r', ('X', 11.4, 11.93, 6.94, 8.74, [])),
    ('core_b', ('Y', 8.74, 11.65, 9.07, 11.93, [])),
]
WALLS = [w for _, w in _W]
_WI = {n: i for i, (n, _) in enumerate(_W)}

# Doors, as in k5i_plan.py
DOORS = [
    # the flat doors open out onto the landing: the halls are too narrow for a leaf swinging in
    dict(kind='apt', wall=_WI['core_l'], a0=3.95, a1=4.9, hinge=1, side=1, room=4, open=0.0),
    dict(kind='apt', wall=_WI['core_l'], a0=5.75, a1=6.7, hinge=1, side=1, room=6, open=0.0),
    dict(kind='apt', wall=_WI['core_r'], a0=5.75, a1=6.7, hinge=1, side=-1, room=12, open=0.0),
    dict(kind='apt', wall=_WI['core_r'], a0=3.95, a1=4.9, hinge=1, side=-1, room=19, open=0.0),
    # A
    dict(kind='kit', wall=_WI['a_kit'], a0=7.85, a1=8.75, hinge=1, side=-1, room=2, open=0.85),
    dict(kind='bath', wall=_WI['a_bath_x'], a0=3.2, a1=4.0, hinge=0, side=-1, room=3, open=0.25),
    dict(kind='room', wall=_WI['x6f'], a0=4.62, a1=5.52, hinge=1, side=-1, room=5, open=0.75),
    dict(kind='bal', wall='front', a0=3.45, a1=4.25, hinge=0, side=1, room=5, open=0.0, z0=0.06),
    # B
    dict(kind='room', wall=_WI['mid_l'], a0=1.0, a1=1.9, hinge=0, side=-1, room=11, open=0.6),
    dict(kind='room', wall=_WI['b_corr'], a0=1.5, a1=2.4, hinge=0, side=1, room=10, open=0.6),
    dict(kind='room', wall=_WI['b_corr'], a0=4.5, a1=5.4, hinge=1, side=1, room=9, open=0.75),
    dict(kind='bath', wall=_WI['b_corr'], a0=6.4, a1=7.2, hinge=0, side=1, room=7, open=0.25),
    dict(kind='kit', wall=_WI['b_kit'], a0=7.95, a1=8.85, hinge=1, side=1, room=8, open=0.85),
    dict(kind='bal', wall='back', a0=3.45, a1=4.25, hinge=0, side=-1, room=9, open=0.0, z0=0.06),
    # C
    dict(kind='kit', wall=_WI['c_kit'], a0=12.15, a1=13.05, hinge=0, side=1, room=14, open=0.85),
    dict(kind='bath', wall=_WI['c_corr'], a0=13.8, a1=14.6, hinge=1, side=1, room=13, open=0.25),
    dict(kind='room', wall=_WI['c_corr'], a0=15.6, a1=16.5, hinge=0, side=1, room=15, open=0.75),
    dict(kind='room', wall=_WI['c_corr'], a0=18.6, a1=19.5, hinge=1, side=1, room=16, open=0.6),
    dict(kind='bal', wall='back', a0=16.75, a1=17.55, hinge=1, side=-1, room=15, open=0.0, z0=0.06),
    # D
    dict(kind='kit', wall=_WI['d_kit'], a0=12.25, a1=13.15, hinge=0, side=-1, room=17, open=0.85),
    dict(kind='bath', wall=_WI['d_bath_x'], a0=3.2, a1=4.0, hinge=0, side=1, room=18, open=0.25),
    dict(kind='room', wall=_WI['x15f'], a0=4.62, a1=5.52, hinge=1, side=1, room=20, open=0.75),
    dict(kind='room', wall=_WI['x18f'], a0=2.0, a1=2.9, hinge=0, side=1, room=21, open=0.6),
    dict(kind='bal', wall='front', a0=16.75, a1=17.55, hinge=1, side=1, room=20, open=0.0, z0=0.06),
]

SWITCH_Z = 1.5
SWITCHES = [
    (2, 7.65, 2.75, 0, -1), (3, 7.88, 4.2, 1, 0), (4, 8.93, 3.75, -1, 0), (5, 5.93, 4.42, -1, 0),
    (6, 8.93, 6.9, -1, 0), (7, 7.4, 6.67, 0, -1), (8, 7.75, 8.96, 0, 1), (9, 5.6, 6.75, 0, 1),
    (10, 1.3, 6.75, 0, 1), (11, 2.1, 5.53, 0, -1),
    (12, 12.07, 6.9, 1, 0), (13, 13.6, 6.67, 0, -1), (14, 13.25, 8.96, 0, 1), (15, 15.4, 6.75, 0, 1),
    (16, 19.7, 6.75, 0, 1),
    (17, 13.35, 2.75, 0, -1), (18, 13.12, 4.2, -1, 0), (19, 12.07, 3.75, 1, 0), (20, 15.07, 4.42, 1, 0),
    (21, 18.07, 3.1, 1, 0),
]
SOCKETS = [(2, 6.07, 1.5, 1, 0, 1.1), (5, 3.07, 3.0, 1, 0, 0.3), (5, 5.93, 1.2, -1, 0, 0.3), (8, 6.07, 10.0, 1, 0, 1.1),
           (9, 3.07, 9.5, 1, 0, 0.3), (10, 0.08, 9.0, 1, 0, 0.3), (11, 0.08, 3.0, 1, 0, 0.3), (14, 14.93, 10.0, -1, 0, 1.1),
           (15, 17.93, 9.5, -1, 0, 0.3), (16, 20.92, 9.0, -1, 0, 0.3), (17, 14.93, 1.5, -1, 0, 1.1),
           (20, 17.93, 3.0, -1, 0, 0.3), (21, 20.92, 4.0, -1, 0, 0.3)]

WINDOWS = [
    ('front', 0.75, 2.25, 0.85, 2.3, 11), ('front', 4.4, 5.6, 0.85, 2.3, 5), ('front', 6.9, 8.1, 0.85, 2.3, 2),
    ('front', 12.9, 14.1, 0.85, 2.3, 17), ('front', 15.4, 16.6, 0.85, 2.3, 20), ('front', 18.75, 20.25, 0.85, 2.3, 21),
    ('back', 0.75, 2.25, 0.85, 2.3, 10), ('back', 4.4, 5.6, 0.85, 2.3, 9), ('back', 6.9, 8.1, 0.85, 2.3, 8),
    ('back', 12.9, 14.1, 0.85, 2.3, 14), ('back', 15.4, 16.6, 0.85, 2.3, 15), ('back', 18.75, 20.25, 0.85, 2.3, 16),
]
STAIR_WINDOW = (9.9, 11.1, 8 * RISE + 0.85, 8 * RISE + 2.05)
VIEW = (16.0, 0.95, 5)


def module_center(j):
    return j * M + M / 2


def as_json():
    return export(sys.modules[__name__])
