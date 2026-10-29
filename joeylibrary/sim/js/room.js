// The living room from living_room.py, built in three.js. Room (x, y, height) in mm -> three (X = x, Y = height, Z = -y) in metres.
// Shared by the walkable room page. buildRoom returns the meshes, a list of static boxes for physics,
// and the BILLY bookcases with the board surfaces books can stand on.
(function (g) {
  const M = {"width": 3300, "kitchen_door_from_right": 160, "kitchen_door_width": 830, "low_ceiling_height": 2573, "low_ceiling_depth": 1430, "ridge_height": 4290, "sloped_ceiling_length": 8450, "window_wall_height": 2893, "to_door_1": 2080, "door_1_nook": 905, "door_1_to_door_2": 950, "door_2_nook": 908, "door_2_to_door_3_far_edge": 3905, "door_3_nook": 910, "door_3_to_back_wall": 2600, "door_brick_reveal": 108, "door_lining_depth": 100, "nook_depth": 208, "door_height": 2130, "box_room_depth": 4920, "box_room_width": 2175, "box_room_height": 2573, "box_door_from_front": 1430, "box_door_width": 950, "box_door_frame": 100, "window_width": 2920.5, "window_height": 1570, "window_from_ceiling_wall": 350, "window_recess": 200, "window_sill_height": 560, "stove_from_window_wall": 1450, "stove_from_box_room": 160, "stove_depth": 370, "stove_width": 550, "stove_plate_length": 1150, "stove_plate_margin": 100, "stove_height": 800, "pipe_diameter": 160, "pipe_towards_back": 50, "kitchen_door_height": 2050, "box_door_height": 2050};
  g.ROOM_M = M;
  g.buildRoom = function (THREE, scene, renderer) {
  const statics = [], units = [], surfaces = {};
  const mm = v => v / 1000;
  const m = M, w = m.width, lch = m.low_ceiling_height, lcd = m.low_ceiling_depth, hr = m.ridge_height, hw = m.window_wall_height;
  const slope = x => hw + (hr - hw) * x / w;
  const y = { d1: m.to_door_1 }; y.d1e = y.d1 + m.door_1_nook; y.d2 = y.d1e + m.door_1_to_door_2; y.d2e = y.d2 + m.door_2_nook;
  y.d3e = y.d2e + m.door_2_to_door_3_far_edge; y.d3 = y.d3e - m.door_3_nook;
  const L = y.d3e + m.door_3_to_back_wall, back = lcd + m.sloped_ceiling_length, T = 150, nk = m.nook_depth, dh = m.door_height, rv = m.door_brick_reveal;
  const doors = [[y.d1, y.d1e], [y.d2, y.d2e], [y.d3, y.d3e]];

  const COL = { brick: 0xe6e3d9, plaster: 0xeeebe0, pine: 0xe1dccc, low: 0x78706a, floor: 0xc59456, trim: 0xb3ab9c, door: 0xd0cbc3,
    frame: 0xf4f4f0, glass: 0x9fc0d0, stove: 0x222222, plate: 0x2e2e30, shelf: 0xc9a56f };
  // photo-scanned materials (Poly Haven, CC0), tuned to the colours in the photos. size = metres one image covers;
  // turn 'h': flat faces get the image turned 90 degrees
  const TEX = {
    brick: { file: 'whitewashed_brick', size: 2.0 },
    plaster: { file: 'white_plaster_02', size: 1.0 },
    planks: { file: 'white_planks_clean', size: 1.8 },
    lowboards: { file: 'white_planks_clean', size: 1.8, tint: 0x6e665e },
    floor: { file: 'wooden_floor_01', size: 2.6 },
    walnut: { file: 'walnut_veneer', size: 1.8 },  // BILLY brown walnut effect; grain runs along each board
    oak: { file: 'oak_veneer', size: 1.8 },  // the light shelves over the windows and by the stove, the window sill
    doorpine: { file: 'oak_veneer', size: 1.8, tint: 0xc88a50 },  // the doors' knotty honey pine
    doorrail: { file: 'oak_veneer', size: 1.8, tint: 0xdda466 },  // the proud rails, lighter as they catch the light
    palewood: { file: 'oak_veneer', size: 1.8, tint: 0xc4b49c },  // the kitchen door's casing, a weathered pale wood
    fabric: { file: 'white_plaster_02', size: 0.45, tint: 0xf08aa8 },  // the kids' couch: the plaster's mottle, fine, reads as worn pink cover
  };
  const loader = new THREE.TextureLoader();
  const texCache = {};
  function loadTex(name) {
    if (!texCache[name]) {
      texCache[name] = loader.load('tex/' + name + '.jpg', () => { texLoaded++; });
      texCache[name].wrapS = texCache[name].wrapT = THREE.RepeatWrapping;
      texCache[name].anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    return texCache[name];
  }
  let texLoaded = 0;
  const parts = [];  // {mesh, kind, flat, textured}
  function addMesh(geo, color, kind, opts, tex, parent) {
    const flat = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0 }, opts || {}));  // lit per pixel: the lamp's pools would smear on Lambert's corners
    const mesh = new THREE.Mesh(geo, flat); mesh.castShadow = mesh.receiveShadow = !(opts && opts.transparent);
    let textured = flat;
    if (tex) {
      const t = TEX[tex];
      textured = new THREE.MeshStandardMaterial({ color: t.tint || 0xc8c8c8, map: loadTex(t.file + '_diff'), normalMap: loadTex(t.file + '_nor'),
        normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.85, metalness: 0 });
      mesh.material = textured;
    }
    (parent || scene).add(mesh); parts.push({ mesh, kind: kind || 'room', flat, textured, tex, own: !!parent }); return mesh;
  }
  // room (x, y, height) -> three (X, -Z, Y), metres. Room y runs away from the kitchen, which is -Z in three.js;
  // without the minus the room comes out mirrored.
  function box(x0, x1, y0, y1, z0, z1, color, kind, opts, tex) {
    const g = new THREE.BoxGeometry(mm(x1 - x0), mm(z1 - z0), mm(y1 - y0));
    const me = addMesh(g, color, kind, opts, tex); me.position.set(mm(x0 + x1) / 2, mm(z0 + z1) / 2, -mm(y0 + y1) / 2);
    statics.push({ size: [mm(x1 - x0), mm(z1 - z0), mm(y1 - y0)], pos: me.position.clone(), quat: me.quaternion.clone() });
    return me;
  }
  function xzPrism(pts, y0, y1, color, kind, tex) {  // polygon in (x, height), extruded along room y
    const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(mm(a), mm(b))));
    const g = new THREE.ExtrudeGeometry(s, { depth: mm(y1 - y0), bevelEnabled: false });
    const me = addMesh(g, color, kind, null, tex); me.position.z = -mm(y1); return me;
  }
  // ---------- doors ----------
  // Shapes and numbers settled in FreeCAD (door_job.py) from the photos: a 40 mm leaf with a 3 mm gap round it and 8
  // mm under it; a white lever on a round rosette (50 x 9 mm, the bar 19 mm thick and 120 long, 55 mm out from the
  // leaf, 1020 mm up, 55 mm in from the free edge) with a round key plate 72 mm below it; white lift-off hinges 250
  // mm in from the top and bottom on the side a door opens to. None of these was measured: they are read from the
  // photos against the measured door openings, and the handle height and hinge places are the usual ones. The details
  // are only looked at; each door is one plain box in `statics`.
  const DOOR = { gap: 3, under: 8, t: 40, hz: 1020, hin: 55, key: 72, white: 0xeeeeea, pine: [0xc8935a, 'doorpine'], rail: [0xd6a066, 'doorrail'], groove: 0x5e3a1e, shade: 0x7d4c28, steel: 0xa8acb0 };
  // a box only to be looked at, its edges rounded r (the terminal look outlines it as the plain box)
  function trim(x0, x1, y0, y1, z0, z1, color, tex, r = 0, opts) {
    const sx = x1 - x0, sz = z1 - z0, sy = y1 - y0;
    r = Math.min(r, sx / 2 - 0.5, sz / 2 - 0.5, sy / 2 - 0.5);
    let g = new THREE.BoxGeometry(mm(sx), mm(sz), mm(sy));
    if (r > 0) {
      const sh = new THREE.Shape(), w2 = sx / 2 - r, h2 = sz / 2 - r;
      sh.moveTo(mm(-w2), mm(-h2)); sh.lineTo(mm(w2), mm(-h2)); sh.lineTo(mm(w2), mm(h2)); sh.lineTo(mm(-w2), mm(h2)); sh.lineTo(mm(-w2), mm(-h2));
      const outline = g;
      g = new THREE.ExtrudeGeometry(sh, { depth: mm(sy - 2 * r), bevelEnabled: true, bevelThickness: mm(r), bevelSize: mm(r), bevelSegments: 2, curveSegments: 1 });
      g.translate(0, 0, -mm(sy / 2 - r)); g.userData.outline = outline;
    }
    const me = addMesh(g, color, 'room', opts, tex); me.position.set(mm(x0 + x1) / 2, mm(z0 + z1) / 2, -mm(y0 + y1) / 2);
    return me;
  }
  // a static box with nothing drawn: what a door is to the books and to you
  function solidBox(x0, x1, y0, y1, z0, z1) {
    statics.push({ size: [mm(x1 - x0), mm(z1 - z0), mm(y1 - y0)], pos: new THREE.Vector3(mm(x0 + x1) / 2, mm(z0 + z1) / 2, -mm(y0 + y1) / 2), quat: new THREE.Quaternion() });
  }
  // a lever handle on the leaf face at (x, y, z), the face looking along room (nx, ny), the bar pointing along (ax, ay),
  // and the key plate under it
  function lever(x, y, z, nx, ny, ax, ay) {
    const gr = new THREE.Group(), Z = new THREE.Vector3(nx, 0, -ny), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3().crossVectors(Y, Z);
    gr.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); gr.position.set(mm(x), mm(z), -mm(y));
    const s = Math.sign(X.x * ax - X.z * ay) || 1, part = (geo, px, pz, py = 0, col = DOOR.white) => { const me = addMesh(geo, col, 'room', null, null, gr); me.position.set(mm(px), mm(py), mm(pz)); return me; };
    [0, -DOOR.key].forEach(py => { part(new THREE.CylinderGeometry(mm(23), mm(25), mm(9), 24), 0, 4.5, py).rotation.x = Math.PI / 2; });  // the rosettes
    part(new THREE.BoxGeometry(mm(5), mm(14), mm(1)), 0, 9.2, -DOOR.key - 2, 0x2a2a2a); part(new THREE.CylinderGeometry(mm(4), mm(4), mm(1), 10), 0, 9.2, -DOOR.key + 4, 0x2a2a2a).rotation.x = Math.PI / 2;  // the keyhole
    part(new THREE.CylinderGeometry(mm(9), mm(9), mm(46), 12), 0, 32).rotation.x = Math.PI / 2;  // the neck
    part(new THREE.CylinderGeometry(mm(9.5), mm(9.5), mm(120), 12), s * 60, 55).rotation.z = Math.PI / 2;  // the bar
    part(new THREE.SphereGeometry(mm(9.5), 12, 8), 0, 55); part(new THREE.SphereGeometry(mm(9.5), 12, 8), s * 120, 55);
    scene.add(gr); return gr;
  }
  // a lift-off hinge: a knuckle 110 mm long round its pin, standing at (x, y) from z up
  function hinge(x, y, z) {
    const me = addMesh(new THREE.CylinderGeometry(mm(6.5), mm(6.5), mm(110), 12), DOOR.white, 'room');
    me.position.set(mm(x), mm(z + 55), -mm(y));
    const pin = addMesh(new THREE.CylinderGeometry(mm(4.5), mm(4.5), mm(126), 8), DOOR.white, 'room'); pin.position.copy(me.position);
  }
  // A door in its own frame: u across the opening, v out of the leaf's face towards the room (the face at v = 0), z up.
  // across is the room axis u runs along ('x' or 'y'), face where v = 0 is on the other axis, out the sign of v there.
  function doorKit(across, face, out) {
    const at = (u0, u1, v0, v1) => { const a = face + out * v0, b = face + out * v1, w0 = Math.min(a, b), w1 = Math.max(a, b); return across === 'x' ? [u0, u1, w0, w1] : [w0, w1, u0, u1]; };
    const xy = (u, v) => across === 'x' ? [u, face + out * v] : [face + out * v, u];
    const k = {
      box: (u0, u1, v0, v1, z0, z1, ...rest) => trim(...at(u0, u1, v0, v1), z0, z1, ...rest),
      // the lever at u, its bar pointing towards +u (s = 1) or -u
      lever: (u, s) => lever(...xy(u, 0), DOOR.hz, ...(across === 'x' ? [0, out, s, 0] : [out, 0, 0, s])),
      hinges: (u, z0, z1) => [z0 + 250 - 55, z1 - 250 - 55].forEach(z => hinge(...xy(u, 4.5), z)),
      // the panelled pine leaf of the nooks (photo 214036): stiles 95 and a top rail 105 flush with the face, flat panels
      // 3 mm behind it with a groove round them 25 mm in, and three rounded rails standing 12 mm out, over the stiles' edges
      pine(u0, u1, z0, z1) {
        const h = z1 - z0, S = 95, P = DOOR.pine, t = DOOR.t;
        k.box(u0, u0 + S, -t, 0, z0, z1, ...P, 2); k.box(u1 - S, u1, -t, 0, z0, z1, ...P, 2); k.box(u0 + S, u1 - S, -t, 0, z1 - 105, z1, ...P, 2);
        const rails = [[0, 150], [0.335, 115], [0.53, 115]].map(([f, rh]) => [z0 + f * h, z0 + f * h + rh]);
        rails.forEach(([za, zb]) => k.box(u0 + S - 10, u1 - S + 10, -t + 10, 12, za, zb, ...DOOR.rail, 6));
        // the grooves and the shade in the corners are drawn as dark strips: the relief is too small for the shadows
        rails.forEach(([, za], i) => {
          const zb = i < 2 ? rails[i + 1][0] : z1 - 105, a = u0 + S + 25, b = u1 - S - 25, c = za + 25, d = zb - 25, g = 4;
          k.box(u0 + S, u1 - S, -t + 10, -3, za, zb, ...P);
          [[a, b, c, c + g], [a, b, d - g, d], [a, a + g, c, d], [b - g, b, c, d]].forEach(([p, q, y, z]) => k.box(p, q, -3, -2.4, y, z, DOOR.groove));
          [[u0 + S, u0 + S + 5], [u1 - S - 5, u1 - S]].forEach(([p, q]) => k.box(p, q, -3, -2.4, za, zb, DOOR.shade));  // along the stiles
          k.box(u0 + S, u1 - S, -3, -2.4, zb - 7, zb, DOOR.shade);  // under the rail above
        });
        rails.forEach(([za]) => za > z0 && k.box(u0 + S - 10, u1 - S + 10, -3, 0.6, za - 6, za, DOOR.shade));  // under each proud rail
      },
    };
    return k;
  }

  // a board's wood grain runs along its longest side, as on the real BILLY (up the sides, along the shelves)
  let boardSeed = 3;
  function boardUV(g, dims, size) {
    const P = g.attributes.position, N = g.attributes.normal, uv = new Float32Array(P.count * 2);
    size = size || TEX.walnut.size;
    const off = ((boardSeed = boardSeed * 16807 % 2147483647) % 1000) / 1000;  // each board a different piece of veneer
    for (let i = 0; i < P.count; i++) {
      const pos = [P.getX(i), P.getY(i), P.getZ(i)], n = [Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i))];
      const k = n.indexOf(Math.max(...n)), [i1, i2] = [0, 1, 2].filter(a => a !== k);
      const along = dims[i1] >= dims[i2] ? i1 : i2, across = along === i1 ? i2 : i1;
      uv[2 * i] = pos[across] / size + off; uv[2 * i + 1] = pos[along] / size + off * 3.7;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  // texture coordinates from world position, so a brick or a board has its real size on every face
  function worldUV(p) {
    const mesh = p.mesh, t = TEX[p.tex];
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, uv = new Float32Array(P.count * 2);
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), flatFace = ay >= ax && ay >= az;
      let u, s;
      if (flatFace) { u = v.x; s = v.z; } else if (ax >= az) { u = v.z; s = v.y; } else { u = v.x; s = v.y; }
      if (t.turn === 'h' && flatFace) [u, s] = [s, u];
      uv[2 * i] = u / t.size; uv[2 * i + 1] = s / t.size;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // floor
  const rc = m.window_recess;
  box(-rc, w + nk, -T, L, -30, 0, COL.floor, 'room', null, 'floor');
  // brick wall: back layer, then the front layer with the three nooks
  box(w + nk, w + nk + T, -T, L + T, 0, hr, COL.brick, 'room', null, 'brick');
  let prev = -T;
  doors.forEach(([a, e]) => { box(w, w + nk, prev, a, 0, hr, COL.brick, 'room', null, 'brick'); box(w, w + nk, a, e, dh, hr, COL.brick, 'room', null, 'brick'); prev = e; });
  box(w, w + nk, prev, L + T, 0, hr, COL.brick, 'room', null, 'brick');
  // the doors at the back of the nooks (photos 214036/039): a lining, a frame painted pale grey (45 mm face, 60 deep) and
  // the panelled pine leaf about flush with its face. They open into the room, so the white hinges show on the far
  // side and the lever is on the side towards the kitchen. Photo 214036 also shows a white fitting on the frame by the
  // lever, a little lower: a second hinge or a catch, not drawn.
  doors.forEach(([a, e]) => {
    const lt = 25, fw = 45, fd = 60, D = DOOR, PALE = [COL.door, null];
    box(w + rv, w + nk, a, a + lt, 0, dh, COL.door); box(w + rv, w + nk, e - lt, e, 0, dh, COL.door);
    box(w + rv, w + nk, a, e, dh - lt, dh, COL.door);
    const fx = w + nk - fd, ht = dh - lt, k = doorKit('y', fx, -1);
    k.box(a + lt, a + lt + fw, -fd, 0, 0, ht, ...PALE, 2); k.box(e - lt - fw, e - lt, -fd, 0, 0, ht, ...PALE, 2); k.box(a + lt + fw, e - lt - fw, -fd, 0, ht - fw, ht, ...PALE, 2);
    const l0 = a + lt + fw + D.gap, l1 = e - lt - fw - D.gap, lz = ht - fw - D.gap;
    k.pine(l0, l1, D.under, lz);
    k.hinges(l1 + D.gap / 2, D.under, lz);
    k.lever(l0 + D.hin, 1);
    solidBox(fx, w + nk, a + lt, e - lt, 0, ht);
  });
  // window wall with the recessed window
  const wa = lcd + m.window_from_ceiling_wall, wb = wa + m.window_width, sill = m.window_sill_height, top = sill + m.window_height;
  box(-rc - T, 0, -T, wa, 0, hw, COL.plaster, 'room', null, 'plaster'); box(-rc - T, 0, wb, L + T, 0, hw, COL.plaster, 'room', null, 'plaster');
  box(-rc - T, 0, wa, wb, 0, sill, COL.plaster, 'room', null, 'plaster'); box(-rc - T, 0, wa, wb, top, hw, COL.plaster, 'room', null, 'plaster');
  {  // unlit, so the view out of the window doesn't change with the lamp: the colour the lit glass had before
    const gl = box(-rc - 40, -rc - 34, wa, wb, sill, top, COL.glass, 'glass', { transparent: true, opacity: .35 }), pt = parts[parts.length - 1];
    pt.flat = pt.textured = gl.material = new THREE.MeshBasicMaterial({ color: 0xbddbdf, transparent: true, opacity: .35 });
  }
  const bar = 55, cols = 4, rows = 3, pw = (wb - wa - (cols + 1) * bar) / cols, ph = (top - sill - (rows + 1) * bar) / rows;
  for (let i = 0; i <= cols; i++) box(-rc - 60, -rc, wa + i * (pw + bar), wa + i * (pw + bar) + bar, sill, top, COL.frame);
  for (let j = 0; j <= rows; j++) box(-rc - 60, -rc, wa, wb, sill + j * (ph + bar), sill + j * (ph + bar) + bar, COL.frame);
  // the wooden window sill: 29 cm deep, 6 cm of it out from the wall, its top 1 cm above the bottom of the window so
  // the two surfaces don't flicker into each other; the radiator under it
  box(-230, 60, wa - 60, wb + 60, sill - 20, sill + 10, COL.shelf, 'room', null, 'oak');
  box(10, 60, wa + 80, wb - 80, 140, sill - 70, 0xf1f1ec);
  // kitchen wall with its door, back wall
  const dr = w - m.kitchen_door_from_right, dl = dr - m.kitchen_door_width, kdh = m.kitchen_door_height;
  box(-rc - T, dl, -T, 0, 0, lch, COL.plaster, 'room', null, 'plaster'); box(dr, w + nk + T, -T, 0, 0, lch, COL.plaster, 'room', null, 'plaster'); box(dl, dr, -T, 0, kdh, lch, COL.plaster, 'room', null, 'plaster');
  // the kitchen door (photos 214056/058): a casing of pale wood (70 x 12) round the opening on the room side and boards
  // lining it; the pine leaf has stiles and a top rail 90 wide, a bottom rail 380 tall of two boards and glazing in 2 x
  // 5 panes between bars 22 wide. It opens into the room, hinged on the brick wall side, with a door closer on the head
  // casing there. In the photo it stands open; here it is shut, as the kitchen is not built: its glass is frosted with
  // a pale wall behind it.
  {
    const D = DOOR, PW = [0xbfb09a, 'palewood'], P = D.pine, cw = 70, ct = 12, lt = 25, y1 = -2, k = doorKit('x', y1, 1);
    trim(dl - cw, dl, 0, ct, 0, kdh + cw, ...PW, 2.5); trim(dr, dr + cw, 0, ct, 0, kdh + cw, ...PW, 2.5); trim(dl, dr, 0, ct, kdh, kdh + cw, ...PW, 2.5);
    trim(dl, dl + lt, -T, 0, 0, kdh, ...PW); trim(dr - lt, dr, -T, 0, 0, kdh, ...PW); trim(dl + lt, dr - lt, -T, 0, kdh - lt, kdh, ...PW);
    const l0 = dl + lt + D.gap, l1 = dr - lt - D.gap, lz = kdh - lt - D.gap, S = 90, zb = D.under + 380, gz = lz - 90, t = D.t;
    k.box(l0, l0 + S, -t, 0, D.under, lz, ...P, 2); k.box(l1 - S, l1, -t, 0, D.under, lz, ...P, 2); k.box(l0 + S, l1 - S, -t, 0, gz, lz, ...P, 2);
    k.box(l0 + S, l1 - S, -t, 0, D.under, D.under + 190, ...P, 2); k.box(l0 + S, l1 - S, -t, 0, D.under + 190, zb, ...P, 2);  // the bottom rail's two boards
    k.box(l0 + S, l1 - S, -t / 2 - 2, -t / 2 + 2, zb, gz, 0xe4ecee, null, 0, { transparent: true, opacity: 0.6 });
    const xm = (l0 + l1) / 2; k.box(xm - 11, xm + 11, -t + 6, -6, zb, gz, ...P, 1.5);  // the glazing bars
    for (let j = 1; j < 5; j++) { const zz = zb + (gz - zb) * j / 5; k.box(l0 + S, l1 - S, -t + 6, -6, zz - 11, zz + 11, ...P, 1.5); }
    trim(dl - 100, dr + 100, -T - 910, -T - 900, 0, kdh + 100, COL.plaster, 'plaster');
    k.hinges(l1 + D.gap / 2, D.under, lz);
    k.lever(l0 + D.hin, 1);
    // the door closer: a slim grey body on the head casing by the hinges, its arm folded along it and down to a shoe on
    // the leaf
    trim(dr - 240, dr - 60, ct, ct + 32, kdh + 18, kdh + 52, D.steel, null, 4);
    trim(dr - 440, dr - 230, ct + 32, ct + 40, kdh + 29, kdh + 41, D.steel, null, 2);
    trim(dr - 450, dr - 434, ct - 1, ct + 40, kdh - 60, kdh + 41, D.steel, null, 2);
    trim(dr - 465, dr - 420, y1, ct - 0.5, kdh - 72, kdh - 40, D.steel, null, 2);
    solidBox(dl, dr, -T, y1, 0, kdh);
  }
  box(-rc - T, w + nk + T, L, L + T, 0, lch, COL.plaster, 'room', null, 'plaster');
  // white walls on the low ceilings, the ceilings
  // the walls above the low ceilings start on top of the ceiling boards; starting level with their underside made the
  // ends of the boards flicker into the wall
  const gable = [[0, lch + 25], [w, lch + 25], [w, hr], [0, hw]];
  xzPrism(gable, lcd - 100, lcd, COL.plaster, 'ceiling', 'plaster'); xzPrism(gable, back, back + 100, COL.plaster, 'ceiling', 'plaster');
  box(-rc - T, w + nk, 0, lcd, lch, lch + 25, COL.low, 'ceiling', null, 'lowboards');
  box(-rc - T, w + nk, back, L, lch, lch + 25, COL.plaster, 'ceiling', null, 'planks');
  xzPrism([[0, hw], [w, hr], [w + nk + T, hr], [w + nk + T, hr + 25], [0, hw + 25]], lcd - 100, back + 100, COL.pine, 'ceiling', 'planks');
  // box room
  const bd = m.box_room_depth, bw = m.box_room_width, bh = m.box_room_height, bf = L - bd, t = 100;
  const bda = bf + m.box_door_from_front, bdb = bda + m.box_door_width, bdh = m.box_door_height;
  box(0, bw, bf, bf + t, 0, bh, COL.plaster, 'room', null, 'plaster');
  box(bw - t, bw, bf + t, bda, 0, bh, COL.plaster, 'room', null, 'plaster'); box(bw - t, bw, bdb, L, 0, bh, COL.plaster, 'room', null, 'plaster'); box(bw - t, bw, bda, bdb, bdh, bh, COL.plaster, 'room', null, 'plaster');
  // its door: a pale casing (60 x 12) on the passage side, the opening lined, and the panelled pine leaf of the nooks set
  // 15 mm in, opening into the box room (estimated: no photo shows it but for the casing's edge)
  {
    const D = DOOR, PALE = [COL.door, null], cw = 60, lt = 25, lx = bw - 15, k = doorKit('y', lx, 1);
    trim(bw, bw + 12, bda - cw, bda, 0, bdh + cw, ...PALE, 2.5); trim(bw, bw + 12, bdb, bdb + cw, 0, bdh + cw, ...PALE, 2.5); trim(bw, bw + 12, bda, bdb, bdh, bdh + cw, ...PALE, 2.5);
    trim(bw - t, bw, bda, bda + lt, 0, bdh, ...PALE); trim(bw - t, bw, bdb - lt, bdb, 0, bdh, ...PALE); trim(bw - t, bw, bda + lt, bdb - lt, bdh - lt, bdh, ...PALE);
    const l0 = bda + lt + D.gap, l1 = bdb - lt - D.gap;
    k.pine(l0, l1, D.under, bdh - lt - D.gap);
    k.lever(l1 - D.hin, -1);
    solidBox(bw - t, bw, bda, bdb, 0, bdh);
  }
  box(0, bw, bf, back, bh, bh + 25, COL.plaster, 'ceiling', null, 'plaster');
  // on top of the box room, under the slope: a plain sand-coloured rug (the cheap kind sold everywhere) and a small
  // pink foam couch for children, where Lucifer, the black cat, lies. The couch has its back to the low side of the slope and faces
  // the passage; its seat, arms and back are each one static box.
  const roof = bh + 25, rug = { x0: 150, x1: bw - 100, y0: bf + 170, y1: back - 100, t: 12 }, ft = roof + rug.t;
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const gc = c.getContext('2d');
    const hsh = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
    gc.fillStyle = '#c9b48e'; gc.fillRect(0, 0, 512, 1024);  // plain sand colour, only the flecks of the pile
    for (let i = 0; i < 14000; i++) { gc.fillStyle = `rgba(${hsh(i, 1) < 0.5 ? '120,98,66' : '236,224,198'},${0.05 + hsh(i, 2) * 0.09})`; gc.fillRect(hsh(i, 3) * 512, hsh(i, 4) * 1024, 2, 2); }
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const me = trim(rug.x0, rug.x1, rug.y0, rug.y1, roof, ft, 0xc9b48e);  // a plain box: the picture lies on its top face, long way along room y
    const pt = parts[parts.length - 1]; pt.textured = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, map: tex, roughness: 1, metalness: 0 }); me.material = pt.textured;
    solidBox(rug.x0, rug.x1, rug.y0, rug.y1, roof, ft);
  }
  // The couch from the user's photo (Kali asleep on it): a soft foam kids' sofa with no legs, everything rounded. A
  // full-width back with a rounded top, two thick arms that run from the back to the front and stand lower than the
  // back, and between them a deep seat mattress lying on a foam base (the fold-out kind: the seam between them shows
  // on the front). A sticker on the back: two elephants under a tree of hearts, "Love". Worn dusty-pink cover.
  // Estimated: the outer size is the old guess (45 x 80 cm), not measured; heights from the photo's proportions on
  // the front (the seat about 0.7 of the arm, the back about 1.3 of the arm). The sticker is drawn, not copied.
  const couch = { x0: 1030, x1: 1480, y0: 7980, y1: 8780, seat: 240, arm: 340, back: 450, aw: 125, bt: 145 };
  {
    const PINK = 0xe7849f, PALE = 0xef93ae, DEEP = 0xd5738f, K = couch, z = ft, my = (K.y0 + K.y1) / 2;
    // a box rounded on every edge: the plan outline's corners by c + r, the ends by r (the plain box is the outline
    // the terminal look draws, as trim's)
    const soft = (x0, x1, y0, y1, z0, z1, color, rr) => {
      const sx = x1 - x0, sz = z1 - z0, sy = y1 - y0; rr = Math.min(rr, sx / 2 - 1, sz / 2 - 1, sy / 2 - 1);
      const w2 = sx / 2 - rr, h2 = sz / 2 - rr, c = Math.max(0.5, Math.min(rr * 0.8, w2 - 0.5, h2 - 0.5)), sh = new THREE.Shape();
      sh.moveTo(mm(-w2 + c), mm(-h2)); sh.lineTo(mm(w2 - c), mm(-h2)); sh.absarc(mm(w2 - c), mm(-h2 + c), mm(c), -Math.PI / 2, 0);
      sh.lineTo(mm(w2), mm(h2 - c)); sh.absarc(mm(w2 - c), mm(h2 - c), mm(c), 0, Math.PI / 2);
      sh.lineTo(mm(-w2 + c), mm(h2)); sh.absarc(mm(-w2 + c), mm(h2 - c), mm(c), Math.PI / 2, Math.PI);
      sh.lineTo(mm(-w2), mm(-h2 + c)); sh.absarc(mm(-w2 + c), mm(-h2 + c), mm(c), Math.PI, 1.5 * Math.PI);
      const g = new THREE.ExtrudeGeometry(sh, { depth: mm(sy - 2 * rr), bevelEnabled: true, bevelThickness: mm(rr), bevelSize: mm(rr), bevelSegments: 4, curveSegments: 4 });
      g.translate(0, 0, -mm(sy / 2 - rr)); g.userData.outline = new THREE.BoxGeometry(mm(sx), mm(sz), mm(sy));
      const me = addMesh(g, color, 'room', null, 'fabric'); me.position.set(mm(x0 + x1) / 2, mm(z0 + z1) / 2, -mm(y0 + y1) / 2);
      return me;
    };
    soft(K.x0, K.x0 + K.bt, K.y0, K.y1, z, z + K.back, PINK, 60);  // back, full width
    for (const [a, b] of [[K.y0, K.y0 + K.aw], [K.y1 - K.aw, K.y1]]) soft(K.x0 + K.bt - 40, K.x1, a, b, z, z + K.arm, PINK, 55);  // arms
    soft(K.x0 + K.bt - 20, K.x1 - 8, K.y0 + K.aw - 6, K.y1 - K.aw + 6, z, z + 125, DEEP, 22);  // the foam base, a little back
    soft(K.x0 + K.bt - 25, K.x1, K.y0 + K.aw - 1, K.y1 - K.aw + 1, z + 115, z + K.seat, PALE, 45);  // the seat mattress
    {  // the sticker, on the back's front face above the seat, a little to the left seen from the front
      const c = document.createElement('canvas'); c.width = 256; c.height = 200; const x = c.getContext('2d');
      const heart = (cx, cy, s, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(cx, cy + s * 0.9);
        x.bezierCurveTo(cx - s * 1.4, cy, cx - s * 0.6, cy - s * 1.0, cx, cy - s * 0.35); x.bezierCurveTo(cx + s * 0.6, cy - s * 1.0, cx + s * 1.4, cy, cx, cy + s * 0.9); x.fill(); };
      const elephant = (cx, cy, dir, col) => {  // facing dir (1 right, -1 left): body, head, ear, trunk raised, legs
        x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, 44, 30, 0, 0, 2 * Math.PI); x.fill();
        x.beginPath(); x.arc(cx + dir * 40, cy - 16, 22, 0, 2 * Math.PI); x.fill();
        for (const l of [-28, -10, 12, 28]) x.fillRect(cx + l - 6, cy + 14, 12, 26);
        x.lineWidth = 11; x.lineCap = 'round'; x.strokeStyle = col; x.beginPath(); x.moveTo(cx + dir * 56, cy - 8);
        x.quadraticCurveTo(cx + dir * 74, cy + 4, cx + dir * 70, cy - 26); x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(cx + dir * 30, cy - 12, 12, 17, 0, 0, 2 * Math.PI); x.fill();
        x.fillStyle = '#222'; x.beginPath(); x.arc(cx + dir * 47, cy - 22, 2.5, 0, 2 * Math.PI); x.fill();
      };
      x.strokeStyle = '#7a4a2a'; x.lineWidth = 6; x.beginPath(); x.moveTo(128, 130); x.lineTo(128, 70); x.stroke();  // the tree's trunk
      [[128, 40, '#e63946'], [104, 58, '#f4a261'], [152, 58, '#2a9d8f'], [92, 32, '#457b9d'], [164, 32, '#e9c46a'], [116, 18, '#8ac926'], [140, 18, '#ff5d8f']]
        .forEach(([hx, hy, col]) => heart(hx, hy, 15, col));
      elephant(62, 120, 1, '#2f8fd8'); elephant(194, 120, -1, '#e23b4a');
      x.fillStyle = '#e0a32a'; x.font = 'bold 34px Georgia, serif'; x.textAlign = 'center'; x.fillText('Love', 128, 188);
      const tex = new THREE.CanvasTexture(c);
      const me = addMesh(new THREE.PlaneGeometry(mm(200), mm(156)), 0xffffff, 'room', { map: tex, transparent: true, roughness: 0.6 });
      me.rotation.y = Math.PI / 2; me.position.set(mm(K.x0 + K.bt + 0.8), mm(z + 335), -mm(my - 70));
    }
    solidBox(K.x0 + K.bt, K.x1, K.y0 + K.aw, K.y1 - K.aw, z, z + K.seat); solidBox(K.x0, K.x0 + K.bt, K.y0, K.y1, z, z + K.back);
    for (const [a, b] of [[K.y0, K.y0 + K.aw], [K.y1 - K.aw, K.y1]]) solidBox(K.x0 + K.bt, K.x1, a, b, z, z + K.arm);
  }
  // stove, plate, pipe, collar
  const sx0 = m.stove_from_window_wall, sx1 = sx0 + m.stove_width, sb = bf - m.stove_from_box_room, sf = sb - m.stove_depth, pm = m.stove_plate_margin, sh = m.stove_height;
  box(sx0 - pm, sx1 + pm, bf - m.stove_plate_length, bf, 0, 6, COL.plate);
  box(sx0, sx1, sf, sb, 6, sh, COL.stove);
  box(sx0 + 90, sx1 - 90, sf - 3, sf, 200, sh - 200, 0x0b0b0b);
  const r = m.pipe_diameter / 2, px = (sx0 + sx1) / 2, py = (sf + sb) / 2 + m.pipe_towards_back, ptop = slope(px) + 400;
  const pipe = addMesh(new THREE.CylinderGeometry(mm(r), mm(r), mm(ptop - sh), 24), COL.stove);
  pipe.position.set(mm(px), mm((ptop + sh) / 2), -mm(py));
  const collar = addMesh(new THREE.CylinderGeometry(mm(2.2 * r), mm(2.2 * r), mm(6), 32), COL.stove);
  collar.position.set(mm(px), mm(slope(px) - 4), -mm(py)); collar.rotation.z = Math.atan((hr - hw) / w);

  // IKEA BILLY bookcases in the corner by the kitchen wall and the window wall, dark wood.
  // BILLY 80 x 28 x 202 cm, half BILLY 40 cm wide, height extension 35 cm on top.
  // Each bookcase has a bottom board, a fixed middle shelf (screwed in, it holds the case square) and a top; the other
  // shelves rest on four pins in 5 mm holes on a 32 mm grid, in one group of holes below the fixed shelf and one above.
  // IKEA does not publish the hole heights: these are read off the assembly drawing (AA-2289108) and are the numbers
  // to correct after measuring a real BILLY. Heights in mm above the floor; holeZ = centre of a hole, and a shelf's
  // underside sits `rest` above the centre of the holes its pins are in. The height extension has no holes.
  const BILLY = {
    H: 2020, E: 350, D: 280, t: 15, base: 75, fixed: 1032, pitch: 32, rest: 5, minHoles: 2,
    groups: { lo: { first: 210, n: 22, name: 'below the fixed shelf' }, hi: { first: 1186, n: 24, name: 'above the fixed shelf' } },
    rows: [40, 243],  // the two rows of holes, mm in front of the back panel
    defaults: [{ id: 'd1', sec: 'lo', i: 5 }, { id: 'd2', sec: 'lo', i: 15 }, { id: 'd3', sec: 'hi', i: 5 }, { id: 'd4', sec: 'hi', i: 15 }],
  };
  BILLY.holeZ = (sec, i) => BILLY.groups[sec].first + i * BILLY.pitch;
  // the shelves as the page had them before they could be moved, in the order their numbers were handed out
  const legacy = [];
  const holeGeo = new THREE.CircleGeometry(mm(2.5), 10), holeMat = new THREE.MeshBasicMaterial({ color: 0x1a120c });
  function billy(ox, oy, wx, wy, W, ext, key, name) {
    const { D, H, E, t } = BILLY, nx = -wy, ny = wx;  // depth runs into the room, square to the width
    const theta = Math.atan2(wy, wx);
    // the unit's own frame: X along the width, Y up, -Z out into the room (mm / 1000)
    const frame = new THREE.Group(); frame.position.set(mm(ox), 0, -mm(oy)); frame.rotation.y = theta; scene.add(frame); frame.updateMatrixWorld(true);
    const unit = { id: units.length, key, name, frame, W, D, H: H + (ext ? E : 0), ext, kind: 'billy', mount: 'floor', boards: new Map(), surfs: [] };
    units.push(unit);
    // a board, in the bookcase's own frame: a across, d out from the back, z up (mm)
    function part(a0, a1, d0, d1, z0, z1) {
      const g = new THREE.BoxGeometry(mm(a1 - a0), mm(z1 - z0), mm(d1 - d0));
      const me = addMesh(g, COL.shelf, 'shelf', null, 'walnut', frame);
      boardUV(g, [a1 - a0, z1 - z0, d1 - d0]);
      me.position.set(mm(a0 + a1) / 2, mm(z0 + z1) / 2, -mm(d0 + d1) / 2); me.userData.unit = unit.id;
      const st = { size: [mm(a1 - a0), mm(z1 - z0), mm(d1 - d0)], pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      statics.push(st); me.userData.static = st; staticPose(me);
      return me;
    }
    // a board books can stand on: a0..a1 across, d0 (back) .. d1 (front edge), z = top; clear (free height above) comes from clearances()
    function surface(sid, kind, d1, z, mesh) {
      const s = { id: key + ':' + sid, sid, kind, unit: unit.id, a0: t, a1: W - t, d0: 3, d1, z, clear: 400, mesh };
      surfaces[s.id] = s; unit.surfs.push(s); mesh.userData.surface = s.id; return s;
    }
    part(0, t, 0, D, 0, H); part(W - t, W, 0, D, 0, H);  // sides
    const topBoard = part(t, W - t, 0, D, H - t, H);
    part(t, W - t, 0, 3, 0, H);  // back
    part(t, W - t, D - 40, D - 25, 0, 60);  // plinth
    surface('bottom', 'bottom', D - 8, BILLY.base, part(t, W - t, 3, D - 8, 60, BILLY.base));
    surface('fixed', 'fixed', D - 8, BILLY.fixed + t, part(t, W - t, 3, D - 8, BILLY.fixed, BILLY.fixed + t));
    surface('top', ext ? 'top' : 'roof', D, H, topBoard);
    if (ext) {
      part(0, t, 0, D, H, H + E); part(W - t, W, 0, D, H, H + E); part(t, W - t, 0, 3, H, H + E);
      surface('roof', 'roof', D, H + E, part(t, W - t, 0, D, H + E - t, H + E));
    }
    // the holes, on the inside of both sides
    const nHoles = BILLY.groups.lo.n + BILLY.groups.hi.n;
    const holes = new THREE.InstancedMesh(holeGeo, holeMat, 2 * BILLY.rows.length * nHoles), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    [[t + 0.3, Math.PI / 2], [W - t - 0.3, -Math.PI / 2]].forEach(([a, rot]) => BILLY.rows.forEach(d => Object.keys(BILLY.groups).forEach(sec => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      for (let i = 0; i < BILLY.groups[sec].n; i++) holes.setMatrixAt(k++, mx.compose(new THREE.Vector3(mm(a), mm(BILLY.holeZ(sec, i)), -mm(3 + d)), q, one));
    })));
    frame.add(holes);
    unit.part = part; unit.surface = surface;
    setShelves(unit.id, BILLY.defaults);
    const old = [75, 399.2, 723.3, 1047.5, 1371.7, 1695.8, 2020, 2370];
    ['bottom', 'd1', 'd2', 'fixed', 'd3', 'd4', 'top', 'roof'].slice(0, ext ? 8 : 7).forEach((sid, i) => legacy.push({ id: key + ':' + sid, z: old[i] }));
    return unit;
  }
  // free height above each board, up to the underside of the next board (40 cm on top of the bookcase); boards top down
  function clearances(unit) {
    const { t, H, E } = BILLY, under = unit.surfs.filter(s => s.kind !== 'roof').map(s => s.z - t);
    under.push(unit.ext ? H + E - t : H - t);
    unit.surfs.forEach(s => { s.clear = s.kind === 'roof' ? 400 : Math.min(...under.filter(b => b > s.z - 0.5)) - s.z; });
    unit.surfs.sort((a, b) => b.z - a.z);
  }
  // put a bookcase's movable shelves where list says ([{id, sec, i}]); returns the boards taken away and added
  function setShelves(u, list) {
    const unit = units[u], { t, D, rest } = BILLY, removed = { statics: [], parts: [] }, added = { statics: [], parts: [] };
    const want = new Map(list.map(b => [b.id, b]));
    unit.surfs.filter(s => {
      if (s.kind !== 'adj') return false;
      const w = want.get(s.sid), b = unit.boards.get(s.sid);
      return !w || w.sec !== b.sec || w.i !== b.i;
    }).forEach(s => {
      const pi = parts.findIndex(p => p.mesh === s.mesh), st = s.mesh.userData.static;
      removed.parts.push(parts[pi]); parts.splice(pi, 1); s.mesh.parent.remove(s.mesh); s.mesh.geometry.dispose();
      statics.splice(statics.indexOf(st), 1); removed.statics.push(st);
      unit.boards.delete(s.sid); delete surfaces[s.id]; unit.surfs.splice(unit.surfs.indexOf(s), 1);
    });
    list.forEach(b => {
      if (unit.boards.has(b.id)) return;
      const z0 = BILLY.holeZ(b.sec, b.i) + rest, n0 = parts.length;
      const mesh = unit.part(t, unit.W - t, 3, D - 8, z0, z0 + t);
      unit.surface(b.id, 'adj', D - 8, z0 + t, mesh); unit.boards.set(b.id, { sec: b.sec, i: b.i });
      added.parts.push(...parts.slice(n0)); added.statics.push(mesh.userData.static);
    });
    clearances(unit);
    return { removed, added };
  }
  // the half BILLY stands at 45 degrees across the corner; its front corners touch the front corners of the
  // bookcases on either side, so their fronts start 28 cm + 40 cm / sqrt 2 = 56 cm out from the corner.
  // The letters run left to right as you face the bookcases from the room.
  const s2 = Math.SQRT1_2, edge = 280 + 400 * s2;
  billy(280 - 280 * s2, edge - 280 * s2, s2, -s2, 400, true, 'C', 'Corner (half BILLY)').type = 'billy40e';
  billy(edge, 0, 1, 0, 800, true, 'B', 'Kitchen wall, by the corner').type = 'billy80e';
  billy(edge + 800, 0, 1, 0, 800, false, 'A', 'Kitchen wall, by the door').type = 'billy80';
  billy(0, edge + 800, 0, -1, 800, true, 'D', 'Window wall').type = 'billy80e';

  // ---------- the kinds of furniture, so more can be added ----------
  // type -> {name, build(key, name, at, suffix)}; a new BILLY gets the next free letter, like the ones in the room
  const types = {};
  [['billy80', 'BILLY, 80 cm', 800, false], ['billy80e', 'BILLY, 80 cm, with height extension', 800, true],
    ['billy40', 'Half BILLY, 40 cm', 400, false], ['billy40e', 'Half BILLY, 40 cm, with height extension', 400, true]].forEach(([type, name, W, ext]) => {
    types[type] = { name, letter: true, build(key, nm, at) {
      const n = legacy.length, u = billy(0, 0, 1, 0, W, ext, key, nm);
      legacy.length = n;  // only the first four had shelves numbered the old way
      u.type = type; placeUnit(u, at); return u;
    } };
  });
  const LETTERS = 'EFGHIJLMNOPQRTUVXYZ';  // not K, S or W, which other furniture uses
  // the key and name a copy of a type gets: the first free one, or the one belonging to a saved key
  function copyName(type, key) {
    const t = types[type]; if (!t) return null;
    const used = new Set(units.map(u => u.key));
    if (t.letter) { key = key || LETTERS.split('').find(c => !used.has(c)); return key && { key, name: 'BILLY ' + key, sfx: '' }; }
    const base = t.series ? t.prefix : type;
    let n = key ? +key.slice(base.length) : t.from || 2;
    if (!key) while (used.has(base + n)) n++;
    return t.series ? { key: base + n, name: t.series + n, sfx: '' } : { key: base + n, name: (t.short || t.name) + ' ' + n, sfx: ' (' + n + ')' };
  }
  // taking a unit out of the room and putting it back (the physics of its boards is the game's)
  function detachUnit(u) {
    u.gone = true; scene.remove(u.frame);
    u.parts = parts.filter(p => p.mesh.parent === u.frame);
    u.parts.forEach(p => parts.splice(parts.indexOf(p), 1));
    u.surfs.forEach(s => { delete surfaces[s.id]; });
  }
  function attachUnit(u) {
    u.gone = false; scene.add(u.frame);
    parts.push(...(u.parts || [])); u.parts = null;
    u.surfs.forEach(s => { surfaces[s.id] = s; });
  }

  // ---------- moving a bookcase or a piece of furniture ----------
  // Where a unit stands, in room mm: the middle of its footprint (cx, cy), the height of its underside (z), and its turn
  // in degrees, counter-clockwise seen from above (0 = its front faces away from the kitchen wall, -90 = towards the brick wall).
  function atOf(u) {
    u.frame.updateMatrixWorld(true);
    const c = new THREE.Vector3(mm(u.W / 2), 0, -mm(u.D / 2)).applyMatrix4(u.frame.matrixWorld);
    return { cx: Math.round(c.x * 1000), cy: Math.round(-c.z * 1000), z: Math.round(u.frame.position.y * 1000),
      rot: Math.round(u.frame.rotation.y * 1800 / Math.PI) / 10 };
  }
  function staticPose(me) { me.updateMatrixWorld(true); me.getWorldPosition(me.userData.static.pos); me.getWorldQuaternion(me.userData.static.quat); }
  const staticsOf = u => u.frame.children.filter(c => c.userData.static).map(c => c.userData.static);
  function placeUnit(u, at) {
    const th = at.rot * Math.PI / 180, v = new THREE.Vector3(mm(u.W / 2), 0, -mm(u.D / 2)).applyAxisAngle(new THREE.Vector3(0, 1, 0), th);
    u.frame.rotation.set(0, th, 0); u.frame.position.set(mm(at.cx) - v.x, mm(at.z || 0), -mm(at.cy) - v.z);
    u.frame.updateMatrixWorld(true);
    u.frame.children.forEach(c => { if (c.userData.static) staticPose(c); });
  }
  // a unit's footprint at a place: its four corners in room mm (x, y), and the heights it takes up
  function footprint(u, at) {
    const th = at.rot * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    // the unit's width runs along (cos, sin) in room x, y and its depth (towards its front) along (-sin, cos)
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
      [at.cx + i * u.W / 2 * cs - j * u.D / 2 * sn, at.cy + i * u.W / 2 * sn + j * u.D / 2 * cs]);
    return { pts, z0: at.z || 0, z1: (at.z || 0) + u.H };
  }
  const ceilingAt = (x, y) => y < lcd || y > back ? lch : slope(Math.max(0, x));
  // what a unit may not stand in: the box room, and the stove on its plate
  const fixedBlocks = [
    { name: 'the box room', pts: [[0, bf], [bw, bf], [bw, L], [0, L]], z0: 0, z1: 9999 },
    { name: 'the stove', pts: [[sx0 - pm, bf - m.stove_plate_length], [sx1 + pm, bf - m.stove_plate_length], [sx1 + pm, bf], [sx0 - pm, bf]], z0: 0, z1: 9999 },
  ];
  if (g.addFurniture) g.addFurniture({ THREE, addMesh, boardUV, statics, units, surfaces, mm, COL, TEX, placeUnit, scene, types,
    room: { w, L, lcd, lch, hw, back, wa, wb, sill, top, bf, bw, sx0, sx1, pm, plate: m.stove_plate_length } });
  units.forEach(u => { u.home = atOf(u); });
  parts.forEach(p => { if (p.tex && !p.own) worldUV(p); });

  // lights: the lamp on the brick wall above the first nook door, a little towards the front (lamp.js)
  const lights = g.RoomLights ? g.RoomLights(THREE, scene, renderer, { mm, addMesh, w, slope, lampY: y.d1 + 610, lampH: 2800 }) : null;
  const cat = g.CatKit && g.CatKit.roomCat ? g.CatKit.roomCat(scene, { mm, roof, rug, couch, bw, bf, back, slope }) : null;

  // How places are written, chosen under BOOKCASES and ZONES: a zone or a bookcase as a letter (A), a number from 1
  // or from 0, or two digits (01 or 00); a shelf, counted from the top, as a number from 1 or 0, two digits, or a
  // small letter. Bookcases count by their letter (A-D, then the ones added); in a zone they count from the first
  // one in it, and any piece can be given its own number under BOOKCASES. Other furniture keeps its own names
  // (K1, Chatol 2) until it is put in a zone or given a number. The keys stay letters underneath, so all of this
  // only changes what is shown.
  const labels = { cases: 'A', shelves: '1', zones: 'A' };
  const zones = [];  // [{id, name, units: [unit key, in order]}], in order
  const marks = {};  // unit key -> the number (from 1) it was given under BOOKCASES
  const ORDINAL = 'ABCD' + LETTERS;  // A is the first bookcase, E the fifth, J the ninth (no K, S or W)
  const FORMATS = ['A', '1', '0', '01', '00'];
  function numbered(n, fmt) {  // n counts from 0
    if (fmt === 'A') return n < 26 ? String.fromCharCode(65 + n) : 'A' + String.fromCharCode(65 + n - 26);
    if (fmt === 'a') return String.fromCharCode(97 + n % 26);
    const v = fmt === '0' || fmt === '00' ? n : n + 1;
    return fmt.length === 2 ? String(v).padStart(2, '0') : String(v);
  }
  const zoneOf = u => zones.find(z => z.units.includes(u.key));
  const zoneLabel = z => numbered(zones.indexOf(z), labels.zones);
  // the units of a zone that are in the room, in its order
  const zoneUnits = z => z.units.map(k => units.find(o => o.key === k)).filter(o => o && !o.gone);
  // the number a unit counts as (from 0), or -1 for furniture that keeps its own names
  function caseNo(u) {
    if (marks[u.key] > 0) return marks[u.key] - 1;
    const z = zoneOf(u); if (z) return zoneUnits(z).indexOf(u);
    return u.kind === 'billy' ? ORDINAL.indexOf(u.key) : -1;
  }
  function caseLabel(u) {
    const n = caseNo(u);
    if (n < 0) return u.kind === 'billy' ? u.key : '';
    if (labels.cases === 'A' && u.kind === 'billy' && !marks[u.key] && !zoneOf(u)) return u.key;
    return numbered(n, labels.cases);
  }
  // the unit with its zone in front: B, A-B, 2-01
  function unitCode(u) { const z = zoneOf(u), c = caseLabel(u); return z && c ? zoneLabel(z) + '-' + c : c; }
  function setLabels(o) {
    labels.cases = FORMATS.includes(o && o.cases) ? o.cases : 'A';
    labels.shelves = ['1', '0', '01', '00', 'a'].includes(o && o.shelves) ? o.shelves : '1';
    labels.zones = FORMATS.includes(o && o.zones) ? o.zones : 'A';
  }
  function setZones(o) {
    zones.length = 0;
    (o && Array.isArray(o.list) ? o.list : []).forEach(z => { if (z && z.id) zones.push({ id: z.id, name: z.name || '', units: Array.isArray(z.units) ? z.units.slice() : [] }); });
  }
  function setMark(key, n) { if (n > 0) marks[key] = Math.round(n); else delete marks[key]; }
  // a shelf's short name: the zone, the bookcase and its number counted from the top (B3, A-B3, or 2-3 when both are
  // numbers); the board on top of the case is 'top'
  function code(id) {
    const s = surfaces[id]; if (!s) return '';
    const u = units[s.unit];
    if (caseNo(u) < 0 && s.label) return s.label;
    const c = unitCode(u);
    if (s.kind === 'roof') return c + ' top';
    const n = numbered(u.surfs.filter(o => o.kind !== 'roof').indexOf(s), labels.shelves);
    return c + (/\d$/.test(c) && /^\d/.test(n) ? '-' : '') + n;
  }
  const surfList = () => Object.values(surfaces);
  return { parts, statics, units, surfaces, surfList, setShelves, code, caseLabel, setLabels, labels, BILLY,
    zones, setZones, zoneOf, zoneLabel, zoneUnits, caseNo, unitCode, setMark, marks, numbered, legacy, texLoaded: () => texLoaded, cat, lights, w, L, dl, slope, mm, COL, TEX,
    atOf, placeUnit, staticsOf, footprint, fixedBlocks, ceilingAt, win: { y0: wa, y1: wb, z0: sill, z1: top }, types, copyName, detachUnit, attachUnit };
  };
})(window);
