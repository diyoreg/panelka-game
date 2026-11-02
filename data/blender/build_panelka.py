"""Generates every 3D asset of Lost in Panelka: Soviet panel blocks, their courtyards and the snow.

Run (headless):
    /Applications/Blender.app/Contents/MacOS/Blender -b -P data/blender/build_panelka.py   (npm run assets)

Output:
    public/models/panelka.glb       all assets in one file, every top-level object is an asset
    data/blender/panelka_assets.blend    source file for manual edits

Conventions (shared with the city of Walk and Relax): Z up, meters, asset origin = center of its base, the front
(entrances) faces -Y, obj["col"] is a JSON list of collider boxes, obj["kind"] building | prop | tree.
Extra properties:
    obj["lights"]  JSON list [x, y, z, range, type] of point lights
                   (w: white mercury street lamp, o: sodium lamp, win: light from a shop window)
    obj["doors"]   JSON list [x, y, z] of entrance lamps above the doors: the game hangs a bulb there
                   (on, off or flickering) and puts a bench next to some of them
Wall UVs are meters (u along the wall from its start, v = height), so the shader can draw the panel seams.
Every window glass has UVs cell + 0..1, the integer cell tells the shader what it is (MODE_PWIN in materials.js):
    cell.x = apartment * 4 + k   k: 0 kitchen, 1 and 2 rooms, 3 balcony door
    cell.x = 4000 + section      stairwell window (cell.y = landing, -1 the transom above the entrance door)
    cell.y = floor
Sizes follow the common series: 1-464 / 1-447 five-storeys (3.2 m module, 2.7 m floors),
II-49 / P-44 type nine- to sixteen-storeys (3.0 m module, 2.8 m floors).
"""
import bpy
import bmesh
import math
import json
import os
import random
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import k5i          # noqa: E402  the buildings with interiors (both plans)
import k5i_plan     # noqa: E402  the khrushchyovka
import k9i_plan     # noqa: E402  the nine-storey with a lift
import k9i          # noqa: E402  its furniture and the lift
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'panelka.glb')
OUT_PLAN = os.path.join(ROOT, 'public', 'models', 'plans.json')
OUT_BLEND = os.path.join(HERE, 'panelka_assets.blend')
TEX = os.path.join(ROOT, 'public', 'tex')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials
# Preview color and texture for Blender. The game draws every material with its own shader (materials.js).
MAT_DEFS = {
    # facades
    'pk_panel9':    ((0.62, 0.62, 0.60), 'panel'),
    'pk_panel9b':   ((0.50, 0.50, 0.50), 'panel_b'),
    'pk_tile9':     ((0.76, 0.72, 0.64), 'tiles'),
    'pk_panel12':   ((0.80, 0.80, 0.78), 'tiles'),
    'pk_panel16':   ((0.66, 0.66, 0.66), 'panel'),
    'pk_panel5':    ((0.70, 0.68, 0.62), 'panel'),
    'pk_brick5':    ((0.72, 0.72, 0.70), 'brick_white'),
    'pk_accent':    ((0.30, 0.42, 0.55), 'tiles'),
    'pk_plinth':    ((0.36, 0.36, 0.36), 'panel_b'),
    'pk_reveal':    ((0.55, 0.55, 0.53), 'panel'),
    'pk_win':       ((0.10, 0.10, 0.12), None),
    'pk_shopwin':   ((1.00, 0.80, 0.50), None),
    'pk_door':      ((0.22, 0.16, 0.12), 'metal_green'),
    'pk_sill':      ((0.60, 0.62, 0.64), 'metal'),
    'pk_snow':      ((0.90, 0.91, 0.94), 'snow'),
    'pk_conc':      ((0.58, 0.58, 0.56), 'panel'),
    'pk_conc_ns':   ((0.50, 0.50, 0.48), 'panel'),
    # balconies
    'pk_bal_white': ((0.82, 0.82, 0.80), 'metal_white'),
    'pk_bal_green': ((0.30, 0.50, 0.42), 'metal_green'),
    'pk_bal_blue':  ((0.32, 0.42, 0.62), 'metal_white'),
    'pk_bal_brown': ((0.42, 0.30, 0.22), 'metal_white'),
    'pk_bal_conc':  ((0.64, 0.64, 0.62), 'panel'),
    'pk_siding':    ((0.84, 0.80, 0.70), 'metal_white'),
    'pk_frame_white': ((0.86, 0.86, 0.84), None),
    'pk_frame_wood': ((0.32, 0.22, 0.15), 'wood_dark'),
    'pk_bglass':    ((0.10, 0.11, 0.13), None),
    # painted metal and other surfaces
    'pk_rail':      ((0.10, 0.10, 0.11), None),
    'pk_paint_green': ((0.12, 0.34, 0.22), None),
    'pk_paint_blue': ((0.12, 0.26, 0.55), None),
    'pk_paint_red': ((0.60, 0.10, 0.08), None),
    'pk_paint_yellow': ((0.80, 0.62, 0.10), None),
    'pk_paint_white': ((0.82, 0.82, 0.80), None),
    'pk_paint_orange': ((0.85, 0.38, 0.08), None),
    'pk_metal':     ((0.55, 0.57, 0.60), 'metal'),
    'pk_rust':      ((0.45, 0.22, 0.12), 'rust'),
    'pk_garage_green': ((0.28, 0.46, 0.38), 'metal_green'),
    'pk_garage_white': ((0.75, 0.74, 0.72), 'metal_white'),
    'pk_brick_red': ((0.55, 0.26, 0.20), 'brick_red'),
    'pk_wood':      ((0.55, 0.45, 0.32), 'planks'),
    'pk_wood_dark': ((0.30, 0.22, 0.16), 'wood_dark'),
    'pk_roof_tin':  ((0.45, 0.47, 0.50), 'metal'),
    'pk_dark':      ((0.03, 0.03, 0.035), None),
    'pk_paper':     ((0.85, 0.84, 0.80), None),
    'pk_ac':        ((0.85, 0.86, 0.86), None),
    'pk_ice':       ((0.35, 0.40, 0.48), 'snow_packed'),
    # nature
    'pk_birch':     ((0.85, 0.85, 0.82), 'birch'),
    'pk_bark':      ((0.30, 0.27, 0.24), 'bark_poplar'),
    'pk_twigs':     ((0.20, 0.17, 0.15), 'twigs'),
    'pk_spruce':    ((0.08, 0.18, 0.12), 'spruce'),
    # cars
    'pk_rubber':    ((0.03, 0.03, 0.03), None),
    'pk_chrome':    ((0.70, 0.72, 0.75), None),
    'pk_headlight': ((0.70, 0.72, 0.68), None),
    'pk_cp_2101':   ((0.78, 0.77, 0.72), None),
    'pk_cp_2107':   ((0.72, 0.62, 0.44), None),
    'pk_cp_2109':   ((0.22, 0.23, 0.25), None),
    'pk_cp_niva':   ((0.82, 0.64, 0.10), None),
    'pk_cp_2141':   ((0.60, 0.62, 0.64), None),
    'pk_carglass':  ((0.08, 0.10, 0.12), None),
    'pk_rim':       ((0.45, 0.46, 0.48), None),
    'pk_turn':      ((0.95, 0.45, 0.08), None),
    'pk_tail':      ((0.55, 0.05, 0.04), None),
    # light
    'pk_glow_w':    ((0.85, 0.92, 1.00), None),
    'pk_glow_o':    ((1.00, 0.62, 0.28), None),
    'pk_glow_bulb': ((1.00, 0.82, 0.55), None),
    'pk_glow_flk':  ((1.00, 0.82, 0.55), None),
    'pk_glow_red':  ((1.00, 0.12, 0.08), None),
    'pk_glow_off':  ((0.10, 0.10, 0.10), None),
    'pk_glow_win':  ((1.00, 0.78, 0.48), None),
    'pk_sign':      ((0.90, 0.30, 0.30), None),
    # khrushchyovka with interiors (k5i.py): the game picks finishes per room in the shader
    'pk_win_i':     ((0.10, 0.10, 0.12), None),
    'pk_door_i':    ((0.22, 0.16, 0.12), 'metal_green'),
    'pk_hatch_i':   ((0.50, 0.52, 0.55), 'metal'),
    'pk_wall_int':  ((0.78, 0.72, 0.60), None),
    'pk_floor_int': ((0.50, 0.34, 0.20), None),
    'pk_ceil_int':  ((0.86, 0.86, 0.83), None),
    'pk_casing':    ((0.84, 0.82, 0.78), None),
    'pk_frame_int': ((0.86, 0.86, 0.84), None),
    'pk_glass_int': ((0.60, 0.70, 0.75), None),
    'pk_glass_door': ((0.75, 0.80, 0.82), None),
    'pk_baseboard': ((0.36, 0.24, 0.16), None),
    'pk_radiator':  ((0.82, 0.80, 0.72), None),
    'pk_switch':    ((0.86, 0.85, 0.80), None),
    'pk_switch_key': ((0.92, 0.91, 0.88), None),
    'pk_stair':     ((0.56, 0.55, 0.53), 'panel_b'),
    'pk_stair_side': ((0.44, 0.56, 0.52), None),
    'pk_handrail':  ((0.32, 0.18, 0.10), None),
    'pk_metal_green': ((0.26, 0.40, 0.32), 'metal_green'),
    'pk_mailbox':   ((0.30, 0.42, 0.56), 'metal_white'),
    'pk_door_base': ((0.36, 0.26, 0.20), 'rust'),
    'pk_mat':       ((0.36, 0.20, 0.14), None),
    'pk_lampshade': ((0.95, 0.90, 0.80), None),
    'pk_lampshade_f': ((0.90, 0.74, 0.50), None),
    'pk_veneer':    ((0.36, 0.20, 0.12), 'wood_dark'),
    'pk_veneer_door': ((0.42, 0.24, 0.14), 'wood_dark'),
    'pk_veneer_light': ((0.76, 0.60, 0.42), 'planks'),
    'pk_fabric':    ((0.50, 0.30, 0.20), None),
    'pk_fabric_dark': ((0.12, 0.12, 0.14), None),
    'pk_leather':   ((0.26, 0.14, 0.08), None),
    'pk_dermantin': ((0.30, 0.15, 0.08), None),
    'pk_bedding':   ((0.62, 0.42, 0.40), None),
    'pk_bedding_b': ((0.40, 0.50, 0.62), None),
    'pk_linen':     ((0.90, 0.90, 0.86), None),
    'pk_drape':     ((0.50, 0.34, 0.24), None),
    'pk_tulle':     ((0.95, 0.95, 0.92), None),
    'pk_carpet':    ((0.55, 0.10, 0.10), None),
    'pk_carpet_edge': ((0.40, 0.10, 0.08), None),
    'pk_rug':       ((0.50, 0.45, 0.40), None),
    'pk_screen_tv': ((0.20, 0.30, 0.40), None),
    'pk_screen_xp': ((0.20, 0.40, 0.80), None),
    'pk_crystal':   ((0.80, 0.85, 0.90), None),
    'pk_dishes':    ((0.92, 0.92, 0.90), None),
    'pk_books':     ((0.50, 0.30, 0.25), None),
    'pk_mirror':    ((0.60, 0.65, 0.70), None),
    'pk_brass':     ((0.70, 0.55, 0.25), None),
    'pk_plastic_beige': ((0.82, 0.78, 0.68), None),
    'pk_plastic_black': ((0.08, 0.08, 0.09), None),
    'pk_plastic_grey': ((0.70, 0.70, 0.72), None),
    'pk_plastic_brown': ((0.36, 0.20, 0.12), None),
    'pk_plastic_red': ((0.66, 0.10, 0.08), None),
    'pk_keys':      ((0.75, 0.72, 0.65), None),
    'pk_glow_green': ((0.30, 1.00, 0.30), None),
    'pk_glow_flame': ((0.30, 0.50, 1.00), None),
    'pk_enamel':    ((0.90, 0.90, 0.88), None),
    'pk_enamel_pot': ((0.85, 0.88, 0.90), None),
    'pk_stove_top': ((0.10, 0.10, 0.10), None),
    'pk_kettle':    ((0.80, 0.30, 0.15), None),
    'pk_sink_well': ((0.40, 0.42, 0.45), None),
    'pk_kitchen':   ((0.80, 0.75, 0.60), None),
    'pk_kitchen_door': ((0.85, 0.80, 0.65), None),
    'pk_counter':   ((0.40, 0.38, 0.35), None),
    'pk_oilcloth':  ((0.80, 0.75, 0.60), None),
    'pk_tub_inside': ((0.92, 0.92, 0.90), None),
    'pk_towel':     ((0.80, 0.40, 0.50), None),
    'pk_coat_a':    ((0.25, 0.22, 0.20), None),
    'pk_coat_b':    ((0.15, 0.18, 0.25), None),
    'pk_coat_c':    ((0.40, 0.30, 0.25), None),
    'pk_fur':       ((0.30, 0.25, 0.20), None),
    'pk_clock':     ((0.90, 0.88, 0.82), None),
    'pk_grille':    ((0.20, 0.15, 0.10), None),
    'pk_globe':     ((0.30, 0.50, 0.70), None),
    'pk_terracotta': ((0.60, 0.30, 0.18), None),
    'pk_plant':     ((0.15, 0.40, 0.15), None),
    'pk_door_int':  ((0.88, 0.88, 0.85), None),
    # the newer styles of the flats (rooms.py)
    'pk_gloss_black': ((0.05, 0.045, 0.05), None),
    'pk_plush':     ((0.58, 0.45, 0.32), None),
    'pk_fabric_grey': ((0.42, 0.43, 0.45), None),
    'pk_cushion_a': ((0.72, 0.62, 0.42), None),
    'pk_cushion_b': ((0.55, 0.60, 0.62), None),
    'pk_bedding_eu': ((0.55, 0.12, 0.14), None),
    'pk_white_matte': ((0.86, 0.86, 0.84), None),
    'pk_wood_oak':  ((0.80, 0.68, 0.50), 'planks'),
    'pk_steel':     ((0.66, 0.68, 0.70), None),
    'pk_glass_black': ((0.03, 0.03, 0.035), None),
    'pk_lace':      ((0.93, 0.92, 0.88), None),
    'pk_iron':      ((0.16, 0.17, 0.18), None),
    'pk_poster_a':  ((0.78, 0.40, 0.32), None),
    'pk_poster_b':  ((0.30, 0.45, 0.60), None),
    'pk_aquarium':  ((0.25, 0.60, 0.62), None),
    'pk_glow_spot': ((1.00, 0.90, 0.72), None),
    'pk_glow_panel': ((0.95, 0.96, 1.00), None),
    'pk_newspaper': ((0.74, 0.72, 0.66), None),
    'pk_jar':       ((0.55, 0.62, 0.42), None),
    'pk_cardboard': ((0.60, 0.46, 0.30), None),
    'pk_rug_eu':    ((0.55, 0.40, 0.30), None),
    'pk_rug_mod':   ((0.70, 0.68, 0.64), None),
    # the lift (k9i.py)
    'pk_lift_frame': ((0.40, 0.36, 0.30), None),
    'pk_lift_wall': ((0.55, 0.38, 0.24), 'planks'),
    'pk_lift_floor': ((0.18, 0.17, 0.16), None),
    'pk_lift_ceil': ((0.62, 0.62, 0.60), None),
    'pk_lift_lamp': ((1.00, 0.92, 0.75), None),
    'pk_lift_door': ((0.52, 0.48, 0.40), 'metal'),
    'pk_lift_panel': ((0.20, 0.18, 0.16), None),
    'pk_floornum': ((0.90, 0.90, 0.88), None),
    'pk_lamp_off':  ((0.25, 0.06, 0.05), None),
    'pk_glow_yellow': ((1.00, 0.80, 0.20), None),
    'pk_chute':     ((0.48, 0.50, 0.46), 'metal'),
}
MATS = {}
IMAGES = {}


def get_image(name):
    if name not in IMAGES:
        path = os.path.join(TEX, name + '.png')
        IMAGES[name] = bpy.data.images.load(path) if os.path.exists(path) else None
    return IMAGES[name]


