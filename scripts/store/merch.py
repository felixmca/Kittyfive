"""
The three launch products as 3D models, for the store (and the try-on).

    node scripts/store/merch-textures.mjs
    node scripts/store/blender.mjs scripts/store/merch.py

Writes public/models/merch-cap.glb, merch-hoodie.glb, merch-longsleeve.glb.
Real sizes, in the site's coordinates (y up, the front faces +z). Garments
are shown as if on an invisible body (a "ghost mannequin"). Materials the
site looks for by name:
    Fabric       the garment's cloth; the site tints it with the chosen colour
    Embroidery   Kitty's face, stitched (cap front, hoodie chest, sleeve)
    Print        the MISSING flyer, screen-printed in one ink (long-sleeve back)
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(ROOT, "assets-raw", "merch", "build")
OUT = os.path.join(ROOT, "public", "models")


def V(x, y, z):
    """Site (x, y, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


def lin(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global MATS
    MATS = {}


MATS = {}


def mat(name, color="#ffffff", rough=0.9, metal=0.0, image=None, alpha_image=False):
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
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(TEX, image))
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if alpha_image:
            nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
            m.surface_render_method = "BLENDED"
    MATS[name] = m
    return m


def obj(name, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def subdivide(ob, levels=1):
    mod = ob.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    if not me.materials:
        for m in old.materials:
            me.materials.append(m)
    bpy.data.meshes.remove(old)
    me.shade_smooth()
    return ob


def superellipse(t, a, b, n=2.4):
    """Point on a superellipse (half-width a along x, half-depth b along z) at angle t (0 = front, +z)."""
    c, s = math.cos(t), math.sin(t)
    x = a * math.copysign(abs(s) ** (2 / n), s)
    z = b * math.copysign(abs(c) ** (2 / n), c)
    return x, z


# ─── surfaces ────────────────────────────────────────────────────────────────

def tube(name, rings, material, segs=48, cap_start=False, cap_end=False, uv_scale=(1.0, 1.0)):
    """A skin through rings of points. `rings` is a list of lists of site
    points, all the same length (segs), in order round the ring."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    grid = [[bm.verts.new(V(*p)) for p in ring] for ring in rings]
    n = len(rings)
    for i in range(n - 1):
        for j in range(segs):
            a, b_ = grid[i][j], grid[i][(j + 1) % segs]
            c, d = grid[i + 1][(j + 1) % segs], grid[i + 1][j]
            f = bm.faces.new((a, b_, c, d))
            for loop, (uu, vv) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                loop[uv].uv = (uu / segs * uv_scale[0], vv / max(1, n - 1) * uv_scale[1])
    if cap_start:
        bm.faces.new(list(reversed(grid[0])))
    if cap_end:
        bm.faces.new(grid[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, material)


def frames_along(points):
    """Tangent frames along a polyline (parallel transport), for sleeves."""
    P = [Vector(p) for p in points]
    T = []
    for i in range(len(P)):
        a = P[max(0, i - 1)]
        b = P[min(len(P) - 1, i + 1)]
        T.append((b - a).normalized())
    ref = Vector((0, 0, 1))
    N = []
    n = (ref - T[0] * ref.dot(T[0])).normalized()
    for t in T:
        n = (n - t * n.dot(t)).normalized()
        N.append(n)
    B = [t.cross(n) for t, n in zip(T, N)]
    return P, T, N, B


def sweep(name, path, radii, material, segs=32, squash=1.0, ribs=0, rib_depth=0.0, cap_end=False):
    """A tube along `path` (site points) with a radius per point."""
    P, T, N, B = frames_along(path)
    rings = []
    for i, (p, n, b, r) in enumerate(zip(P, N, B, radii)):
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            rr = r * (1 + rib_depth * math.cos(a * ribs)) if ribs else r
            q = p + n * (math.cos(a) * rr) + b * (math.sin(a) * rr * squash)
            ring.append(tuple(q))
        rings.append(ring)
    return tube(name, rings, material, segs=segs, cap_end=cap_end)


def decal(name, surface, u0, u1, v0, v1, material, lift=0.0012, res=18):
    """A curved patch lying on a surface: `surface(u, v)` gives (point, normal)
    in site coordinates; the patch spans u0..u1 × v0..v1 with UVs 0..1."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    grid = []
    for i in range(res + 1):
        row = []
        for j in range(res + 1):
            u = u0 + (u1 - u0) * j / res
            v = v0 + (v1 - v0) * i / res
            p, nrm = surface(u, v)
            row.append((bm.verts.new(V(*(Vector(p) + Vector(nrm) * lift))), j / res, i / res))
        grid.append(row)
    for i in range(res):
        for j in range(res):
            cells = (grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])
            f = bm.faces.new([c[0] for c in cells])
            for loop, c in zip(f.loops, cells):
                loop[uv].uv = (c[1], c[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj(name, bm, material)
    return ob


def merge_by_material():
    """One mesh per material: a garment is a handful of draw calls, not dozens."""
    groups = {}
    for ob in list(bpy.data.objects):
        if ob.type == "MESH":
            groups.setdefault(ob.data.materials[0].name, []).append(ob)
    for name, obs in groups.items():
        if len(obs) < 2:
            obs[0].name = name
            continue
        bm = bmesh.new()
        for ob in obs:
            me = ob.data.copy()
            me.transform(ob.matrix_world)
            if not me.uv_layers:
                me.uv_layers.new(name="UVMap")
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        m = obs[0].data.materials[0]
        for ob in obs:
            old = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if old.users == 0:
                bpy.data.meshes.remove(old)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(m)
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)


def export(path, names=None):
    merge_by_material()
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=86,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_cameras=False,
        export_lights=False,
    )
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"[merch] {os.path.basename(path)}: {tris} triangles, {os.path.getsize(path) // 1024} KB")


