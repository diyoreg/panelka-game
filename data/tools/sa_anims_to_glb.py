"""Converts GTA San Andreas animations (ped.ifp) onto the player model and writes public/models/player.glb.

    python3 tools/sa_anims_to_glb.py

Inputs:
    data/sources/player.glb   the San Andreas ped model (Sketchfab, CC BY 4.0). Its skeleton is the SA ped
                      skeleton with renamed bones, but every bone frame was rotated by the converter
                      (glTF bones point along +Y, RenderWare bones along another axis).
    data/sources/ped.ifp      the animation package from the user's copy of GTA San Andreas.
    data/sources/add-on-inu-tools-gta-sa-v2.5.1/core/ifp.py   IFP reader (INU Tools, GPL-3.0), used as a dev tool only.

Retargeting: IFP keys are absolute local rotations of the SA frames. For every bone b
    world_model(b) = K * world_sa(b) * C(b)
where K maps SA world (Z up, +Y forward) into the skeleton space (the rest rotation of the root bone)
and C(b) is that bone's change of axes. The converter that made the model rotated bone frames
differently per bone (legs differ from the spine and the arms), so C(b) is solved per bone: the
axis-aligned rotation (one of 24) closest to the one that maps the SA standing pose onto the
model's bind pose. Then local(b) = C(parent)^-1 * q * C(b). The SA root is folded into the pelvis,
the root bone only carries the vertical bob. Forward root motion is removed, its speed is written to the sidecar JSON
so the game can match playback speed to the walking speed. Foot contacts are found with forward
kinematics and written there too, for footstep sounds.

Output: public/models/player.glb (model + clips) and public/models/player_anims.json.
"""
import json
import math
import os
import struct
import sys
import importlib.util
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_GLB = os.path.join(ROOT, 'data', 'sources', 'player.glb')
SRC_IFP = os.path.join(ROOT, 'data', 'sources', 'ped.ifp')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'player.glb')
OUT_JSON = os.path.join(ROOT, 'public', 'models', 'player_anims.json')
IFP_PY = os.path.join(ROOT, 'data', 'sources', 'add-on-inu-tools-gta-sa-v2.5.1', 'core', 'ifp.py')

# game clip name -> (SA animation, loop, strip forward root motion)
CLIPS = {
    'idle': ('IDLE_stance', True, False),
    'walk': ('WALK_player', True, True),
    'run': ('run_player', True, True),
    'crouch_idle': ('WEAPON_crouch', True, False),
    'crouch_walk': ('GunCrouchFwd', True, True),
    'jump': ('JUMP_glide', False, False),   # not a seamless loop in SA: play once and hold
    'fly': ('Jetpack_Idle', True, False),
    'idle_look': ('roadcross', False, False),
    'idle_scratch': ('XPRESSscratch', False, False),
    'idle_tired': ('IDLE_tired', True, False),
}

# SA bone id -> model bone. Ids are stable across clips, names are not ("Spine1" vs "Spine 2").
MAP = {
    1: 'root hips_32', 2: 'spine lower_31', 3: 'spine upper_30', 4: 'head neck lower_29', 5: 'head neck upper_28',
    8: 'head jaw_27', 6: 'head eyebrow left 1_26', 7: 'head eyebrow right 1_25',
    31: 'arm left shoulder 1_24', 32: 'arm left shoulder 2_23', 33: 'arm left elbow_22', 34: 'arm left wrist_21',
    35: 'arm left finger 2a_20', 36: 'arm left finger 2b_19',
    21: 'arm right shoulder 1_18', 22: 'arm right shoulder 2_17', 23: 'arm right elbow_16', 24: 'arm right wrist_15',
    25: 'arm right finger 2a_14', 26: 'arm right finger 2b_13',
    302: 'breast left base_12', 301: 'breast right base_11', 201: 'belly_10',
    41: 'leg left thigh_9', 42: 'leg left knee_8', 43: 'leg left ankle_7', 44: 'leg left toes_6',
    51: 'leg right thigh_5', 52: 'leg right knee_4', 53: 'leg right ankle_3', 54: 'leg right toes_2',
}
PELVIS = MAP[1]
ROOT_BONE = 'root ground_33'
REFERENCE = 'IDLE_stance'   # SA pose closest to the bind pose, used to solve the per-bone axes


# ------------------------------------------------------------------ quaternions (w, x, y, z)

def qmul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2])


def qconj(q):
    return np.array([q[0], -q[1], -q[2], -q[3]])


def qrot(q, v):
    return qmul(qmul(q, np.array([0.0, *v])), qconj(q))[1:]


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + (b - a) * t
        return r / np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


