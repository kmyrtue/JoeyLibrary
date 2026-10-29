"""The room's doors, to settle the shapes and numbers for room.js (photos 20261028_214036/039: the pine door in a
brick nook; 214056/058: the glazed kitchen door).
Frame per door: u across the opening, v out of the leaf's face towards the room (the face at v = 0), z up; mm."""
import FreeCAD as App, FreeCADGui as Gui, Part
from FreeCAD import Vector as V
import os
OUT = os.path.dirname(os.path.abspath(__file__)) + '/'

# --- numbers (mirrored in room.js) ---
GAP, UNDER, T = 3, 8, 40           # gap round a leaf, under it, leaf thickness
# lever handle on a round rosette with a key escutcheon 72 mm below (photo: white, Danish standard; sizes estimated)
ROS_D, ROS_T, NECK_D, ARM_D, ARM_L, ARM_OUT, KEY_DZ = 50, 9, 18, 19, 120, 55, 72
HANDLE_Z, HANDLE_IN = 1020, 55
HINGE_D, HINGE_L, HINGE_IN = 13, 110, 250    # lift-off hinge knuckle, its length, from the top and bottom of the leaf
# the pine door (photo 214036): stiles 95; flat panels with a groove round them; three proud rounded rails
STILE, TOP_RAIL = 95, 105
PINE_RAILS = [(0.0, 150), (0.335, 115), (0.53, 115)]   # proud rails: (bottom as a fraction of the leaf height, height)
RAIL_OUT, RAIL_R = 12, 6
# the glazed door (photo 214058): stiles and top rail 90, a bottom rail of two boards 380 tall, 2 x 5 panes, bars 22
G_STILE, G_TOP, G_BOTTOM, G_COLS, G_ROWS, G_BAR = 90, 90, 380, 2, 5, 22
CASING_W, CASING_T = 70, 12


def solid(shape, name, doc, color):
    o = doc.addObject('Part::Feature', name); o.Shape = shape
    if App.GuiUp: o.ViewObject.ShapeAppearance = (App.Material(DiffuseColor=color, AmbientColor=tuple(c * 0.4 for c in color), SpecularColor=(0.2, 0.2, 0.2), Shininess=0.2),)
    return o


def box(u0, u1, v0, v1, z0, z1):
    return Part.makeBox(u1 - u0, v1 - v0, z1 - z0, V(u0, v0, z0))


def rounded(shape, r):
    try: return shape.makeFillet(r, shape.Edges)
    except Exception: return shape


def lever(doc, u, z, towards, color):
    """on the face v = 0 at u, z; the arm points `towards` (+1 / -1 in u)"""
    def ros(zz):
        r = Part.makeCylinder(ROS_D / 2, ROS_T, V(u, 0, zz), V(0, 1, 0))
        return r.makeFillet(3, [e for e in r.Edges if abs(e.BoundBox.YMin - ROS_T) < 0.1])
    neck = Part.makeCylinder(NECK_D / 2, ARM_OUT - ROS_T, V(u, ROS_T, z), V(0, 1, 0))
    arm = Part.makeCylinder(ARM_D / 2, ARM_L, V(u, ARM_OUT, z), V(towards, 0, 0))
    ends = [Part.makeSphere(ARM_D / 2, V(u, ARM_OUT, z)), Part.makeSphere(ARM_D / 2, V(u + towards * ARM_L, ARM_OUT, z))]
    solid(ros(z).fuse([neck, arm] + ends).removeSplitter(), 'Lever', doc, color)
    key = ros(z - KEY_DZ).cut(box(u - 3, u + 3, ROS_T - 2, ROS_T + 1, z - KEY_DZ - 9, z - KEY_DZ + 5))
    solid(key, 'KeyPlate', doc, color)


def hinges(doc, u, z0, z1, color):
    for z in (z0 + HINGE_IN - HINGE_L / 2, z1 - HINGE_IN - HINGE_L / 2):
        k = Part.makeCylinder(HINGE_D / 2, HINGE_L, V(u, HINGE_D / 2 - 2, z))
        solid(k.fuse([Part.makeCylinder(HINGE_D / 2 - 2, 8, V(u, HINGE_D / 2 - 2, z + HINGE_L)), Part.makeCylinder(HINGE_D / 2 - 2, 8, V(u, HINGE_D / 2 - 2, z - 8))]), 'Hinge', doc, color)


def pine_leaf(doc, u0, u1, z0, z1, color):
    h = z1 - z0
    # stiles and top rail flush with the face, flat panels 3 mm behind it with a groove 25 mm in from their edge
    solid(rounded(box(u0, u0 + STILE, -T, 0, z0, z1), 2), 'Stile', doc, color)
    solid(rounded(box(u1 - STILE, u1, -T, 0, z0, z1), 2), 'Stile', doc, color)
    solid(rounded(box(u0 + STILE, u1 - STILE, -T, 0, z1 - TOP_RAIL, z1), 2), 'TopRail', doc, color)
    rails = [(z0 + f * h, z0 + f * h + rh) for f, rh in PINE_RAILS]
    tops = [r[1] for r in rails]; bots = [r[0] for r in rails[1:]] + [z1 - TOP_RAIL]
    for za, zb in zip(tops, bots):
        p = box(u0 + STILE, u1 - STILE, -T + 10, -3, za, zb)
        g = box(u0 + STILE + 25, u1 - STILE - 25, -5, -2, za + 25, zb - 25).cut(box(u0 + STILE + 27, u1 - STILE - 27, -6, -1, za + 27, zb - 27))
        solid(p.cut(g), 'Panel', doc, color)
    # the proud rails: rounded boards standing RAIL_OUT out of the face, over the stiles' inner edges
    for za, zb in rails:
        solid(rounded(box(u0 + STILE - 10, u1 - STILE + 10, -T + 10, RAIL_OUT, za, zb), RAIL_R), 'Rail', doc, color)