# ─── the torso both tops share ───────────────────────────────────────────────

def torso(profile, segs=56, folds=0.0, n=2.4):
    """Rings of a garment body from (y, half-width, half-depth) rows.
    `folds` adds a soft drape (vertical folds that fade towards the chest)."""
    rings = []
    for (y, w, d) in profile:
        ring = []
        for j in range(segs):
            t = 2 * math.pi * j / segs
            x, z = superellipse(t, w, d, n)
            if folds:
                k = folds * max(0.0, 1 - y / 0.45)
                bulge = 1 + k * (0.5 * math.sin(t * 7 + 1.3) + 0.35 * math.sin(t * 11 + 0.4))
                x *= bulge
                z *= bulge
            ring.append((x, y, z))
        rings.append(ring)
    return rings


def torso_surface(profile, n=2.4):
    """(u across the front or back, v = height) -> (point, normal) on the torso,
    by interpolating the profile; u in -1..1 maps the front's angle range."""
    ys = [p[0] for p in profile]

    def at(y):
        for k in range(len(profile) - 1):
            y0, w0, d0 = profile[k]
            y1, w1, d1 = profile[k + 1]
            if y0 <= y <= y1:
                f = (y - y0) / (y1 - y0)
                return w0 + (w1 - w0) * f, d0 + (d1 - d0) * f
        return profile[-1][1], profile[-1][2]

    def surf(t, y):
        w, d = at(max(ys[0], min(ys[-1], y)))
        x, z = superellipse(t, w, d, n)
        # Normal from the neighbouring points round the ring and up the body.
        e = 0.01
        x1, z1 = superellipse(t + e, w, d, n)
        w2, d2 = at(min(ys[-1], y + e))
        x2, z2 = superellipse(t, w2, d2, n)
        a = Vector((x1 - x, 0, z1 - z))
        b = Vector((x2 - x, e, z2 - z))
        nrm = a.cross(b).normalized()
        if nrm.dot(Vector((x, 0, z))) < 0:
            nrm = -nrm
        return (x, y, z), tuple(nrm)

    return surf


# ─── the hoodie ──────────────────────────────────────────────────────────────