def mat2q(m):
    m = np.asarray(m, float)
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1) * 2
        return np.array([0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s])
    i = int(np.argmax(np.diag(m)))
    if i == 0:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return np.array([(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s])
    if i == 1:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return np.array([(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s])
    s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return np.array([(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s])


def axis_rotations():
    import itertools
    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product([1, -1], repeat=3):
            m = np.zeros((3, 3))
            for r, (c, s) in enumerate(zip(perm, signs)):
                m[r, c] = s
            if np.linalg.det(m) > 0:
                out.append(mat2q(m))
    return out


def solve_axes(anim, nodes, idx, parent, rest_q, K):
    """Per-bone change of axes C(b), snapped to the nearest axis-aligned rotation."""
    keys = {}
    rootq = None
    for b in anim.bones:
        x, y, z, w = b.keyframes[0].rotation
        q = np.array([w, x, y, z]) / np.linalg.norm([w, x, y, z])
        if b.bone_id == 0:
            rootq = q
        elif b.bone_id in MAP:
            keys[MAP[b.bone_id]] = q
    sa_world, model_world = {}, {}

    def chain(nm):
        if nm in sa_world:
            return
        p = nodes[parent[idx[nm]]]['name']
        if nm == PELVIS:
            sa_world[nm] = qmul(K, qmul(rootq, keys[nm]))
            model_world[nm] = qmul(rest_q[ROOT_BONE], rest_q[nm])
        else:
            chain(p)
            sa_world[nm] = qmul(sa_world[p], keys[nm])
            model_world[nm] = qmul(model_world[p], rest_q[nm])

    cands = axis_rotations()
    C = {}
    for nm in MAP.values():
        chain(nm)
        x = qmul(qconj(sa_world[nm]), model_world[nm])
        best = max(cands, key=lambda c: abs(float(np.dot(c, x))))
        if np.dot(best, x) < 0:
            best = -best
        resid = math.degrees(2 * math.acos(min(1.0, abs(float(np.dot(best, x))))))
        # small bones (feet, toes, brows, breasts) sit differently in the bind pose than in the SA stance:
        # use the exact mapping for them, so the stance shows them exactly as modeled
        C[nm] = best if resid < 30 else x / np.linalg.norm(x)
        if resid >= 30:
            print('  exact axes for %s (nearest axis rotation was %.0f degrees off)' % (nm, resid))
    return C


def sample(keys, t):
    """keys: list of (time, quat). Spherical interpolation at time t."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, q0), (t1, q1) in zip(keys, keys[1:]):
        if t <= t1:
            return slerp(q0, q1, (t - t0) / max(t1 - t0, 1e-9))
    return keys[-1][1]


# ------------------------------------------------------------------ GLB io

def read_glb(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    js = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', d[off:off + 4])[0]
    binary = bytearray(d[off + 8:off + 8 + bl])
    return js, binary


def write_glb(path, js, binary):
    while len(binary) % 4:
        binary.append(0)
    js['buffers'][0]['byteLength'] = len(binary)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + bytes(binary))


def add_accessor(js, binary, arr, typ):
    arr = np.asarray(arr, dtype=np.float32)
    while len(binary) % 4:
        binary.append(0)
    view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': arr.nbytes}
    binary.extend(arr.tobytes())
    js['bufferViews'].append(view)
    acc = {'bufferView': len(js['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
    if typ == 'SCALAR':
        acc['min'] = [float(arr.min())]
        acc['max'] = [float(arr.max())]
    js['accessors'].append(acc)
    return len(js['accessors']) - 1


# ------------------------------------------------------------------ conversion

def load_ifp():
    spec = importlib.util.spec_from_file_location('inu_ifp', IFP_PY)
    mod = importlib.util.module_from_spec(spec)
    sys.modules['inu_ifp'] = mod
    spec.loader.exec_module(mod)
    return mod.read_ifp(SRC_IFP)


def main():
    js, binary = read_glb(SRC_GLB)
    nodes = js['nodes']
    idx = {n['name']: i for i, n in enumerate(nodes)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    rest_q = {}
    rest_t = {}
    for name in list(MAP.values()) + [ROOT_BONE]:
        n = nodes[idx[name]]
        r = n.get('rotation', [0, 0, 0, 1])
        rest_q[name] = np.array([r[3], r[0], r[1], r[2]])
        rest_t[name] = np.array(n.get('translation', [0, 0, 0]), float)
    K = rest_q[ROOT_BONE]

    ifp = load_ifp()
    anims = {a.name: a for a in ifp.animations}
    C = solve_axes(anims[REFERENCE], nodes, idx, parent, rest_q, K)
    parent_name = {nm: nodes[parent[idx[nm]]]['name'] for nm in MAP.values()}
    js['animations'] = []
    meta = {}

    for clip_name, (sa_name, loop, strip) in CLIPS.items():
        a = anims[sa_name]
        bones = {}
        root = None
        for b in a.bones:
            keys = []
            for k in b.keyframes:
                x, y, z, w = k.rotation
                q = np.array([w, x, y, z])
                keys.append((k.time, q / np.linalg.norm(q), np.array(k.translation, float)))
            if b.bone_id == 0:
                root = keys
            elif b.bone_id in MAP:
                bones[MAP[b.bone_id]] = keys
        dur = max(k[-1][0] for k in list(bones.values()) + [root])
        channels = []

        def channel(node_name, path, times, values, typ):
            inp = add_accessor(js, binary, times, 'SCALAR')
            out = add_accessor(js, binary, values, typ)
            channels.append((idx[node_name], path, inp, out))

        # root: vertical bob only (and sideways sway), forward motion removed
        rt = np.array([k[0] for k in root])
        tr = np.array([k[2] for k in root])
        speed = 0.0
        if strip and dur > 0:
            speed = (tr[-1, 1] - tr[0, 1]) / dur
            tr[:, 1] -= tr[0, 1] + speed * rt
        pos = np.array([qrot(K, t) for t in tr])
        channel(ROOT_BONE, 'translation', rt, pos, 'VEC3')

        root_keys = [(k[0], k[1]) for k in root]
        for name in MAP.values():
            if name not in bones:
                # bones the clip does not animate stay in the rest pose
                q = rest_q[name]
                channel(name, 'rotation', np.array([0.0, dur]), np.array([[q[1], q[2], q[3], q[0]]] * 2), 'VEC4')
                continue
            keys = bones[name]
            times = np.array([k[0] for k in keys])
            vals = []
            prev = None
            for t, q, _ in keys:
                if name == PELVIS:
                    # the SA root rotation is folded into the pelvis
                    local = qmul(qmul(sample(root_keys, t), q), C[name])
                else:
                    local = qmul(qmul(qconj(C[parent_name[name]]), q), C[name])
                if prev is not None and np.dot(prev, local) < 0:
                    local = -local
                prev = local
                vals.append([local[1], local[2], local[3], local[0]])
            if len(times) == 1:
                times = np.array([0.0, dur])
                vals = vals * 2
            elif loop:
                # some SA loops end a little off their first frame: close the loop
                first, last = np.array(vals[0]), np.array(vals[-1])
                if np.dot(first, last) < 0:
                    first = -first
                if np.dot(first, last) < 0.9998:
                    vals[-1] = list(first)
            channel(name, 'rotation', times, np.array(vals), 'VEC4')

        anim = {'name': clip_name, 'samplers': [], 'channels': []}
        for node, path, inp, out in channels:
            anim['samplers'].append({'input': inp, 'output': out, 'interpolation': 'LINEAR'})
            anim['channels'].append({'sampler': len(anim['samplers']) - 1, 'target': {'node': node, 'path': path}})
        js['animations'].append(anim)

        meta[clip_name] = {'source': sa_name, 'duration': round(dur, 4), 'loop': loop, 'speed': round(abs(speed), 3),
                           'contacts': foot_contacts(nodes, idx, parent, rest_q, rest_t, K, C, parent_name, bones, root_keys, dur) if strip else []}
        print('%-13s <- %-14s %.2fs  speed %.2f m/s  contacts %s' % (clip_name, sa_name, dur, abs(speed), meta[clip_name]['contacts']))

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    write_glb(OUT_GLB, js, binary)
    json.dump(meta, open(OUT_JSON, 'w'), indent=1)
    print('wrote', OUT_GLB, len(binary), 'bytes')


def foot_contacts(nodes, idx, parent, rest_q, rest_t, K, C, parent_name, bones, root_keys, dur):
    """Times (as loop fractions) when each foot is lowest: heel strikes, for footstep sounds."""
    chain = {}
    for side in ('left', 'right'):
        names = ['root hips_32', 'leg %s thigh' % side, 'leg %s knee' % side, 'leg %s ankle' % side]
        chain[side] = [n if n in rest_q else next(k for k in rest_q if k.startswith(n)) for n in names]
    N = 120
    heights = {'left': [], 'right': []}
    for s in range(N):
        t = dur * s / N
        rq = sample(root_keys, t)
        for side, ch in chain.items():
            W = K
            P = np.zeros(3)
            for j, name in enumerate(ch):
                keys = [(k[0], k[1]) for k in bones[name]]
                q = sample(keys, t)
                local = qmul(qmul(rq, q), C[name]) if j == 0 else qmul(qmul(qconj(C[parent_name[name]]), q), C[name])
                if j > 0:
                    P = P + qrot(W, rest_t[name])
                W = qmul(W, local)
            foot = P + qrot(W, np.array([0, 0.41, 0]))   # ankle offset is applied with the next bone
            heights[side].append(foot[1])
    # one step per foot: the moment that foot is lowest
    return sorted(round(int(np.argmin(heights[side])) / N, 3) for side in ('right', 'left'))


if __name__ == '__main__':
    main()
