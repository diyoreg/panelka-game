"""Keyframes GTA San Andreas style animations onto data/sources/player.glb and exports public/models/player.glb.

Run (headless):
    /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/animate_player.py

The source model has a skeleton but no animations. Every clip here is generated from
periodic functions, so all clips loop seamlessly (first frame == last frame).

Rotations are written in armature space (Z up, the character faces -Y) and converted
into each bone's local rest frame, so a "forward swing" is the same axis for every limb:
    rotate around +X: negative = limb swings forward (toward -Y), positive = backward
    spine around +X: positive = lean forward
    around Z: twist, around Y: sideways
"""
import bpy
import math
import os
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'data', 'sources', 'player.glb')
OUT = os.path.join(ROOT, 'public', 'models', 'player.glb')
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)

# the glTF importer adds an icosphere used as a bone display shape
for o in list(scene.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)

arm = next(o for o in scene.objects if o.type == 'ARMATURE')
B = {
    'hips': 'root hips_32',
    'spine': 'spine lower_31',
    'chest': 'spine upper_30',
    'neck': 'head neck lower_29',
    'head': 'head neck upper_28',
    'thigh_r': 'leg right thigh_5', 'knee_r': 'leg right knee_4', 'ankle_r': 'leg right ankle_3', 'toes_r': 'leg right toes_2',
    'thigh_l': 'leg left thigh_9', 'knee_l': 'leg left knee_8', 'ankle_l': 'leg left ankle_7', 'toes_l': 'leg left toes_6',
    'clav_r': 'arm right shoulder 1_18', 'uarm_r': 'arm right shoulder 2_17', 'farm_r': 'arm right elbow_16', 'hand_r': 'arm right wrist_15',
    'clav_l': 'arm left shoulder 1_24', 'uarm_l': 'arm left shoulder 2_23', 'farm_l': 'arm left elbow_22', 'hand_l': 'arm left wrist_21',
    'fing_r': 'arm right finger 2a_14', 'fing_l': 'arm left finger 2a_20',
}
REST = {k: arm.data.bones[v].matrix_local.to_3x3() for k, v in B.items()}

# Arms rest in an A-pose (about 20 degrees out), so a plain X rotation would swing the hands
# outward. For arm bones the X angle is applied around the limb's own hinge axis instead:
# perpendicular to the bone and to the forward direction.
FORWARD = Vector((0, -1, 0))
HINGE = {}
for k in ('uarm_r', 'uarm_l', 'farm_r', 'farm_l', 'hand_r', 'hand_l', 'fing_r', 'fing_l'):
    bone = arm.data.bones[B[k]]
    d = (bone.tail_local - bone.head_local).normalized()
    HINGE[k] = FORWARD.cross(d).normalized()

S, C = math.sin, math.cos
TAU = math.pi * 2


def rad(d):
    return d * math.pi / 180


def base_pose():
    """Relaxed arms: the rest pose has them almost straight down, bend the elbows a little."""
    return {
        'uarm_r': [0, rad(-9), 0], 'uarm_l': [0, rad(9), 0],
        'farm_r': [rad(-10), 0, 0], 'farm_l': [rad(-10), 0, 0],
        'fing_r': [rad(-25), 0, 0], 'fing_l': [rad(-25), 0, 0],
    }


def add(p, bone, rx=0.0, ry=0.0, rz=0.0):
    v = p.setdefault(bone, [0, 0, 0])
    v[0] += rx
    v[1] += ry
    v[2] += rz


# ------------------------------------------------------------------ clips
# each returns (rotations {bone: [rx, ry, rz] radians in armature space}, hips offset Vector in meters)