def hoodie():
    reset()
    FAB = mat("Fabric", "#ffffff", 0.95)
    EMB = mat("Embroidery", image="embroidery-face.png", alpha_image=True, rough=0.6)
    METAL = mat("Metal", "#c9c9c4", 0.3, 0.9)
    body = [
        (0.07, 0.262, 0.145),
        (0.12, 0.27, 0.15),
        (0.22, 0.274, 0.152),
        (0.34, 0.279, 0.154),
        (0.44, 0.285, 0.152),
        (0.52, 0.28, 0.146),
        (0.575, 0.258, 0.138),
        (0.615, 0.212, 0.126),
        (0.645, 0.155, 0.11),
        (0.662, 0.112, 0.094),
    ]
    rings = torso(body, folds=0.018)
    ob = tube("body", rings, FAB, segs=56)
    subdivide(ob, 1)
    # Ribbed band at the hem, a little narrower than the body (the body blouses over it).
    band = []
    for (y, w, d) in ((0.0, 0.236, 0.13), (0.035, 0.24, 0.132), (0.075, 0.246, 0.136)):
        ring = []
        for j in range(200):
            t = 2 * math.pi * j / 200
            x, z = superellipse(t, w, d)
            k = 1 + 0.01 * math.cos(t * 100)
            ring.append((x * k, y, z * k))
        band.append(ring)
    tube("band", band, FAB, segs=200, cap_start=False)
    # Sleeves, hanging a little away from the body, bent at the elbow; ribbed cuffs.
    for s in (-1, 1):
        path = [(s * 0.16, 0.575, 0.0), (s * 0.245, 0.535, 0.0), (s * 0.305, 0.445, 0.005), (s * 0.345, 0.335, 0.016), (s * 0.372, 0.225, 0.032), (s * 0.388, 0.11, 0.048)]
        radii = [0.066, 0.079, 0.074, 0.067, 0.061, 0.056]
        sl = sweep("sleeve", path, radii, FAB, segs=40, squash=0.9)
        subdivide(sl, 1)
        cuff = [(s * 0.39, 0.105, 0.05), (s * 0.392, 0.07, 0.052), (s * 0.393, 0.035, 0.053)]
        sweep("cuff", cuff, [0.05, 0.047, 0.046], FAB, segs=120, squash=0.9, ribs=60, rib_depth=0.03, cap_end=True)
    # The hood, lying on the shoulders: a thick rolled rim round the neck and
    # the hood's body bunched on the upper back.
    rim = []
    for j in range(64):
        t = 2 * math.pi * j / 64
        x, z = superellipse(t, 0.118, 0.1, 2.2)
        y = 0.668 + 0.035 * (1 - math.cos(t)) / 2  # higher at the back
        rim.append((x, y, z))
    ring_pts = []
    for j in range(64):
        c = Vector(rim[j])
        nxt = Vector(rim[(j + 1) % 64])
        tang = (nxt - c).normalized()
        out = Vector((c.x, 0, c.z)).normalized()
        up = tang.cross(out).normalized()
        ring = []
        for k in range(16):
            a = 2 * math.pi * k / 16
            q = c + out * (math.cos(a) * 0.03) + Vector((0, 1, 0)) * (math.sin(a) * 0.026)
            ring.append(tuple(q))
        ring_pts.append(ring)
    # Stitch the rim's cross-sections into a closed torus.
    bm = bmesh.new()
    grid = [[bm.verts.new(V(*p)) for p in r] for r in ring_pts]
    for j in range(64):
        for k in range(16):
            bm.faces.new((grid[j][k], grid[j][(k + 1) % 16], grid[(j + 1) % 64][(k + 1) % 16], grid[(j + 1) % 64][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj("hoodrim", bm, FAB)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    bmesh.ops.scale(bm, vec=(0.16, 0.07, 0.12), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(0, 0.62, -0.13), verts=bm.verts)
    obj("hood", bm, FAB)
    # Kangaroo pocket: a panel lying on the front, a touch proud of it.
    surf = torso_surface(body)
    pocket = decal("pocket", lambda u, v: surf(u, v), -0.62, 0.62, 0.13, 0.3, FAB, lift=0.006, res=14)
    subdivide(pocket, 1)
    for s in (-1, 1):
        # The pocket's openings: a rolled edge down each side.
        pts = [surf(s * (0.62 - 0.1 * f), 0.14 + 0.15 * f)[0] for f in (0.0, 0.33, 0.66, 1.0)]
        pts = [tuple(Vector(p) + Vector((0, 0, 0.008))) for p in pts]
        sweep("pocketedge", pts, [0.005] * 4, FAB, segs=10)
    # Drawstrings with metal aglets.
    for s in (-1, 1):
        top = (s * 0.035, 0.63, 0.1)
        pts = [top, (s * 0.04, 0.55, 0.14), (s * 0.042, 0.45, 0.155), (s * 0.04, 0.4, 0.157)]
        sweep("cord", pts, [0.0045] * 4, FAB, segs=10)
        sweep("aglet", [(s * 0.04, 0.4, 0.157), (s * 0.04, 0.37, 0.157)], [0.005, 0.005], METAL, segs=10, cap_end=True)
    # Kitty on the left chest (the wearer's left, the viewer's right).
    decal("embroidery", surf, 0.42, 0.62, 0.45, 0.52, EMB, lift=0.0025, res=10)
    export(os.path.join(OUT, "merch-hoodie.glb"))


# ─── the long-sleeve ─────────────────────────────────────────────────────────

def longsleeve():
    reset()
    FAB = mat("Fabric", "#ffffff", 0.92)
    EMB = mat("Embroidery", image="embroidery-face.png", alpha_image=True, rough=0.6)
    PRINT = mat("Print", "#111111", 0.8, image="flyer-print.png", alpha_image=True)
    body = [
        (0.0, 0.262, 0.13),
        (0.015, 0.26, 0.13),
        (0.15, 0.258, 0.134),
        (0.3, 0.262, 0.138),
        (0.44, 0.27, 0.138),
        (0.52, 0.266, 0.134),
        (0.572, 0.246, 0.126),
        (0.612, 0.2, 0.114),
        (0.642, 0.14, 0.098),
        (0.66, 0.098, 0.082),
    ]
    rings = torso(body, folds=0.014)
    ob = tube("body", rings, FAB, segs=56)
    subdivide(ob, 1)
    # Ribbed crew neck.
    collar = []
    for j in range(64):
        t = 2 * math.pi * j / 64
        x, z = superellipse(t, 0.099, 0.083, 2.1)
        collar.append((x, 0.662, z))
    bm = bmesh.new()
    grid = []
    for j in range(64):
        c = Vector(collar[j])
        out = Vector((c.x, 0, c.z)).normalized()
        grid.append([bm.verts.new(V(*(c + out * (math.cos(2 * math.pi * k / 10) * 0.009) + Vector((0, 1, 0)) * (math.sin(2 * math.pi * k / 10) * 0.011)))) for k in range(10)])
    for j in range(64):
        for k in range(10):
            bm.faces.new((grid[j][k], grid[j][(k + 1) % 10], grid[(j + 1) % 64][(k + 1) % 10], grid[(j + 1) % 64][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj("collar", bm, FAB)
    for s in (-1, 1):
        path = [(s * 0.15, 0.575, 0.0), (s * 0.232, 0.535, 0.0), (s * 0.29, 0.44, 0.004), (s * 0.326, 0.32, 0.014), (s * 0.35, 0.19, 0.03), (s * 0.366, 0.05, 0.045)]
        radii = [0.058, 0.068, 0.062, 0.056, 0.05, 0.046]
        sl = sweep("sleeve", path, radii, FAB, segs=36, squash=0.88)
        subdivide(sl, 1)
        sweep("cuff", [(s * 0.372, 0.045, 0.046), (s * 0.373, 0.0, 0.047)], [0.045, 0.044], FAB, segs=100, squash=0.88, ribs=50, rib_depth=0.03, cap_end=True)
    surf = torso_surface(body)
    # The flyer on the back: t runs round the body, pi is the middle of the back.
    decal("print", lambda u, v: surf(math.pi + u, v), -0.62, 0.62, 0.16, 0.52, PRINT, lift=0.0015, res=20)
    # Kitty on the left sleeve, near the shoulder, facing out.
    P, T, N, B = frames_along([(0.262, 0.49, 0.002), (0.305, 0.37, 0.01)])

    def sleeve_surface(u, v):
        p = P[0] + (P[1] - P[0]) * v
        t = T[0]
        side = Vector((1, 0, 0.35)).normalized()
        side = (side - t * side.dot(t)).normalized()
        fwd = t.cross(side).normalized()
        a = u
        r = 0.068
        q = p + side * (math.cos(a) * r) + fwd * (math.sin(a) * r * 0.88)
        nrm = (q - p).normalized()
        return tuple(q), tuple(nrm)

    decal("sleevekitty", sleeve_surface, 0.42, -0.42, 0.15, 0.55, EMB, lift=0.002, res=8)
    export(os.path.join(OUT, "merch-longsleeve.glb"))


# ─── the cap ─────────────────────────────────────────────────────────────────

def cap():
    reset()
    FAB = mat("Fabric", "#ffffff", 0.9)
    EMB = mat("Embroidery", image="embroidery-face.png", alpha_image=True, rough=0.6)
    THREAD = mat("Thread", "#3a3a3a", 0.8)
    rx, rz, h = 0.093, 0.104, 0.104
    STITCH = FAB

    def crown_point(t, phi):
        """t: round the head (0 = front, +z); phi: 0 at the band, pi/2 at the top."""
        c = math.cos(phi) ** 0.8
        front = max(0.0, math.cos(t)) ** 2
        # A structured front: a little fuller and taller at the front panels.
        x = rx * c * math.sin(t)
        z = (rz + 0.006 * front) * c * math.cos(t)
        # Taller at the front panels, lower towards the back.
        back = max(0.0, -math.cos(t)) ** 2
        y = h * math.sin(phi) * (1 + 0.05 * front - 0.1 * back)
        # The six seams sit in shallow grooves.
        seam = min(abs(((t / (math.pi / 3)) % 1.0) - 0.0), abs(((t / (math.pi / 3)) % 1.0) - 1.0))
        g = 1 - 0.012 * math.exp(-((seam / 0.035) ** 2)) * math.sin(phi * 2.4 + 0.2)
        return (x * g, y, z * g)

    def crown_surface(t, phi):
        p = Vector(crown_point(t, phi))
        e = 0.01
        a = Vector(crown_point(t + e, phi)) - p
        b = Vector(crown_point(t, phi + e)) - p
        nrm = a.cross(b).normalized()
        if nrm.dot(p - Vector((0, 0.02, 0))) < 0:
            nrm = -nrm
        return tuple(p), tuple(nrm)

    rings = []
    nphi = 14
    segs = 60
    for i in range(nphi + 1):
        phi = (math.pi / 2) * (i / nphi) * 0.995
        rings.append([crown_point(2 * math.pi * j / segs, phi) for j in range(segs)])
    crown = tube("crown", rings, FAB, segs=segs, cap_end=True)
    sol = crown.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.0025
    sol.offset = -1
    subdivide(crown, 1)
    # Button on top, eyelets on each panel, stitched seams.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.011)
    bmesh.ops.scale(bm, vec=(1, 1, 0.45), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(0, h * 1.02, 0), verts=bm.verts)
    obj("button", bm, FAB)
    for k in range(6):
        t = math.pi / 6 + k * math.pi / 3
        p, nrm = crown_surface(t, 0.95)
        c = Vector(p) + Vector(nrm) * 0.0008
        n = Vector(nrm)
        ref = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
        a = n.cross(ref).normalized()
        b = n.cross(a).normalized()
        pts = [tuple(c + a * math.cos(2 * math.pi * i / 12) * 0.0035 + b * math.sin(2 * math.pi * i / 12) * 0.0035) for i in range(13)]
        sweep("eyelet", pts, [0.0012] * 13, THREAD, segs=6)
    for k in range(6):
        t = k * math.pi / 3
        pts = []
        # The front seam disappears under the embroidery.
        start = 0.86 if k == 0 else 0.04
        for i in range(10):
            phi = start + (math.pi / 2 - 0.1 - start) * i / 9
            p, nrm = crown_surface(t, phi)
            pts.append(tuple(Vector(p) + Vector(nrm) * 0.0006))
        sweep("seam", pts, [0.0011] * 10, STITCH, segs=5)
    # The brim: a curved plate in front of the band, bending down at its sides.
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rows = []
    nu, nv = 36, 10
    def brim_point(t, f):
        bx = rx * 0.985 * math.sin(t)
        bz = rz * 0.985 * math.cos(t)
        out = Vector((math.sin(t) / rx, 0, math.cos(t) / rz)).normalized()
        reach = 0.076 * max(0.0, math.cos(t * 1.12)) ** 0.85
        x = bx + out.x * reach * f
        z = bz + out.z * reach * f
        # Pre-curved: the sides arch down, and the whole brim pitches down a little.
        y = 0.002 - 0.034 * math.sin(t) ** 2 * f ** 1.3 - 0.008 * f
        return (x, y, z)

    for i in range(nv + 1):
        f = i / nv  # 0 at the band, 1 at the brim's edge
        row = []
        for j in range(nu + 1):
            t = -math.radians(76) + math.radians(152) * j / nu
            row.append(bm.verts.new(V(*brim_point(t, f))))
        rows.append(row)
    for i in range(nv):
        for j in range(nu):
            face = bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            for loop, (uu, vv) in zip(face.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                loop[uv].uv = (uu / nu, vv / nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    brim = obj("brim", bm, FAB)
    sol = brim.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.0045
    sol.offset = 0
    subdivide(brim, 1)
    # Rows of stitching round the brim.
    for f in (0.45, 0.62, 0.79):
        pts = []
        for j in range(0, 37, 2):
            t = -math.radians(56) + math.radians(112) * j / 36
            x, y, z = brim_point(t, f)
            pts.append((x, y + 0.0026, z))
        sweep("brimstitch", pts, [0.0008] * len(pts), STITCH, segs=4)
    # Kitty on the front, following the curve of the crown.
    decal("embroidery", crown_surface, -0.36, 0.36, 0.2, 0.78, EMB, lift=0.0018, res=14)
    export(os.path.join(OUT, "merch-cap.glb"))


os.makedirs(OUT, exist_ok=True)
cap()
hoodie()
longsleeve()