def glazed_leaf(doc, u0, u1, z0, z1, color, glass):
    solid(rounded(box(u0, u0 + G_STILE, -T, 0, z0, z1), 2), 'Stile', doc, color)
    solid(rounded(box(u1 - G_STILE, u1, -T, 0, z0, z1), 2), 'Stile', doc, color)
    solid(rounded(box(u0 + G_STILE, u1 - G_STILE, -T, 0, z1 - G_TOP, z1), 2), 'TopRail', doc, color)
    zb = z0 + G_BOTTOM
    for a, b in ((z0, z0 + G_BOTTOM / 2), (z0 + G_BOTTOM / 2, zb)):   # the bottom rail as two boards, as in the photo
        solid(rounded(box(u0 + G_STILE, u1 - G_STILE, -T, 0, a, b), 2), 'BottomBoard', doc, color)
    g0, g1, gz0, gz1 = u0 + G_STILE, u1 - G_STILE, zb, z1 - G_TOP
    solid(box(g0, g1, -T / 2 - 2, -T / 2 + 2, gz0, gz1), 'Glass', doc, glass)
    for k in range(1, G_COLS):
        uu = g0 + (g1 - g0) * k / G_COLS; solid(rounded(box(uu - G_BAR / 2, uu + G_BAR / 2, -T + 6, -6, gz0, gz1), 1.5), 'Bar', doc, color)
    for k in range(1, G_ROWS):
        zz = gz0 + (gz1 - gz0) * k / G_ROWS; solid(rounded(box(g0, g1, -T + 6, -6, zz - G_BAR / 2, zz + G_BAR / 2), 1.5), 'Bar', doc, color)


def casing(doc, u0, u1, h, color, v=0):
    for b in (box(u0 - CASING_W, u0, v, v + CASING_T, 0, h + CASING_W), box(u1, u1 + CASING_W, v, v + CASING_T, 0, h + CASING_W), box(u0, u1, v, v + CASING_T, h, h + CASING_W)):
        solid(rounded(b, 2.5), 'Casing', doc, color)


def build():
    doc = App.newDocument('doors')
    pine, pale, white, glass = (0.74, 0.45, 0.2), (0.83, 0.81, 0.77), (0.93, 0.93, 0.91), (0.8, 0.88, 0.92)
    # the pine door: 908 nook, frame 45 at the back, the leaf flush with the frame, opening into the room
    a0, a1, H = 0, 908, 2130
    solid(box(a0 - 400, a0, -250, 150, 0, 2500).fuse([box(a1, a1 + 400, -250, 150, 0, 2500), box(a0, a1, -250, 150, H, 2500)]).removeSplitter(), 'Brick', doc, white)
    fr = box(a0 + 25, a0 + 70, -60, 0, 0, H - 25).fuse([box(a1 - 70, a1 - 25, -60, 0, 0, H - 25), box(a0 + 25, a1 - 25, -60, 0, H - 70, H - 25)])
    solid(rounded(fr.removeSplitter(), 3), 'Frame', doc, pale)
    l0, l1, lz = a0 + 70 + GAP, a1 - 70 - GAP, H - 70 - GAP
    pine_leaf(doc, l0, l1, UNDER, lz, pine)
    hinges(doc, l1 + GAP / 2, UNDER, lz, white)
    lever(doc, l0 + HANDLE_IN, HANDLE_Z, +1, white)
    # the glazed door: 830 x 2050 in a plastered wall, a casing round it
    o, W, KH = 1500, 830, 2050
    solid(box(o - 400, o, -150, 0, 0, 2500).fuse([box(o + W, o + W + 400, -150, 0, 0, 2500), box(o, o + W, -150, 0, KH, 2500)]).removeSplitter(), 'Wall', doc, white)
    casing(doc, o, o + W, KH, pale)
    l0, l1, lz = o + 25 + GAP, o + W - 25 - GAP, KH - 25 - GAP
    glazed_leaf(doc, l0, l1, UNDER, lz, pine, glass)
    hinges(doc, l1 + GAP / 2, UNDER, lz, white)
    lever(doc, l0 + HANDLE_IN - 10, HANDLE_Z, +1, white)
    doc.recompute()
    return doc


def cam(v, eye, target, fov=0.8):
    from pivy import coin
    v.setCameraType('Perspective'); c = v.getCameraNode()
    c.position.setValue(*eye)
    c.pointAt(coin.SbVec3f(*target), coin.SbVec3f(0, 0, 1))
    c.heightAngle = fov; c.nearDistance = 20; c.farDistance = 20000


def after_gui(shot, log):
    doc = build()
    bad = [o.Name for o in doc.Objects if not o.Shape.isValid()]
    log.write('objects %d invalid %s\n' % (len(doc.Objects), bad))
    tri = sum(len(o.Shape.tessellate(1.0)[1]) for o in doc.Objects)
    log.write('triangles at 1 mm %d\n' % tri)
    doc.saveAs(OUT + 'doors.FCStd')
    Gui.updateGui()
    v = Gui.activeDocument().activeView()
    cam(v, (700, 2700, 1500), (454, 0, 1000), 0.8); v.saveImage(OUT + 'fc_door_pine.png', 800, 1000, 'White')
    cam(v, (500, 700, 1200), (150, 0, 950), 0.6); v.saveImage(OUT + 'fc_door_pine_close.png', 800, 800, 'White')
    cam(v, (1500 + 600, 2700, 1500), (1915, 0, 1000), 0.8); v.saveImage(OUT + 'fc_door_glazed.png', 800, 1000, 'White')
