"""
Kitty's living room and garden (Pacific Wharf) as one GLB for the store.

    node scripts/store/textures.mjs            # textures from Felix's photos first
    node scripts/store/blender.mjs scripts/store/room.py

Built from src/components/store/layout.json (the same numbers the site uses
for Kitty's spots and paths) and the textures in assets-raw/room/build, in a
stylised, soft-edged style: bevelled shapes, flat colours, and photo
textures only where a flat thing was photographed (the pictures on the walls)
or painted from the photos (the rugs, the floor, the brick).

Writes public/models/room.glb. Everything that shares a material is merged
into one mesh (few draw calls on a phone). Names the site looks for:
    Sway_*            plants that sway in the breeze (pivot at their base)
    Glow_* materials  lamps, bulbs and the light they throw (brighter in the evening)
    Shadow            soft contact shadows under furniture
    Glass             window glass
Coordinates in this file are the site's (three.js: y up, the visitor at +z
looking towards -z); V() turns them into Blender's.
"""

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
with open(os.path.join(ROOT, "src", "components", "store", "layout.json"), encoding="utf-8") as fh:
    L = json.load(fh)
TEX = os.path.join(ROOT, "assets-raw", "room", "build")
OUT = os.path.join(ROOT, "public", "models", "room.glb")

R = L["room"]
F = L["furniture"]
G = L["garden"]
rng = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def V(x, y, z):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


# ─── materials ───────────────────────────────────────────────────────────────

MATS = {}


def lin(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def mat(name, color="#ffffff", rough=0.85, metal=0.0, image=None, emit=None, strength=1.0, alpha_image=False, alpha=1.0, size=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if image:
        img = bpy.data.images.load(os.path.join(TEX, image))
        if size and (img.size[0] > size[0] or img.size[1] > size[1]):
            img.scale(size[0], size[1])
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if alpha_image:
            nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit), 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    if alpha_image or alpha < 1:
        m.surface_render_method = "BLENDED"
    MATS[name] = m
    return m


# The palette, from the photos.
WALL = mat("Wall", "#ece7dd", 0.95)
CEILING = mat("Ceiling", "#f2eee8", 1.0)
SKIRT = mat("Skirting", "#f6f4ef", 0.5)
FLOOR = mat("Floor", image="floor-beech.png", rough=0.45)
UPVC = mat("Upvc", "#f3f3f0", 0.35)
GLASS = mat("Glass", "#cfe2ea", 0.05, alpha=0.14)
BLIND = mat("Blind", "#e8e1cf", 0.9)
SOFA = mat("Sofa", "#6a6d70", 1.0)
SOFA_DARK = mat("SofaDark", "#595e61", 1.0)
MUSTARD = mat("Mustard", "#d6a31e", 0.7)
SAGE = mat("Sage", "#a7b49d", 0.9)
OAK = mat("Oak", "#c99e62", 0.55)
OAK_DARK = mat("OakDark", "#a97a45", 0.6)
OAK_LIGHT = mat("OakLight", "#d6b07a", 0.55)
WALNUT = mat("Walnut", "#7d4822", 0.5)
BLACK = mat("Black", "#1c1c1e", 0.45)
METAL_BLACK = mat("MetalBlack", "#202123", 0.4, 0.6)
STEEL = mat("Steel", "#b9bcc0", 0.3, 0.9)
LEATHER = mat("Leather", "#9d4f26", 0.42)
LEATHER_DARK = mat("LeatherDark", "#7a3a1b", 0.45)
THROW = mat("Throw", "#ecebe6", 1.0)
PINE = mat("Pine", "#cf9f5f", 0.6)
DARK_WOOD = mat("DarkWood", "#3b2417", 0.35)
DOOR_WOOD = mat("DoorWood", "#c07a3e", 0.5)
HALL = mat("Hall", "#3a3632", 1.0)
PLUSH = mat("Plush", "#5e6164", 1.0)
PLUSH_DARK = mat("PlushDark", "#393b3e", 1.0)
SISAL = mat("Sisal", "#cdb489", 1.0)
PUFFER = mat("Puffer", "#1c1d21", 0.5)
KHAKI = mat("Khaki", "#5d5a44", 0.9)
TRAINER = mat("Trainer", "#e9e7e1", 0.7)
BLUE = mat("Blue", "#3b6fd1", 0.6)
CERAMIC = mat("Ceramic", "#f1eee8", 0.35)
LEAF = mat("Leaf", "#58853a", 0.85)
LEAF_DEEP = mat("LeafDeep", "#3d6a36", 0.9)
ROSEMARY = mat("Rosemary", "#6f8b67", 0.95)
STEM = mat("Stem", "#4f7a33", 0.9)
SUNFLOWER = mat("Sunflower", "#f0b31d", 0.8)
SUN_EYE = mat("SunflowerEye", "#553416", 0.9)
TENNIS = mat("TennisBall", "#d6e84b", 1.0)
AMBER = mat("Amber", "#e0792a", 0.2)
CAP_GREEN = mat("CapGreen", "#3f8f5a", 0.85)
CAP_RED = mat("CapRed", "#d23a32", 0.85)
HELMET_GREY = mat("HelmetGrey", "#8e9396", 0.35)
LAPTOP = mat("Laptop", "#3a3b3e", 0.4, 0.5)
BOOKS = [mat(f"Book{i}", c, 0.8) for i, c in enumerate(["#8b2f2a", "#274a73", "#c8b98e", "#2f5a3c", "#e3dccb", "#1f1f22", "#b8683a", "#5a4a7a"])]
# Garden
PAVING = mat("Paving", image="paving.png", rough=0.9, size=(512, 512))
BRICK = mat("Brick", image="brick-stock.png", rough=0.95, size=(512, 512))
FENCE = mat("Fence", "#6d7664", 0.9)
FENCE_DARK = mat("FenceDark", "#5a6253", 0.9)
FELT = mat("FeltGreen", "#a8c83b", 1.0)
SLEEPER = mat("Sleeper", "#8d6c47", 0.9)
SOIL = mat("Soil", "#3b2a1f", 1.0)
SCAFFOLD = mat("Scaffold", "#b59c77", 0.9)
CAGE = mat("CageGreen", "#57c47e", 0.6)
CHAIR_WHITE = mat("ChairWhite", "#f2f2f1", 0.5)
PALLET = mat("PalletWood", "#c79a5d", 0.9)
GATE = mat("GateWhite", "#f1efe9", 0.7)
CONCRETE = mat("Concrete", "#8f8c85", 0.95)
TYRE = mat("Tyre", "#1a1a1a", 0.8)
BIKE = mat("BikeWhite", "#eeeeee", 0.4)
LIFEBUOY = mat("LifebuoyRed", "#d7392f", 0.6)
WHITE = mat("White", "#f4f4f2", 0.6)
# Pictures and rugs
ART_BP = mat("Art_BeautyParlour", image="art-beauty-parlour.png", rough=0.45)
ART_MAZE = mat("Art_Maze", image="art-maze.png", rough=0.5)
ART_PINK = mat("Art_Pink", image="art-pink.png", rough=0.5)
ART_MAPS = mat("Art_Maps", image="art-maps.png", rough=0.5)
ART_BOT = mat("Art_Botanical", image="art-botanical.png", rough=0.5)
RUG = mat("Rug_Folk", image="rug-folk.png", rough=1.0, size=(768, 1080))
KOI = mat("Rug_Koi", image="rug-koi.png", rough=1.0, alpha_image=True, size=(384, 1050))
SHADOW = mat("Shadow", "#000000", 1.0, image="shadow-soft.png", alpha_image=True, size=(128, 128))
# Light: the site brightens these in the evening.
GLOW_LAMP = mat("Glow_Lamp", "#f7e7c6", 0.8, emit="#ffc27a", strength=1.0)
GLOW_WICKER = mat("Glow_Wicker", "#d9a45a", 0.9, emit="#ffb867", strength=0.6)
GLOW_FESTOON = mat("Glow_Festoon", "#fff4dc", 0.4, emit="#ffd28a", strength=1.2)
GLOW_GLOBE = mat("Glow_Globe", "#fff6e6", 0.3, emit="#ffe6b8", strength=1.4)
GLOW_WASH = mat("Glow_Wash", "#fff1dc", 1.0, image="glow-wash.png", alpha_image=True, emit="#ffd9a8", strength=0.8, size=(128, 128))

# ─── geometry helpers ────────────────────────────────────────────────────────

COLL = SCENE.collection


def obj(name, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(38))
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mats = list(ob.data.materials)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    if not me.materials:
        for m in mats:
            me.materials.append(m)
    bpy.data.meshes.remove(old)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(38))
    return ob


