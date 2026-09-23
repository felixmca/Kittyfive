"""
Kitty, the 3D cat who shows visitors round the store: a smooth rigged cat
with her own markings, a walk and an idle, for public/models/kitty.glb.

    node scripts/store/blender.mjs scripts/store/kitty.py

Markings from Felix's photos (assets-raw/room, 23 Sep 2026, and chapter 1's
close-up): black back, head, ears and tail (fluffy); a broad white bib from
the chin down the chest and round the sides of the neck; white front legs
with a black patch high on her left one; white socks behind; a white muzzle
with a blaze running up between yellow-green eyes; a small black spot on
her chin; a pink nose; and her collar with its tag.

Built as: a body from the Skin modifier over a stick skeleton (spine, legs,
tail) made smooth with subdivision; a sculpted head; ears, eyes, nose,
whiskers and collar as parts. Markings are vertex colours. The rig is an
armature with hand-made weights (distance to each bone), and two actions:
"Walk" (a 0.6 s lateral-sequence walk, the pace the store walks her at)
and "Idle" (standing, breathing, tail and ears alive). Site coordinates:
y up, she faces +z, her feet on y = 0, about 0.36 m to the top of her head.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "models", "kitty.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
SCENE.render.fps = 30
COLL = SCENE.collection


def V(x, y, z):
    """Site (x, y, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


def S(v):
    """Blender -> site."""
    return Vector((v.x, v.z, -v.y))


def lin(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


MATS = {}


def mat(name, color, rough=0.8, metal=0.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


FUR = mat("Fur", "#ffffff", 0.78)
EYE = mat("Eye", "#c8c23a", 0.12)
PUPIL = mat("Pupil", "#0b0b0c", 0.08)
NOSE = mat("Nose", "#c9818b", 0.45)
EAR_IN = mat("EarInner", "#9d6f74", 0.85)
WHISKER = mat("Whisker", "#f3efe7", 0.5)
COLLAR = mat("Collar", "#23262b", 0.5)
TAG = mat("Tag", "#c9c7c2", 0.25, 0.9)

BLACK = lin("#18181b")
WHITE = lin("#f2eee7")


def link(name, me, material):
    if not me.materials:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


def evaluated(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


# ─── the skeleton everything hangs on (site coordinates) ─────────────────────

J = {
    "pelvis": (0, 0.186, -0.115),
    "mid": (0, 0.194, -0.015),
    "chest": (0, 0.196, 0.075),
    "neck0": (0, 0.222, 0.118),
    "neck1": (0, 0.258, 0.158),
    "head": (0, 0.29, 0.198),
    "headtip": (0, 0.31, 0.238),
}
for s, x in (("L", 0.042), ("R", -0.042)):
    J[f"shoulder.{s}"] = (x, 0.17, 0.1)
    J[f"elbow.{s}"] = (x * 1.03, 0.098, 0.1)
    J[f"wrist.{s}"] = (x * 1.03, 0.032, 0.114)
    J[f"toe.{s}"] = (x * 1.03, 0.011, 0.14)
for s, x in (("L", 0.048), ("R", -0.048)):
    J[f"hip.{s}"] = (x, 0.172, -0.118)
    J[f"knee.{s}"] = (x * 1.03, 0.108, -0.088)
    J[f"hock.{s}"] = (x * 1.03, 0.047, -0.166)
    J[f"htoe.{s}"] = (x * 1.03, 0.011, -0.13)
TAIL = [(0, 0.188, -0.178), (0, 0.183, -0.245), (0, 0.178, -0.312), (0, 0.177, -0.378), (0, 0.181, -0.44), (0, 0.19, -0.495)]


# ─── body ────────────────────────────────────────────────────────────────────

def body():
    verts = []
    radius = []
    index = {}

    def add(key, p, r):
        index[key] = len(verts)
        verts.append(V(*p))
        radius.append(r)

    add("pelvis", J["pelvis"], (0.066, 0.07))
    add("mid", J["mid"], (0.071, 0.077))
    add("chest", J["chest"], (0.066, 0.075))
    add("neck0", J["neck0"], (0.047, 0.05))
    add("neck1", J["neck1"], (0.04, 0.042))
    for s in ("L", "R"):
        add(f"shoulder.{s}", J[f"shoulder.{s}"], (0.03, 0.033))
        add(f"elbow.{s}", J[f"elbow.{s}"], (0.02, 0.022))
        add(f"wrist.{s}", J[f"wrist.{s}"], (0.015, 0.016))
        add(f"toe.{s}", J[f"toe.{s}"], (0.019, 0.014))
        add(f"hip.{s}", J[f"hip.{s}"], (0.041, 0.046))
        add(f"knee.{s}", J[f"knee.{s}"], (0.025, 0.028))
        add(f"hock.{s}", J[f"hock.{s}"], (0.015, 0.016))
        add(f"htoe.{s}", J[f"htoe.{s}"], (0.019, 0.014))
    tail_r = [0.027, 0.029, 0.028, 0.026, 0.022, 0.014]
    for i, (p, r) in enumerate(zip(TAIL, tail_r)):
        add(f"tail{i}", p, (r, r))
    edges = [("pelvis", "mid"), ("mid", "chest"), ("chest", "neck0"), ("neck0", "neck1")]
    for s in ("L", "R"):
        edges += [("chest", f"shoulder.{s}"), (f"shoulder.{s}", f"elbow.{s}"), (f"elbow.{s}", f"wrist.{s}"), (f"wrist.{s}", f"toe.{s}")]
        edges += [("pelvis", f"hip.{s}"), (f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"hock.{s}"), (f"hock.{s}", f"htoe.{s}")]
    edges += [("pelvis", "tail0")] + [(f"tail{i}", f"tail{i + 1}") for i in range(5)]
    me = bpy.data.meshes.new("body")
    me.from_pydata([tuple(v) for v in verts], [(index[a], index[b]) for a, b in edges], [])
    ob = link("body", me, FUR)
    sk = ob.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    for i, r in enumerate(radius):
        me.skin_vertices[0].data[i].radius = (r[0] * 1.18, r[1] * 1.18)
    me.skin_vertices[0].data[index["pelvis"]].use_root = True
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = 2
    evaluated(ob)
    # A cat is deeper than wide through the ribs: narrow the torso a little.
    for v in ob.data.vertices:
        p = S(v.co)
        if -0.17 < p.z < 0.13 and p.y > 0.14:
            k = 1 - 0.12 * smooth(0.02, 0.07, abs(p.x)) * smooth(0.14, 0.2, p.y)
            p.x *= k
            v.co = V(*p)
    ob.data.shade_smooth()
    return ob


# ─── head ────────────────────────────────────────────────────────────────────

HEAD_C = Vector(J["head"])
HS = 1.12  # head scale: a slightly big head reads as a cat, and as her


def head_shape(p):
    """Unit sphere point -> the head, in site coordinates."""
    x, y, z = p
    front = smooth(0.25, 0.95, z)
    low = smooth(0.15, -0.65, y)
    # Muzzle: the lower front pushed out and narrowed; a soft chin.
    mz = front * low
    zz = (z * 0.05 + 0.021 * mz) * HS
    xx = x * 0.055 * (1 - 0.28 * mz) * HS
    # Full cheeks either side of the muzzle, a flatter crown, a rounder back.
    cheek = smooth(0.35, 0.9, abs(x)) * smooth(0.2, -0.5, y)
    xx *= 1 + 0.1 * cheek
    yy = y * (0.047 if y > 0 else 0.046) * HS
    if y > 0.55:
        yy -= 0.006 * (y - 0.55) * HS
    if z < 0:
        zz *= 0.92
    return Vector((xx, yy, zz)) + HEAD_C


def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=1.0)
    for v in bm.verts:
        p = S(v.co)  # unit sphere, site axes
        v.co = V(*head_shape((p.x, p.y, p.z)))
    me = bpy.data.meshes.new("head")
    bm.to_mesh(me)
    bm.free()
    ob = link("head", me, FUR)
    ob.data.shade_smooth()
    return ob


def ears():
    """Each ear: a curved black shell (a cupped triangle with some thickness,
    fuller at the base), and a smaller pink-grey inside set into its front."""
    parts = []
    for s in (1, -1):
        base = HEAD_C + Vector((s * 0.028, 0.032, -0.008)) * HS
        up = Vector((s * 0.3, 1.0, 0.06)).normalized()
        side = Vector((1, -0.3 * s, 0)).normalized()
        fwd = side.cross(up).normalized()
        if fwd.z < 0:
            fwd = -fwd
        height = 0.05 * HS
        half = 0.027 * HS
        rows = 6
        cols = 7
        bm = bmesh.new()
        front = []
        back = []
        for i in range(rows + 1):
            f_ = i / rows
            w = half * (1 - f_) ** 0.9
            rowf = []
            rowb = []
            for j in range(cols):
                u = -1 + 2 * j / (cols - 1)
                cup = 0.006 * HS * (1 - u * u) * (1 - f_)  # the front is cupped
                p = base + up * (height * f_) + side * (w * u)
                rowf.append(bm.verts.new(V(*(p - fwd * cup + fwd * 0.004 * (1 - f_)))))
                rowb.append(bm.verts.new(V(*(p - fwd * (0.007 * HS * (1 - f_) + 0.001)))))
            front.append(rowf)
            back.append(rowb)
        for i in range(rows):
            for j in range(cols - 1):
                bm.faces.new((front[i][j], front[i][j + 1], front[i + 1][j + 1], front[i + 1][j]))
                bm.faces.new((back[i][j + 1], back[i][j], back[i + 1][j], back[i + 1][j + 1]))
            for j in (0, cols - 1):
                a, b = (front, back) if j == 0 else (back, front)
                bm.faces.new((a[i][j], b[i][j], b[i + 1][j], a[i + 1][j]))
        for j in range(cols - 1):
            bm.faces.new((front[0][j + 1], front[0][j], back[0][j], back[0][j + 1]))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new("ear")
        bm.to_mesh(me)
        bm.free()
        ob = link("ear", me, FUR)
        ob.data.shade_smooth()
        parts.append(ob)
        # The inside: a smaller triangle just in front of the cupped face.
        bm = bmesh.new()
        ib = base + up * (height * 0.1) + fwd * 0.0035
        ipts = [ib - side * half * 0.55, ib + side * half * 0.55, base + up * (height * 0.78) + fwd * 0.0015]
        vs = [bm.verts.new(V(*p)) for p in ipts]
        bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for face in bm.faces:
            if S(face.normal).dot(fwd) < 0:
                face.normal_flip()
        me = bpy.data.meshes.new("earinner")
        bm.to_mesh(me)
        bm.free()
        parts.append(link("earinner", me, EAR_IN))
    return parts


def face_parts():
    parts = []
    for s in (1, -1):
        c = HEAD_C + Vector((s * 0.021, 0.008, 0.039)) * HS
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=0.0118 * HS)
        bmesh.ops.scale(bm, vec=(1.0, 0.8, 0.95), verts=bm.verts)
        bmesh.ops.translate(bm, vec=V(*c), verts=bm.verts)
        me = bpy.data.meshes.new("eye")
        bm.to_mesh(me)
        bm.free()
        ob = link("eye", me, EYE)
        ob.data.shade_smooth()
        parts.append(ob)
        # A slit pupil at the front of the eye.
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.0102 * HS)
        # Blender axes here: x across, y depth, z height.
        bmesh.ops.scale(bm, vec=(0.3, 0.55, 0.92), verts=bm.verts)
        bmesh.ops.translate(bm, vec=V(*(c + Vector((0, 0, 0.0068 * HS)))), verts=bm.verts)
        me = bpy.data.meshes.new("pupil")
        bm.to_mesh(me)
        bm.free()
        ob = link("pupil", me, PUPIL)
        ob.data.shade_smooth()
        parts.append(ob)
    # Nose: a small rounded triangle.
    nc = HEAD_C + Vector((0, -0.012, 0.0695)) * HS
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.0054 * HS)
    bmesh.ops.scale(bm, vec=(1.3, 0.5, 0.85), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(*nc), verts=bm.verts)
    me = bpy.data.meshes.new("nose")
    bm.to_mesh(me)
    bm.free()
    ob = link("nose", me, NOSE)
    ob.data.shade_smooth()
    parts.append(ob)
    # Whiskers: three a side, fanning out and drooping.
    for s in (1, -1):
        for k, (dy, spread) in enumerate(((0.004, 0.2), (-0.001, 0.0), (-0.006, -0.22))):
            a = HEAD_C + Vector((s * 0.016, -0.02 + dy, 0.058)) * HS
            b = a + Vector((s * 0.065, 0.008 * spread - 0.01, -0.012))
            m = (a + b) / 2 + Vector((0, 0.006, 0))
            bm = bmesh.new()
            prev = None
            pts = [a, m, b]
            rings = []
            for i, p in enumerate(pts):
                r = 0.0007 * (1 - 0.5 * i / 2)
                t = (pts[min(2, i + 1)] - pts[max(0, i - 1)]).normalized()
                n = t.cross(Vector((0, 1, 0))).normalized()
                bb = t.cross(n).normalized()
                ring = [bm.verts.new(V(*(p + n * math.cos(2 * math.pi * j / 4) * r + bb * math.sin(2 * math.pi * j / 4) * r))) for j in range(4)]
                rings.append(ring)
            for i in range(2):
                for j in range(4):
                    bm.faces.new((rings[i][j], rings[i][(j + 1) % 4], rings[i + 1][(j + 1) % 4], rings[i + 1][j]))
            me = bpy.data.meshes.new("whisker")
            bm.to_mesh(me)
            bm.free()
            parts.append(link("whisker", me, WHISKER))
    return parts