def idle(t, T):
    """Standing, breathing, slow weight shift and a look around."""
    p = base_pose()
    ph = TAU * t / T
    br = S(ph * 2)                      # two breaths per loop
    shift = S(ph)                       # one weight shift per loop
    add(p, 'chest', rad(1.5) * br, 0, 0)
    add(p, 'spine', rad(-1), rad(1.5) * shift, 0)
    add(p, 'hips', 0, rad(-2) * shift, rad(2) * S(ph + 0.5))
    # weight on one leg: that knee straight, the other bent
    add(p, 'thigh_r', rad(-2) - rad(2) * max(0, shift), rad(1.5) * shift, 0)
    add(p, 'knee_r', rad(4) + rad(5) * max(0, shift), 0, 0)
    add(p, 'ankle_r', rad(-2) - rad(3) * max(0, shift), 0, 0)
    add(p, 'thigh_l', rad(-2) - rad(2) * max(0, -shift), rad(1.5) * shift, 0)
    add(p, 'knee_l', rad(4) + rad(5) * max(0, -shift), 0, 0)
    add(p, 'ankle_l', rad(-2) - rad(3) * max(0, -shift), 0, 0)
    add(p, 'clav_r', 0, 0, rad(1) * br)
    add(p, 'clav_l', 0, 0, rad(-1) * br)
    add(p, 'uarm_r', rad(2) * br, 0, 0)
    add(p, 'uarm_l', rad(2) * br, 0, 0)
    # look around
    add(p, 'neck', rad(-2), 0, rad(18) * S(ph) * abs(S(ph)))
    add(p, 'head', rad(3) * S(ph * 2 + 1), 0, rad(8) * S(ph))
    hips = Vector((0.012 * shift, 0, -0.012 - 0.006 * abs(shift) + 0.003 * br))
    return p, hips


def gait(t, T, run=False, crouch=False):
    """Walk / run / crouch walk. One loop = two steps. Right leg forward at t = 0."""
    p = base_pose()
    ph = TAU * t / T
    s, c = S(ph), C(ph)
    if run:
        leg, knee, arm, elbow, lean, bob, roll = rad(40), rad(82), rad(42), rad(-80), rad(14), 0.06, rad(9)
    elif crouch:
        leg, knee, arm, elbow, lean, bob, roll = rad(18), rad(30), rad(14), rad(-50), rad(30), 0.015, rad(4)
    else:
        leg, knee, arm, elbow, lean, bob, roll = rad(26), rad(48), rad(24), rad(-16), rad(3), 0.028, rad(7)

    # squat: thigh -70, knee 115, ankle -45 keeps the foot flat on the ground
    base_thigh = rad(-70) if crouch else 0.0
    base_knee = rad(115) if crouch else 0.0
    base_ankle = rad(-45) if crouch else 0.0
    for side, sg in (('r', 1), ('l', -1)):
        sw = s * sg                       # +1: this leg forward
        cw = c * sg
        if run:
            # the thigh is already driving forward while the knee is still folded
            sw = S(ph + 0.55) * sg
            cw = C(ph + 0.55) * sg
        # thigh swings forward with negative X
        add(p, 'thigh_' + side, base_thigh - leg * sw - (rad(10) if run else 0), 0, 0)
        # knee bends while the leg passes under the body and swings forward
        bend = max(0.0, -cw) ** 1.4 if not run else max(0.0, -C(ph) * sg)
        add(p, 'knee_' + side, base_knee + rad(4) + knee * bend + (rad(10) * max(0, sw) if run else 0), 0, 0)
        # ankle: toes up at heel strike, push off at the back
        add(p, 'ankle_' + side, base_ankle + rad(-10) * max(0, sw) + rad(14) * max(0, -sw) - knee * bend * 0.35, 0, 0)
        add(p, 'toes_' + side, rad(-18) * max(0, -sw) * max(0, cw), 0, 0)
        # arms swing opposite to the legs, elbows bend more on the forward swing
        add(p, 'uarm_' + side, arm * sw, rad(-4) * sg if run else 0, 0)
        add(p, 'farm_' + side, elbow + rad(-14 if not run else -10) * max(0, -sw), 0, 0)
    # GTA SA swagger: chest rolls against the hips, shoulders bob
    add(p, 'hips', 0, rad(3) * s if not crouch else 0, -roll * s)
    add(p, 'spine', lean * 0.5, 0, roll * 0.5 * s)
    add(p, 'chest', lean * 0.5, rad(-2) * s, roll * 0.9 * s)
    add(p, 'clav_r', 0, 0, rad(3) * max(0, -s))
    add(p, 'clav_l', 0, 0, rad(-3) * max(0, s))
    add(p, 'neck', -lean * 0.6, 0, -roll * 0.9 * s)
    add(p, 'head', -lean * 0.3 + rad(2) * S(ph * 2), 0, 0)
    drop = -0.40 if crouch else 0.0
    hips = Vector((0.02 * s * (0 if run else 1), 0, drop + bob * (abs(c) - 0.6)))
    return p, hips