def box(name, x0, y0, z0, x1, y1, z1, material, bevel=0.0, seg=2):
    """An axis-aligned box between two corners, in site coordinates."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(abs(x1 - x0), abs(z1 - z0), abs(y1 - y0)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    ob = obj(name, bm, material, smooth=False)
    if bevel > 0:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = "NONE"
        mod.harden_normals = False
        apply_mods(ob)
    return ob


def lbox(name, cx, cy, cz, sx, sy, sz, material, bevel=0.0, seg=2):
    """A box by centre and size (site axes)."""
    return box(name, cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, material, bevel, seg)


def cyl(name, x, y0, z, r, h, material, seg=20, r2=None):
    """A vertical cylinder (or cone, with r2) standing on y0."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=V(x, y0 + h / 2, z), verts=bm.verts)
    return obj(name, bm, material)


def rod(name, a, b, r, material, seg=10):
    """A cylinder from point a to point b (site coordinates)."""
    A = V(*a)
    B = V(*b)
    d = B - A
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((A + B) / 2) @ rot, verts=bm.verts)
    return obj(name, bm, material)


def ball(name, x, y, z, r, material, sx=1.0, sy=1.0, sz=1.0, seg=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(x, y, z), verts=bm.verts)
    return obj(name, bm, material)


def torus(name, x, y, z, R_, r, material, axis="y", seg=32, tseg=10):
    """A ring around the given site axis."""
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(tseg):
            b = 2 * math.pi * j / tseg
            p = ((R_ + r * math.cos(b)) * math.cos(a), (R_ + r * math.cos(b)) * math.sin(a), r * math.sin(b))
            ring.append(bm.verts.new(p))
        verts.append(ring)
    for i in range(seg):
        for j in range(tseg):
            a0 = verts[i][j]
            a1 = verts[(i + 1) % seg][j]
            b1 = verts[(i + 1) % seg][(j + 1) % tseg]
            b0 = verts[i][(j + 1) % tseg]
            bm.faces.new((a0, a1, b1, b0))
    # Built around Blender Z (= site y). Turn for other axes.
    if axis == "x":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "z":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, vec=V(x, y, z), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, material)


def quad(name, c, u, v, w, h, material, flip=False):
    """A flat rectangle centred at c (site), spanning w along u and h along v,
    UV 0..1 (u right, v up), facing u × v... i.e. towards the viewer for whom
    u points right and v up."""
    c = Vector(c)
    u = Vector(u).normalized()
    v = Vector(v).normalized()
    corners = [c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2, c - u * w / 2 + v * h / 2]
    bm = bmesh.new()
    vs = [bm.verts.new(V(*p)) for p in corners]
    f = bm.faces.new(vs if not flip else list(reversed(vs)))
    uv = bm.loops.layers.uv.new("UVMap")
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    if flip:
        uvs = list(reversed(uvs))
    for loop, t in zip(f.loops, uvs):
        loop[uv].uv = t
    return obj(name, bm, material, smooth=False)


def floor_quad(name, x, z, w, d, material, y=0.002, yaw=0.0):
    """A rectangle lying on the floor, w along x and d along z before turning by yaw.
    The texture's top edge points away from the visitor (towards -z)."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    u = (ca, 0, -sa)
    v = (-sa, 0, -ca)
    return quad(name, (x, y, z), u, v, w, d, material)


def shadow(x, z, w, d, y=0.003, strength_scale=1.0, yaw=0.0):
    return floor_quad("shadow", x, z, w * 1.35 * strength_scale, d * 1.35 * strength_scale, SHADOW, y=y, yaw=yaw)


def uv_world(ob, scale):
    """Box-project UVs from world position so tiling textures are true to size."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = ob.matrix_world
    rot = mw.to_3x3()
    for f in bm.faces:
        n = rot @ f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            p = mw @ loop.vert.co
            if ax == 0:
                a, b = p.y, p.z
            elif ax == 1:
                a, b = p.x, p.z
            else:
                a, b = p.x, -p.y
            loop[uv].uv = (a / scale, b / scale)
    bm.to_mesh(me)
    bm.free()


def group(name, loc, yaw, build):
    """Build parts around the origin (site coords), then move them to loc and turn by yaw."""
    before = set(bpy.data.objects)
    build()
    parts = [o for o in bpy.data.objects if o not in before]
    M = Matrix.Translation(V(*loc)) @ Matrix.Rotation(yaw, 4, "Z")
    for p in parts:
        p.data.transform(M)
    return parts