def material(name):
    if name in MATS:
        return MATS[name]
    color, tex = MAT_DEFS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    if name.startswith('pk_glow') or name in ('pk_sign', 'pk_shopwin'):
        bsdf.inputs['Emission Color'].default_value = (*color, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    m.diffuse_color = (*color, 1.0)
    if tex and get_image(tex):
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = get_image(tex)
        node.interpolation = 'Closest'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['A'].default_value = (*color, 1.0)
        nt.links.new(node.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    MATS[name] = m
    return m


# ------------------------------------------------------------------ mesh builder

def newell(pts):
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        p, q = Vector(pts[i]), Vector(pts[(i + 1) % len(pts)])
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


class Mesh:
    def __init__(self, name, kind='building'):
        self.name = name
        self.kind = kind
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.cols = []
        self.lights = []
        self.extra = {}

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def face(self, pts, m, uvs=None):
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(m)
        f.smooth = False
        f.normal_update()
        n = f.normal if f.normal.length > 1e-6 else Vector((0, 0, 1))
        for i, loop in enumerate(f.loops):
            co = loop.vert.co
            if uvs:
                loop[self.uv].uv = uvs[i]
            elif abs(n.z) > 0.7:
                loop[self.uv].uv = (co.x, co.y)
            else:
                t = Vector((-n.y, n.x, 0))
                t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
                loop[self.uv].uv = (co.dot(t), co.z)
        return f

    def face_n(self, pts, m, n, uvs=None):
        """Face turned so that its normal points along n."""
        if newell(pts).dot(Vector(n)) < 0:
            pts = list(reversed(pts))
            uvs = list(reversed(uvs)) if uvs else None
        return self.face(pts, m, uvs)

    def hexa(self, c, side, top=None, bottom=None):
        """Hexahedron: c = 8 points, bottom 0-3 and top 4-7, counter-clockwise seen from above."""
        top = top or side
        b0, b1, b2, b3, t0, t1, t2, t3 = c
        self.face([b0, b1, t1, t0], side)
        self.face([b1, b2, t2, t1], side)
        self.face([b2, b3, t3, t2], side)
        self.face([b3, b0, t0, t3], side)
        self.face([t0, t1, t2, t3], top)
        if bottom:
            self.face([b3, b2, b1, b0], bottom)

    def box(self, x0, y0, z0, x1, y1, z1, side, top=None, bottom=None, col=False):
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        self.hexa(c, side, top, bottom)
        if col:
            self.col(x0, y0, z0, x1, y1, z1)

    def col(self, x0, y0, z0, x1, y1, z1):
        self.cols.append([round(v, 3) for v in (min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1))])

    def cbox(self, cx, cy, z0, w, d, h, side, top=None, bottom=None, col=False):
        self.box(cx - w / 2, cy - d / 2, z0, cx + w / 2, cy + d / 2, z0 + h, side, top, bottom, col)

    def cyl(self, cx, cy, z0, z1, r, n=8, side='pk_metal', top=None, r1=None, col=False, bottom=None, rot=0.0):
        r1 = r if r1 is None else r1
        top = top or side
        ring0 = [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n), z0) for i in range(n)]
        ring1 = [(cx + r1 * math.cos(rot + 2 * math.pi * i / n), cy + r1 * math.sin(rot + 2 * math.pi * i / n), z1) for i in range(n)]
        circ = 2 * math.pi * max(r, r1)
        for i in range(n):
            j = (i + 1) % n
            u0, u1 = circ * i / n, circ * (i + 1) / n
            self.face([ring0[i], ring0[j], ring1[j], ring1[i]], side, [(u0, z0), (u1, z0), (u1, z1), (u0, z1)])
        if r1 > 0.001:
            self.face(ring1, top)
        if bottom:
            self.face(list(reversed(ring0)), bottom)
        if col:
            rr = max(r, r1)
            self.col(cx - rr, cy - rr, z0, cx + rr, cy + rr, z1)

    def tube(self, p0, p1, r0, r1, m, n=6, cap=True):
        """Tapered cylinder between two points (branches, pipes, chains)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-5:
            return
        d.normalize()
        a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(a).normalized()
        v = d.cross(u)
        ang = [2 * math.pi * i / n for i in range(n)]
        ring0 = [p0 + (u * math.cos(t) + v * math.sin(t)) * r0 for t in ang]
        ring1 = [p1 + (u * math.cos(t) + v * math.sin(t)) * max(r1, 0.0005) for t in ang]
        circ = 2 * math.pi * max(r0, r1)
        for i in range(n):
            j = (i + 1) % n
            mid = (ring0[i] + ring0[j]) / 2 - p0
            self.face_n([ring0[i], ring0[j], ring1[j], ring1[i]], m, mid,
                        [(circ * i / n, 0), (circ * (i + 1) / n, 0), (circ * (i + 1) / n, L), (circ * i / n, L)])
        if cap and r1 > 0.004:
            self.face_n(ring1, m, d)

    def htube(self, x0, y0, z0, x1, y1, z1, r, m, n=6):
        self.tube((x0, y0, z0), (x1, y1, z1), r, r, m, n)

    def pillow(self, x0, y0, z0, x1, y1, z1, m, sub=2, p=0.45, seed=0, jitter=0.06):
        """Rounded box with a flat bottom: snow caps, drifts, mounds."""
        rnd = random.Random(seed)
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=1.0)
        c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, z0))
        h = Vector(((x1 - x0) / 2, (y1 - y0) / 2, z1 - z0))
        idx = self.mi(m)
        vmap = {}
        for v in tmp.verts:
            w = [math.copysign(abs(k) ** p, k) for k in v.co]
            wz = (max(w[2], -0.15) + 0.15) / 1.15
            k = 1 + rnd.uniform(-jitter, jitter)
            vmap[v] = self.bm.verts.new(Vector((c.x + w[0] * h.x * k, c.y + w[1] * h.y * k, c.z + wz * h.z * (k if wz > 0.05 else 1))))
        for f in tmp.faces:
            vs = [vmap[v] for v in f.verts]
            if len(set(vs)) < 3:
                continue
            try:
                nf = self.bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = idx
            # soft snow: smooth normals across the shared vertices
            nf.smooth = True
            for loop in nf.loops:
                loop[self.uv].uv = (loop.vert.co.x + loop.vert.co.y * 0.3, loop.vert.co.y + loop.vert.co.z * 0.3)
        tmp.free()

    def card(self, center, size, angle, m, hang=False, tilt=0.0):
        """Upright square card with full 0..1 UVs (twigs). hang: attached at the top edge, twigs droop down."""
        cx, cy, cz = center
        s = size / 2
        dx, dy = math.cos(angle) * s, math.sin(angle) * s
        ox, oy = -math.sin(angle) * tilt, math.cos(angle) * tilt
        if hang:
            pts = [(cx - dx + ox, cy - dy + oy, cz - size), (cx + dx + ox, cy + dy + oy, cz - size), (cx + dx, cy + dy, cz), (cx - dx, cy - dy, cz)]
            uvs = [(0, 1), (1, 1), (1, 0), (0, 0)]
        else:
            pts = [(cx - dx, cy - dy, cz), (cx + dx, cy + dy, cz), (cx + dx + ox, cy + dy + oy, cz + size), (cx - dx + ox, cy - dy + oy, cz + size)]
            uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        self.face(pts, m, uvs)

    def light(self, x, y, z, rng, kind):
        self.lights.append([round(x, 3), round(y, 3), round(z, 3), rng, kind])

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(ob)
        ob['kind'] = self.kind
        if self.cols:
            ob['col'] = json.dumps(self.cols)
        if self.lights:
            ob['lights'] = json.dumps(self.lights)
        for k, v in self.extra.items():
            ob[k] = v
        return ob


# ------------------------------------------------------------------ facade frames
# A frame is a wall plane: o = start of the wall at ground level, n = outward normal, r = z x n (to the right
# for someone looking at the wall). Points are (u along the wall, out from the wall, z).

class Frame:
    def __init__(self, o, n):
        self.o = Vector(o)
        self.n = Vector(n)
        self.r = Vector((-self.n.y, self.n.x, 0))

    def p(self, u, out, z):
        return self.o + self.r * u + self.n * out + Vector((0, 0, z))


def fbox(m, F, u0, u1, o0, o1, z0, z1, side, top=None, bottom=None, col=False):
    """Axis aligned box given in wall coordinates."""
    a, b = F.p(u0, o0, z0), F.p(u1, o1, z1)
    m.box(min(a.x, b.x), min(a.y, b.y), z0, max(a.x, b.x), max(a.y, b.y), z1, side, top, bottom, col)


def icicles(m, rnd, a, b, z, n, length=0.35):
    """A row of icicles hanging under an edge from point a to point b (Blender coordinates)."""
    a, b = Vector(a), Vector(b)
    for i in range(n):
        t = (i + rnd.uniform(0.1, 0.9)) / n
        p = a + (b - a) * t
        L = length * rnd.uniform(0.3, 1.0)
        m.cyl(p.x, p.y, z - L, z, 0.0, 4, 'pk_ice', r1=rnd.uniform(0.02, 0.04), rot=rnd.uniform(0, 1))


def fquad(m, F, u0, u1, z0, z1, out, mat, uvs=None, n=None):
    pts = [F.p(u0, out, z0), F.p(u1, out, z0), F.p(u1, out, z1), F.p(u0, out, z1)]
    m.face_n(pts, mat, n if n is not None else F.n, uvs)


def wall(m, F, L, z0, z1, holes, mat, uoff=0.0):
    """Flat wall from u = 0..L, z0..z1 with rectangular holes, merged into horizontal runs."""
    us = {0.0, L}
    zs = {z0, z1}
    hs = []
    for (ua, ub, za, zb) in holes:
        za2, zb2 = max(za, z0), min(zb, z1)
        if zb2 <= za2 + 1e-4:
            continue
        hs.append((ua, ub, za2, zb2))
        us.update((ua, ub))
        zs.update((za2, zb2))
    us = sorted(u for u in us if -1e-6 <= u <= L + 1e-6)
    zs = sorted(zs)
    for j in range(len(zs) - 1):
        za, zb = zs[j], zs[j + 1]
        if zb - za < 1e-4:
            continue
        zc = (za + zb) / 2
        run = None
        for i in range(len(us) - 1):
            ua, ub = us[i], us[i + 1]
            uc = (ua + ub) / 2
            solid = not any(h[0] < uc < h[1] and h[2] < zc < h[3] for h in hs)
            if solid:
                run = (run[0] if run else ua, ub)
            if (not solid or i == len(us) - 2) and run:
                a, b = run
                fquad(m, F, a, b, za, zb, 0.0, mat, [(a + uoff, za), (b + uoff, za), (b + uoff, zb), (a + uoff, zb)])
                run = None


def opening(m, F, ua, ub, za, zb, depth, glass, cell=None, sill=True, reveal='pk_reveal'):
    """Recess in the wall: four reveals, glass (or door) at the back, a tin sill that catches snow."""
    p = F.p
    if glass:
        fquad(m, F, ua, ub, za, zb, -depth, glass,
              [(cell[0] + 0.002, cell[1] + 0.002), (cell[0] + 0.998, cell[1] + 0.002), (cell[0] + 0.998, cell[1] + 0.998), (cell[0] + 0.002, cell[1] + 0.998)] if cell else None)
    m.face_n([p(ua, 0, za), p(ua, -depth, za), p(ua, -depth, zb), p(ua, 0, zb)], reveal, F.r)
    m.face_n([p(ub, 0, za), p(ub, -depth, za), p(ub, -depth, zb), p(ub, 0, zb)], reveal, -F.r)
    m.face_n([p(ua, 0, zb), p(ub, 0, zb), p(ub, -depth, zb), p(ua, -depth, zb)], reveal, (0, 0, -1))
    m.face_n([p(ua, 0, za), p(ub, 0, za), p(ub, -depth, za), p(ua, -depth, za)], reveal, (0, 0, 1))
    if sill:
        fbox(m, F, ua - 0.05, ub + 0.05, -depth + 0.04, 0.11, za - 0.04, za + 0.012, 'pk_sill')


# ------------------------------------------------------------------ balconies

BAL_COLORS = ['pk_bal_white', 'pk_bal_white', 'pk_bal_green', 'pk_bal_blue', 'pk_bal_brown', 'pk_siding']


def clutter(m, F, u0, u1, zf, rnd):
    """Things people keep on an open balcony."""
    k = rnd.random()
    d = 1.1
    if k < 0.18:
        # cardboard boxes and a crate
        for i in range(rnd.randint(1, 3)):
            u = rnd.uniform(u0 + 0.3, u1 - 0.6)
            h = rnd.uniform(0.3, 0.6)
            fbox(m, F, u, u + rnd.uniform(0.35, 0.6), 0.1, rnd.uniform(0.4, 0.7), zf, zf + h, 'pk_wood' if rnd.random() < 0.4 else 'pk_paper')
    elif k < 0.3:
        # skis and a sled leaning on the wall
        u = rnd.uniform(u0 + 0.3, u1 - 0.5)
        for s in (0, 0.12):
            m.tube(F.p(u + s, 0.25, zf), F.p(u + s + 0.15, 0.08, zf + 1.75), 0.03, 0.03, 'pk_paint_red', 4)
        fbox(m, F, u1 - 0.9, u1 - 0.2, 0.15, 0.5, zf, zf + 0.25, 'pk_wood_dark')
    elif k < 0.42:
        # laundry line with frozen laundry
        for t in (0.35, 0.7):
            fbox(m, F, u0 + 0.1, u1 - 0.1, t - 0.01, t + 0.01, zf + 1.9, zf + 1.92, 'pk_rail')
            for i in range(rnd.randint(2, 4)):
                u = rnd.uniform(u0 + 0.2, u1 - 0.6)
                fquad(m, F, u, u + rnd.uniform(0.25, 0.5), zf + rnd.uniform(1.2, 1.5), zf + 1.9, t,
                      rnd.choice(['pk_paper', 'pk_paint_blue', 'pk_paint_red', 'pk_bal_white']))
    elif k < 0.5:
        # jars and a bucket on the floor, an old chair
        m.cyl(F.p(u0 + 0.5, 0.5, 0).x, F.p(u0 + 0.5, 0.5, 0).y, zf, zf + 0.35, 0.16, 8, 'pk_metal')
        c = F.p(u1 - 0.6, 0.45, 0)
        m.cbox(c.x, c.y, zf + 0.42, 0.42, 0.42, 0.05, 'pk_wood_dark')
        m.cbox(c.x, c.y, zf, 0.06, 0.06, 0.42, 'pk_rail')
    elif k < 0.56:
        # a small fir tree waiting for New Year
        c = F.p(rnd.uniform(u0 + 0.5, u1 - 0.5), 0.5, 0)
        for i in range(3):
            m.cyl(c.x, c.y, zf + 0.2 + i * 0.35, zf + 0.75 + i * 0.35, 0.36 - i * 0.1, 7, 'pk_spruce', r1=0.02)


def balcony(m, F, u0, u1, zf, style, color, rnd, top_floor, ceiling, hollow=False):
    """hollow: you can walk out onto it (the khrushchyovka with interiors), glazed ones collide only at the walls."""
    d = 1.1
    H = 1.05
    fbox(m, F, u0, u1, 0, d, zf - 0.16, zf, 'pk_conc', 'pk_snow' if top_floor else 'pk_conc_ns', 'pk_conc_ns', col=True)
    if rnd.random() < 0.3:
        icicles(m, rnd, F.p(u0 + 0.1, d + 0.02, 0), F.p(u1 - 0.1, d + 0.02, 0), zf - 0.16, rnd.randint(3, 7), 0.4)
    if style in ('sheet', 'lattice', 'conc'):
        if style == 'sheet':
            fbox(m, F, u0 + 0.03, u1 - 0.03, d - 0.05, d - 0.02, zf + 0.06, zf + H - 0.07, color)
            fbox(m, F, u0, u0 + 0.03, 0.05, d - 0.05, zf + 0.06, zf + H - 0.07, color)
            fbox(m, F, u1 - 0.03, u1, 0.05, d - 0.05, zf + 0.06, zf + H - 0.07, color)
        elif style == 'lattice':
            n = int((u1 - u0) / 0.13)
            for i in range(1, n):
                u = u0 + i * (u1 - u0) / n
                fbox(m, F, u - 0.012, u + 0.012, d - 0.04, d - 0.016, zf, zf + H, 'pk_rail')
            for s in (u0, u1 - 0.025):
                for i in range(1, 8):
                    o = i * d / 8
                    fbox(m, F, s, s + 0.025, o - 0.012, o + 0.012, zf, zf + H, 'pk_rail')
            fbox(m, F, u0, u1, d - 0.045, d - 0.01, zf + 0.12, zf + 0.15, 'pk_rail')
        else:
            # ribbed concrete panel at the front, open sides with a rail
            fbox(m, F, u0, u1, d - 0.09, d, zf, zf + H - 0.05, 'pk_bal_conc', 'pk_snow')
            for i in range(1, int((u1 - u0) / 0.6)):
                u = u0 + i * 0.6
                fbox(m, F, u - 0.03, u + 0.03, d, d + 0.03, zf + 0.05, zf + H - 0.1, 'pk_bal_conc')
            for s in (u0, u1 - 0.04):
                fbox(m, F, s, s + 0.04, 0.0, d - 0.09, zf + 0.5, zf + 0.54, 'pk_rail')
        if style != 'conc':
            # top rail with a line of snow on it, corner posts
            fbox(m, F, u0, u1, d - 0.06, d + 0.005, zf + H - 0.07, zf + H, 'pk_rail')
            fbox(m, F, u0, u0 + 0.05, 0.0, d - 0.06, zf + H - 0.07, zf + H, 'pk_rail')
            fbox(m, F, u1 - 0.05, u1, 0.0, d - 0.06, zf + H - 0.07, zf + H, 'pk_rail')
            for u in (u0, u1 - 0.04):
                fbox(m, F, u, u + 0.04, d - 0.05, d - 0.01, zf, zf + H, 'pk_rail')
        m.col(*F.p(u0, d - 0.1, zf), *F.p(u1, d, zf + H))
        m.col(*F.p(u0, 0, zf), *F.p(u0 + 0.08, d, zf + H))
        m.col(*F.p(u1 - 0.08, 0, zf), *F.p(u1, d, zf + H))
        if top_floor:
            m.pillow(*F.p(u0 + 0.1, 0.05, zf), *F.p(u1 - 0.1, d - 0.1, zf + 0.12), 'pk_snow', 1, 0.5, rnd.randint(0, 999))
        clutter(m, F, u0, u1, zf, rnd)
        # satellite dish on the rail
        if rnd.random() < 0.12:
            c = F.p(rnd.uniform(u0 + 0.4, u1 - 0.4), d + 0.15, zf + H + 0.25)
            m.tube(c, c + F.n * 0.07 + Vector((0, 0, 0.04)), 0.3, 0.33, 'pk_paint_white', 10)
            m.tube(c, c + F.n * 0.45 + Vector((0, 0, 0.1)), 0.012, 0.012, 'pk_rail', 4)
            m.tube(c - Vector((0, 0, 0.35)), c, 0.02, 0.02, 'pk_rail', 4)
    else:
        # glazed: wooden frames from the 80s or white plastic from the 2000s
        frame = 'pk_frame_wood' if style == 'wood' else 'pk_frame_white'
        lower = color if style == 'wood' else 'pk_siding'
        top = ceiling if not top_floor else zf + 2.45
        fbox(m, F, u0, u1, d - 0.06, d, zf, zf + 1.0, lower, frame)
        fbox(m, F, u0, u0 + 0.06, 0, d - 0.06, zf, zf + 1.0, lower, frame)
        fbox(m, F, u1 - 0.06, u1, 0, d - 0.06, zf, zf + 1.0, lower, frame)
        fquad(m, F, u0 + 0.03, u1 - 0.03, zf + 1.0, top, d - 0.04, 'pk_bglass')
        for side, uu in ((-1, u0 + 0.03), (1, u1 - 0.03)):
            pts = [F.p(uu, 0.02, zf + 1.0), F.p(uu, d - 0.04, zf + 1.0), F.p(uu, d - 0.04, top), F.p(uu, 0.02, top)]
            m.face_n(pts, 'pk_bglass', F.r * side)
        n = max(2, round((u1 - u0) / 0.75))
        for i in range(n + 1):
            u = u0 + i * (u1 - u0) / n
            fbox(m, F, max(u0, u - 0.03), min(u1, u + 0.03), d - 0.07, d - 0.01, zf + 1.0, top, frame)
        fbox(m, F, u0, u1, d - 0.08, d, top - 0.06, top, frame)
        fbox(m, F, u0, u1, d - 0.08, d + 0.02, zf + 1.0, zf + 1.05, frame)
        fbox(m, F, u0, u1, d - 0.08, d, zf + 1.0 + (top - zf - 1.0) * 0.72, zf + 1.04 + (top - zf - 1.0) * 0.72, frame)
        for uu in (u0, u1 - 0.05):
            fbox(m, F, uu, uu + 0.05, 0, d - 0.06, top - 0.06, top, frame)
            fbox(m, F, uu, uu + 0.05, d * 0.5 - 0.025, d * 0.5 + 0.025, zf + 1.0, top, frame)
        if top_floor:
            fbox(m, F, u0 - 0.06, u1 + 0.06, 0, d + 0.1, top, top + 0.07, 'pk_metal', 'pk_snow', col=True)
        if hollow:
            m.col(*F.p(u0, d - 0.08, zf), *F.p(u1, d, top))
            m.col(*F.p(u0, 0, zf), *F.p(u0 + 0.07, d, top))
            m.col(*F.p(u1 - 0.07, 0, zf), *F.p(u1, d, top))
            if top_floor:
                m.col(*F.p(u0, 0, top), *F.p(u1, d, top + 0.07))
        else:
            m.col(*F.p(u0, 0, zf), *F.p(u1, d, top))
        # tin ledge with snow under the windows
        fbox(m, F, u0, u1, d, d + 0.08, zf + 0.97, zf + 1.0, 'pk_sill')


# ------------------------------------------------------------------ panel buildings

SERIES = {
    # module width, floor height, plinth, depth, modules of one section on the entrance side and the back
    'p9':  dict(M=3.0, fh=2.8, PL=1.0, D=12.0, front=['L', 'K', 'S', 'K', 'L'], back=['LB', 'L', 'K', 'L', 'LB']),
    'p12': dict(M=3.0, fh=2.8, PL=1.0, D=12.6, front=['LB', 'K', 'S', 'K', 'LB'], back=['LB', 'L', 'LB', 'L', 'LB']),
    't16': dict(M=3.0, fh=2.8, PL=1.2, D=15.0, front=['LB', 'L', 'K', 'S', 'K', 'L', 'LB'], back=['LB', 'L', 'LB', 'K', 'LB', 'L', 'LB']),
    'k5':  dict(M=3.2, fh=2.7, PL=0.8, D=11.4, front=['L', 'S', 'K', 'L'], back=['LB', 'L', 'L', 'LB']),
    # the one you can walk into (k5i_plan.py)
    'k5i': dict(M=k5i_plan.M, fh=k5i_plan.FH, PL=k5i_plan.PL, D=k5i_plan.D, front=k5i_plan.FRONT, back=k5i_plan.BACK),
    'k9i': dict(M=k9i_plan.M, fh=k9i_plan.FH, PL=k9i_plan.PL, D=k9i_plan.D, front=k9i_plan.FRONT, back=k9i_plan.BACK),
}
INNER = {'k5i': k5i_plan, 'k9i': k9i_plan}


def antenna(m, rnd, x, y, z):
    """Old TV antenna: a mast with one or two Yagi booms."""
    h = rnd.uniform(2.5, 4.5)
    m.tube((x, y, z), (x, y, z + h), 0.035, 0.025, 'pk_metal', 5)
    a = rnd.uniform(0, math.pi)
    for k in range(rnd.randint(1, 2)):
        zz = z + h - k * 0.7
        ca, sa = math.cos(a), math.sin(a)
        L = rnd.uniform(1.4, 2.4)
        m.tube((x - ca * L / 2, y - sa * L / 2, zz), (x + ca * L / 2, y + sa * L / 2, zz), 0.02, 0.02, 'pk_metal', 4)
        n = rnd.randint(4, 7)
        for i in range(n):
            t = -L / 2 + L * i / (n - 1)
            e = 0.5 - 0.25 * i / n
            px, py = x + ca * t, y + sa * t
            m.tube((px + sa * e, py - ca * e, zz), (px - sa * e, py + ca * e, zz), 0.01, 0.01, 'pk_metal', 3, cap=False)
    # guy wires
    for k in range(3):
        b = a + k * 2.1
        m.tube((x, y, z + h * 0.7), (x + math.cos(b) * 1.6, y + math.sin(b) * 1.6, z), 0.006, 0.006, 'pk_rail', 3, cap=False)


def panel_building(name, series, sections, floors, seed, wall_mat, bal_style='sheet', glaze=0.45,
                   roof='flat', shop=False, end_windows=False, accent=False, rail=False):
    S = SERIES[series]
    rnd = random.Random(seed)
    M, fh, PL, D = S['M'], S['fh'], S['PL'], S['D']
    nm = len(S['front'])
    P = INNER.get(series)
    inner = P is not None
    # the buildings with interiors have thick end walls outside their sections
    uoff = P.END if inner else 0.0
    L = sections * nm * M + 2 * uoff
    top = PL + floors * fh
    m = Mesh(name)
    F = {
        'front': Frame((-L / 2, -D / 2, 0), (0, -1, 0)),
        'back': Frame((L / 2, D / 2, 0), (0, 1, 0)),
        'left': Frame((-L / 2, D / 2, 0), (-1, 0, 0)),
        'right': Frame((L / 2, -D / 2, 0), (1, 0, 0)),
    }
    parapet = 0.6 if roof == 'flat' else 0.0
    wall_top = top + parapet
    doors = []
    # the color of the balconies in this building (people repaint some of them)
    base_color = rnd.choice(BAL_COLORS)

    for side in ('front', 'back'):
        Fr = F[side]
        mods = S[side] * sections
        holes, plinth_holes = [], []
        shop_mods = set(range(nm)) if (shop and side == 'front') else set()
        if inner:
            doors += inner_facade(m, Fr, side, L, uoff, sections, floors, rnd, base_color, bal_style, glaze, holes, plinth_holes, P)
            mods = []
        for j, kind in enumerate(mods):
            sec = j // nm
            u0 = j * M
            uc = u0 + M / 2
            apt = (j // 2) + (0 if side == 'front' else 500) + sec * 7
            if kind != 'S' and PL > 0.6 and j not in shop_mods:
                plinth_holes.append((uc - 0.25, uc + 0.25, 0.25, 0.5))
                opening(m, Fr, uc - 0.25, uc + 0.25, 0.25, 0.5, 0.25, 'pk_dark', sill=False, reveal='pk_plinth')
            # balconies of this column: floor 0 only sometimes, people built their own
            first_bal = 0 if rnd.random() < 0.45 else 1
            for f in range(floors):
                zf = PL + f * fh
                if j in shop_mods and f == 0 and kind != 'S':
                    # shop on the ground floor: one big lit window per module
                    holes.append((u0 + 0.2, u0 + M - 0.2, zf + 0.2, zf + 2.35))
                    opening(m, Fr, u0 + 0.2, u0 + M - 0.2, zf + 0.2, zf + 2.35, 0.2, 'pk_shopwin', sill=False)
                    continue
                if kind == 'S':
                    if f < floors - 1:
                        za = zf + fh / 2 + 0.85
                        holes.append((uc - 0.6, uc + 0.6, za, za + 1.2))
                        opening(m, Fr, uc - 0.6, uc + 0.6, za, za + 1.2, 0.2, 'pk_win', (4000 + sec, f))
                    continue
                if kind == 'LB' and f >= first_bal:
                    holes.append((uc - 1.1, uc - 0.35, zf + 0.06, zf + 2.25))
                    opening(m, Fr, uc - 1.1, uc - 0.35, zf + 0.06, zf + 2.25, 0.2, 'pk_win', (apt * 4 + 3, f), sill=False)
                    holes.append((uc - 0.2, uc + 1.0, zf + 0.85, zf + 2.3))
                    opening(m, Fr, uc - 0.2, uc + 1.0, zf + 0.85, zf + 2.3, 0.2, 'pk_win', (apt * 4 + 1, f))
                    glazed = rnd.random() < glaze
                    style = (('wood' if rnd.random() < 0.55 else 'pvc') if glazed else bal_style)
                    color = base_color if rnd.random() < 0.75 else rnd.choice(BAL_COLORS)
                    ceiling = zf + fh - 0.16
                    balcony(m, Fr, u0 + 0.08, u0 + M - 0.08, zf, style, color, rnd, f == floors - 1, ceiling)
                    continue
                w = 1.2 if kind == 'K' else 1.5
                k = 0 if kind == 'K' else 1 + (j % 2)
                holes.append((uc - w / 2, uc + w / 2, zf + 0.85, zf + 2.3))
                opening(m, Fr, uc - w / 2, uc + w / 2, zf + 0.85, zf + 2.3, 0.2, 'pk_win', (apt * 4 + k, f))
                # air conditioner next to some windows
                if rnd.random() < 0.035 and f > 0:
                    fbox(m, Fr, uc + w / 2 + 0.15, uc + w / 2 + 0.95, 0, 0.3, zf + 1.0, zf + 1.55, 'pk_ac', 'pk_snow')
            if kind == 'S' and side == 'front':
                # entrance: steel door, transom, canopy with snow, steps, intercom, notices
                plinth_holes.append((uc - 0.65, uc + 0.65, 0.3, 2.55))
                holes.append((uc - 0.65, uc + 0.65, 0.3, 2.55))
                opening(m, Fr, uc - 0.65, uc + 0.65, 0.3, 2.2, 0.3, 'pk_door', sill=False)
                opening(m, Fr, uc - 0.65, uc + 0.65, 2.2, 2.55, 0.3, 'pk_win', (4000 + sec, -1), sill=False)
                fbox(m, Fr, uc + 0.3, uc + 0.42, -0.3, -0.25, 1.05, 1.2, 'pk_metal')
                fbox(m, Fr, uc - 1.6, uc + 1.6, 0, 1.7, 2.72, 2.88, 'pk_conc', 'pk_snow', 'pk_conc_ns', col=True)
                m.pillow(*Fr.p(uc - 1.5, 0.1, 2.88), *Fr.p(uc + 1.5, 1.6, 3.06), 'pk_snow', 2, 0.5, j)
                icicles(m, rnd, Fr.p(uc - 1.55, 1.68, 0), Fr.p(uc + 1.55, 1.68, 0), 2.72, 9, 0.45)
                for s in (-1, 1):
                    c = Fr.p(uc + s * 1.45, 1.55, 0)
                    m.cyl(c.x, c.y, 0.3, 2.72, 0.05, 6, 'pk_rail')
                fbox(m, Fr, uc - 1.2, uc + 1.2, 0, 1.4, 0, 0.15, 'pk_conc', 'pk_conc', col=True)
                fbox(m, Fr, uc - 0.95, uc + 0.95, 0, 0.7, 0.15, 0.3, 'pk_conc', 'pk_conc', col=True)
                fbox(m, Fr, uc + 0.8, uc + 1.0, 0, 0.06, 1.3, 1.6, 'pk_metal')
                fbox(m, Fr, uc - 1.25, uc - 0.8, 0, 0.012, 1.25, 1.65, 'pk_paper')
                fbox(m, Fr, uc + 0.75, uc + 1.05, 0, 0.012, 1.75, 1.95, 'pk_paper')
                fbox(m, Fr, uc - 0.25, uc + 0.25, 0, 0.03, 2.6, 2.7, 'pk_paint_blue')
                b = Fr.p(uc, 0.14, 2.62)
                doors.append([round(b.x, 3), round(b.y, 3), round(b.z, 3)])
        if shop and side == 'front':
            # sign board over the shop windows and its entrance light
            fbox(m, Fr, 0.2, nm * M - 0.2, 0, 0.25, PL + 2.5, PL + 3.25, 'pk_rail', 'pk_snow')
            fquad(m, Fr, 0.4, nm * M - 0.4, PL + 2.58, PL + 3.17, 0.26, 'pk_sign', [(0, 0), (1, 0), (1, 1), (0, 1)])
            c = Fr.p(nm * M / 2, 1.5, 2.4)
            m.light(c.x, c.y, c.z, 11, 'win')
        main = wall_mat
        wall(m, Fr, L, PL, wall_top, holes, main)
        wall(m, Fr, L, 0, PL, plinth_holes, 'pk_plinth')
        if accent:
            # colored panels between the windows of the stair columns
            for j, kind in enumerate(mods):
                if kind == 'K':
                    fbox(m, Fr, j * M + 0.05, j * M + 0.2, 0, 0.04, PL, top, 'pk_accent')

    # ends of the building
    for side in ('left', 'right'):
        Fr = F[side]
        holes = []
        if end_windows:
            n = int(D // M)
            off = (D - n * M) / 2
            for j in range(n):
                uc = off + j * M + M / 2
                k = 0 if j % 2 else 1
                for f in range(floors):
                    zf = PL + f * fh
                    holes.append((uc - 0.6, uc + 0.6, zf + 0.85, zf + 2.3))
                    opening(m, Fr, uc - 0.6, uc + 0.6, zf + 0.85, zf + 2.3, 0.2, 'pk_win', ((900 + j + (0 if side == 'left' else 20)) * 4 + k, f))
        elif inner:
            pass
        elif rnd.random() < 0.5 or series == 'k5':
            uc = D / 2
            for f in range(floors):
                zf = PL + f * fh
                holes.append((uc - 0.45, uc + 0.45, zf + 0.85, zf + 2.0))
                opening(m, Fr, uc - 0.45, uc + 0.45, zf + 0.85, zf + 2.0, 0.2, 'pk_win', ((950 + (0 if side == 'left' else 1)) * 4, f))
        wall(m, Fr, D, PL, wall_top, holes, wall_mat)
        wall(m, Fr, D, 0, PL, [], 'pk_plinth')
    if inner:
        k5i.use(P)
        for sec in range(sections):
            k5i.structure_cols(m, -L / 2 + uoff + sec * P.W, sec == 0, sec == sections - 1)
    else:
        m.col(-L / 2, -D / 2, 0, L / 2, D / 2, top)

    hatches = []
    if inner:
        hx0, hy0, hx1, hy1 = P.HATCH
        for sec in range(sections):
            bx = -L / 2 + uoff + sec * P.W
            hatches.append((bx + hx0, -D / 2 + hy0, bx + hx1, -D / 2 + hy1))
    if roof == 'flat':
        t = 0.28
        roof_face(m, -L / 2 + t, -D / 2 + t, L / 2 - t, D / 2 - t, top, hatches)
        for (x0, y0, x1, y1) in hatches:
            # kerb around the hatch and the lid; the game hides this lid and opens its own when you are near
            for (a0, b0, a1, b1) in ((x0 - 0.1, y0 - 0.1, x1 + 0.1, y0), (x0 - 0.1, y1, x1 + 0.1, y1 + 0.1),
                                     (x0 - 0.1, y0, x0, y1), (x1, y0, x1 + 0.1, y1)):
                m.box(a0, b0, top - 0.25, a1, b1, top + 0.15, 'pk_metal', 'pk_snow')
            m.box(x0 - 0.02, y0, top + 0.15, x1 + 0.02, y1 + 0.04, top + 0.2, 'pk_hatch_i', 'pk_hatch_i')
        for (x0, y0, x1, y1) in ((-L / 2, -D / 2, L / 2, -D / 2 + t), (-L / 2, D / 2 - t, L / 2, D / 2),
                                 (-L / 2, -D / 2 + t, -L / 2 + t, D / 2 - t), (L / 2 - t, -D / 2 + t, L / 2, D / 2 - t)):
            # inner side of the parapet and a cap of snow on it
            m.box(x0 + 0.002, y0 + 0.002, top, x1 - 0.002, y1 - 0.002, wall_top + 0.06, 'pk_conc', 'pk_snow')
            m.col(x0, y0, top, x1, y1, wall_top + 0.06)
        if rail:
            for x in [-L / 2 + 0.2 + i * 2.0 for i in range(int(L / 2.0) + 1)]:
                for y in (-D / 2 + 0.14, D / 2 - 0.14):
                    m.cbox(x, y, wall_top, 0.04, 0.04, 0.9, 'pk_rail')
            for y in (-D / 2 + 0.14, D / 2 - 0.14):
                m.box(-L / 2 + 0.2, y - 0.025, wall_top + 0.85, L / 2 - 0.2, y + 0.025, wall_top + 0.9, 'pk_rail')
        # lift machine rooms and roof exits above every stairwell
        for sec in range(sections):
            sj = sec * nm + S['front'].index('S')
            xs = -L / 2 + uoff + sj * M + M / 2
            if inner and P.ELEVATOR:
                # the lift machine room over the shaft, the roof hatch in front of it
                bx = -L / 2 + uoff + sec * P.W
                x0, y0, x1, y1 = P.STAIR_X[0] - 0.14, P.ELEVATOR['wall'][1], P.STAIR_X[1] + 0.14, P.ELEVATOR['shaft'][3] + 0.3
                m.box(bx + x0, y0 - D / 2, top, bx + x1, y1 - D / 2, top + 2.6, 'pk_conc', 'pk_snow', col=True)
                m.box(bx + x0 + 0.6, y1 - D / 2, top + 0.05, bx + x0 + 1.5, y1 - D / 2 + 0.03, top + 2.0, 'pk_door')
                m.pillow(bx + x0 + 0.1, y0 - D / 2 + 0.1, top + 2.6, bx + x1 - 0.1, y1 - D / 2 - 0.1, top + 2.8, 'pk_snow', 1, 0.5, sec)
                for k in range(rnd.randint(1, 3)):
                    antenna(m, rnd, xs + rnd.choice([-1, 1]) * rnd.uniform(3.0, 8), rnd.uniform(-D / 2 + 1.5, D / 2 - 1.5), top)
                for k in range(2):
                    vx, vy = xs + rnd.choice([-1, 1]) * rnd.uniform(3.0, 8), rnd.uniform(1, D / 2 - 1.5)
                    m.box(vx - 0.35, vy - 0.35, top, vx + 0.35, vy + 0.35, top + 1.1, 'pk_conc', 'pk_snow', col=True)
                continue
            if inner:
                # only the hatch; antennas and vents stay clear of it
                for k in range(rnd.randint(1, 3)):
                    antenna(m, rnd, xs + rnd.choice([-1, 1]) * rnd.uniform(2.5, 6), rnd.uniform(-D / 2 + 1.5, D / 2 - 1.5), top)
                for k in range(2):
                    vx, vy = xs + rnd.choice([-1, 1]) * rnd.uniform(2.5, 6), rnd.uniform(1, D / 2 - 1.5)
                    m.box(vx - 0.35, vy - 0.35, top, vx + 0.35, vy + 0.35, top + 1.1, 'pk_conc', 'pk_snow', col=True)
                continue
            if series == 'k5':
                m.box(xs - 0.6, -D / 2 + 2.0, top, xs + 0.6, -D / 2 + 3.2, top + 0.9, 'pk_conc', 'pk_snow', col=True)
            else:
                m.box(xs - 1.8, -D / 2 + 1.0, top, xs + 1.8, -D / 2 + 5.6, top + 2.8, 'pk_conc', 'pk_snow', col=True)
                m.box(xs + 1.8, -D / 2 + 1.5, top, xs + 1.82, -D / 2 + 2.4, top + 2.0, 'pk_door')
                m.box(xs - 0.6, -D / 2 + 0.98, top + 1.4, xs + 0.6, -D / 2 + 1.0, top + 2.0, 'pk_dark')
                m.pillow(xs - 1.7, -D / 2 + 1.1, top + 2.8, xs + 1.7, -D / 2 + 5.5, top + 3.0, 'pk_snow', 1, 0.5, sec)
            if series != 'k5':
                antenna(m, rnd, xs + rnd.uniform(-1.2, 1.2), -D / 2 + 3.3, top + 2.8)
            for k in range(rnd.randint(1, 3)):
                antenna(m, rnd, xs + rnd.uniform(-5, 5), rnd.uniform(-D / 2 + 1.5, D / 2 - 1.5), top)
            for k in range(2):
                vx, vy = xs + rnd.uniform(-6, 6), rnd.uniform(1, D / 2 - 1.5)
                m.box(vx - 0.35, vy - 0.35, top, vx + 0.35, vy + 0.35, top + 1.1, 'pk_conc', 'pk_snow', col=True)
        if series == 't16':
            for (x, y) in ((-L / 2 + 0.3, -D / 2 + 0.3), (L / 2 - 0.3, D / 2 - 0.3)):
                m.cbox(x, y, wall_top + 0.06, 0.25, 0.25, 0.25, 'pk_glow_red')
    else:
        # low pitched tin roof with dormers, the usual roof of a brick five-storey
        rise = 2.0
        o = 0.45
        zt = top
        for s in (-1, 1):
            pts = [(-L / 2 - o, s * (D / 2 + o), zt - 0.15), (L / 2 + o, s * (D / 2 + o), zt - 0.15), (L / 2 + o, 0, zt + rise), (-L / 2 - o, 0, zt + rise)]
            m.face_n(pts, 'pk_roof_tin', (0, s * 0.7, 1))
            m.face_n(pts, 'pk_wood_dark', (0, -s * 0.7, -1))
            # gables
            g = [(s * L / 2, -D / 2, zt), (s * L / 2, D / 2, zt), (s * L / 2, 0, zt + rise - 0.05)]
            m.face_n(g, wall_mat, (s, 0, 0))
        for s in (-1, 1):
            for k in range(max(1, int(L // 16))):
                x = -L / 2 + 8 + k * 16 + rnd.uniform(-2, 2)
                yy = s * D / 4
                zz = zt + rise * 0.5
                pts = [(x - 0.7, yy, zz - 0.25), (x + 0.7, yy, zz - 0.25), (x, yy, zz + 0.8)]
                m.face_n(pts, 'pk_wood_dark', (0, s, 0))
                m.face_n([(x - 0.7, yy, zz - 0.25), (x, yy, zz + 0.8), (x, yy - s * 1.2, zz + 0.8 + 0.2), (x - 0.7, yy - s * 1.2, zz + 0.2)], 'pk_roof_tin', (-0.6, 0, 1))
                m.face_n([(x + 0.7, yy, zz - 0.25), (x, yy, zz + 0.8), (x, yy - s * 1.2, zz + 0.8 + 0.2), (x + 0.7, yy - s * 1.2, zz + 0.2)], 'pk_roof_tin', (0.6, 0, 1))
        for s in (-1, 1):
            y = s * (D / 2 + o - 0.05)
            icicles(m, rnd, (-L / 2, y, 0), (L / 2, y, 0), zt - 0.15, int(L * 1.2), 0.55)
            # gutters and drainpipes down the facade
            m.htube(-L / 2 - 0.3, s * (D / 2 + 0.3), zt - 0.2, L / 2 + 0.3, s * (D / 2 + 0.3), zt - 0.2, 0.07, 'pk_metal', 6)
            for x in (-L / 2 + 0.4, L / 2 - 0.4) + tuple(-L / 2 + k * L / sections for k in range(1, sections)):
                m.htube(x, s * (D / 2 + 0.12), 0.25, x, s * (D / 2 + 0.12), zt - 0.2, 0.06, 'pk_metal', 6)
                m.htube(x, s * (D / 2 + 0.12), zt - 0.2, x, s * (D / 2 + 0.3), zt - 0.2, 0.06, 'pk_metal', 6)
                m.htube(x, s * (D / 2 + 0.12), 0.25, x, s * (D / 2 + 0.45), 0.08, 0.06, 'pk_metal', 6)
        for k in range(sections):
            x = -L / 2 + (k + 0.5) * L / sections
            m.box(x - 0.4, 1.2, zt + 1.0, x + 0.4, 2.0, zt + 2.6, 'pk_brick_red', 'pk_snow')
            antenna(m, rnd, x + 2.5, 0, zt + rise)
        for i, (h, w) in enumerate(((0.5, D), (1.25, D * 0.62), (1.85, D * 0.25))):
            m.col(-L / 2, -w / 2, zt, L / 2, w / 2, zt + h)
    m.extra['h'] = float(wall_top)
    if doors:
        m.extra['doors'] = json.dumps(doors)
    if inner:
        # the game puts the insides, furniture and doors of every section here (interiors.js)
        m.extra['interior'] = json.dumps(dict(plan=P.NAME, sections=sections, x0=-L / 2 + uoff))
    return m.finish()


def roof_face(m, x0, y0, x1, y1, z, holes):
    """Flat roof covered in snow, with rectangular holes for the hatches."""
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[2] for h in holes]})
    ys = sorted({y0, y1, *[h[1] for h in holes], *[h[3] for h in holes]})
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            a0, a1, b0, b1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            cx, cy = (a0 + a1) / 2, (b0 + b1) / 2
            if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes):
                continue
            m.face([(a0, b0, z), (a1, b0, z), (a1, b1, z), (a0, b1, z)], 'pk_snow')


def inner_facade(m, Fr, side, L, uoff, sections, floors, rnd, base_color, bal_style, glaze, holes, plinth_holes, P):
    """Facade of the khrushchyovka with interiors, from its plan. Every window says which room, section and floor
    it belongs to: cell = (10000 + room, section * 10 + floor, + 500 for a balcony door), so the game lights it
    the same way as the room behind it. The room is counted from the plan's BASE (the game keeps the rooms of all plans
    in one list)."""
    doors = []
    def u_of(sec, x):
        g = uoff + sec * P.W + x
        return g if side == 'front' else L - g
    def span(sec, x0, x1):
        a, b = u_of(sec, x0), u_of(sec, x1)
        return min(a, b), max(a, b)
    mods = P.FRONT if side == 'front' else P.BACK
    for sec in range(sections):
        for j, kind in enumerate(mods):
            if kind not in ('S', 'X'):
                ua, ub = span(sec, P.module_center(j) - 0.25, P.module_center(j) + 0.25)
                plinth_holes.append((ua, ub, 0.25, 0.5))
                opening(m, Fr, ua, ub, 0.25, 0.5, 0.25, 'pk_dark', sill=False, reveal='pk_plinth')
        first_col = rnd.random()
        for f in range(floors):
            zf = P.PL + f * P.FH
            for (s, x0, x1, z0, z1, room) in P.WINDOWS:
                if s != side:
                    continue
                ua, ub = span(sec, x0, x1)
                holes.append((ua, ub, zf + z0, zf + z1))
                opening(m, Fr, ua, ub, zf + z0, zf + z1, 0.2, 'pk_win_i', (10000 + P.BASE + room, sec * 10 + f))
            if side == 'front' and f < floors - 1:
                x0, x1, z0, z1 = P.STAIR_WINDOW
                ua, ub = span(sec, x0, x1)
                holes.append((ua, ub, zf + z0, zf + z1))
                opening(m, Fr, ua, ub, zf + z0, zf + z1, 0.2, 'pk_win_i', (10000 + P.BASE, sec * 10 + f))
            for d in P.DOORS:
                if d['wall'] != side:
                    continue
                ua, ub = span(sec, d['a0'], d['a1'])
                holes.append((ua, ub, zf + 0.06, zf + 2.25))
                opening(m, Fr, ua, ub, zf + 0.06, zf + 2.25, 0.2, 'pk_win_i', (10000 + P.BASE + d['room'], sec * 10 + f + 500), sill=False)
                j = int(d['a0'] // P.M)
                m0, m1 = span(sec, j * P.M + 0.08, (j + 1) * P.M - 0.08)
                glazed = rnd.random() < glaze
                style = (('wood' if rnd.random() < 0.55 else 'pvc') if glazed else bal_style)
                color = base_color if rnd.random() < 0.75 else rnd.choice(BAL_COLORS)
                balcony(m, Fr, m0, m1, zf, style, color, rnd, f == floors - 1, zf + P.FH - 0.16, hollow=True)
        if side == 'front':
            # entrance: a doorway through the wall (the game hangs the door), transom, canopy, steps
            e0, e1, ez0, ez1 = P.ENTRANCE
            ua, ub = span(sec, e0, e1)
            uc = (ua + ub) / 2
            plinth_holes.append((ua, ub, ez0, ez1 + 0.35))
            holes.append((ua, ub, ez0, ez1 + 0.35))
            opening(m, Fr, ua, ub, ez0, ez1, P.T, None, sill=False)
            fquad(m, Fr, ua, ub, ez0, ez1, -0.12, 'pk_door_i')
            opening(m, Fr, ua, ub, ez1, ez1 + 0.35, 0.2, 'pk_win_i', (10000 + P.BASE, sec * 10), sill=False)
            fbox(m, Fr, uc + 0.6, uc + 0.72, -0.3, -0.25, 1.05, 1.2, 'pk_metal')
            fbox(m, Fr, uc - 1.6, uc + 1.6, 0, 1.7, 2.72, 2.88, 'pk_conc', 'pk_snow', 'pk_conc_ns', col=True)
            m.pillow(*Fr.p(uc - 1.5, 0.1, 2.88), *Fr.p(uc + 1.5, 1.6, 3.06), 'pk_snow', 2, 0.5, sec)
            icicles(m, rnd, Fr.p(uc - 1.55, 1.68, 0), Fr.p(uc + 1.55, 1.68, 0), 2.72, 9, 0.45)
            for s in (-1, 1):
                c = Fr.p(uc + s * 1.45, 1.55, 0)
                m.cyl(c.x, c.y, 0.3, 2.72, 0.05, 6, 'pk_rail')
            fbox(m, Fr, uc - 1.2, uc + 1.2, 0, 1.4, 0, 0.15, 'pk_conc', 'pk_conc', col=True)
            fbox(m, Fr, uc - 0.95, uc + 0.95, 0, 0.7, 0.15, 0.3, 'pk_conc', 'pk_conc', col=True)
            fbox(m, Fr, uc + 0.8, uc + 1.0, 0, 0.06, 1.3, 1.6, 'pk_metal')
            fbox(m, Fr, uc - 1.25, uc - 0.8, 0, 0.012, 1.25, 1.65, 'pk_paper')
            fbox(m, Fr, uc + 0.75, uc + 1.05, 0, 0.012, 1.75, 1.95, 'pk_paper')
            fbox(m, Fr, uc - 0.25, uc + 0.25, 0, 0.03, 2.6, 2.7, 'pk_paint_blue')
            b = Fr.p(uc, 0.14, 2.62)
            doors.append([round(b.x, 3), round(b.y, 3), round(b.z, 3)])
    return doors


# ------------------------------------------------------------------ small buildings

def garage_row(name, n=6, seed=1):
    """Row of brick garages with steel gates, a flat roof that collects snow."""
    rnd = random.Random(seed)
    m = Mesh(name)
    w, d, h = 3.3, 6.0, 2.6
    L = n * w
    m.box(-L / 2, -d / 2, 0, L / 2, d / 2, h, 'pk_brick_red', 'pk_snow', col=True)
    m.box(-L / 2 - 0.2, -d / 2 - 0.3, h, L / 2 + 0.2, d / 2 + 0.1, h + 0.15, 'pk_conc', 'pk_snow', col=True)
    m.pillow(-L / 2, -d / 2 - 0.2, h + 0.15, L / 2, d / 2, h + 0.45, 'pk_snow', 2, 0.4, seed)
    icicles(m, rnd, (-L / 2, -d / 2 - 0.28, 0), (L / 2, -d / 2 - 0.28, 0), h, n * 4, 0.5)
    for i in range(n):
        x = -L / 2 + w / 2 + i * w
        gate = rnd.choice(['pk_garage_green', 'pk_rust', 'pk_paint_blue', 'pk_garage_white', 'pk_wood_dark', 'pk_rust'])
        m.box(x - 1.3, -d / 2 - 0.04, 0, x - 0.02, -d / 2, 2.25, gate)
        m.box(x + 0.02, -d / 2 - 0.04, 0, x + 1.3, -d / 2, 2.25, gate)
        m.box(x - 0.06, -d / 2 - 0.08, 1.0, x + 0.06, -d / 2 - 0.04, 1.25, 'pk_rail')
        # snow pushed against the gate by the plough
        if rnd.random() < 0.6:
            m.pillow(x - 1.4, -d / 2 - 1.2, 0, x + 1.4, -d / 2, rnd.uniform(0.3, 0.7), 'pk_snow', 2, 0.6, i + seed * 10)
    m.extra['h'] = h
    return m.finish()


def garage_shell(name, paint, seed=2):
    """"Rakushka": the folding steel shell garage."""
    m = Mesh(name)
    w, d, h = 3.0, 5.6, 2.1
    n = 9
    prof = []
    for i in range(n + 1):
        a = math.pi * i / n
        prof.append((math.cos(a) * w / 2, 0.35 + math.sin(a) * (h - 0.35)))
    prof = [(w / 2, 0)] + prof + [(-w / 2, 0)]
    for i in range(len(prof) - 1):
        (xa, za), (xb, zb) = prof[i], prof[i + 1]
        m.face_n([(xa, -d / 2, za), (xb, -d / 2, zb), (xb, d / 2, zb), (xa, d / 2, za)], paint, ((xa + xb), 0, (za + zb) - 0.4))
    for y, s in ((-d / 2, -1), (d / 2, 1)):
        pts = [(x, y, z) for x, z in prof]
        m.face_n(pts, paint, (0, s, 0))
    m.box(-0.05, -d / 2 - 0.02, 0.0, 0.05, -d / 2, 1.9, 'pk_rail')
    m.pillow(-w / 2 + 0.2, -d / 2, h - 0.3, w / 2 - 0.2, d / 2, h + 0.15, 'pk_snow', 2, 0.6, seed)
    m.col(-w / 2, -d / 2, 0, w / 2, d / 2, h)
    m.extra['h'] = h
    return m.finish()


def transformer():
    """Brick transformer substation with steel doors and a warning sign."""
    m = Mesh('tp', 'building')
    w, d, h = 6.4, 4.4, 3.4
    m.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, 'pk_brick_red', 'pk_snow', col=True)
    m.box(-w / 2 - 0.25, -d / 2 - 0.25, h, w / 2 + 0.25, d / 2 + 0.25, h + 0.2, 'pk_conc', 'pk_snow', col=True)
    m.pillow(-w / 2, -d / 2, h + 0.2, w / 2, d / 2, h + 0.5, 'pk_snow', 2, 0.4, 5)
    for x in (-1.6, 1.4):
        m.box(x - 0.8, -d / 2 - 0.04, 0.1, x + 0.8, -d / 2, 2.4, 'pk_garage_green')
        m.box(x - 0.8, -d / 2 - 0.05, 2.0, x + 0.8, -d / 2 - 0.04, 2.3, 'pk_rail')
    m.face([(-0.25, -d / 2 - 0.05, 1.7), (0.25, -d / 2 - 0.05, 1.7), (0.0, -d / 2 - 0.05, 2.15)], 'pk_paint_yellow')
    for x in (-1.5, 0, 1.5):
        m.cyl(x, 0.6, h + 0.2, h + 0.9, 0.08, 6, 'pk_paint_white')
    m.extra['h'] = h
    return m.finish()


def kiosk():
    """Corner kiosk, open all night: lit window and a sign."""
    m = Mesh('kiosk', 'building')
    w, d, h = 4.2, 3.0, 2.7
    m.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, 'pk_garage_white', 'pk_snow', col=True)
    m.box(-w / 2 - 0.3, -d / 2 - 0.5, h, w / 2 + 0.3, d / 2 + 0.2, h + 0.18, 'pk_metal', 'pk_snow')
    m.pillow(-w / 2 - 0.2, -d / 2 - 0.4, h + 0.18, w / 2 + 0.2, d / 2 + 0.1, h + 0.42, 'pk_snow', 2, 0.5, 3)
    icicles(m, random.Random(8), (-w / 2 - 0.25, -d / 2 - 0.48, 0), (w / 2 + 0.25, -d / 2 - 0.48, 0), h, 8, 0.4)
    m.box(-w / 2 + 0.3, -d / 2 - 0.02, 0.9, w / 2 - 0.3, -d / 2, 2.2, 'pk_shopwin')
    m.box(-w / 2 + 0.3, -d / 2 - 0.25, 0.85, w / 2 - 0.3, -d / 2, 0.9, 'pk_metal', 'pk_snow')
    m.box(-w / 2, -d / 2 - 0.25, 2.3, w / 2, -d / 2 - 0.15, 2.65, 'pk_rail')
    m.face([(-w / 2 + 0.1, -d / 2 - 0.26, 2.33), (w / 2 - 0.1, -d / 2 - 0.26, 2.33), (w / 2 - 0.1, -d / 2 - 0.26, 2.62), (-w / 2 + 0.1, -d / 2 - 0.26, 2.62)],
           'pk_sign', [(0, 0), (1, 0), (1, 1), (0, 1)])
    m.light(0, -d / 2 - 1.4, 2.0, 10, 'win')
    m.extra['h'] = h
    return m.finish()


def container_site():
    """Rubbish containers in a low brick enclosure."""
    m = Mesh('containers', 'prop')
    w, d = 7.0, 2.6
    m.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.12, 'pk_conc', 'pk_snow')
    m.box(-w / 2, d / 2 - 0.25, 0, w / 2, d / 2, 1.5, 'pk_brick_red', 'pk_snow', col=True)
    for s in (-1, 1):
        m.box(s * w / 2 - 0.25 * (s > 0), -d / 2, 0, s * w / 2 + 0.25 * (s < 0), d / 2, 1.5, 'pk_brick_red', 'pk_snow', col=True)
    rnd = random.Random(4)
    for i, x in enumerate((-2.2, 0, 2.2)):
        paint = rnd.choice(['pk_garage_green', 'pk_paint_blue', 'pk_garage_green', 'pk_rust'])
        m.box(x - 0.85, -0.75, 0.25, x + 0.85, 0.75, 1.3, paint, 'pk_rail', col=True)
        m.hexa([(x - 0.88, -0.78, 1.3), (x + 0.88, -0.78, 1.3), (x + 0.88, 0.78, 1.3), (x - 0.88, 0.78, 1.3),
                (x - 0.88, -0.78, 1.36), (x + 0.88, -0.78, 1.36), (x + 0.88, 0.78, 1.42), (x - 0.88, 0.78, 1.42)], 'pk_rail', 'pk_snow')
        for wx in (-0.7, 0.7):
            m.cyl(x + wx, -0.6, 0, 0.25, 0.1, 6, 'pk_rubber')
        m.pillow(x - 0.8, -0.7, 1.42, x + 0.8, 0.7, 1.58, 'pk_snow', 1, 0.5, i)
    # a bag nobody threw in
    m.pillow(2.9, -1.0, 0, 3.5, -0.4, 0.45, 'pk_rubber', 1, 0.7, 9)
    m.extra['h'] = 1.5
    return m.finish()


def hockey_box():
    """Yard hockey rink: wooden boards around a sheet of ice, two goals."""
    m = Mesh('hockey', 'prop')
    w, d, h, c = 28.0, 14.0, 1.15, 2.5
    pts = [(-w / 2 + c, -d / 2), (w / 2 - c, -d / 2), (w / 2, -d / 2 + c), (w / 2, d / 2 - c), (w / 2 - c, d / 2), (-w / 2 + c, d / 2), (-w / 2, d / 2 - c), (-w / 2, -d / 2 + c)]
    m.face([(x, y, 0.03) for x, y in pts], 'pk_ice')
    for i in range(len(pts)):
        (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % len(pts)]
        dx, dy = xb - xa, yb - ya
        L = math.hypot(dx, dy)
        nx, ny = dy / L, -dx / L
        # gap for the gate in the middle of a long side
        segs = [(0, 1)]
        if i == 0:
            segs = [(0, 0.45), (0.55, 1)]
        for (t0, t1) in segs:
            a = (xa + dx * t0, ya + dy * t0)
            b = (xa + dx * t1, ya + dy * t1)
            t = 0.08
            c8 = [(a[0], a[1], 0), (b[0], b[1], 0), (b[0] + nx * t, b[1] + ny * t, 0), (a[0] + nx * t, a[1] + ny * t, 0),
                  (a[0], a[1], h), (b[0], b[1], h), (b[0] + nx * t, b[1] + ny * t, h), (a[0] + nx * t, a[1] + ny * t, h)]
            m.hexa([c8[0], c8[1], c8[2], c8[3], c8[4], c8[5], c8[6], c8[7]] if newell([c8[0], c8[1], c8[2], c8[3]]).z > 0 else
                   [c8[3], c8[2], c8[1], c8[0], c8[7], c8[6], c8[5], c8[4]], 'pk_paint_blue', 'pk_snow')
            m.col(min(a[0], b[0], a[0] + nx * t, b[0] + nx * t), min(a[1], b[1], a[1] + ny * t, b[1] + ny * t), 0,
                  max(a[0], b[0], a[0] + nx * t, b[0] + nx * t), max(a[1], b[1], a[1] + ny * t, b[1] + ny * t), h)
    # snow banks along the boards, shoveled off the ice
    for (x0, y0, x1, y1) in ((-w / 2 + 3, d / 2 - 1.2, w / 2 - 3, d / 2), (-w / 2 + 3, -d / 2, -1.6, -d / 2 + 1.0), (1.6, -d / 2, w / 2 - 3, -d / 2 + 1.0)):
        m.pillow(x0, y0, 0.03, x1, y1, 0.55, 'pk_snow', 2, 0.6, int(x0))
    for s in (-1, 1):
        x = s * (w / 2 - 3.0)
        for y in (-0.9, 0.9):
            m.htube(x, y, 0, x, y, 1.2, 0.04, 'pk_paint_red')
        m.htube(x, -0.9, 1.2, x, 0.9, 1.2, 0.04, 'pk_paint_red')
        m.htube(x, -0.9, 0.02, x + s * 0.9, -0.9, 0.02, 0.03, 'pk_paint_red')
        m.htube(x, 0.9, 0.02, x + s * 0.9, 0.9, 0.02, 0.03, 'pk_paint_red')
    # floodlight on a pole
    m.cyl(-w / 2 - 0.5, d / 2 + 0.5, 0, 7, 0.08, 6, 'pk_metal', col=True)
    m.box(-w / 2 - 0.2, d / 2 + 0.2, 6.8, -w / 2 + 0.3, d / 2 + 0.7, 7.1, 'pk_rail', 'pk_rail', 'pk_glow_w')
    m.light(-w / 2 + 2, d / 2 - 1, 6.6, 24, 'w')
    m.extra['h'] = h
    return m.finish()


# ------------------------------------------------------------------ playground and yard

def swings():
    m = Mesh('swings', 'prop')
    for x in (-1.6, 1.6):
        m.htube(x, -0.9, 0, x, 0, 2.6, 0.05, 'pk_paint_blue')
        m.htube(x, 0.9, 0, x, 0, 2.6, 0.05, 'pk_paint_blue')
    m.htube(-1.7, 0, 2.6, 1.7, 0, 2.6, 0.06, 'pk_paint_red')
    for x, sw in ((-0.75, 0.0), (0.75, 0.15)):
        for dx in (-0.25, 0.25):
            m.htube(x + dx, 0, 2.58, x + dx, sw, 0.55, 0.012, 'pk_metal', 4)
        m.box(x - 0.3, sw - 0.15, 0.5, x + 0.3, sw + 0.15, 0.55, 'pk_wood', 'pk_wood')
    m.col(-1.7, -0.95, 0, -1.5, 0.95, 2.6)
    m.col(1.5, -0.95, 0, 1.7, 0.95, 2.6)
    return m.finish()


def balance():
    m = Mesh('balance', 'prop')
    m.box(-0.15, -0.15, 0, 0.15, 0.15, 0.55, 'pk_paint_red')
    m.hexa([(-2.0, -0.08, 0.35), (2.0, -0.08, 0.85), (2.0, 0.08, 0.85), (-2.0, 0.08, 0.35),
            (-2.0, -0.08, 0.45), (2.0, -0.08, 0.95), (2.0, 0.08, 0.95), (-2.0, 0.08, 0.45)], 'pk_paint_yellow', 'pk_paint_yellow')
    for x, z in ((-1.7, 0.45), (1.7, 0.95)):
        m.box(x - 0.2, -0.18, z, x + 0.2, 0.18, z + 0.05, 'pk_wood', 'pk_wood')
        m.htube(x + 0.2, -0.15, z, x + 0.2, -0.15, z + 0.5, 0.025, 'pk_paint_red')
        m.htube(x + 0.2, 0.15, z, x + 0.2, 0.15, z + 0.5, 0.025, 'pk_paint_red')
        m.htube(x + 0.2, -0.15, z + 0.5, x + 0.2, 0.15, z + 0.5, 0.025, 'pk_paint_red')
    m.col(-2.0, -0.2, 0, 2.0, 0.2, 0.6)
    return m.finish()


def carousel():
    m = Mesh('carousel', 'prop')
    m.cyl(0, 0, 0, 0.35, 0.12, 8, 'pk_rail')
    m.cyl(0, 0, 0.35, 0.42, 1.0, 14, 'pk_paint_red', 'pk_paint_yellow')
    m.cyl(0, 0, 0.42, 0.9, 0.04, 6, 'pk_metal')
    for i in range(4):
        a = i * math.pi / 2
        m.htube(0, 0, 0.9, math.cos(a) * 0.9, math.sin(a) * 0.9, 0.9, 0.025, 'pk_paint_blue')
        m.htube(math.cos(a) * 0.9, math.sin(a) * 0.9, 0.42, math.cos(a) * 0.9, math.sin(a) * 0.9, 0.9, 0.025, 'pk_paint_blue')
    m.col(-1, -1, 0, 1, 1, 0.42)
    return m.finish()


def slide():
    """Steel slide that kids turn into an ice run."""
    m = Mesh('slide', 'prop')
    for x in (-0.4, 0.4):
        for y in (-0.4, 0.4):
            m.htube(x, y, 0, x, y, 2.6, 0.04, 'pk_paint_green')
    m.box(-0.45, -0.45, 1.5, 0.45, 0.45, 1.56, 'pk_wood', 'pk_wood', col=True)
    for i in range(6):
        z = 0.25 + i * 0.25
        m.box(-0.35, 0.45 + (5 - i) * 0.18, z - 0.03, 0.35, 0.55 + (5 - i) * 0.18, z, 'pk_paint_green')
    for x in (-0.35, 0.35):
        m.htube(x, 1.55, 0, x, 0.45, 1.5, 0.03, 'pk_paint_green')
    m.hexa([(-0.35, -0.45, 1.5), (0.35, -0.45, 1.5), (0.35, -3.0, 0.15), (-0.35, -3.0, 0.15),
            (-0.35, -0.45, 1.55), (0.35, -0.45, 1.55), (0.35, -3.0, 0.2), (-0.35, -3.0, 0.2)], 'pk_metal', 'pk_ice')
    for x in (-0.38, 0.38):
        m.hexa([(x - 0.03, -0.45, 1.55), (x + 0.03, -0.45, 1.55), (x + 0.03, -3.0, 0.2), (x - 0.03, -3.0, 0.2),
                (x - 0.03, -0.45, 1.75), (x + 0.03, -0.45, 1.75), (x + 0.03, -3.0, 0.4), (x - 0.03, -3.0, 0.4)], 'pk_metal')
    m.htube(-0.45, -0.45, 2.6, 0.45, -0.45, 2.6, 0.03, 'pk_paint_green')
    m.htube(-0.45, 0.45, 2.6, 0.45, 0.45, 2.6, 0.03, 'pk_paint_green')
    m.col(-0.45, -0.45, 0, 0.45, 0.45, 1.56)
    return m.finish()


def bars():
    """Monkey bars arch and a pull-up bar."""
    m = Mesh('bars', 'prop')
    n = 9
    for s in (-0.5, 0.5):
        prev = None
        for i in range(n + 1):
            a = math.pi * i / n
            p = (math.cos(a) * 2.0, s, math.sin(a) * 2.2)
            if prev:
                m.tube(prev, p, 0.035, 0.035, 'pk_paint_orange', 5)
            prev = p
    for i in range(1, n):
        a = math.pi * i / n
        m.htube(math.cos(a) * 2.0, -0.5, math.sin(a) * 2.2, math.cos(a) * 2.0, 0.5, math.sin(a) * 2.2, 0.022, 'pk_metal', 4)
    for x in (3.0, 4.2):
        m.htube(x, 0, 0, x, 0, 2.3, 0.04, 'pk_paint_blue')
    m.htube(3.0, 0, 2.2, 4.2, 0, 2.2, 0.02, 'pk_metal', 4)
    m.col(-2.05, -0.55, 0, -1.9, 0.55, 0.6)
    m.col(1.9, -0.55, 0, 2.05, 0.55, 0.6)
    return m.finish()


def sandbox():
    """Sandbox under a mushroom roof, full of snow."""
    m = Mesh('sandbox', 'prop')
    s = 1.5
    for (x0, y0, x1, y1) in ((-s, -s, s, -s + 0.12), (-s, s - 0.12, s, s), (-s, -s, -s + 0.12, s), (s - 0.12, -s, s, s)):
        m.box(x0, y0, 0, x1, y1, 0.35, 'pk_wood', 'pk_wood', col=True)
    m.pillow(-s + 0.1, -s + 0.1, 0, s - 0.1, s - 0.1, 0.42, 'pk_snow', 2, 0.6, 2)
    m.htube(0, 0, 0, 0, 0, 2.3, 0.07, 'pk_paint_white')
    m.cyl(0, 0, 2.15, 2.75, 1.3, 10, 'pk_paint_red', r1=0.05, bottom='pk_paint_red')
    m.cyl(0, 0, 2.62, 2.85, 0.75, 10, 'pk_snow', r1=0.05)
    m.col(-0.1, -0.1, 0, 0.1, 0.1, 2.3)
    return m.finish()


def goal():
    m = Mesh('goal', 'prop')
    w, h, d = 3.0, 2.0, 1.2
    for x in (-w / 2, w / 2):
        m.htube(x, 0, 0, x, 0, h, 0.05, 'pk_paint_white')
        m.htube(x, 0, h, x, d, 0, 0.03, 'pk_paint_white')
        m.htube(x, d, 0, x, 0, 0, 0.03, 'pk_paint_white')
    m.htube(-w / 2, 0, h, w / 2, 0, h, 0.05, 'pk_paint_white')
    m.htube(-w / 2, d, 0, w / 2, d, 0, 0.03, 'pk_paint_white')
    m.box(-w / 2, -0.02, h + 0.05, w / 2, 0.06, h + 0.12, 'pk_snow')
    m.col(-w / 2 - 0.05, -0.05, 0, -w / 2 + 0.05, 0.05, h)
    m.col(w / 2 - 0.05, -0.05, 0, w / 2 + 0.05, 0.05, h)
    return m.finish()


def carpet_beater():
    """Frame for beating rugs in the snow, a winter ritual."""
    m = Mesh('beater', 'prop')
    for x in (-1.6, 1.6):
        m.htube(x, 0, 0, x, 0, 2.1, 0.05, 'pk_paint_green')
    for z in (1.2, 2.05):
        m.htube(-1.6, 0, z, 1.6, 0, z, 0.035, 'pk_paint_green')
    m.box(-1.6, -0.03, 2.08, 1.6, 0.03, 2.13, 'pk_snow')
    m.col(-1.65, -0.06, 0, -1.55, 0.06, 2.1)
    m.col(1.55, -0.06, 0, 1.65, 0.06, 2.1)
    return m.finish()


def laundry_poles():
    m = Mesh('laundry', 'prop')
    for x in (-4, 4):
        m.htube(x, 0, 0, x, 0, 2.3, 0.05, 'pk_metal')
        m.htube(x, -0.7, 2.3, x, 0.7, 2.3, 0.04, 'pk_metal')
        m.col(x - 0.06, -0.06, 0, x + 0.06, 0.06, 2.3)
    for y in (-0.6, -0.2, 0.2, 0.6):
        for k in range(8):
            xa, xb = -4 + k, -3 + k
            sa = 0.12 * (1 - ((xa / 4) ** 2))
            sb = 0.12 * (1 - ((xb / 4) ** 2))
            m.tube((xa, y, 2.28 - sa), (xb, y, 2.28 - sb), 0.006, 0.006, 'pk_rail', 3, cap=False)
    return m.finish()


def bench(name='bench', back=True):
    """Courtyard bench: concrete legs, wooden slats under snow."""
    m = Mesh(name, 'prop')
    for x in (-0.75, 0.75):
        m.box(x - 0.08, -0.2, 0, x + 0.08, 0.2, 0.42, 'pk_conc', 'pk_conc')
    for i in range(3):
        y = -0.2 + i * 0.14
        m.box(-0.95, y, 0.42, 0.95, y + 0.11, 0.46, 'pk_wood', 'pk_wood')
    if back:
        for x in (-0.75, 0.75):
            m.box(x - 0.04, 0.2, 0.42, x + 0.04, 0.26, 0.9, 'pk_rail')
        for z in (0.6, 0.78):
            m.box(-0.95, 0.21, z, 0.95, 0.25, z + 0.1, 'pk_wood', 'pk_wood')
    m.pillow(-0.92, -0.2, 0.46, 0.92, 0.2, 0.56, 'pk_snow', 1, 0.5, 3)
    m.col(-0.95, -0.22, 0, 0.95, 0.26, 0.5)
    return m.finish()


def urn():
    m = Mesh('urn', 'prop')
    m.cyl(0, 0, 0, 0.6, 0.22, 8, 'pk_conc', r1=0.28)
    m.cyl(0, 0, 0.6, 0.62, 0.25, 8, 'pk_snow', r1=0.2)
    m.col(-0.28, -0.28, 0, 0.28, 0.28, 0.6)
    return m.finish()


def fence_low(name='fence', paint='pk_paint_green'):
    """Low pipe fence around a lawn, 3 m along X."""
    m = Mesh(name, 'prop')
    for x in (-1.5, 1.5):
        m.htube(x, 0, 0, x, 0, 0.7, 0.03, paint, 5)
    for z in (0.3, 0.68):
        m.htube(-1.5, 0, z, 1.5, 0, z, 0.025, paint, 5)
    m.box(-1.5, -0.025, 0.7, 1.5, 0.025, 0.74, 'pk_snow')
    m.col(-1.5, -0.05, 0, 1.5, 0.05, 0.7)
    return m.finish()


def tires():
    """Half-buried painted tires along a flower bed, a yard classic."""
    m = Mesh('tires', 'prop')
    cols = ['pk_paint_red', 'pk_paint_yellow', 'pk_paint_blue', 'pk_paint_white', 'pk_paint_green']
    for i in range(5):
        x = -1.6 + i * 0.8
        prev = None
        for k in range(8):
            a = math.pi * k / 7
            p = (x + math.cos(a) * 0.32, 0, math.sin(a) * 0.32)
            if prev:
                m.tube(prev, p, 0.09, 0.09, cols[i], 5)
            prev = p
        m.box(x - 0.28, -0.08, 0.38, x + 0.28, 0.08, 0.44, 'pk_snow')
    m.col(-2.0, -0.1, 0, 2.0, 0.1, 0.42)
    return m.finish()


def snowman():
    m = Mesh('snowman', 'prop')
    m.pillow(-0.5, -0.5, 0, 0.5, 0.5, 0.85, 'pk_snow', 2, 0.9, 1, 0.08)
    m.pillow(-0.35, -0.35, 0.72, 0.35, 0.35, 1.35, 'pk_snow', 2, 0.9, 2, 0.06)
    m.pillow(-0.24, -0.24, 1.28, 0.24, 0.24, 1.7, 'pk_snow', 2, 0.9, 3, 0.04)
    m.tube((0, -0.2, 1.5), (0, -0.42, 1.48), 0.04, 0.005, 'pk_paint_orange', 5)
    m.cyl(0, 0, 1.66, 1.88, 0.16, 8, 'pk_metal', r1=0.18)
    for x in (-0.08, 0.08):
        m.cbox(x, -0.21, 1.56, 0.04, 0.02, 0.04, 'pk_dark')
    m.tube((0.3, 0, 1.1), (0.8, 0.1, 1.45), 0.02, 0.01, 'pk_bark', 4)
    m.col(-0.45, -0.45, 0, 0.45, 0.45, 1.7)
    return m.finish()


def drift(name, w, d, h, seed):
    """Plough bank or pile: overlapping round lumps of different heights, never one smooth slab."""
    rnd = random.Random(seed)
    m = Mesh(name, 'prop')
    n = max(2, int(w / 1.3))
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n + rnd.uniform(-0.2, 0.2)
        lw = w / n * rnd.uniform(1.3, 1.8)
        lh = h * rnd.uniform(0.6, 1.0)
        dd = d * rnd.uniform(0.75, 1.0)
        y = rnd.uniform(-0.15, 0.15) * d
        m.pillow(x - lw / 2, y - dd / 2, -0.25, x + lw / 2, y + dd / 2, lh, 'pk_snow', 2, 1.0, rnd.randint(0, 9999), 0.14)
    if h > 0.45:
        m.col(-w / 2 * 0.8, -d / 2 * 0.7, 0, w / 2 * 0.8, d / 2 * 0.7, h * 0.75)
    return m.finish()


# ------------------------------------------------------------------ lamps and power lines

def lamp_post(name, light, kind='conc'):
    """Concrete street lamp pole with a cobra head (or a short steel yard lamp)."""
    m = Mesh(name, 'prop')
    glow = {'w': 'pk_glow_w', 'o': 'pk_glow_o', None: 'pk_glow_off'}[light]
    if kind == 'conc':
        m.cyl(0, 0, 0, 9.0, 0.15, 8, 'pk_conc', r1=0.09)
        m.tube((0, 0.0, 8.4), (0, -1.6, 9.25), 0.045, 0.035, 'pk_rail', 5)
        m.box(-0.18, -2.2, 9.05, 0.18, -1.35, 9.35, 'pk_metal', 'pk_snow')
        m.box(-0.13, -2.1, 8.98, 0.13, -1.45, 9.05, glow)
        m.cols.append([-0.16, -0.16, 0, 0.16, 0.16, 9.0])
        if light:
            m.light(0, -1.8, 8.85, 23, light)
    else:
        m.cyl(0, 0, 0, 5.2, 0.07, 6, 'pk_rail', r1=0.05)
        m.tube((0, 0, 5.1), (0, -0.7, 5.5), 0.04, 0.04, 'pk_rail', 5)
        m.cyl(0, -0.8, 5.25, 5.6, 0.32, 8, 'pk_metal', 'pk_snow', r1=0.12)
        m.cyl(0, -0.8, 5.15, 5.25, 0.2, 8, glow)
        m.cols.append([-0.08, -0.08, 0, 0.08, 0.08, 5.2])
        if light:
            m.light(0, -0.8, 5.0, 16, light)
    return m.finish()


def bulb(name, on):
    """Bare bulb in a little cage over an entrance (placed by the game at obj["doors"])."""
    m = Mesh(name, 'prop')
    m.box(-0.08, 0.0, -0.06, 0.08, 0.1, 0.06, 'pk_rail')
    m.cyl(0, -0.05, -0.2, -0.04, 0.07, 8, on)
    return m.finish()


def lep_tower():
    """Steel lattice pylon of a power line, wires half a span (32 m) each way along X."""
    m = Mesh('lep', 'prop')
    H = 30.0
    levels = [(0, 3.2), (8, 2.2), (16, 1.4), (22, 1.0), (30, 0.6)]
    for (za, wa), (zb, wb) in zip(levels, levels[1:]):
        for sx in (-1, 1):
            for sy in (-1, 1):
                m.tube((sx * wa, sy * wa, za), (sx * wb, sy * wb, zb), 0.08, 0.07, 'pk_metal', 4)
        # cross bracing on every side
        for k in range(4):
            zz0, zz1 = za + (zb - za) * k / 4, za + (zb - za) * (k + 1) / 4
            w0 = wa + (wb - wa) * k / 4
            w1 = wa + (wb - wa) * (k + 1) / 4
            for (ax, ay, bx, by) in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
                m.tube((ax * w0, ay * w0, zz0), (bx * w1, by * w1, zz1), 0.03, 0.03, 'pk_metal', 3, cap=False)
    for z, half in ((16, 6.5), (22, 5.0), (27, 4.0)):
        m.box(-0.15, -half, z - 0.15, 0.15, half, z + 0.15, 'pk_metal', 'pk_snow')
        for y in (-half + 0.3, half - 0.3):
            m.tube((0, y, z), (0, y, z - 1.4), 0.08, 0.08, 'pk_paint_white', 6)
            # sagging wires to the next pylons
            for s in (-1, 1):
                prev = (0, y, z - 1.4)
                for i in range(1, 9):
                    x = s * 32 * i / 8
                    sag = 3.0 * (1 - (abs(x) / 32 - 1) ** 2)
                    p = (x, y, z - 1.4 - sag)
                    m.tube(prev, p, 0.02, 0.02, 'pk_rail', 3, cap=False)
                    prev = p
    m.cyl(0, 0, H, H + 2, 0.05, 4, 'pk_metal')
    m.col(-3.2, -3.2, 0, 3.2, 3.2, 3.0)
    m.extra['h'] = H
    return m.finish()


# ------------------------------------------------------------------ cars

# ------------------------------------------------------------------ detailed cars
# Bodies are lofted from cross-sections along the length with smooth normals: rounded edges, real wheel arches,
# a lofted cabin with tumblehome and a crowned roof, snow blankets that follow the panels,
# proportions from the real cars and the reference sheets in data/sources/*.jpeg. The front is at -X.
# Paint comes from a palette per model in the shader (pk_cp_<model>), every parked car gets its own color.

CAR2 = {
    # L, W, wheelbase, wheel r, sill, top profile [(x from the nose, z)], cabin (windshield base, windshield top,
    # roof end, rear glass base: x from the nose), belt, roof, rear glass base z, style
    '2101': dict(L=4.07, W=1.61, wb=2.42, wr=0.29, sill=0.27,
                 top=[(0.0, 0.70), (0.08, 0.79), (1.2, 0.86), (3.2, 0.88), (4.0, 0.84), (4.07, 0.74)],
                 cab=(1.28, 1.78, 3.02, 3.42), belt=0.87, roof=1.39, rz=0.88,
                 lights='round', grille='chrome', bumper='chrome_over', pillars=(0.04, 0.5, 0.82), molding=True),
    '2107': dict(L=4.13, W=1.62, wb=2.42, wr=0.29, sill=0.27,
                 top=[(0.0, 0.74), (0.06, 0.82), (1.22, 0.87), (3.25, 0.9), (4.08, 0.87), (4.13, 0.76)],
                 cab=(1.3, 1.78, 3.08, 3.45), belt=0.88, roof=1.41, rz=0.9,
                 lights='rect', grille='tall', bumper='chrome_black', pillars=(0.04, 0.5, 0.82), molding=True),
    '2109': dict(L=4.0, W=1.65, wb=2.46, wr=0.29, sill=0.28,
                 top=[(0.0, 0.62), (0.1, 0.7), (1.05, 0.85), (3.6, 0.95), (3.97, 0.95), (4.0, 0.86)],
                 cab=(1.05, 1.82, 3.15, 3.96), belt=0.86, roof=1.37, rz=0.97,
                 lights='narrow', grille='slot', bumper='plastic', pillars=(0.04, 0.46, 0.86), molding=False, hatch=True),
    'niva': dict(L=3.74, W=1.68, wb=2.2, wr=0.36, sill=0.42,
                 top=[(0.0, 0.9), (0.06, 0.99), (0.98, 1.06), (3.66, 1.07), (3.74, 1.0)],
                 cab=(1.0, 1.4, 3.6, 3.7), belt=1.06, roof=1.62, rz=1.07,
                 lights='round_black', grille='black', bumper='steel', pillars=(0.04, 0.6, 0.9), molding=False, hatch=True, doors=2),
    '2141': dict(L=4.35, W=1.69, wb=2.58, wr=0.3, sill=0.28,
                 top=[(0.0, 0.66), (0.1, 0.74), (1.15, 0.86), (3.9, 0.97), (4.3, 0.96), (4.35, 0.88)],
                 cab=(1.15, 1.85, 3.05, 4.1), belt=0.86, roof=1.38, rz=0.98,
                 lights='wide', grille='slot', bumper='plastic', pillars=(0.04, 0.47, 0.9), molding=False, hatch=True),
}


def lerp_profile(pts, x):
    for (xa, za), (xb, zb) in zip(pts, pts[1:]):
        if xa <= x <= xb:
            t = (x - xa) / max(xb - xa, 1e-6)
            return za + (zb - za) * t
    return pts[-1][1] if x > pts[-1][0] else pts[0][1]


def smooth_noise(seed):
    """Smooth 2D noise from a few sines, for the uneven thickness of the snow."""
    r = random.Random(seed)
    w = [(r.uniform(2, 5), r.uniform(2, 6), r.uniform(0, 6.3), r.uniform(0.5, 1.0)) for _ in range(4)]
    tot = sum(a for *_, a in w)
    return lambda u, v: sum(a * math.sin(fu * u + fv * v + ph) for fu, fv, ph, a in w) / tot


def sloft(m, rings, mat_fn, closed=True, smooth=True, uv_scale=1.0):
    """Loft through rings of points with shared vertices and smooth normals.
    mat_fn(i, k, normal, center) picks the material of each face. Faces turn away from the ring centers."""
    V = [[m.bm.verts.new(Vector(p)) for p in r] for r in rings]
    for i in range(len(V) - 1):
        A, B = V[i], V[i + 1]
        cen = (sum((v.co for v in A), Vector()) + sum((v.co for v in B), Vector())) / (len(A) + len(B))
        n = len(A)
        for k in range(n if closed else n - 1):
            j = (k + 1) % n
            vs = [A[k], A[j], B[j], B[k]]
            pts = [v.co for v in vs]
            if (pts[0] - pts[1]).length < 1e-6 and (pts[2] - pts[3]).length < 1e-6:
                continue
            c = sum(pts, Vector()) / 4
            nn = newell(pts)
            out = c - cen
            if nn.dot(out) < 0:
                vs = list(reversed(vs))
                nn = -nn
            nl = nn.normalized() if nn.length > 1e-9 else Vector((0, 0, 1))
            try:
                f = m.bm.faces.new(vs)
            except ValueError:
                continue
            f.material_index = m.mi(mat_fn(i, k, nl, c))
            f.smooth = smooth
            for loop in f.loops:
                co = loop.vert.co
                loop[m.uv].uv = ((co.x + co.y * 0.5) * uv_scale, (co.z + co.y * 0.5) * uv_scale)
    return V


def cap(m, ring_pts, mat, n):
    m.face_n([Vector(p) for p in ring_pts], mat, n)


def body_ring(x, hw, zb, zt, belt, rt, rb, lod=False):
    """Cross-section of the lower body: rounded bottom, slight bulge at the waist, a crease at the belt,
    rounded shoulder up to the hood or trunk. Counter-clockwise seen from the front."""
    pts = []
    def arc(cy, cz, r, a0, a1, n):
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append((x, cy + math.cos(a) * r, cz + math.sin(a) * r))
    zc = min(max(belt, zb + 0.12), zt - 0.03)
    nb, nt = (1, 2) if lod else (2, 3)
    arc(hw - rb, zb + rb, rb, -math.pi / 2, 0, nb)
    pts.append((x, hw + 0.01, zb + (zc - zb) * 0.45))
    if not lod:
        pts.append((x, hw + 0.004, zc - 0.03))
    pts.append((x, hw - 0.004, zc))
    arc(hw - rt, zt - rt, rt, 0, math.pi / 2, nt)
    pts.append((x, 0.0, zt + 0.012))
    arc(-hw + rt, zt - rt, rt, math.pi / 2, math.pi, nt)
    pts.append((x, -hw + 0.004, zc))
    if not lod:
        pts.append((x, -hw - 0.004, zc - 0.03))
    pts.append((x, -hw - 0.01, zb + (zc - zb) * 0.45))
    arc(-hw + rb, zb + rb, rb, math.pi, 1.5 * math.pi, nb)
    return pts


def lathe(m, cx, cy, cz, prof, mat_fn, axis_sign=1, n=20):
    """Surface of revolution around an axis along Y through (cx, cz). prof: [(r, y offset)], y offset grows outward."""
    rings = []
    for (r, dy) in prof:
        rings.append([(cx + math.cos(2 * math.pi * i / n) * r, cy + axis_sign * dy, cz + math.sin(2 * math.pi * i / n) * r) for i in range(n)])
    # faces turn away from the axis: reuse sloft with a fake center by building per pair
    for i in range(len(rings) - 1):
        A = [m.bm.verts.new(Vector(p)) for p in rings[i]]
        B = [m.bm.verts.new(Vector(p)) for p in rings[i + 1]]
        for k in range(n):
            j = (k + 1) % n
            vs = [A[k], A[j], B[j], B[k]]
            pts = [v.co for v in vs]
            c = sum(pts, Vector()) / 4
            ax = Vector((cx, c.y, cz))
            radial = c - ax
            ra, rb = prof[i][0], prof[i + 1][0]
            # outward: away from the axis on the tread, along the axis on flat discs
            want = radial if abs(ra - rb) < abs(prof[i + 1][1] - prof[i][1]) * 2 else Vector((0, axis_sign, 0)) * (1 if rb < ra else -1)
            if newell(pts).dot(want) < 0:
                vs = list(reversed(vs))
            try:
                f = m.bm.faces.new(vs)
            except ValueError:
                continue
            f.material_index = m.mi(mat_fn(i))
            f.smooth = True
            for loop in f.loops:
                loop[m.uv].uv = (loop.vert.co.x, loop.vert.co.z)


def car2(name, model, snow, seed, lod=False):
    """Detailed Soviet car under snow. snow: 0 light, 1 heavy, 2 buried in a mound.
    lod: the same car with far fewer polygons and no small parts, for cars farther than ~40 m."""
    Q = (lambda hi, lo: lo if lod else hi)
    S = CAR2[model]
    rnd = random.Random(seed)
    m = Mesh(name, 'prop')
    paint = 'pk_cp_' + model
    L, W, wr = S['L'], S['W'], S['wr']
    x0 = -L / 2
    X = lambda d: x0 + d
    hw0 = W / 2
    belt, roof, rz = S['belt'], S['roof'], S['rz']
    a, b, c, d = S['cab']
    wheels = [(L - S['wb']) / 2 + (0.03 if model == '2141' else 0), (L - S['wb']) / 2 + S['wb']]
    R = wr + 0.085

    def hw(t):
        e = max(0.0, max(0.4 - t, t - (L - 0.4))) / 0.4
        return hw0 - 0.09 * e ** 2.2

    def zbot(t):
        z = S['sill'] + (0.07 if (t < 0.5 or t > L - 0.55) else 0.0)
        for w in wheels:
            dx = abs(t - w)
            if dx < R:
                z = max(z, wr + math.sqrt(R * R - dx * dx))
        return z

    # ---- lower body, densely sampled, with real wheel arches
    # the arch is sampled by angle, so the straight pieces between the rings never cut into the tire
    arch = [w + R * math.cos(math.pi * i / Q(16, 6)) for w in wheels for i in range(Q(17, 7))]
    ts = sorted(set([i * L / Q(40, 12) for i in range(Q(41, 13))] + arch + [p[0] for p in S['top']]))
    ts = [t for t in ts if not any(R * 0.995 < abs(t - w) < R + 0.04 for w in wheels) or any(abs(abs(t - w) - R) < 1e-6 for w in wheels)]
    ts = [t for t in ts if 0 <= t <= L]
    rings = []
    for t in ts:
        zt = lerp_profile(S['top'], t)
        zb = min(zbot(t), zt - 0.12)
        rings.append(body_ring(X(t), hw(t), zb, zt, belt - 0.03, 0.09 if zt - zb > 0.35 else 0.05, 0.05, lod))
    sloft(m, rings, lambda i, k, n, c: 'pk_rubber' if n.z < -0.6 else paint)
    cap(m, rings[0], paint, (-1, 0, 0))
    cap(m, rings[-1], paint, (1, 0, 0))

    # ---- cabin: lofted from the windshield to the rear glass, tumblehome, crowned roof
    hb = hw0 - 0.045
    hr = hw0 - 0.2
    def cab_top(t):
        if t <= b:
            u = (t - a) / (b - a)
            return belt + (roof - belt) * math.sin(u * math.pi / 2) ** 0.85
        if t <= c:
            return roof
        u = (t - c) / (d - c)
        return roof + (rz - roof) * (1 - math.cos(u * math.pi / 2)) ** 0.9
    xB = a + (d - a) * S['pillars'][1]
    tC = S['pillars'][2]
    cts = sorted(set([a + (d - a) * i / Q(40, 10) for i in range(Q(41, 11))] + [b, c, xB - 0.035, xB + 0.035]))
    crings = []
    for t in cts:
        zt = max(cab_top(t), belt + 0.002)
        zb = belt if t <= b else min(belt, belt + (rz - belt) * max(0.0, (t - c) / (d - c))) if rz < belt else belt
        f = (zt - belt) / (roof - belt)
        hu = hb - (hb - hr) * f
        e = min(0.07, (zt - belt) * 0.5)
        ring = [(X(t), -hb, belt), (X(t), -hu, zt - e), (X(t), -hu + 0.07 * f, zt - 0.01), (X(t), -0.45 * f - 0.05, zt + 0.015 * f),
                (X(t), 0.0, zt + 0.022 * f), (X(t), 0.45 * f + 0.05, zt + 0.015 * f), (X(t), hu - 0.07 * f, zt - 0.01), (X(t), hu, zt - e), (X(t), hb, belt)]
        crings.append(ring)
    dd = d - a
    def cab_mat(i, k, n, cc):
        tt = cc.x - x0
        side = k == 0 or k == 7
        if side:
            if abs(tt - xB) < 0.035:
                return paint
            if (tt - a) / dd > tC:
                return paint
            if (tt - a) / dd < S['pillars'][0] * 1.5:
                return paint
            if S.get('hatch') and S.get('doors', 4) == 4 and abs(tt - (a + dd * (tC - 0.12))) < 0.03:
                return paint
            return 'pk_carglass'
        if abs(n.x) > 0.3 and (k in (2, 3, 4, 5)):
            return 'pk_carglass'
        return paint
    CV = sloft(m, crings, cab_mat, closed=False)
    # A and C pillars as rounded tubes along the edge between windshield and side windows
    for side, kk in ((-1, 1), (1, 7)):
        pts = [Vector(r[kk]) for r, t in zip(crings, cts) if t <= b + 0.02]
        for p0, p1 in zip(pts, pts[1:]):
            m.tube(p0 + Vector((0, side * 0.01, 0)), p1 + Vector((0, side * 0.01, 0)), 0.03, 0.03, paint, 5, cap=False)
        pts = [Vector(r[kk]) for r, t in zip(crings, cts) if t >= c - 0.02]
        for p0, p1 in zip(pts, pts[1:]):
            m.tube(p0 + Vector((0, side * 0.01, 0)), p1 + Vector((0, side * 0.01, 0)), 0.03, 0.03, paint, 5, cap=False)
        # window frame along the belt
        m.tube((X(a + 0.05), side * (hb + 0.006), belt + 0.012), (X(d - 0.05), side * (hb + 0.006), belt + 0.012), 0.014, 0.014,
               'pk_chrome' if S['molding'] else 'pk_rubber', 5)
    # wipers
    for y in (-0.36, 0.14):
        p0 = Vector((X(a + 0.05), y, belt + 0.03))
        m.tube(p0, p0 + Vector((0.12, 0.42, 0.13)), 0.008, 0.008, 'pk_rubber', 3)

    # ---- side details
    for side in (() if lod else (-1, 1)):
        ys = side * (hw0 + 0.012)
        gaps = [a - 0.03, xB]
        if S.get('doors', 4) == 4:
            gaps.append(a + dd * tC - 0.02)
        for gx in gaps:
            m.face_n([(X(gx) - 0.005, ys, zbot(gx) + 0.06), (X(gx) + 0.005, ys, zbot(gx) + 0.06), (X(gx) + 0.005, ys, belt - 0.03), (X(gx) - 0.005, ys, belt - 0.03)], 'pk_rail', (0, side, 0))
        for hx in [xB - 0.2] + ([a + dd * tC - 0.18] if S.get('doors', 4) == 4 else []):
            m.pillow(X(hx) - 0.07, ys - 0.02, belt - 0.13, X(hx) + 0.07, ys + 0.02, belt - 0.09, 'pk_chrome', 1, 0.6, 0, 0)
        if S['molding']:
            m.tube((X(0.3), ys, 0.6), (X(L - 0.3), ys, 0.6), 0.012, 0.012, 'pk_chrome', 5)
        else:
            m.tube((X(wheels[0] + R + 0.05), ys - side * 0.005, S['sill'] + 0.08), (X(wheels[1] - R - 0.05), ys - side * 0.005, S['sill'] + 0.08), 0.035, 0.035, 'pk_rubber', 6)
        # mirror on a stalk
        mx = X(a + 0.14)
        m.tube((mx, side * hb, belt + 0.04), (mx + 0.03, side * (hw0 + 0.06), belt + 0.09), 0.014, 0.014, 'pk_rail', 4)
        m.pillow(mx - 0.035, side * (hw0 + 0.07) - 0.07, belt + 0.06, mx + 0.04, side * (hw0 + 0.07) + 0.07, belt + 0.17, 'pk_rail', 2, 0.55, 1, 0)
        # mud flap behind the rear wheel
        fx = X(wheels[1] + R + 0.02)
        m.box(fx, side * (hw0 - 0.2) - 0.1, 0.12, fx + 0.012, side * (hw0 - 0.2) + 0.1, 0.42, 'pk_rubber')

    # ---- wheels: tire with a rounded sidewall, dished steel rim, chrome cap
    for wt in wheels:
        for side in (-1, 1):
            # rolled lip along the arch: a clean edge where the side meets the wheel well
            prev = None
            for i in range(Q(25, 9)):
                ang = math.pi * i / Q(24, 8)
                tt = wt + R * math.cos(ang)
                p = Vector((X(tt), side * (hw(tt) + 0.004), wr + R * math.sin(ang) + 0.012))
                if p.z < S['sill'] + 0.03:
                    prev = None
                    continue
                if prev is not None:
                    m.tube(prev, p, 0.022, 0.022, paint, 5, cap=False)
                prev = p
            wx = X(wt)
            yo = side * (hw0 - 0.035)
            tw = 0.18
            prof = [(wr * 0.66, -tw), (wr * 0.9, -tw - 0.005), (wr * 0.98, -tw + 0.02), (wr, -tw + 0.05), (wr, -0.05), (wr * 0.98, -0.02), (wr * 0.9, 0.0), (wr * 0.66, 0.003)]
            if lod:
                prof = [prof[0], prof[3], prof[4], prof[7]]
            lathe(m, wx, yo, wr, prof, lambda i: 'pk_rubber', side, Q(22, 10))
            rim = [(wr * 0.66, 0.003), (wr * 0.6, -0.01), (wr * 0.42, -0.03), (wr * 0.36, -0.02), (0.0001, -0.02)]
            if lod:
                rim = [rim[0], rim[-1]]
            lathe(m, wx, yo, wr, rim, lambda i: 'pk_rim', side, Q(18, 8))
            if lod:
                continue
            if model in ('2101', '2107', '2141'):
                hub = [(wr * 0.4, -0.012), (wr * 0.34, 0.01), (wr * 0.2, 0.025), (0.0001, 0.03)]
            else:
                hub = [(wr * 0.2, -0.015), (wr * 0.17, 0.01), (0.0001, 0.015)]
            lathe(m, wx, yo, wr, hub, lambda i: 'pk_chrome' if model in ('2101', '2107', '2141') else 'pk_rim', side, 14)

    # ---- front
    zn = lerp_profile(S['top'], 0.0)
    xf = x0 - 0.004
    zl = zn - 0.115
    chrome_front = S['grille'] in ('chrome', 'tall')
    if S['lights'] in ('round', 'round_black'):
        for s in (-1, 1):
            yy = s * (hw0 - 0.25)
            bez = [(0.098, 0.0), (0.1, -0.012), (0.09, -0.022), (0.082, -0.02)]
            for i in range(len(bez) - 1):
                pass
            ringpts = lambda r, dx: [(xf - dx, yy + math.cos(2 * math.pi * i / 18) * r, zl + math.sin(2 * math.pi * i / 18) * r) for i in range(18)]
            sloft(m, [ringpts(0.1, 0.0), ringpts(0.102, 0.015), ringpts(0.09, 0.025), ringpts(0.082, 0.02)],
                  lambda i, k, n, c: 'pk_chrome' if S['lights'] == 'round' or i < 1 else 'pk_rail')
            sloft(m, [ringpts(0.082, 0.02), ringpts(0.06, 0.03), ringpts(0.0001, 0.034)], lambda i, k, n, c: 'pk_headlight')
        gy = hw0 - 0.37
        m.box(xf - 0.012, -gy, zl - 0.09, xf + 0.01, gy, zl + 0.085, 'pk_chrome' if S['lights'] == 'round' else 'pk_rail')
        for i in range(7):
            z = zl - 0.075 + i * 0.026
            m.box(xf - 0.022, -gy + 0.02, z, xf - 0.012, gy - 0.02, z + 0.01, 'pk_rail' if S['lights'] == 'round' else 'pk_metal')
        m.cbox(xf - 0.026, 0, zl - 0.015, 0.01, 0.07, 0.05, 'pk_chrome')
        for s in (-1, 1):
            m.pillow(xf - 0.02, s * (hw0 - 0.11) - 0.05, zl - 0.18, xf + 0.01, s * (hw0 - 0.11) + 0.05, zl - 0.1, 'pk_turn', 1, 0.6, 2, 0)
    else:
        lw, lh = {'rect': (0.3, 0.15), 'narrow': (0.34, 0.085), 'wide': (0.42, 0.12)}[S['lights']]
        for s in (-1, 1):
            yy = s * (hw0 - 0.12 - lw / 2)
            m.box(xf - 0.02, yy - lw / 2 - 0.015, zl - lh / 2 - 0.015, xf + 0.01, yy + lw / 2 + 0.015, zl + lh / 2 + 0.015, 'pk_chrome' if chrome_front else 'pk_rail')
            inner = 0.06 if S['lights'] == 'rect' else 0.0
            m.pillow(xf - 0.032, yy - lw / 2 + 0.012, zl - lh / 2 + 0.01, xf - 0.016, yy + lw / 2 - 0.012 - (inner if s > 0 else 0), zl + lh / 2 - 0.01, 'pk_headlight', 1, 0.35, 3, 0)
            if inner:
                m.box(xf - 0.03, yy + s * (lw / 2 - inner) - 0.03 * (s < 0), zl - lh / 2 + 0.01, xf - 0.016, yy + s * (lw / 2 - 0.012) + 0.03 * (s < 0), zl + lh / 2 - 0.01, 'pk_turn')
            else:
                m.box(xf - 0.03, s * (hw0 - 0.045) - 0.03, zl - lh / 2, xf - 0.012, s * (hw0 - 0.045) + 0.03, zl + lh / 2, 'pk_turn')
        gy = hw0 - 0.14 - lw
        if S['grille'] == 'tall':
            m.box(xf - 0.05, -gy, zl - 0.11, xf + 0.01, gy, zl + 0.1, 'pk_chrome')
            for i in range(8):
                z = zl - 0.095 + i * 0.026
                m.box(xf - 0.06, -gy + 0.025, z, xf - 0.05, gy - 0.025, z + 0.012, 'pk_rail')
            m.cbox(xf - 0.065, 0, zl - 0.03, 0.01, 0.06, 0.06, 'pk_chrome')
        else:
            m.box(xf - 0.015, -gy, zl - 0.035, xf + 0.01, gy, zl + 0.035, 'pk_rail')
            for i in range(3):
                m.box(xf - 0.022, -gy + 0.02, zl - 0.028 + i * 0.022, xf - 0.015, gy - 0.02, zl - 0.02 + i * 0.022, 'pk_metal')
            m.cbox(xf - 0.026, 0, zl - 0.02, 0.008, 0.05, 0.04, 'pk_chrome')

    # ---- bumpers: a rounded bar that bends around the corners of the body
    zb0 = S['sill'] + 0.06
    def bumper(front, mat, h, depth, z0):
        s = -1 if front else 1
        xe = X(0) if front else X(L)
        path = []
        for i in range(Q(17, 7)):
            u = -1 + 2 * i / Q(16, 6)
            y = u * (hw0 + 0.005)
            bend = max(0.0, abs(u) - 0.82) / 0.18
            x = xe + s * (0.05 - 0.17 * bend ** 1.5)
            path.append((x, y))
        rings = []
        for (x, y) in path:
            rr = []
            for k in range(Q(8, 4)):
                ang = 2 * math.pi * k / Q(8, 4) + math.pi / Q(8, 4)
                rr.append((x + s * (math.cos(ang) * depth / 2 + depth / 2 - 0.02), y, z0 + h / 2 + math.sin(ang) * h / 2))
            rings.append(rr)
        sloft(m, rings, lambda i, k, n, c: mat)
        cap(m, rings[0], mat, (0, -1, 0))
        cap(m, rings[-1], mat, (0, 1, 0))
    if S['bumper'].startswith('chrome'):
        for front in (True, False):
            bumper(front, 'pk_chrome', 0.1, 0.08, zb0)
            if S['bumper'] == 'chrome_black':
                bumper(front, 'pk_rubber', 0.035, 0.09, zb0 + 0.035)
            else:
                xe = X(0) - 0.08 if front else X(L) + 0.08
                for yy in (-0.38, 0.38):
                    m.pillow(xe - 0.035, yy - 0.03, zb0 - 0.07, xe + 0.035, yy + 0.03, zb0 + 0.18, 'pk_chrome', 1, 0.5, 4, 0)
    else:
        mat = 'pk_rubber' if S['bumper'] == 'plastic' else 'pk_rim'
        for front in (True, False):
            bumper(front, mat, 0.22 if S['bumper'] == 'plastic' else 0.12, 0.12, zb0 - 0.05)
    # plates
    m.box(X(0) - 0.13, -0.26, zb0 + 0.0, X(0) - 0.115, 0.26, zb0 + 0.11, 'pk_paper')
    xr = X(L) + 0.005
    zt_r = lerp_profile(S['top'], L) - 0.08
    m.box(xr - 0.005, -0.26, zt_r - 0.22, xr + 0.012, 0.26, zt_r - 0.1, 'pk_paper')
    # tail lights: red, amber and a white reversing light in one block
    for s in (-1, 1):
        yy = s * (hw0 - 0.2)
        m.box(xr - 0.01, yy - 0.17, zt_r - 0.13, xr + 0.01, yy + 0.17, zt_r + 0.01, 'pk_rail')
        m.pillow(xr + 0.0, yy - 0.16, zt_r - 0.12, xr + 0.018, yy + 0.04, zt_r, 'pk_tail', 1, 0.35, 5, 0)
        m.pillow(xr + 0.0, yy + 0.05, zt_r - 0.12, xr + 0.018, yy + 0.16, zt_r - 0.05, 'pk_turn', 1, 0.35, 6, 0)
        m.pillow(xr + 0.0, yy + 0.05, zt_r - 0.045, xr + 0.018, yy + 0.16, zt_r, 'pk_headlight', 1, 0.35, 7, 0)
    m.tube((xr - 0.35, -hw0 + 0.4, 0.2), (xr + 0.06, -hw0 + 0.4, 0.21), 0.026, 0.026, 'pk_rail', 8)

    # ---- snow: blankets that follow the hood, the trunk and the roof, uneven, with soft edges
    t = (0.15, 0.3, 0.4)[snow]
    nz = smooth_noise(seed)
    def blanket(t0, t1, top_fn, half_fn, th, overhang, crown=0.02):
        n = max(Q(6, 3), int((t1 - t0) / Q(0.07, 0.25)))
        rings = []
        for i in range(n + 1):
            u = i / n
            tt = t0 + (t1 - t0) * u
            fade = min(1.0, u / 0.12, (1 - u) / 0.12) if snow < 2 else 1.0
            fade = fade * fade * (3 - 2 * fade)
            z = top_fn(tt)
            hwv = half_fn(tt)
            rr = []
            K = Q(10, 4)
            for k in range(K + 1):
                v = -1 + 2 * k / K
                edge = abs(v)
                thick = th * fade * (0.8 + 0.35 * nz(tt * 3.1, v * 2.3)) * (1 - edge ** 6)
                y = v * (hwv + overhang * fade * (edge ** 4))
                zz = z - 0.02 - 0.06 * edge ** 3 + thick + crown * (1 - v * v)
                rr.append((X(tt), y, zz))
            rings.append(rr)
        sloft(m, rings, lambda i, k, nn, cc: 'pk_snow', closed=False)
        # the underside so the edge has a thickness
        # a short lip under the edge, tucked in, so the blanket has a thickness but does not hang down the sides
        under = [[(p[0], p[1] * 0.97, p[2] - 0.035) for p in (r[0], r[-1])] for r in rings]
        for side in (0, 1):
            ed = [[r[0 if side == 0 else -1], u[side]] for r, u in zip(rings, under)]
            sloft(m, [list(e) for e in ed], lambda i, k, nn, cc: 'pk_snow', closed=False)
    top = lambda tt: lerp_profile(S['top'], tt)
    blanket(0.06, a - 0.02, top, lambda tt: hw(tt) - 0.04, t * 0.85, 0.06)
    if not S.get('hatch'):
        blanket(d + 0.02, L - 0.05, top, lambda tt: hw(tt) - 0.04, t * 0.8, 0.05)
    else:
        blanket(L - 0.32, L - 0.03, top, lambda tt: hw(tt) - 0.08, t * 0.45, 0.02)
    blanket(b - 0.12, c + 0.1, lambda tt: cab_top(tt) + 0.005, lambda tt: hr - 0.02 + (hb - hr) * (1 - (cab_top(tt) - belt) / (roof - belt)) * 0.5, t, 0.07, 0.03)
    # snow piled at the foot of the windshield and on the bumpers
    m.pillow(X(a - 0.06), -hb + 0.05, belt - 0.02, X(a + 0.2), hb - 0.05, belt + 0.06 + t * 0.4, 'pk_snow', Q(2, 1), 0.8, seed + 7, 0.1)
    for xb in (X(0) - 0.1, X(L) + 0.0):
        m.pillow(xb, -hw0 + 0.06, zb0 + 0.09, xb + 0.1, hw0 - 0.06, zb0 + 0.14, 'pk_snow', 2, 0.7, seed + 9, 0.05)
    # soft mounds at the tires, a drift on one side
    for wt in wheels:
        for side in (-1, 1):
            cx = X(wt) + rnd.uniform(-0.12, 0.12)
            m.pillow(cx - 0.36, side * (hw0 - 0.08) - 0.24, -0.15, cx + 0.36, side * (hw0 - 0.08) + 0.24, 0.2 + 0.08 * snow, 'pk_snow', Q(2, 1), 1.0, rnd.randint(0, 999), 0.1)
    if snow >= 1:
        s = rnd.choice([-1, 1])
        m.pillow(X(0.3), s * hw0 - 0.32, -0.25, X(L - 0.3), s * hw0 + 0.32, 0.42 + 0.2 * (snow - 1), 'pk_snow', Q(2, 1), 1.0, seed + 11, 0.1)
    roof_top = roof + t
    if snow >= 2:
        m.pillow(X(0) - 0.25, -hw0 - 0.3, -0.3, X(L) + 0.25, hw0 + 0.3, belt + 0.1, 'pk_snow', Q(3, 2), 0.95, seed + 13, 0.05)
        m.pillow(X(a - 0.15), -hb - 0.1, belt - 0.25, X(d + 0.15), hb + 0.1, roof + t - 0.04, 'pk_snow', Q(3, 2), 0.95, seed + 14, 0.05)
    m.col(X(0) - 0.1, -hw0, 0, X(L) + 0.1, hw0, roof_top)
    m.extra['h'] = roof_top
    return m.finish()


# ------------------------------------------------------------------ trees

def branch(m, rnd, p, d, L, r, depth, bark, ends, droop=0.0, up=0.25):
    end = p + d * L
    m.tube(p, end, r, r * 0.62, bark, 5 if r > 0.06 else 4)
    if depth == 0 or r < 0.02:
        ends.append((end, d))
        return
    nb = rnd.randint(2, 3)
    for i in range(nb):
        t = rnd.uniform(0.5, 1.0)
        start = p + d * (L * t)
        a = rnd.uniform(0, 2 * math.pi)
        side = Vector((math.cos(a), math.sin(a), 0))
        nd = (d + side * rnd.uniform(0.5, 1.0) + Vector((0, 0, up - droop))).normalized()
        branch(m, rnd, start, nd, L * rnd.uniform(0.55, 0.75), r * 0.58, depth - 1, bark, ends, droop, up)
    ends.append((end, d))


def birch(name, seed, h=11.0):
    """Birch: chalk white trunk, thin hanging twigs, snow lines on the branches."""
    rnd = random.Random(seed)
    m = Mesh(name, 'tree')
    lean = Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), 1)).normalized()
    m.tube((0, 0, 0), lean * h, 0.17, 0.05, 'pk_birch', 7)
    ends = []
    for i in range(7):
        z = h * rnd.uniform(0.35, 0.9)
        a = rnd.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), rnd.uniform(0.8, 1.6))).normalized()
        branch(m, rnd, lean * z, d, rnd.uniform(2.0, 3.5) * (1.1 - z / h), 0.07, 2, 'pk_birch', ends, droop=0.25, up=0.2)
    for (e, d) in ends:
        for k in range(2):
            m.card(tuple(e), rnd.uniform(1.4, 2.2), rnd.uniform(0, math.pi), 'pk_twigs', hang=True, tilt=rnd.uniform(-0.3, 0.3))
    m.col(-0.2, -0.2, 0, 0.2, 0.2, 3)
    return m.finish()


def poplar(name, seed, cut=False):
    """Poplar: tall, upright branches. cut: pollarded the Soviet way, a stubby trunk with bunches of shoots."""
    rnd = random.Random(seed)
    m = Mesh(name, 'tree')
    h = 9.0 if cut else 17.0
    m.tube((0, 0, 0), (0, 0, h), 0.35 if cut else 0.3, 0.16 if cut else 0.06, 'pk_bark', 7)
    ends = []
    if cut:
        for i in range(5):
            z = h * rnd.uniform(0.55, 1.0)
            a = rnd.uniform(0, 2 * math.pi)
            p = Vector((0, 0, z))
            stub = p + Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, 1.2))
            m.tube(p, stub, 0.16, 0.12, 'pk_bark', 5)
            for k in range(5):
                d = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 1)).normalized()
                e = stub + d * rnd.uniform(1.6, 2.6)
                m.tube(stub, e, 0.03, 0.01, 'pk_bark', 3)
                ends.append((e, d))
        for (e, d) in ends:
            m.card((e.x, e.y, e.z - 1.6), 2.0, rnd.uniform(0, math.pi), 'pk_twigs')
    else:
        for i in range(10):
            z = h * rnd.uniform(0.25, 0.92)
            a = rnd.uniform(0, 2 * math.pi)
            d = Vector((math.cos(a) * 0.35, math.sin(a) * 0.35, 1)).normalized()
            branch(m, rnd, Vector((0, 0, z)), d, rnd.uniform(2.5, 4.5) * (1.15 - z / h), 0.08, 2, 'pk_bark', ends, up=0.5)
        for (e, d) in ends:
            m.card((e.x, e.y, e.z - 1.2), rnd.uniform(1.6, 2.4), rnd.uniform(0, math.pi), 'pk_twigs')
    m.col(-0.35, -0.35, 0, 0.35, 0.35, 3)
    return m.finish()


def maple(name, seed):
    rnd = random.Random(seed)
    m = Mesh(name, 'tree')
    h = 4.0
    m.tube((0, 0, 0), (0, 0, h), 0.22, 0.12, 'pk_bark', 6)
    ends = []
    for i in range(6):
        a = rnd.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), rnd.uniform(0.7, 1.3))).normalized()
        branch(m, rnd, Vector((0, 0, h * rnd.uniform(0.75, 1.0))), d, rnd.uniform(2.2, 3.2), 0.09, 3, 'pk_bark', ends, up=0.35)
    for (e, d) in ends:
        m.card((e.x, e.y, e.z - 0.9), rnd.uniform(1.2, 1.8), rnd.uniform(0, math.pi), 'pk_twigs')
    m.col(-0.25, -0.25, 0, 0.25, 0.25, 3)
    return m.finish()


def spruce(name, seed, h=8.0):
    """Blue spruce in front of the building, layers of boughs with snow."""
    rnd = random.Random(seed)
    m = Mesh(name, 'tree')
    m.tube((0, 0, 0), (0, 0, h), 0.18, 0.03, 'pk_bark', 6)
    layers = 11
    for i in range(layers):
        t = i / layers
        z = 0.7 + t * (h - 1.0)
        R = (1 - t) ** 0.95 * h * 0.3 + 0.25
        n = max(4, int(R * 5))
        off = rnd.uniform(0, math.pi)
        for k in range(n):
            a = off + 2 * math.pi * k / n + rnd.uniform(-0.15, 0.15)
            ca, sa = math.cos(a), math.sin(a)
            w = 2 * math.pi * R / n * 1.5
            inner = Vector((ca * 0.1, sa * 0.1, z + 0.45))
            outer = Vector((ca * R, sa * R, z - 0.35 * R))
            px, py = -sa * w / 2, ca * w / 2
            pts = [outer + Vector((-px, -py, 0)), outer + Vector((px, py, 0)), inner + Vector((px * 0.3, py * 0.3, 0)), inner + Vector((-px * 0.3, -py * 0.3, 0))]
            m.face_n(pts, 'pk_spruce', (0, 0, 1), [(0, 0), (1, 0), (1, 1), (0, 1)])
    m.cyl(0, 0, h - 0.2, h + 0.5, 0.15, 6, 'pk_spruce', r1=0.0)
    m.col(-0.4, -0.4, 0, 0.4, 0.4, 2.0)
    return m.finish()


def bush(name, seed):
    """Lilac bush: bunch of thin stems with twigs."""
    rnd = random.Random(seed)
    m = Mesh(name, 'tree')
    for i in range(7):
        b = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
        d = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), 1)).normalized()
        e = b + d * rnd.uniform(1.6, 2.6)
        m.tube(b, e, 0.03, 0.012, 'pk_bark', 3)
        m.card((e.x, e.y, e.z - 1.3), 1.5, rnd.uniform(0, math.pi), 'pk_twigs')
    m.pillow(-0.9, -0.9, 0, 0.9, 0.9, 0.5, 'pk_snow', 2, 0.6, seed)
    m.col(-0.7, -0.7, 0, 0.7, 0.7, 1.2)
    return m.finish()


# ------------------------------------------------------------------ build

def build():
    # Buildings: series, sections, floors
    panel_building('p9_3a', 'p9', 3, 9, 1, 'pk_panel9', 'sheet', 0.5)
    panel_building('p9_3b', 'p9', 3, 9, 2, 'pk_tile9', 'conc', 0.4, accent=True)
    panel_building('p9_4', 'p9', 4, 9, 3, 'pk_panel9b', 'sheet', 0.55, rail=True)
    panel_building('p9_2s', 'p9', 2, 9, 4, 'pk_panel9', 'sheet', 0.5, shop=True)
    panel_building('p12_2', 'p12', 2, 12, 5, 'pk_panel12', 'conc', 0.6, rail=True)
    panel_building('t16_a', 't16', 1, 16, 6, 'pk_panel16', 'conc', 0.55, end_windows=True)
    panel_building('t16_b', 't16', 1, 16, 7, 'pk_tile9', 'sheet', 0.5, end_windows=True, accent=True)
    panel_building('k5_4b', 'k5', 4, 5, 8, 'pk_brick5', 'lattice', 0.4, roof='pitched')
    panel_building('k5_3p', 'k5', 3, 5, 9, 'pk_panel5', 'lattice', 0.35)
    panel_building('k5_2b', 'k5', 2, 5, 10, 'pk_brick5', 'lattice', 0.45, roof='pitched')
    k5i.init(Mesh)
    panel_building('k5i_4', 'k5i', 4, 5, 11, 'pk_panel5', 'lattice', 0.35)
    panel_building('k5i_3', 'k5i', 3, 5, 12, 'pk_panel5', 'sheet', 0.4)
    k5i.use(k5i_plan)
    k5i.build_shell()
    k5i.build_furniture()
    k5i.build_doors()
    panel_building('k9i_2', 'k9i', 2, 9, 13, 'pk_panel9', 'sheet', 0.5)
    panel_building('k9i_3', 'k9i', 3, 9, 14, 'pk_tile9', 'conc', 0.45)
    k5i.use(k9i_plan)
    k5i.build_shell(k9i.shell_extra)
    k9i.build_furniture()
    k9i.build_lift()
    with open(OUT_PLAN, 'w') as f:
        json.dump({'k5i': k5i_plan.as_json(), 'k9i': k9i_plan.as_json()}, f, separators=(',', ':'))

    garage_row('garages6', 6, 1)
    garage_row('garages4', 4, 2)
    garage_shell('shell_green', 'pk_garage_green', 3)
    garage_shell('shell_white', 'pk_garage_white', 4)
    transformer()
    kiosk()
    container_site()
    hockey_box()

    for f in (swings, balance, carousel, slide, bars, sandbox, goal, carpet_beater, laundry_poles, urn, tires, snowman):
        f()
    bench('bench', True)
    bench('bench_flat', False)
    fence_low('fence', 'pk_paint_green')
    fence_low('fence_y', 'pk_paint_yellow')
    drift('drift_long', 7.0, 1.8, 0.8, 1)
    drift('drift_pile', 3.2, 3.0, 1.4, 2)
    drift('drift_low', 4.0, 2.4, 0.35, 3)

    lamp_post('lamp_w', 'w')
    lamp_post('lamp_o', 'o')
    lamp_post('lamp_off', None)
    lamp_post('ylamp_w', 'w', 'yard')
    lamp_post('ylamp_off', None, 'yard')
    bulb('bulb_on', 'pk_glow_bulb')
    bulb('bulb_flk', 'pk_glow_flk')
    bulb('bulb_off', 'pk_glow_off')
    lep_tower()

    # detailed cars (v2): two snow levels per model, colors come from the shader palette
    for i, model in enumerate(['2101', '2107', '2109', 'niva', '2141']):
        for lod in (False, True):
            sfx = '_lod' if lod else ''
            car2('car2_' + model + '_a' + sfx, model, 0, 100 + i, lod)
            car2('car2_' + model + '_b' + sfx, model, 1, 200 + i, lod)
    for lod in (False, True):
        car2('car2_buried_a' + ('_lod' if lod else ''), '2107', 2, 301, lod)
        car2('car2_buried_b' + ('_lod' if lod else ''), 'niva', 2, 302, lod)

    for o in list(scene.collection.objects):
        if o.name.startswith('car2_'):
            separate_from_glass(o)

    birch('birch_a', 11, 12.0)
    birch('birch_b', 12, 9.5)
    poplar('poplar', 13)
    poplar('poplar_cut', 14, cut=True)
    maple('maple', 15)
    spruce('spruce_a', 16, 9.0)
    spruce('spruce_b', 17, 6.5)
    bush('lilac', 18)

    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    kw = dict(filepath=OUT_GLB, export_format='GLB', export_extras=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_apply=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_image_format='NONE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    tris = sum(len(o.data.polygons) for o in scene.collection.objects)
    print('EXPORTED', OUT_GLB, len(scene.collection.objects), 'objects', tris, 'faces')


# Snow lying on a window almost parallel to the glass, a centimeter or two above or under it, crosses
# the glass at a shallow angle: the line where it dips under looks torn and slides with every move of
# the camera, just like z-fighting. Every snow or rubber vertex that close over the glass moves to a
# clear side, on top of the glass or well under it, so the two surfaces cross steeply or not at all.
GLASS_OVER, GLASS_UNDER = 0.02, 0.03


def separate_from_glass(obj):
    me = obj.data
    names = [m.name if m else '' for m in me.materials]
    glass_idx = {i for i, n in enumerate(names) if n == 'pk_carglass'}
    if not glass_idx:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    glass = bm.copy()
    bmesh.ops.delete(glass, geom=[f for f in glass.faces if f.material_index not in glass_idx], context='FACES')
    tree = BVHTree.FromBMesh(glass)
    glass.free()
    center = sum((v.co for v in bm.verts), Vector()) / max(1, len(bm.verts))
    center.z = 0.0
    moved = 0
    for v in bm.verts:
        mats = {names[f.material_index] for f in v.link_faces}
        if not mats & {'pk_snow', 'pk_rubber'} or 'pk_carglass' in mats:
            continue
        hit, n, _, dist = tree.find_nearest(v.co)
        if hit is None or dist > 0.05:
            continue
        if n.dot(hit - center) < 0:
            n = -n  # outward, away from the cabin
        d = (v.co - hit).dot(n)
        # only right over the pane, not beside its edge
        if ((v.co - hit) - n * d).length > 0.005 or not -GLASS_UNDER < d < GLASS_OVER:
            continue
        target = GLASS_OVER if d > -0.008 else -GLASS_UNDER
        v.co += n * (target - d)
        moved += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    print('glass gap', obj.name, moved, 'vertices moved')


build()