LEG = 0.87   # hip to sole, meters


def walk(t, T):
    """Relaxed San Andreas walk. One loop = two steps, right heel strikes at t = T / 4.

    Stance leg (moving back) stays straight and carries the body, the foot stays flat.
    Swing leg (moving forward) bends at the knee to clear the ground.
    The hips sink by exactly the height the straight stance leg loses at its angle,
    so the planted foot stays on the floor.
    """
    p = base_pose()
    ph = TAU * t / T
    s, c = S(ph), C(ph)
    leg = rad(21)
    for side, sg in (('r', 1), ('l', -1)):
        sw, cw = s * sg, c * sg            # sw: +1 leg in front, cw > 0: leg travelling forward
        swing = max(0.0, cw)
        stance = max(0.0, -cw)
        thigh = -leg * sw
        knee = rad(4) + rad(40) * swing ** 1.6 + rad(9) * max(0.0, sw) * stance
        # keep the sole parallel to the ground, toes up at heel strike, heel up at toe-off
        ankle = -(thigh + knee) - rad(10) * max(0.0, sw) ** 3 + rad(16) * max(0.0, -sw) ** 3
        add(p, 'thigh_' + side, thigh, 0, 0)
        add(p, 'knee_' + side, knee, 0, 0)
        add(p, 'ankle_' + side, ankle, 0, 0)
        add(p, 'toes_' + side, rad(-20) * max(0.0, -sw) ** 3 * stance, 0, 0)
        # loose pendulum arms, a little behind the legs
        a = S(ph - 0.35) * sg
        add(p, 'uarm_' + side, rad(17) * a, 0, 0)
        add(p, 'farm_' + side, rad(-12) + rad(-10) * max(0.0, -a), 0, 0)
    # swagger: pelvis turns with the front leg, chest and shoulders roll against it
    add(p, 'hips', 0, rad(2.5) * c, rad(6) * s)
    add(p, 'spine', rad(3), 0, rad(-3) * s)
    add(p, 'chest', rad(2), rad(-2) * c, rad(-7) * s)
    add(p, 'clav_r', 0, 0, rad(3) * max(0.0, s))
    add(p, 'clav_l', 0, 0, rad(-3) * max(0.0, -s))
    add(p, 'neck', rad(-4), 0, rad(4) * s)
    add(p, 'head', rad(-1) + rad(1.5) * S(ph * 2), 0, 0)
    # body over the stance foot, low at double support, high at passing
    drop = LEG * (1 - math.cos(leg * s)) + 0.01
    hips = Vector((0.022 * c, 0, -drop))
    return p, hips


def crouch_idle(t, T):
    p = base_pose()
    ph = TAU * t / T
    br = S(ph * 2)
    for side in ('r', 'l'):
        add(p, 'thigh_' + side, rad(-70), 0, 0)
        add(p, 'knee_' + side, rad(115), 0, 0)
        add(p, 'ankle_' + side, rad(-45), 0, 0)
        add(p, 'farm_' + side, rad(-55), 0, 0)
        add(p, 'uarm_' + side, rad(-12), 0, 0)
    add(p, 'thigh_r', 0, rad(4), 0)
    add(p, 'thigh_l', 0, rad(-4), 0)
    add(p, 'spine', rad(16) + rad(1.5) * br, 0, 0)
    add(p, 'chest', rad(14), 0, 0)
    add(p, 'neck', rad(-20), 0, rad(14) * S(ph))
    add(p, 'head', rad(-6), 0, rad(6) * S(ph))
    return p, Vector((0, 0, -0.41 + 0.006 * br))