def sway(name, pivot, build):
    """Parts that sway together: merged into one object whose origin is the pivot."""
    before = set(bpy.data.objects)
    build()
    parts = [o for o in bpy.data.objects if o not in before]
    bm = bmesh.new()
    mats = []
    for p in parts:
        m = p.data.materials[0]
        if m not in mats:
            mats.append(m)
        me = p.data.copy()
        idx = mats.index(m)
        for poly in me.polygons:
            poly.material_index = idx
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for p in parts:
        bpy.data.objects.remove(p, do_unlink=True)
    P = V(*pivot)
    bmesh.ops.translate(bm, vec=-P, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    ob.location = P
    COLL.objects.link(ob)
    return ob


# ─── the room ────────────────────────────────────────────────────────────────

def shell():
    x0, x1, zb, zf, h = R["left"], R["right"], R["back"], R["front"], R["height"]
    t = 0.12
    fl = box("floor", x0, -0.06, zb, x1, 0.0, zf, FLOOR)
    uv_world(fl, 1.28)
    box("ceiling", x0, h, zb, x1, h + 0.05, zf, CEILING)
    d = L["patioDoor"]
    # Back wall with the patio door.
    box("wall", x0 - t, 0, zb - t, d["x0"], h, zb, WALL)
    box("wall", d["x1"], 0, zb - t, x1 + t, h, zb, WALL)
    box("wall", d["x0"], d["height"], zb - t, d["x1"], h, zb, WALL)
    # Left wall.
    box("wall", x0 - t, 0, zb - t, x0, h, zf + t, WALL)
    # Right wall with the hall door.
    hd = F["hallDoor"]
    box("wall", x1, 0, zb - t, x1 + t, h, hd["z0"], WALL)
    box("wall", x1, 0, hd["z1"], x1 + t, h, zf + t, WALL)
    box("wall", x1, hd["height"], hd["z0"], x1 + t, h, hd["z1"], WALL)
    # The front (behind the visitor), so nothing looks out into the void.
    box("wall", x0 - t, 0, zf, x1 + t, h, zf + t, WALL)
    # Skirting.
    s = 0.1
    k = 0.014
    box("skirt", x0, 0, zb, d["x0"], s, zb + k, SKIRT)
    box("skirt", d["x1"], 0, zb, x1, s, zb + k, SKIRT)
    box("skirt", x0, 0, zb, x0 + k, s, zf, SKIRT)
    box("skirt", x1 - k, 0, zb, x1, s, hd["z0"], SKIRT)
    box("skirt", x1 - k, 0, hd["z1"], x1, s, zf, SKIRT)
    # Where the ceiling meets the walls, a soft line.
    for (a, b, c, e) in ((x0, zb, x1, zb + 0.02), (x0, zb, x0 + 0.02, zf), (x1 - 0.02, zb, x1, zf)):
        box("cornice", a, h - 0.04, b, c, h, e, SKIRT)


def patio_door():
    d = L["patioDoor"]
    zb = R["back"]
    x0, x1, hh = d["x0"], d["x1"], d["height"]
    z0, z1 = zb - 0.1, zb
    f = 0.07
    box("upvc", x0, 0, z0, x0 + f, hh, z1, UPVC)
    box("upvc", x1 - f, 0, z0, x1, hh, z1, UPVC)
    box("upvc", x0, hh - f, z0, x1, hh, z1, UPVC)
    box("upvc", x0 - 0.02, -0.1, z0 - 0.04, x1 + 0.02, 0.02, z1 + 0.03, UPVC)  # sill / step
    # The fixed pane on the left (with the blind in front of it) ...
    mid = d["openFrom"]
    p0, p1 = x0 + f, mid
    zp = zb - 0.05
    box("upvc", p0, 0.02, zp - 0.03, p0 + 0.07, hh - f, zp + 0.03, UPVC)
    box("upvc", p1 - 0.07, 0.02, zp - 0.03, p1, hh - f, zp + 0.03, UPVC)
    box("upvc", p0, hh - f - 0.07, zp - 0.03, p1, hh - f, zp + 0.03, UPVC)
    box("upvc", p0, 0.02, zp - 0.03, p1, 0.13, zp + 0.03, UPVC)
    quad("glass", ((p0 + p1) / 2, (0.13 + hh - f - 0.07) / 2, zp), (1, 0, 0), (0, 1, 0), p1 - p0 - 0.14, hh - f - 0.2, GLASS)
    # ... and the sliding pane, open: tucked behind it, its handle showing.
    zs = zb - 0.085
    q0, q1 = p0 + 0.05, p1 + 0.06
    box("upvc", q1 - 0.07, 0.02, zs - 0.025, q1, hh - f, zs + 0.025, UPVC)
    rod("handle", (q1 - 0.02, 0.95, zs + 0.04), (q1 - 0.02, 1.2, zs + 0.04), 0.012, STEEL)
    # Vertical blinds over the fixed pane.
    box("blindrail", x0 - 0.02, hh + 0.02, zb + 0.06, p1 + 0.12, hh + 0.07, zb + 0.1, UPVC)
    n = 9
    for i in range(n):
        x = x0 + 0.05 + i * (p1 + 0.1 - x0 - 0.05) / (n - 1)
        def slat():
            lbox("slat", 0, 1.06, 0, 0.088, 1.98, 0.004, BLIND)
        group("slat", (x, 0, zb + 0.09), math.radians(62), slat)


def sofa():
    s = F["sofa"]
    x0, x1, z0, z1, cx0, cz1 = s["x0"], s["x1"], s["z0"], s["z1"], s["chaiseX0"], s["chaiseZ1"]
    seat, back = s["seat"], s["back"]
    box("sofa", x0, 0.07, z0, x1, 0.3, z1, SOFA, 0.03, 3)
    box("sofa", cx0, 0.07, z1 - 0.05, x1, 0.3, cz1, SOFA, 0.03, 3)
    box("sofa", x0, 0.07, z0, x1, 0.62, z0 + 0.2, SOFA, 0.05, 3)  # back frame
    box("sofa", x0, 0.07, z0, x0 + 0.2, 0.62, z1, SOFA, 0.07, 4)  # left arm
    # Seat cushions: two on the long part, one long one on the chaise.
    left = x0 + 0.2
    w = (cx0 - left) / 2
    for i in range(2):
        box("cushion", left + i * w + 0.006, 0.3, z0 + 0.2, left + (i + 1) * w - 0.006, seat, z1 + 0.02, SOFA, 0.06, 4)
    box("cushion", cx0 + 0.006, 0.3, z0 + 0.2, x1, seat, cz1 + 0.02, SOFA, 0.06, 4)
    # Back cushions, leaning back a little.
    n = 3
    bw = (x1 - left) / n
    for i in range(n):
        cx = left + (i + 0.5) * bw

        def cushion():
            lbox("back", 0, 0, 0, bw - 0.02, back - seat + 0.02, 0.22, SOFA, 0.08, 4)

        parts = group("back", (cx, (seat + back) / 2, z0 + 0.3), 0, cushion)
        for p in parts:
            p.data.transform(Matrix.Translation(V(cx, (seat + back) / 2, z0 + 0.3)) @ Matrix.Rotation(math.radians(-10), 4, "X") @ Matrix.Translation(-V(cx, (seat + back) / 2, z0 + 0.3)))
    # Feet.
    for (x, z) in ((x0 + 0.06, z0 + 0.06), (x0 + 0.06, z1 - 0.06), (x1 - 0.06, z0 + 0.06), (x1 - 0.06, cz1 - 0.06), (cx0 + 0.06, cz1 - 0.06)):
        box("foot", x - 0.025, 0, z - 0.025, x + 0.025, 0.07, z + 0.025, BLACK)
    # Mustard velvet cushions and the sage bolster.
    for (x, z, yaw) in ((-0.02, z0 + 0.42, 0.12), (1.18, z0 + 0.4, -0.2)):
        def pillow():
            lbox("pillow", 0, 0, 0, 0.46, 0.42, 0.13, MUSTARD, 0.06, 4)

        parts = group("pillow", (x, seat + 0.2, z), yaw, pillow)
        for p in parts:
            c = V(x, seat + 0.2, z)
            p.data.transform(Matrix.Translation(c) @ Matrix.Rotation(math.radians(-18), 4, "X") @ Matrix.Translation(-c))
    rod("bolster", (0.38, seat + 0.085, z0 + 0.62), (0.8, seat + 0.085, z0 + 0.58), 0.085, SAGE, seg=18)
    shadow((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0)
    shadow((cx0 + x1) / 2, (z1 + cz1) / 2, x1 - cx0, z1 - cz1)


def ottoman():
    o = F["ottoman"]
    box("ottoman", o["x0"], 0.0, o["z0"], o["x1"], o["height"], o["z1"], SOFA_DARK, 0.045, 3)
    for i in range(3):
        for j in range(2):
            x = o["x0"] + (i + 0.5) * (o["x1"] - o["x0"]) / 3
            z = o["z0"] + (j + 0.5) * (o["z1"] - o["z0"]) / 2
            ball("button", x, o["height"] - 0.004, z, 0.014, PLUSH_DARK, sy=0.5, seg=8)
    shadow((o["x0"] + o["x1"]) / 2, (o["z0"] + o["z1"]) / 2, o["x1"] - o["x0"], o["z1"] - o["z0"])


def coffee_table():
    t = F["coffeeTable"]
    x0, x1, z0, z1, h = t["x0"], t["x1"], t["z0"], t["z1"], t["height"]
    box("tabletop", x0, h - 0.035, z0, x1, h, z1, OAK, 0.008, 2)
    box("tablebody", x0 + 0.03, 0.22, z0 + 0.03, x1 - 0.03, h - 0.035, z1 - 0.03, OAK, 0.006, 2)
    # Drawer front and the open cubby on the right.
    box("drawer", x0 + 0.06, 0.24, z1 - 0.032, x0 + 0.62, h - 0.05, z1 - 0.024, OAK_DARK, 0.004, 2)
    box("cubby", x0 + 0.66, 0.235, z0 + 0.06, x1 - 0.05, h - 0.05, z1 - 0.026, WALNUT)
    box("pull", x0 + 0.3, 0.3, z1 - 0.026, x0 + 0.38, 0.312, z1 - 0.018, WALNUT)
    for (x, z, sx, sz) in ((x0 + 0.08, z0 + 0.08, -1, -1), (x1 - 0.08, z0 + 0.08, 1, -1), (x0 + 0.08, z1 - 0.08, -1, 1), (x1 - 0.08, z1 - 0.08, 1, 1)):
        rod("leg", (x, 0.225, z), (x + sx * 0.04, 0.0, z + sz * 0.03), 0.02, OAK)
    # What is on it: the wooden box, a black flask, a little stack of cards.
    box("woodbox", 0.22, h, -1.72, 0.44, h + 0.13, -1.58, WALNUT, 0.008, 2)
    cyl("flask", 0.6, h, -1.56, 0.038, 0.22, BLACK)
    for i, m in enumerate((BOOKS[4], BOOKS[1], BOOKS[2])):
        lbox("cards", -0.1, h + 0.006 + i * 0.012, -1.7, 0.16, 0.011, 0.11, m)
    shadow((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y=0.006)


def rug():
    r = F["rug"]
    # The painted rug is portrait; its long side runs along x here.
    quad("rug", (r["x"], 0.005, r["z"]), (0, 0, 1), (1, 0, 0), r["depth"], r["width"], RUG)


def recliner():
    r = F["recliner"]

    def build():
        box("base", -0.42, 0.06, -0.42, 0.42, 0.36, 0.42, LEATHER, 0.05, 3)
        box("seat", -0.29, 0.36, -0.3, 0.29, 0.5, 0.42, LEATHER, 0.06, 4)
        for s in (-1, 1):
            box("arm", s * 0.28 if s > 0 else -0.42, 0.06, -0.42, 0.42 if s > 0 else -0.28, 0.63, 0.42, LEATHER, 0.06, 4)
            rod("armroll", (s * 0.36, 0.63, -0.44), (s * 0.36, 0.63, 0.45), 0.085, LEATHER, seg=18)
        box("front", -0.36, 0.1, 0.4, 0.36, 0.34, 0.45, LEATHER_DARK, 0.03, 2)
        for x in (-0.36, 0.36):
            for z in (-0.36, 0.36):
                cyl("caster", x, 0.0, z, 0.025, 0.06, BLACK, seg=10)

    parts = group("recliner", (r["x"], 0, r["z"]), r["yaw"], build)

    def back():
        box("back", -0.42, 0.0, -0.11, 0.42, 0.66, 0.11, LEATHER, 0.08, 4)
        rod("backroll", (-0.42, 0.63, -0.02), (0.42, 0.63, -0.02), 0.1, LEATHER, seg=18)
        # The white throw over the top and down the back.
        box("throw", -0.3, 0.62, -0.16, 0.18, 0.76, 0.06, THROW, 0.05, 3)
        box("throw", -0.3, 0.18, -0.2, 0.18, 0.7, -0.12, THROW, 0.03, 2)

    c = Vector((0, 0.36, -0.34))
    parts = group("recliner", (0, 0, 0), 0, back)
    tilt = Matrix.Translation(V(*c)) @ Matrix.Rotation(math.radians(-12), 4, "X") @ Matrix.Translation(-V(0, 0, 0))
    M = Matrix.Translation(V(r["x"], 0, r["z"])) @ Matrix.Rotation(r["yaw"], 4, "Z")
    for p in parts:
        p.data.transform(M @ tilt)
    shadow(r["x"], r["z"], 0.9, 0.9, yaw=r["yaw"])


def bookcase():
    b = F["bookcase"]
    x0, x1, z0, z1, h = b["x0"], b["x1"], b["z0"], b["z1"], b["height"]
    t = 0.022
    box("case", x0, 0.0, z0, x1, 0.06, z1, PINE)
    box("case", x0, h - t, z0, x1, h, z1, PINE, 0.004, 2)
    box("case", x0, 0.0, z0, x1, h, z0 + t, PINE)
    box("case", x0, 0.0, z1 - t, x1, h, z1, PINE)
    zm = (z0 + z1) / 2
    box("case", x0, 0.06, zm - t / 2, x1, h - t, zm + t / 2, PINE)
    box("case", x1 - 0.01, 0.06, z0, x1, h, z1, OAK_DARK)
    shelves = [0.06, 0.34, 0.62, h - t]
    for y in shelves[1:3]:
        box("case", x0, y - t, z0, x1, y, z1, PINE)
    # Books in each of the six compartments.
    for row in range(3):
        y0 = shelves[row] + (t if row else 0)
        top = shelves[row + 1] - t
        for (a, e) in ((z0 + t, zm - t / 2), (zm + t / 2, z1 - t)):
            z = a + 0.01
            while z < e - 0.03:
                bw = rng.uniform(0.018, 0.045)
                if z + bw > e - 0.005:
                    break
                bh = min(top - y0 - 0.02, rng.uniform(0.17, 0.26))
                bd = rng.uniform(0.15, 0.21)
                if rng.random() < 0.08:
                    z += rng.uniform(0.04, 0.09)  # a gap
                    continue
                box("book", x1 - 0.012 - bd, y0, z, x1 - 0.012, y0 + bh, z + bw, rng.choice(BOOKS))
                z += bw + 0.002
    # On top: sunflowers in a glass vase, a speaker, the terrarium lantern with
    # tennis balls, an amber bowl, the wicker lamp, a carved wooden fish.
    y = h
    xc = (x0 + x1) / 2 - 0.02
    cyl("vase", xc, y, z0 + 0.2, 0.07, 0.22, GLASS)
    for i, (dz, dy, tilt) in enumerate(((0.0, 0.42, 0.0), (-0.07, 0.36, 0.3), (0.08, 0.33, -0.25))):
        top = (xc - 0.06, y + dy, z0 + 0.2 + dz)
        rod("stem", (xc, y + 0.05, z0 + 0.2 + dz * 0.3), top, 0.006, STEM, seg=6)

        def head(tilt=tilt):
            cyl("petals", 0, -0.012, 0, 0.075, 0.024, SUNFLOWER, seg=18)
            cyl("eye", 0, 0.012, 0, 0.034, 0.012, SUN_EYE, seg=14)

        parts = group("sunflower", (0, 0, 0), 0, head)
        # Face the room (-x), tipped up a little.
        M = Matrix.Translation(V(*top)) @ Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Rotation(math.radians(-20 + tilt * 30), 4, "X")
        for p in parts:
            p.data.transform(M)
        ball("leaf", xc - 0.02, y + dy * 0.55, z0 + 0.2 + dz + 0.05, 0.05, LEAF, sx=0.3, sy=0.5, sz=1.0, seg=10)
    box("speaker", xc - 0.07, y, z0 + 0.42, xc + 0.08, y + 0.2, z0 + 0.54, BLACK, 0.01, 2)
    lz = z0 + 0.9
    cyl("lantern", xc, y, lz, 0.12, 0.21, GLASS, seg=6)
    cyl("lanternroof", xc, y + 0.21, lz, 0.13, 0.12, GLASS, seg=6, r2=0.005)
    cyl("lanternbase", xc, y, lz, 0.125, 0.015, CAP_GREEN, seg=6)
    for (dx, dy, dz) in ((0, 0.033, 0), (0.05, 0.033, 0.04), (-0.04, 0.033, 0.05), (0.02, 0.033, -0.06), (-0.02, 0.09, 0.0)):
        ball("tennis", xc + dx, y + dy + 0.015, lz + dz, 0.033, TENNIS, seg=12)
    ball("bowl", xc, y + 0.01, z0 + 1.18, 0.07, AMBER, sy=0.45, seg=14)
    cyl("lampbase", xc, y, z1 - 0.28, 0.06, 0.03, BLACK)
    ball("wicker", xc, y + 0.17, z1 - 0.28, 0.1, GLOW_WICKER, sy=1.45, seg=18)
    ball("fish", xc + 0.02, y + 0.03, z1 - 0.1, 0.11, WALNUT, sx=0.35, sy=0.3, sz=1.0, seg=12)
    shadow((x0 + x1) / 2 - 0.05, (z0 + z1) / 2, x1 - x0 + 0.1, z1 - z0)


def pictures():
    xR = R["right"]
    xL = R["left"]
    zb = R["back"]
    p = F["poster"]
    box("frameback", xR - 0.02, p["y"] - p["height"] / 2, p["z"] - p["width"] / 2, xR, p["y"] + p["height"] / 2, p["z"] + p["width"] / 2, BLACK)
    quad("poster", (xR - 0.021, p["y"], p["z"]), (0, 0, 1), (0, 1, 0), p["width"], p["height"], ART_BP)
    m = F["maze"]
    box("frameback", m["x"] - m["width"] / 2, m["y"] - m["height"] / 2, zb, m["x"] + m["width"] / 2, m["y"] + m["height"] / 2, zb + 0.022, PINE)
    quad("maze", (m["x"], m["y"], zb + 0.023), (1, 0, 0), (0, 1, 0), m["width"], m["height"], ART_MAZE)
    k = F["pink"]
    box("frameback", xR - 0.02, k["y"] - k["height"] / 2, k["z"] - k["width"] / 2, xR, k["y"] + k["height"] / 2, k["z"] + k["width"] / 2, PINE)
    quad("pink", (xR - 0.021, k["y"], k["z"]), (0, 0, 1), (0, 1, 0), k["width"], k["height"], ART_PINK)
    mp = F["maps"]
    quad("maps", (xL + 0.012, mp["y"], mp["z"]), (0, 0, -1), (0, 1, 0), mp["width"], mp["height"], ART_MAPS)
    bo = F["botanical"]
    box("frameback", xL, bo["y"] - bo["height"] / 2, bo["z"] - bo["width"] / 2, xL + 0.02, bo["y"] + bo["height"] / 2, bo["z"] + bo["width"] / 2, BLACK)
    quad("botanical", (xL + 0.021, bo["y"], bo["z"]), (0, 0, -1), (0, 1, 0), bo["width"], bo["height"], ART_BOT)
    # Two small frames on the back wall either side of the cap rack.
    for (x, y, w, h, art) in ((-0.22, 1.8, 0.2, 0.26, ART_BOT), (0.62, 1.66, 0.22, 0.3, ART_PINK)):
        box("frameback", x - w / 2, y - h / 2, zb, x + w / 2, y + h / 2, zb + 0.02, BLACK)
        quad("smallart", (x, y, zb + 0.021), (1, 0, 0), (0, 1, 0), w - 0.03, h - 0.03, art)


def cap_rack():
    c = F["capRack"]
    zb = R["back"]
    x = c["x"]
    for dx in (-0.16, 0.16):
        box("rack", x + dx - 0.012, c["y"] - 0.1, zb, x + dx + 0.012, c["y"] + 0.8, zb + 0.03, METAL_BLACK)
    for i, y in enumerate((c["y"] + 0.12, c["y"] + 0.42, c["y"] + 0.72)):
        box("rack", x - 0.18, y - 0.012, zb, x + 0.18, y, zb + 0.2, METAL_BLACK)
    # Helmets and caps.
    ball("helmet", x - 0.02, c["y"] + 0.43, zb + 0.12, 0.13, BLACK, sy=0.72, sz=1.1, seg=16)
    ball("helmet", x + 0.03, c["y"] + 0.73, zb + 0.12, 0.12, HELMET_GREY, sy=0.7, sz=1.1, seg=16)
    for (y, m) in ((c["y"] + 0.13, CAP_GREEN), (c["y"] - 0.12, CAP_RED)):
        ball("cap", x, y + 0.02, zb + 0.1, 0.085, m, sy=0.62, seg=14)
        box("brim", x - 0.07, y + 0.005, zb + 0.16, x + 0.07, y + 0.015, zb + 0.24, m, 0.004, 2)


def uplighters():
    xR, xL, zb = R["right"], R["left"], R["back"]
    for u in L["uplighters"]:
        if u["wall"] == "back":
            c, n, along = (u["x"], u["y"], zb), (0, 0, 1), (1, 0, 0)
        elif u["wall"] == "right":
            c, n, along = (xR, u["y"], u["z"]), (-1, 0, 0), (0, 0, 1)
        else:
            c, n, along = (xL, u["y"], u["z"]), (1, 0, 0), (0, 0, -1)
        cx, cy, cz = c
        nx, _, nz = n
        # A half-bowl on the wall, open at the top; a glow in its mouth.
        half_bowl(c, n, along)
        # The warm wash it throws up the wall.
        quad("wash", (cx + nx * 0.004, cy + 0.08 + 0.45, cz + nz * 0.004), along, (0, 1, 0), 1.2, 0.95, GLOW_WASH)


def half_bowl(c, n, along, r=0.15):
    """A ceramic uplighter: the lower half of a bowl, cut by the wall, open upwards."""
    bm = bmesh.new()
    rim = []
    rings = 6
    segs = 16
    grid = []
    for i in range(rings + 1):
        phi = (math.pi / 2) * (i / rings)  # 0 at the rim, pi/2 at the bottom
        row = []
        for j in range(segs + 1):
            th = math.pi * (j / segs)  # half round, from one side of the wall to the other
            x = r * math.cos(th) * math.cos(phi)
            d = r * math.sin(th) * math.cos(phi) * 0.8  # out from the wall
            y = -r * math.sin(phi) * 0.75
            p = Vector(c) + Vector(along) * x + Vector(n) * d + Vector((0, y, 0))
            row.append(bm.verts.new(V(*p)))
        grid.append(row)
    for i in range(rings):
        for j in range(segs):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj("bowl", bm, CERAMIC)
    sol = ob.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.008
    apply_mods(ob)
    # The glowing mouth: a half-disc just inside the rim.
    bm = bmesh.new()
    centre = bm.verts.new(V(*(Vector(c) + Vector((0, -0.01, 0)))))
    ring = []
    for j in range(segs + 1):
        th = math.pi * (j / segs)
        p = Vector(c) + Vector(along) * (0.92 * r * math.cos(th)) + Vector(n) * (0.92 * r * math.sin(th) * 0.8) + Vector((0, -0.01, 0))
        ring.append(bm.verts.new(V(*p)))
    for j in range(segs):
        bm.faces.new((centre, ring[j], ring[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    obj("bowlglow", bm, GLOW_LAMP)


def bench():
    b = F["bench"]
    x0 = R["left"] + 0.02
    x1 = x0 + b["depth"]
    h = b["height"]
    box("bench", x0, h - 0.045, b["z0"] + 0.05, x1, h, b["z1"] - 0.05, DARK_WOOD, 0.01, 2)
    for z in (b["z0"] + 0.04, b["z1"] - 0.04):
        rod("scroll", (x0, h - 0.07, z), (x1, h - 0.07, z), 0.06, DARK_WOOD, seg=16)
    for z in (b["z0"] + 0.18, b["z1"] - 0.18):
        box("benchleg", x0 + 0.02, 0.0, z - 0.02, x1 - 0.02, h - 0.045, z + 0.02, DARK_WOOD, 0.006, 2)
    box("apron", x0 + 0.02, h - 0.1, b["z0"] + 0.2, x0 + 0.04, h - 0.045, b["z1"] - 0.2, DARK_WOOD)
    shadow((x0 + x1) / 2, (b["z0"] + b["z1"]) / 2, x1 - x0, b["z1"] - b["z0"])


def coats():
    z = F["coats"]["z"]
    x = R["left"]
    box("hooks", x, 1.72, z - 0.35, x + 0.03, 1.76, z + 0.3, METAL_BLACK)
    # The long black puffer hanging from its hood, and a khaki parka behind it.
    coat((x + 0.16, z + 0.06), 1.7, 0.95, 0.24, PUFFER, quilted=True)
    coat((x + 0.1, z - 0.27), 1.62, 0.7, 0.2, KHAKI)
    for (sx, sz, yaw, m) in ((x + 0.35, -3.0, 0.3, TRAINER), (x + 0.52, -2.95, -0.2, TRAINER), (x + 0.4, -2.62, 1.2, BLUE)):
        def shoe(m=m):
            box("shoe", -0.05, 0.0, -0.14, 0.05, 0.08, 0.14, m, 0.03, 3)

        group("shoe", (sx, 0, sz), yaw, shoe)
    shadow(x + 0.2, z, 0.4, 0.7)


def coat(at, top, length, half_width, material, quilted=False):
    """A coat on a hook: a lathe-like body (narrow shoulders under the hook,
    flaring to the hem), flattened against the wall, sleeves down its sides;
    a puffer gets shallow quilting grooves."""
    x, z = at
    bm = bmesh.new()
    rings = 24
    segs = 20
    grid = []
    for i in range(rings + 1):
        t = i / rings  # 0 at the hook, 1 at the hem
        y = top - 0.1 - t * length
        w = half_width * (0.35 + 0.65 * min(1.0, t * 5)) * (1 + 0.12 * t)
        if quilted:
            w *= 1 - 0.06 * (0.5 + 0.5 * math.cos(t * math.pi * 2 * 9))
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            p = (x + math.sin(a) * w * 0.5, y, z + math.cos(a) * w)
            row.append(bm.verts.new(V(*p)))
        grid.append(row)
    for i in range(rings):
        for j in range(segs):
            bm.faces.new((grid[i][j], grid[i][(j + 1) % segs], grid[i + 1][(j + 1) % segs], grid[i + 1][j]))
    bm.faces.new(grid[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj("coat", bm, material)
    ball("hood", x - 0.02, top - 0.05, z, half_width * 0.5, material, sx=0.8, sy=0.9, sz=1.0, seg=14)
    for s in (-1, 1):
        rod("sleeve", (x, top - 0.2, z + s * half_width * 0.62), (x + 0.02, top - 0.2 - length * 0.62, z + s * half_width * 0.95), half_width * 0.22, material, seg=12)


def hall_door():
    hd = F["hallDoor"]
    xR = R["right"]
    z0, z1, h = hd["z0"], hd["z1"], hd["height"]
    # Architrave.
    box("architrave", xR - 0.012, 0, z0 - 0.06, xR, h + 0.06, z0, DOOR_WOOD)
    box("architrave", xR - 0.012, 0, z1, xR, h + 0.06, z1 + 0.06, DOOR_WOOD)
    box("architrave", xR - 0.012, h, z0 - 0.06, xR, h + 0.06, z1 + 0.06, DOOR_WOOD)
    # The dim hallway beyond.
    box("hall", xR + 0.12, 0, z0 - 0.5, xR + 1.3, 0.001, z1 + 0.5, HALL)
    box("hall", xR + 1.25, 0, z0 - 0.5, xR + 1.3, 2.3, z1 + 0.5, HALL)
    box("hall", xR + 0.12, 0, z0 - 0.55, xR + 1.3, 2.3, z0 - 0.5, HALL)
    box("hall", xR + 0.12, 2.25, z0 - 0.5, xR + 1.3, 2.3, z1 + 0.5, HALL)
    # The door, open into the room, hinged on the side nearer the visitor.
    w = z1 - z0

    def leaf():
        box("door", -0.04, 0, -w, 0, h - 0.01, 0, DOOR_WOOD, 0.004, 2)
        rod("lever", (-0.07, 1.02, -w + 0.07), (-0.07, 1.02, -w + 0.19), 0.01, STEEL)
        rod("lever", (-0.04, 1.02, -w + 0.07), (-0.07, 1.02, -w + 0.07), 0.01, STEEL)

    group("door", (xR, 0, z1), -hd["open"], leaf)


def bin_():
    b = F["bin"]
    cyl("bin", b["x"], 0, b["z"], 0.17, 0.5, BLACK, seg=24)
    ball("binlid", b["x"], 0.5, b["z"], 0.172, BLACK, sy=0.55, seg=20)
    shadow(b["x"], b["z"], 0.34, 0.34)


def cat_tree():
    c = F["catTree"]
    x, z = c["x"], c["z"]
    box("base", x - 0.3, 0, z - 0.24, x + 0.3, 0.03, z + 0.24, PLUSH, 0.01, 2)
    box("cubby", x - 0.28, 0.03, z - 0.2, x + 0.06, 0.34, z + 0.14, PLUSH, 0.02, 2)
    quad("hole", (x - 0.281, 0.19, z - 0.03), (0, 0, -1), (0, 1, 0), 0.17, 0.17, PLUSH_DARK)
    for (px, pz, y0, y1) in ((x + 0.17, z - 0.14, 0.03, 0.92), (x - 0.12, z + 0.12, 0.34, 1.32), (x + 0.12, z + 0.14, 0.03, 0.5)):
        cyl("post", px, y0, pz, 0.045, y1 - y0, SISAL, seg=14)
    cyl("platform", x + 0.1, 0.5, z + 0.04, 0.2, 0.03, PLUSH, seg=24)
    box("platform", x - 0.14, 0.92, z - 0.22, x + 0.28, 0.955, z + 0.1, PLUSH, 0.015, 2)
    cyl("bed", x - 0.12, 1.32, z + 0.1, 0.22, 0.03, PLUSH, seg=24)
    torus("bedrim", x - 0.12, 1.38, z + 0.1, 0.19, 0.05, PLUSH, "y", 28, 10)
    rod("string", (x + 0.25, 0.92, z - 0.18), (x + 0.25, 0.72, z - 0.18), 0.003, BLACK, seg=4)
    ball("pompom", x + 0.25, 0.7, z - 0.18, 0.03, CAP_RED, seg=10)
    shadow(x, z, 0.6, 0.5)


def koi_rug():
    k = F["koiRug"]
    th = k["yaw"]
    v = (math.sin(th), 0, -math.cos(th))
    u = (math.cos(th), 0, math.sin(th))
    quad("koi", (k["x"], 0.004, k["z"]), u, v, k["width"], k["length"], KOI)


def dining():
    d = F["diningTable"]
    x, z, w, ln = d["x"], d["z"], d["width"], d["length"]
    box("dtop", x - w / 2, 0.72, z - ln / 2, x + w / 2, 0.76, z + ln / 2, OAK_LIGHT, 0.008, 2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box("dleg", x + sx * (w / 2 - 0.1) - 0.03, 0, z + sz * (ln / 2 - 0.1) - 0.03, x + sx * (w / 2 - 0.1) + 0.03, 0.72, z + sz * (ln / 2 - 0.1) + 0.03, OAK_LIGHT)
    box("laptop", x - 0.16, 0.76, z - 0.45, x + 0.16, 0.778, z - 0.23, LAPTOP, 0.004, 2)
    for cz in (z - 0.35, z + 0.4):
        def chair():
            box("seat", -0.21, 0.42, -0.21, 0.21, 0.46, 0.21, OAK_LIGHT, 0.01, 2)
            for sx in (-1, 1):
                for sz in (-1, 1):
                    box("cleg", sx * 0.18 - 0.018, 0, sz * 0.18 - 0.018, sx * 0.18 + 0.018, 0.42, sz * 0.18 + 0.018, OAK_LIGHT)
            for sx in (-1, 1):
                box("post", sx * 0.19 - 0.02, 0.46, 0.16, sx * 0.19 + 0.02, 1.0, 0.2, OAK_LIGHT)
            for i in range(5):
                xs = -0.13 + i * 0.065
                box("slat", xs - 0.012, 0.52, 0.17, xs + 0.012, 0.98, 0.19, OAK_LIGHT)
            box("rail", -0.21, 0.96, 0.16, 0.21, 1.0, 0.2, OAK_LIGHT)

        group("chair", (x + w / 2 + 0.24, 0, cz), math.pi / 2, chair)
    shadow(x, z, w, ln)


# ─── the garden ──────────────────────────────────────────────────────────────

def garden():
    x0, x1, z0, z1, wall = G["x0"], G["x1"], G["z0"], G["z1"], G["wall"]
    yard = -0.1
    p = box("yard", x0, yard - 0.05, z1, x1, yard, z0 - 0.1, PAVING)
    uv_world(p, 1.2)
    path = box("path", -9, yard - 0.05, G["path"]["z1"], 9, yard, z1, PAVING)
    uv_world(path, 1.8)
    t = 0.22
    # Left: brick wall, stepping down near the end, railings over the low part.
    low = 1.1
    for (a, e) in ((z0 - 0.1, -7.3),):
        w = box("brick", x0 - t, yard, e, x0, wall, a, BRICK)
        uv_world(w, 0.9)
    for (a, e, hh) in ((-7.3, -7.55, 1.72), (-7.55, -7.8, 1.45), (-7.8, z1, low)):
        w = box("brick", x0 - t, yard, e, x0, hh, a, BRICK)
        uv_world(w, 0.9)
    zz = -7.4
    while zz > z1:
        rod("rail", (x0 - t / 2, low, zz), (x0 - t / 2, wall, zz), 0.011, METAL_BLACK, seg=6)
        zz -= 0.13
    rod("rail", (x0 - t / 2, wall, -7.3), (x0 - t / 2, wall, z1), 0.016, METAL_BLACK, seg=8)
    # Far wall with the gate.
    g = G["gate"]
    for (a, e) in ((x0 - t, g["x0"] - 0.2), (g["x1"] + 0.1, x1 + 0.05)):
        w = box("brick", a, yard, z1 - t, e, wall, z1, BRICK)
        uv_world(w, 0.9)
    w = box("brick", g["x0"] - 0.2, yard, z1 - t - 0.02, g["x0"], wall + 0.1, z1 + 0.02, BRICK)
    uv_world(w, 0.9)
    box("gatepost", g["x1"], yard, z1 - t, g["x1"] + 0.1, g["height"] + 0.08, z1, GATE)
    gw = g["x1"] - g["x0"]

    def gate():
        for i in range(8):
            xs = -gw + i * gw / 8
            box("board", xs + 0.004, 0.05, -0.02, xs + gw / 8 - 0.004, g["height"], 0.0, GATE)
        for y in (0.3, g["height"] - 0.3):
            box("ledge", -gw + 0.04, y - 0.05, 0.0, -0.04, y + 0.05, 0.03, GATE)
        rod("brace", (-0.08, 0.32, 0.015), (-gw + 0.08, g["height"] - 0.34, 0.015), 0.035, GATE, seg=4)
        box("latch", -gw + 0.06, 1.0, 0.02, -gw + 0.14, 1.04, 0.04, BLACK)

    group("gate", (g["x1"], yard, z1), -g["open"], gate)
    # Right: the fence, the felt planter on it, the festoon lights along it.
    zc = z0 - 0.1
    while zc > z1:
        box("fenceboard", x1, yard, zc - 0.14, x1 + 0.03, 1.8, zc - 0.005, FENCE if int(zc * 10) % 3 else FENCE_DARK)
        zc -= 0.145
    box("felt", x1 - 0.03, 0.85, -5.95, x1, 1.85, -5.2, FELT)
    for i in range(4):
        for j in range(6):
            ball("pocket", x1 - 0.03, 0.95 + j * 0.16, -5.85 + i * 0.18, 0.06, FELT, sx=0.35, sy=0.5, seg=8)
    pts = []
    for i in range(24):
        f = i / 23
        zz = z0 - 0.4 + (z1 + 0.3 - (z0 - 0.4)) * f
        sag = 0.12 * math.sin(math.pi * ((f * 3) % 1.0))
        pts.append((x1 - 0.06, 1.72 - sag, zz))
    for a, b in zip(pts, pts[1:]):
        rod("cable", a, b, 0.004, BLACK, seg=4)
    for q in pts[1::2]:
        ball("bulb", q[0], q[1] - 0.05, q[2], 0.03, GLOW_FESTOON, seg=10)
    # The raised planter: plants at the house end, a scaffold-board seat, a big climber by the gate.
    pl = G["planter"]
    px0, px1, pz0, pz1, ph = pl["x0"], pl["x1"], pl["z0"], pl["z1"], pl["height"]
    for (a, b, c, d_) in ((px0, pz0, px0 + 0.06, pz1), (px1 - 0.06, pz0, px1, pz1), (px0, pz1 - 0.06, px1, pz1), (px0, pz0, px1, pz0 + 0.06)):
        box("sleeper", a, yard, b, c, ph, d_, SLEEPER, 0.006, 2)
    box("soil", px0 + 0.06, ph - 0.1, pz0 + 0.06, px1 - 0.06, ph - 0.06, pz1 - 0.06, SOIL)
    for i in range(4):
        zs = -8.0 + i * 0.4
        box("seat", px0 - 0.05, ph, zs, px1 + 0.02, ph + 0.038, zs + 0.38, SCAFFOLD, 0.005, 2)
    plants = [(0.12, -4.85, "rosemary"), (0.05, -5.35, "herb"), (0.16, -5.8, "cage"), (0.05, -6.25, "rosemary"), (0.1, -8.35, "climber")]
    for n, (x, z, kind) in enumerate(plants):
        base = (x, ph - 0.07, z)

        def build(kind=kind, x=x, z=z):
            if kind == "rosemary":
                for k in range(9):
                    a = k * 2.4
                    rr = 0.06 + 0.05 * (k % 3)
                    ball("needles", x + math.cos(a) * rr, ph + 0.12 + 0.03 * (k % 4), z + math.sin(a) * rr, 0.07, ROSEMARY, sx=0.45, sy=1.9, sz=0.45, seg=8)
            elif kind == "herb":
                for k in range(6):
                    a = k * 1.9
                    ball("leafball", x + math.cos(a) * 0.08, ph + 0.05 + 0.04 * (k % 2), z + math.sin(a) * 0.1, 0.09, LEAF, sy=0.7, seg=10)
            elif kind == "cage":
                for k in range(5):
                    torus("cage", x, ph + 0.1 + k * 0.2, z, 0.14 - 0.01 * k, 0.006, CAGE, "y", 20, 4)
                for k in range(6):
                    ball("tomato", x + 0.05 * math.cos(k), ph + 0.2 + 0.12 * k, z + 0.05 * math.sin(k * 2), 0.09, LEAF, sy=0.8, seg=10)
            else:
                for k in range(14):
                    a = k * 2.2
                    ball("climb", x - 0.05 + math.cos(a) * 0.14, ph + 0.15 + k * 0.1, z + math.sin(a) * 0.18, 0.2 - 0.004 * k, LEAF_DEEP, sy=0.85, seg=10)

        sway(f"Sway_plant{n}", base, build)
    # Two white chairs and a small round table.
    for (cx, cz, yaw) in ((-0.95, -5.35, 1.4), (-1.0, -6.95, -2.9)):
        def chair():
            box("seat", -0.2, 0.43, -0.2, 0.2, 0.46, 0.2, CHAIR_WHITE, 0.01, 2)
            box("back", -0.2, 0.5, -0.2, 0.2, 0.8, -0.17, CHAIR_WHITE, 0.01, 2)
            for sx in (-1, 1):
                for sz in (-1, 1):
                    rod("tube", (sx * 0.17, 0.44, sz * 0.17), (sx * 0.2, 0.0, sz * 0.21), 0.011, CHAIR_WHITE, seg=6)
            for sx in (-1, 1):
                rod("tube", (sx * 0.18, 0.44, -0.19), (sx * 0.18, 0.8, -0.2), 0.011, CHAIR_WHITE, seg=6)

        group("chair", (cx, yard, cz), yaw, chair)
        shadow(cx, cz, 0.45, 0.45, y=yard + 0.003)
    cyl("tabletop", -0.95, yard + 0.5, -6.15, 0.28, 0.02, METAL_BLACK, seg=28)
    for k in range(3):
        a = k * 2.094
        rod("tleg", (-0.95 + 0.1 * math.cos(a), yard + 0.5, -6.15 + 0.1 * math.sin(a)), (-0.95 + 0.2 * math.cos(a), yard, -6.15 + 0.2 * math.sin(a)), 0.012, METAL_BLACK, seg=6)
    # The pallet leaning on the wall, and a bike beyond it.
    def pallet():
        for i in range(5):
            y = 0.05 + i * 0.24
            box("pslat", -0.02, y, -0.6, 0.0, y + 0.1, 0.6, PALLET)
        for zc_ in (-0.55, 0.0, 0.55):
            box("pblock", 0.0, 0.0, zc_ - 0.05, 0.09, 1.1, zc_ + 0.05, PALLET)

    parts = group("pallet", (x0 + 0.34, yard, -4.9), 0, pallet)
    for p in parts:
        c = V(x0 + 0.34, yard, -4.9)
        p.data.transform(Matrix.Translation(c) @ Matrix.Rotation(math.radians(-16), 4, "Y") @ Matrix.Translation(-c))
    bx = x0 + 0.22
    for zc_ in (-6.35, -7.35):
        torus("wheel", bx, yard + 0.34, zc_, 0.33, 0.02, TYRE, "x", 32, 8)
    for (a, b) in (((bx, yard + 0.34, -6.35), (bx, yard + 0.75, -6.75)), ((bx, yard + 0.34, -7.35), (bx, yard + 0.34, -6.8)), ((bx, yard + 0.34, -6.8), (bx, yard + 0.75, -6.75)), ((bx, yard + 0.34, -6.8), (bx, yard + 0.82, -7.1)), ((bx, yard + 0.34, -7.35), (bx, yard + 0.82, -7.1)), ((bx, yard + 0.75, -6.75), (bx, yard + 0.82, -7.1))):
        rod("frame", a, b, 0.016, BIKE, seg=8)
    rod("bars", (bx - 0.2, yard + 0.95, -6.62), (bx + 0.2, yard + 0.95, -6.62), 0.013, BLACK, seg=6)
    rod("stem", (bx, yard + 0.75, -6.75), (bx, yard + 0.95, -6.65), 0.013, BIKE, seg=6)
    box("saddle", bx - 0.04, yard + 0.88, -7.2, bx + 0.04, yard + 0.92, -7.02, BLACK, 0.01, 2)
    # Out of the gate: the Thames Path, its lamp posts, the river railing, a lifebuoy.
    for (lx, lz) in G["lamps"]:
        cyl("lamppost", lx, yard, lz, 0.07, 0.25, METAL_BLACK)
        cyl("lamppost", lx, yard + 0.25, lz, 0.045, 3.1, METAL_BLACK, seg=12)
        ball("globe", lx, yard + 3.5, lz, 0.2, GLOW_GLOBE, seg=18)
        cyl("lampcap", lx, yard + 3.66, lz, 0.08, 0.06, METAL_BLACK, seg=12)
    rz = G["path"]["rail"]
    box("riverwall", -9, yard - 0.4, rz - 0.18, 9, yard + 0.12, rz + 0.12, CONCRETE)
    xx = -9.0
    while xx <= 9.0:
        rod("bar", (xx, yard + 0.12, rz), (xx, yard + 1.1, rz), 0.009, METAL_BLACK, seg=5)
        xx += 0.13
    for y in (0.16, 0.95, 1.1):
        rod("railbar", (-9, yard + y, rz), (9, yard + y, rz), 0.018, METAL_BLACK, seg=6)
    xx = -9.0
    while xx <= 9.0:
        box("railpost", xx - 0.03, yard + 0.12, rz - 0.03, xx + 0.03, yard + 1.18, rz + 0.03, METAL_BLACK)
        ball("finial", xx, yard + 1.23, rz, 0.045, METAL_BLACK, seg=10)
        xx += 2.2
    torus("lifebuoy", 0.9, yard + 0.72, rz + 0.07, 0.25, 0.06, LIFEBUOY, "z", 28, 10)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        box("band", 0.9 + 0.25 * math.cos(a) - 0.03, yard + 0.72 + 0.25 * math.sin(a) - 0.065, rz + 0.07, 0.9 + 0.25 * math.cos(a) + 0.03, yard + 0.72 + 0.25 * math.sin(a) + 0.065, rz + 0.14, WHITE)


# ─── merge, export ───────────────────────────────────────────────────────────

FINISHES = {}


def finish(rough, metal):
    """One shared material per finish; the colour rides on the vertices."""
    if metal >= 0.5:
        key, r, m = "Paint_Metal", 0.35, 0.8
    elif rough >= 0.85:
        key, r, m = "Paint_Matte", 0.95, 0.0
    elif rough >= 0.55:
        key, r, m = "Paint_Satin", 0.7, 0.0
    elif rough >= 0.3:
        key, r, m = "Paint_Sheen", 0.42, 0.0
    else:
        key, r, m = "Paint_Gloss", 0.2, 0.0
    if key not in FINISHES:
        FINISHES[key] = mat(key, "#ffffff", r, m)
    return FINISHES[key]


def plain(m):
    """A flat colour: no picture, no glow, not see-through."""
    b = m.node_tree.nodes["Principled BSDF"]
    if b.inputs["Base Color"].is_linked or b.inputs["Alpha"].default_value < 1:
        return False
    if b.inputs["Emission Strength"].default_value > 0 or m.name in ("Glass", "Shadow"):
        return False
    return True


def paint_by_vertex():
    """Flat-coloured objects share a few finishes, their colours as vertex colours (far fewer draw calls)."""
    for ob in list(bpy.data.objects):
        if ob.type != "MESH" or ob.name.startswith("Sway"):
            continue
        me = ob.data
        m = me.materials[0]
        if not plain(m):
            continue
        b = m.node_tree.nodes["Principled BSDF"]
        rgb = tuple(b.inputs["Base Color"].default_value)[:3]
        col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
        for d in col.data:
            d.color = (*rgb, 1.0)
        me.color_attributes.active_color = col
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        me.materials[0] = finish(b.inputs["Roughness"].default_value, b.inputs["Metallic"].default_value)


def merge_by_material():
    bpy.context.view_layer.update()
    groups = {}
    for ob in list(bpy.data.objects):
        if ob.type != "MESH" or ob.name.startswith("Sway"):
            continue
        groups.setdefault(ob.data.materials[0].name, []).append(ob)
    for name, obs in groups.items():
        bm = bmesh.new()
        for ob in obs:
            me = ob.data.copy()
            me.transform(ob.matrix_world)
            if not me.uv_layers:
                me.uv_layers.new(name="UVMap")
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        mat_ = obs[0].data.materials[0]
        for ob in obs:
            old = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if old.users == 0:
                bpy.data.meshes.remove(old)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat_)
        if "Col" in me.color_attributes:
            # The merge drops which colour layer is active; the exporter needs it.
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        ob = bpy.data.objects.new(name, me)
        COLL.objects.link(ob)


def main():
    shell()
    patio_door()
    sofa()
    ottoman()
    coffee_table()
    rug()
    recliner()
    bookcase()
    pictures()
    cap_rack()
    uplighters()
    bench()
    coats()
    hall_door()
    bin_()
    cat_tree()
    koi_rug()
    dining()
    garden()
    paint_by_vertex()
    merge_by_material()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"[room] {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes, {len(MATS)} materials, {tris} triangles")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_image_format="WEBP",
        export_image_quality=82,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[room] wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


main()