def collar():
    """Her collar: a dark band round the neck, a small silver tag hanging at the front."""
    a = Vector(J["neck0"]).lerp(Vector(J["neck1"]), 0.45)
    ax = (Vector(J["neck1"]) - Vector(J["neck0"])).normalized()
    n = ax.cross(Vector((1, 0, 0))).normalized()
    b = ax.cross(n).normalized()
    bm = bmesh.new()
    rings = []
    R = 0.047
    for k in range(2):
        c = a + ax * (k * 0.012 - 0.006)
        rings.append([bm.verts.new(V(*(c + n * math.cos(2 * math.pi * j / 32) * R + b * math.sin(2 * math.pi * j / 32) * R * 1.05))) for j in range(32)])
    for j in range(32):
        bm.faces.new((rings[0][j], rings[0][(j + 1) % 32], rings[1][(j + 1) % 32], rings[1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("collar")
    bm.to_mesh(me)
    bm.free()
    ob = link("collar", me, COLLAR)
    sol = ob.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.003
    evaluated(ob)
    ob.data.materials.clear()
    ob.data.materials.append(COLLAR)
    # The tag: a small disc at the front of the throat.
    front = a + n * (-R) if (a + n * (-R)).z > (a + n * R).z else a + n * R
    tag_c = front + Vector((0, -0.018, 0.008))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.009, radius2=0.009, depth=0.0025)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, vec=V(*tag_c), verts=bm.verts)
    me = bpy.data.meshes.new("tag")
    bm.to_mesh(me)
    bm.free()
    return [ob, link("tag", me, TAG)]


# ─── markings ────────────────────────────────────────────────────────────────

def whiteness_body(p, n):
    """0 black .. 1 white, for a point p (site) with normal n on the body."""
    w = 0.0
    # The bib: the front of the chest and the throat, broad, wrapping round the sides of the neck.
    front = smooth(-0.1, 0.45, n.z)
    bib = smooth(0.05, 0.1, p.z) * smooth(0.27, 0.2, p.y) * smooth(0.06, 0.035, abs(p.x)) * front
    throat = smooth(0.1, 0.13, p.z) * smooth(0.29, 0.26, p.y) * smooth(-0.3, 0.2, n.z - 0.5 * n.y)
    w = max(w, bib, throat)
    # Belly, underneath.
    w = max(w, smooth(-0.25, -0.6, n.y) * smooth(-0.12, -0.04, p.z) * smooth(0.17, 0.13, p.y))
    # Front legs: white all round below the elbow, and on their front above it,
    # with a black patch high on her left one.
    fl = smooth(0.05, 0.08, p.z) * smooth(0.115, 0.09, p.y)
    fl = max(fl, smooth(0.07, 0.1, p.z) * smooth(0.17, 0.13, p.y) * front)
    patch = math.exp(-(((p.x - 0.05) / 0.016) ** 2 + ((p.y - 0.125) / 0.02) ** 2 + ((p.z - 0.112) / 0.025) ** 2))
    w = max(w, fl * (1 - 0.95 * patch))
    # White socks behind.
    w = max(w, smooth(-0.09, -0.12, p.z) * smooth(0.068, 0.05, p.y))
    return max(0.0, min(1.0, w))


def whiteness_head(p):
    """Head markings, from the head's own unit coordinates (x across, y up, z forward)."""
    x, y, z = p
    w = 0.0
    # Muzzle and chin.
    w = max(w, smooth(0.25, 0.55, z) * smooth(0.02, -0.18, y))
    w = max(w, smooth(-0.45, -0.7, y) * smooth(-0.2, 0.2, z))
    # Lower cheeks, under the whisker line.
    w = max(w, smooth(-0.15, -0.4, y) * smooth(0.0, 0.3, z))
    # The blaze: a stripe up the nose, narrowing between the eyes.
    half = 0.15 - 0.11 * smooth(-0.1, 0.45, y)
    w = max(w, smooth(0.62, 0.8, z) * smooth(half + 0.035, half, abs(x)) * smooth(0.5, 0.36, y))
    # The black spot on her chin, on her left.
    spot = math.exp(-(((x - 0.2) / 0.1) ** 2 + ((y + 0.44) / 0.08) ** 2)) * smooth(0.3, 0.6, z)
    w *= 1 - 0.9 * spot
    return max(0.0, min(1.0, w))


def paint(ob, fn):
    me = ob.data
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            k = fn(v)
            c = [BLACK[i] + (WHITE[i] - BLACK[i]) * k for i in range(3)]
            col.data[li].color = (*c, 1.0)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def paint_all(body_ob, head_ob, ear_obs):
    paint(body_ob, lambda v: whiteness_body(S(v.co), S(v.normal)))

    def head_fn(v):
        p = S(v.co) - HEAD_C
        # Back to unit-sphere-ish coordinates for the rules.
        return whiteness_head((p.x / (0.055 * HS), p.y / (0.047 * HS), p.z / (0.05 * HS)))

    paint(head_ob, head_fn)
    for e in ear_obs:
        if e.data.materials[0] == FUR:
            paint(e, lambda v: 0.0)


# ─── rig ─────────────────────────────────────────────────────────────────────

BONES = [
    # name, head joint, tail joint, parent
    ("hips", J["pelvis"], J["mid"], None),
    ("spine", J["mid"], J["chest"], "hips"),
    ("chest", J["chest"], J["neck0"], "spine"),
    ("neck", J["neck0"], J["neck1"], "chest"),
    ("head", J["neck1"], J["headtip"], "neck"),
]
for s in ("L", "R"):
    BONES += [
        (f"upperarm.{s}", J[f"shoulder.{s}"], J[f"elbow.{s}"], "chest"),
        (f"forearm.{s}", J[f"elbow.{s}"], J[f"wrist.{s}"], f"upperarm.{s}"),
        (f"paw.{s}", J[f"wrist.{s}"], J[f"toe.{s}"], f"forearm.{s}"),
        (f"thigh.{s}", J[f"hip.{s}"], J[f"knee.{s}"], "hips"),
        (f"shin.{s}", J[f"knee.{s}"], J[f"hock.{s}"], f"thigh.{s}"),
        (f"foot.{s}", J[f"hock.{s}"], J[f"htoe.{s}"], f"shin.{s}"),
    ]
prev = "hips"
for i in range(5):
    BONES.append((f"tail.{i + 1}", TAIL[i], TAIL[i + 1], prev))
    prev = f"tail.{i + 1}"


def rig():
    data = bpy.data.armatures.new("KittyRig")
    arm = bpy.data.objects.new("KittyRig", data)
    COLL.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = data.edit_bones.new("root")
    root.head = V(0, 0, 0)
    root.tail = V(0, 0.06, 0)
    root.align_roll(V(0, 0, 1))
    for name, a, b, parent in BONES:
        eb = data.edit_bones.new(name)
        eb.head = V(*a)
        eb.tail = V(*b)
        d = Vector(b) - Vector(a)
        # A consistent sideways X axis: horizontal bones roll their Z up,
        # hanging leg bones roll their Z forwards.
        up = V(0, 0, 1) if abs(d.y) > abs(d.z) else V(0, 1, 0)
        eb.align_roll(up)
        eb.parent = data.edit_bones[parent] if parent else root
        eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def segdist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def skin(ob, arm, fixed=None):
    """Vertex weights from the distance to each bone (the three nearest,
    falling off with the 4th power), or all to one bone (`fixed`)."""
    names = [b[0] for b in BONES]
    segs = {b[0]: (Vector(b[1]), Vector(b[2])) for b in BONES}
    groups = {n: ob.vertex_groups.new(name=n) for n in names}
    for v in ob.data.vertices:
        if fixed:
            groups[fixed].add([v.index], 1.0, "REPLACE")
            continue
        p = S(v.co)
        ds = sorted(((segdist(p, *segs[n]), n) for n in names))[:3]
        ws = [(1.0 / max(1e-4, d) ** 4, n) for d, n in ds]
        total = sum(w for w, _ in ws)
        for w, n in ws:
            if w / total > 0.02:
                groups[n].add([v.index], w / total, "REPLACE")
    ob.parent = arm
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = arm


# ─── animation ───────────────────────────────────────────────────────────────

def key_action(arm, name, frames, pose_at):
    """Make an action by calling pose_at(t in 0..1) → {bone: (pitch, yaw, roll)} and
    optional ('root', (dx, dy, dz)) offsets, keyed on every frame of the loop."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    pbs = arm.pose.bones
    for pb in pbs:
        pb.rotation_mode = "XYZ"
    for f in range(frames + 1):
        t = (f % frames) / frames
        pose = pose_at(t)
        for pb in pbs:
            rx, ry, rz = pose.get(pb.name, (0.0, 0.0, 0.0))
            pb.rotation_euler = (rx, ry, rz)
            pb.keyframe_insert("rotation_euler", frame=f + 1)
            if pb.name in ("root", "hips"):
                off = pose.get(pb.name + ":loc", (0.0, 0.0, 0.0))
                pb.location = off
                pb.keyframe_insert("location", frame=f + 1)
    # Park the action on the NLA so the exporter keeps every clip.
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    arm.animation_data.action = None
    return action


TAU = 2 * math.pi


def walk_pose(t):
    """A lateral-sequence walk: left hind, left fore, right hind, right fore,
    a quarter of a cycle apart. Pitch is about each bone's sideways axis."""
    pose = {}
    phases = {"L": 0.0, "R": 0.5}
    for s, ph in phases.items():
        hind = TAU * (t + ph)
        fore = TAU * (t + ph + 0.25)
        pose[f"thigh.{s}"] = (0.33 * math.sin(hind), 0.0, 0.0)
        pose[f"shin.{s}"] = (-0.45 * max(0.0, math.cos(hind)) - 0.08, 0.0, 0.0)
        pose[f"foot.{s}"] = (0.45 * max(0.0, math.cos(hind + 0.6)), 0.0, 0.0)
        pose[f"upperarm.{s}"] = (0.28 * math.sin(fore), 0.0, 0.0)
        pose[f"forearm.{s}"] = (0.6 * max(0.0, math.cos(fore - 0.4)), 0.0, 0.0)
        pose[f"paw.{s}"] = (-0.45 * max(0.0, math.cos(fore - 0.9)), 0.0, 0.0)
    sway = 0.045 * math.sin(TAU * t)
    pose["hips"] = (0.0, 0.0, sway)
    pose["hips:loc"] = (0.0, 0.004 * math.cos(2 * TAU * t), 0.0)
    pose["spine"] = (0.0, 0.0, -sway * 0.6)
    pose["chest"] = (0.0, 0.0, -sway * 0.5)
    pose["neck"] = (-0.04 * math.cos(2 * TAU * t), 0.0, 0.0)
    pose["head"] = (0.05 * math.cos(2 * TAU * t), 0.0, 0.0)
    # Tail up in a relaxed curve, swaying.
    lift = [0.5, 0.3, 0.15, -0.05, -0.15]
    for i in range(5):
        pose[f"tail.{i + 1}"] = (lift[i], 0.0, 0.1 * math.sin(TAU * t - i * 0.7))
    return pose


def idle_pose(t):
    """Standing still: breathing, the tail slowly swishing, a glance, an ear flick."""
    pose = {}
    breath = math.sin(TAU * t * 2)
    pose["spine"] = (0.012 * breath, 0.0, 0.0)
    pose["chest"] = (-0.01 * breath, 0.0, 0.0)
    pose["neck"] = (0.05, 0.0, 0.0)
    pose["head"] = (-0.04, 0.0, 0.06 * math.sin(TAU * t))
    lift = [0.35, 0.3, 0.2, 0.05, -0.1]
    for i in range(5):
        pose[f"tail.{i + 1}"] = (lift[i], 0.0, 0.16 * math.sin(TAU * t - i * 0.5))
    for s in ("L", "R"):
        pose[f"shin.{s}"] = (-0.05, 0.0, 0.0)
    return pose


def join(obs, name):
    """Merge meshes (same material, colours kept) into one object."""
    if len(obs) == 1:
        obs[0].name = name
        return obs[0]
    bm = bmesh.new()
    for ob in obs:
        bm.from_mesh(ob.data)
    m = obs[0].data.materials[0]
    for ob in obs:
        old = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    me.shade_smooth()
    if "Col" in me.color_attributes:
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    return link(name, me, m)


def by_material(obs):
    out = {}
    for ob in obs:
        out.setdefault(ob.data.materials[0].name, []).append(ob)
    return out


def main():
    b = body()
    h = head()
    es = ears()
    fs = face_parts()
    cs = collar()
    paint_all(b, h, es)
    arm = rig()
    skin(b, arm)
    # The head and everything on it moves with the head bone: one mesh per material.
    head_parts = [join(obs, name) for name, obs in by_material([h] + es + fs).items()]
    for part in head_parts:
        skin(part, arm, fixed="head")
    for part in cs:
        skin(part, arm, fixed="neck")
    key_action(arm, "Walk", 18, walk_pose)
    key_action(arm, "Idle", 120, idle_pose)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"[kitty] {tris} triangles")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_draco_mesh_compression_enable=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[kitty] wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


main()