def jump(t, T):
    """Airborne loop: one knee tucked, arms up and out, a little flail."""
    p = base_pose()
    ph = TAU * t / T
    w = S(ph)
    add(p, 'thigh_r', rad(-55) + rad(4) * w, 0, 0)
    add(p, 'knee_r', rad(85), 0, 0)
    add(p, 'ankle_r', rad(-10), 0, 0)
    add(p, 'thigh_l', rad(-12) - rad(4) * w, 0, 0)
    add(p, 'knee_l', rad(40), 0, 0)
    add(p, 'ankle_l', rad(15), 0, 0)
    add(p, 'uarm_r', rad(-35) + rad(6) * w, rad(14), 0)
    add(p, 'uarm_l', rad(-20) - rad(6) * w, rad(-14), 0)
    add(p, 'farm_r', rad(-40), 0, 0)
    add(p, 'farm_l', rad(-30), 0, 0)
    add(p, 'spine', rad(6), 0, 0)
    add(p, 'chest', rad(4), 0, rad(3) * w)
    add(p, 'neck', rad(-6), 0, 0)
    return p, Vector((0, 0, 0.0))


# clips listed in GROUNDED get their hips height solved per frame so the lowest sole touches the floor
GROUNDED = {'walk'}

CLIPS = [
    ('idle', 4.0, idle),
    ('walk', 1.3, walk),
    ('run', 0.68, lambda t, T: gait(t, T, run=True)),
    ('crouch_idle', 3.0, crouch_idle),
    ('crouch_walk', 1.3, lambda t, T: gait(t, T, crouch=True)),
    ('jump', 0.8, jump),
]

# ------------------------------------------------------------------ keyframing

for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

FEET = [(B['ankle_r'], B['toes_r']), (B['ankle_l'], B['toes_l'])]


def lowest_sole():
    """Height of the lowest sole above the floor (armature space), relative to the rest pose.

    The depsgraph update would apply the stored clips (NLA tracks) and the active action on top
    of the pose we just set, so both are switched off while measuring.
    """
    ad = arm.animation_data
    act = ad.action
    slot = getattr(ad, 'action_slot', None)
    muted = [t.mute for t in ad.nla_tracks]
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = None
    bpy.context.view_layer.update()
    low = 1e9
    for ankle, toes in FEET:
        for bn in (ankle, toes):
            low = min(low, arm.pose.bones[bn].head.z - arm.data.bones[bn].head_local.z)
    ad.action = act
    if slot is not None and getattr(ad, 'action_slot', None) is None:
        ad.action_slot = slot
    for t, m in zip(ad.nla_tracks, muted):
        t.mute = m
    return low

if arm.animation_data is None:
    arm.animation_data_create()

hips_rest = REST['hips'].inverted()

for name, T, fn in CLIPS:
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    frames = int(round(T * FPS))
    for f in range(frames + 1):
        # sample exactly one period, so the last key equals the first one
        t = f / frames * T
        rots, hips = fn(t, T)
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        for key, (rx, ry, rz) in rots.items():
            M = REST[key]
            if key in HINGE:
                R = Euler((0, ry, rz), 'XYZ').to_matrix() @ Matrix.Rotation(rx, 3, HINGE[key])
            else:
                R = Euler((rx, ry, rz), 'XYZ').to_matrix()
            local = M.inverted() @ R @ M
            pb = arm.pose.bones[B[key]]
            pb.rotation_quaternion = local.to_quaternion()
        hb = arm.pose.bones[B['hips']]
        hb.location = hips_rest @ hips
        if name in GROUNDED:
            hips.z -= lowest_sole()
            hb.location = hips_rest @ hips
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
        hb.keyframe_insert('location', frame=f + 1)
    # keep it for export
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    arm.animation_data.action = None
    print('clip', name, frames, 'frames')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_yup=True, export_skins=True, export_def_bones=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'player_animated.blend'))
print('EXPORTED', OUT)
