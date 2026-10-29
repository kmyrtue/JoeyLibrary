// The rest of the furniture in the room, built the same way as the BILLY bookcases: each piece is a unit with its own
// frame (a across its width, d out from its back, z up; mm), boards that books can stand on, and a place it can be
// moved from (see placeUnit in room.js). Sizes are measured where the notes say so; the rest is estimated from photos.
// Each kind of piece is a type in `types` (type -> {name, build(key, name, at, suffix)}), so more of them can be added
// to the room; a copy's shelves are labelled like the original's with the suffix after them ('K1 (2)').
// Edges, knobs, handles, mouldings and feet were modelled in FreeCAD with real fillets against the photos first; the
// numbers here are the ones that matched.
(function (g) {
  g.addFurniture = function (X) {
    const { THREE, addMesh, boardUV, statics, units, surfaces, mm, TEX, placeUnit, scene, room, types } = X;
    TEX.pine = { file: 'oak_veneer', size: 1.8, tint: 0xc9a074 };  // honey-coloured pine: the oak veneer, tinted
    TEX.kallax = { file: 'oak_veneer', size: 1.8, tint: 0x4a423d };  // KALLAX black-brown: a faint grain under the colour
    TEX.blackoak = { file: 'oak_veneer', size: 1.8, tint: 0x333230 };  // the coffee table's black-stained top
    const C = { oak: 0xd2ad78, pine: 0xc8873e, white: 0xf2f1ec, kallax: 0x2b2421, walnut: 0x6b4630, alu: 0xb4b8bc,
      chrome: 0xb3b8bd, stone: 0x1d1d1f, rail: 0x3a2a20, glass: 0x9fc0d0, knob: 0x8a5a2a, iron: 0x2a2420, lead: 0x55575a };

    // ---------- shapes beyond plain boxes ----------
    // ExtrudeGeometry's normals are flat per face; average them where faces meet at less than `deg` degrees, so a
    // rounded edge looks round and a square one stays square
    function smooth(geo, deg = 50) {
      const P = geo.attributes.position, N = geo.attributes.normal, cos = Math.cos(deg * Math.PI / 180), out = new Float32Array(P.count * 3), at = new Map();
      for (let i = 0; i < P.count; i++) {
        const k = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
        if (!at.has(k)) at.set(k, []); at.get(k).push(i);
      }
      at.forEach(ids => ids.forEach(i => {
        let x = 0, y = 0, z = 0;
        ids.forEach(j => { if (N.getX(i) * N.getX(j) + N.getY(i) * N.getY(j) + N.getZ(i) * N.getZ(j) >= cos) { x += N.getX(j); y += N.getY(j); z += N.getZ(j); } });
        const l = Math.hypot(x, y, z) || 1; out[3 * i] = x / l; out[3 * i + 1] = y / l; out[3 * i + 2] = z / l;
      }));
      geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
      return geo;
    }
    // a shape extruded t mm with its edges rounded r: in mm, the shape in its x, y and the thickness along z from 0
    // (seg steps round the rounded edge, curve steps along each arc of the shape)
    function extrude(shape, t, r, seg = 3, curve = 6) {
      r = Math.max(0, Math.min(r, t / 2 - 0.05));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: t - 2 * r, bevelEnabled: r > 0, bevelThickness: r, bevelSize: r, bevelOffset: -r, bevelSegments: r > 0 ? seg : 1, curveSegments: curve });
      geo.translate(0, 0, r); return geo;
    }
    // a board sx across, sy deep and sz tall with every edge rounded r and its corners seen from above rounded
    // `corner`; centred on its middle, in metres. The terminal look outlines it as the plain box.
    function slabGeo(sx, sy, sz, r, corner = r) {
      r = Math.min(r, sx / 2 - 0.5, sy / 2 - 0.5, sz / 2 - 0.05);
      const w = sx / 2, h = sy / 2, c = Math.min(Math.max(corner, r), w, h) - 0.01, s = new THREE.Shape();
      s.moveTo(-w + c, -h); s.lineTo(w - c, -h); s.absarc(w - c, -h + c, c, -Math.PI / 2, 0); s.lineTo(w, h - c); s.absarc(w - c, h - c, c, 0, Math.PI / 2);
      s.lineTo(-w + c, h); s.absarc(-w + c, h - c, c, Math.PI / 2, Math.PI); s.lineTo(-w, -h + c); s.absarc(-w + c, -h + c, c, Math.PI, 1.5 * Math.PI);
      // a 1-2 mm round reads the same in one or two steps, which keeps the many shelf boards cheap
      const geo = extrude(s, sz, r, corner > 6 ? 4 : r > 2 ? 2 : 1, c > 6 ? 6 : c > 2.5 ? 2 : 1);
      geo.translate(0, 0, -sz / 2); geo.rotateX(-Math.PI / 2); geo.scale(0.001, 0.001, 0.001);
      smooth(geo); geo.userData.outline = new THREE.BoxGeometry(mm(sx), mm(sz), mm(sy));
      return geo;
    }
    const dimsOf = geo => { geo.computeBoundingBox(); const b = geo.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => v * 1000); };
    // a mesh only to be looked at (not solid, books don't stand on it) at a (across), d (out from the back), z (up);
    // look = [colour, texture, material options]
    function deco(u, geo, look, a = 0, d = 0, z = 0, parent) {
      const [color, tex, opts] = look, me = addMesh(geo, color, 'shelf', opts || null, tex, parent || u.frame);
      if (tex) boardUV(geo, dimsOf(geo), TEX[tex].size);
      me.position.set(mm(a), mm(z), -mm(d)); me.userData.unit = u.id; return me;
    }
    // a board cut to a shape (pts in mm, holes as more lists of points), t thick and its edges rounded r, lying in:
    // 'ad' seen from above (x = a, y = d), from z = at up; 'az' seen from the front (x = a, y = z), from d = at out;
    // 'dz' seen from the side (x = d, y = z), from a = at across
    function cut(u, plane, pts, at, t, look, r = 0, holes, parent) {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      (holes || []).forEach(h => sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
      const geo = extrude(sh, t, r);
      if (plane === 'ad') geo.rotateX(-Math.PI / 2);
      else if (plane === 'az') geo.translate(0, 0, -t);
      else geo.rotateY(Math.PI / 2);
      geo.scale(0.001, 0.001, 0.001); smooth(geo);
      return plane === 'ad' ? deco(u, geo, look, 0, 0, at, parent) : plane === 'az' ? deco(u, geo, look, 0, at, 0, parent) : deco(u, geo, look, at, 0, 0, parent);
    }
    // a turned part, prof = [[radius, height], ...] from its foot; standing on (a, d, z), or sticking out of a front
    // at d when out is set
    function turned(u, prof, look, a, d, z, out, segs = 16) {
      const geo = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(mm(Math.max(r, 0.01)), mm(h))), segs);
      const me = deco(u, geo, look, a, d, z);
      if (out) me.rotation.x = -Math.PI / 2;
      return me;
    }
    // a moulding: the profile prof = [[out, up], ...] (mm out from the line and up from z) run along the line path =
    // [[a, d], ...] seen from above, its outside on the left going along, mitred at the corners. Repeat a point of the
    // profile to keep a sharp corner there.
    function sweep(u, prof, path, z, look) {
      const dir = (p, q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
      const pts = path.map((p, i) => {
        const d1 = i ? dir(path[i - 1], p) : dir(p, path[i + 1]), d2 = i + 1 < path.length ? dir(p, path[i + 1]) : d1;
        const m = [-d1[1] - d2[1], d1[0] + d2[0]], ml = Math.hypot(m[0], m[1]), k = ml / (m[0] * -d1[1] + m[1] * d1[0]);
        return [p, [m[0] / ml * k, m[1] / ml * k]];
      });
      const pos = [], idx = [], n = prof.length;
      for (let i = 0; i + 1 < pts.length; i++) {  // a strip of its own for each stretch, so the mitres stay sharp
        const b = pos.length / 3;
        [pts[i], pts[i + 1]].forEach(([p, nv]) => prof.forEach(([o, h]) => pos.push(mm(p[0] + nv[0] * o), mm(z + h), -mm(p[1] + nv[1] * o))));
        for (let j = 0; j + 1 < n; j++) idx.push(b + j, b + j + 1, b + n + j, b + j + 1, b + n + j + 1, b + n + j);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      return deco(u, geo, [look[0], look[1], { side: THREE.DoubleSide }]);
    }
    // rows of 5 mm shelf-pin holes on the inside of boards: faces = [[a, +1 or -1 (the way the face looks)]],
    // ds = the rows (mm out from the back), zs = the heights
    const holeGeo = new THREE.CircleGeometry(mm(2.5), 10), holeMat = new THREE.MeshBasicMaterial({ color: 0x4a3420 });
    function holes(u, faces, ds, zs) {
      const m = new THREE.InstancedMesh(holeGeo, holeMat, faces.length * ds.length * zs.length), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      let k = 0;
      faces.forEach(([a, s]) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * Math.PI / 2); ds.forEach(d => zs.forEach(z => m.setMatrixAt(k++, mx.compose(new THREE.Vector3(mm(a + s * 0.3), mm(z), -mm(d)), q, one)))); });
      u.frame.add(m);
    }
    const steps = (z0, z1, pitch) => { const out = []; for (let z = z0; z <= z1; z += pitch) out.push(z); return out; };

    function piece(key, name, W, D, H, mount, at) {
      const frame = new THREE.Group(); scene.add(frame);
      const u = { id: units.length, key, name, frame, W, D, H, kind: 'furniture', mount, boards: new Map(), surfs: [] };
      units.push(u);
      // a board: solid ones are physics boxes too (the box round it, rounded or not); look = [colour, texture];
      // r rounds its edges, corner its corners seen from above
      u.part = (a0, a1, d0, d1, z0, z1, look, solid = true, r = 0, corner = r) => {
        const [color, tex] = look, geo = r ? slabGeo(a1 - a0, d1 - d0, z1 - z0, r, corner) : new THREE.BoxGeometry(mm(a1 - a0), mm(z1 - z0), mm(d1 - d0));
        const me = addMesh(geo, color, 'shelf', null, tex, frame);
        if (tex) boardUV(geo, [a1 - a0, z1 - z0, d1 - d0], TEX[tex].size);
        me.position.set(mm(a0 + a1) / 2, mm(z0 + z1) / 2, -mm(d0 + d1) / 2); me.userData.unit = u.id;
        if (solid) { const st = { size: [mm(a1 - a0), mm(z1 - z0), mm(d1 - d0)], pos: new THREE.Vector3(), quat: new THREE.Quaternion() }; statics.push(st); me.userData.static = st; }
        return me;
      };
      // somewhere books can go: kind 'shelf' (filled when the bookcases are full) or 'roof' (the top of a chest, a table)
      u.surface = (sid, label, kind, a0, a1, d0, d1, z, clear, mesh) => {
        const s = { id: key + ':' + sid, sid, kind, label: label + suffix, unit: u.id, a0, a1, d0, d1, z, clear, mesh };
        surfaces[s.id] = s; u.surfs.push(s); mesh.userData.surface = s.id; return s;
      };
      u.done = () => { u.surfs.sort((a, b) => b.z - a.z); placeUnit(u, at); return u; };
      return u;
    }
    let suffix = '';
    // o: series + prefix + from for pieces numbered on (W6, W7 ...) instead of getting a suffix
    function def(type, name, build, o) {
      types[type] = Object.assign({ name, build(key, nm, at, sfx) { suffix = sfx || ''; try { const u = build(key, nm, at); u.type = type; return u; } finally { suffix = ''; } } }, o);
    }
    // a turned knob on a front d mm out from the back; prof from the front outwards
    const KNOB = {
      pine: [[0, 0], [9, 0], [9, 6], [7.5, 12], [10, 15], [16, 18], [17.5, 22], [17, 27], [14, 30.5], [8, 32], [0, 32.3]],  // 3.5 cm mushroom (measured)
      small: [[0, 0], [7, 0], [7, 4], [5, 8], [8, 11], [9, 14], [8, 18], [0, 19]],
    };
    const knob = (u, a, z, look, d = u.D, prof = KNOB.pine) => turned(u, prof, look, a, d, z, true);
    // a panel of glass, not solid: books are put in through it; pts its outline seen from the front
    function glass(u, pts, d) { cut(u, 'az', pts, d + 2, 4, [C.glass, null, { transparent: true, opacity: 0.28 }]); }

    // ---------- the shelves over the windows ----------
    // Modules of 89.5 x 61 x 42.5 cm (measured) in light wood, screwed to the wall on a dark rail, 12 cm above the
    // windows. Each has a divider in the middle and a shelf in its right half, as in the photos (seen from the room a
    // module's width runs right to left, so its right half is a < mid). The boards' edges are rounded 1.5 mm and the
    // sides have rows of shelf-pin holes like in the photos.
    const OAK = [C.oak, 'oak'], T = 18, MW = 895, MH = 610, MD = 425, z0w = room.top + 120, ER = 1.5;
    def('W', 'Shelf module (as over the windows)', (key, name, at) => {
      const u = piece(key, name, MW, MD, MH, 'wall', at), p = u.part, mid = MW / 2;
      p(0, T, 0, MD, 0, MH, OAK, true, ER); p(MW - T, MW, 0, MD, 0, MH, OAK, true, ER);
      const bottom = p(T, MW - T, 0, MD, 0, T, OAK, true, ER); p(T, MW - T, 0, MD, MH - T, MH, OAK, true, ER); p(T, MW - T, 0, 6, T, MH - T, OAK);
      p(mid - T / 2, mid + T / 2, 6, MD - 10, T, MH - T, OAK, true, ER);
      const zs = Math.round(MH / 2 - T / 2), shelf = p(T, mid - T / 2, 6, MD - 10, zs, zs + T, OAK, true, ER);
      holes(u, [[T, 1], [mid - T / 2, -1], [mid + T / 2, 1], [MW - T, -1]], [45, MD - 55], steps(T + 70, MH - T - 70, 32));
      u.surface('left', key + ' left', 'shelf', mid + T / 2, MW - T, 6, MD, T, MH - 2 * T, bottom);
      u.surface('high', key + ' right, top', 'shelf', T, mid - T / 2, 6, MD - 10, zs + T, MH - T - zs - T, shelf);
      u.surface('low', key + ' right, bottom', 'shelf', T, mid - T / 2, 6, MD, T, zs - T, bottom);
      return u.done();
    }, { series: 'Over the windows ', prefix: 'W', from: 6 });
    const y0w = room.lcd;  // they start where the low ceiling ends
    for (let n = 1; n <= 5; n++) types.W.build('W' + n, 'Over the windows ' + n, { cx: MD / 2, cy: y0w + MW * (n - 0.5), z: z0w, rot: -90 });
    // the rail they hang on stays where it is
    const rail = addMesh(new THREE.BoxGeometry(mm(22), mm(50), mm(5 * MW)), C.rail);
    rail.position.set(mm(11), mm(z0w - 25), -mm(y0w + 5 * MW / 2));

    // ---------- the shelf by the stove ----------
    // Three of the same modules stacked against the box room, the bottom one closed with two doors set in between
    // its sides, each with a small white knob near the top by the middle (photo).
    def('S', 'Shelf by the stove (three modules)', (key, name, at) => {
      const H = 3 * MH, u = piece(key, name, MW, MD, H, 'floor', at), p = u.part;
      p(0, T, 0, MD, 0, H, OAK, true, ER); p(MW - T, MW, 0, MD, 0, H, OAK, true, ER); p(T, MW - T, 0, 6, 0, H, OAK);
      const top = p(T, MW - T, 0, MD, H - T, H, OAK, true, ER);
      p(T, MW - T, 0, MD, 0, T, OAK, true, ER);
      p(T + 2, MW / 2 - 1.5, MD - T - 2, MD - 2, T + 2, MH - T - 2, OAK, true, ER); p(MW / 2 + 1.5, MW - T - 2, MD - T - 2, MD - 2, T + 2, MH - T - 2, OAK, true, ER);  // doors
      knob(u, MW / 2 - 40, MH - 90, [0xf4f3ee], MD - 2, KNOB.small); knob(u, MW / 2 + 40, MH - 90, [0xf4f3ee], MD - 2, KNOB.small);
      let n = 4;
      for (let k = 0; k < 2; k++) {
        const zb = (k + 1) * MH, base = p(T, MW - T, 0, MD, zb - T, zb + T, OAK, true, ER), zs = zb + Math.round(MH / 2 - T / 2);
        const shelf = p(T, MW - T, 6, MD - 10, zs, zs + T, OAK, true, ER);
        holes(u, [[T, 1], [MW - T, -1]], [45, MD - 55], steps(zb + T + 70, zb + MH - T - 70, 32));
        u.surface('m' + k + 'lo', 'S' + n--, 'shelf', T, MW - T, 6, MD, zb + T, zs - zb - T, base);
        u.surface('m' + k + 'hi', 'S' + n--, 'shelf', T, MW - T, 6, MD - 10, zs + T, zb + MH - T - zs - T, shelf);
      }
      u.surface('top', 'S top', 'roof', T, MW - T, 0, MD, H, 400, top);
      return u.done();
    }, { short: 'Shelf by the stove' });
    types.S.build('S', 'By the stove', { cx: room.sx0 - room.pm - 5 - MW / 2, cy: room.bf - MD / 2, z: 0, rot: 180 });

    // ---------- chests of drawers ----------
    // a carcass with a top board and drawer fronts in rows (o.rows = drawers per row, from the bottom, all the same
    // height) and handles; o.side: the sides frame the fronts (the fronts sit between them) instead of the fronts
    // covering the sides; o.foot draws what it stands on, from the floor up to o.base
    function chest(key, name, label, W, D, H, at, o) {
      const u = piece(key, name, W, D, H, 'floor', at), p = u.part, b = o.base, tt = o.topT || 20, s = o.side || 0, r = o.r || 0;
      o.foot(u);
      p(s, W - s, 0, D - 20, b, H - tt, o.look);  // the carcass
      if (s) { p(0, s, 0, D, b, H - tt, o.look, true, r); p(W - s, W, 0, D, b, H - tt, o.look, true, r); }
      const top = p(0, W, 0, D, H - tt, H, o.look, true, r);
      const gap = 3, rh = (H - tt - b) / o.rows.length;
      o.rows.forEach((n, i) => {
        const cw = (W - 2 * s) / n;
        for (let c = 0; c < n; c++) {
          const a0 = s + c * cw + gap / 2, a1 = a0 + cw - gap, z0 = b + i * rh + gap / 2, z1 = z0 + rh - gap;
          p(a0, a1, D - 20, D, z0, z1, o.look, false, r);
          if (o.handle) o.handle(u, (a0 + a1) / 2, (z0 + z1) / 2, a1 - a0);
        }
      });
      u.surface('top', label + ' top', 'roof', 10, W - 10, 5, D - 5, H, 400, top);
      return u.done();
    }
    // walnut, in front of the bookcases: 148 x 46 x 85 cm on a 5 cm base, 3 x 3 drawers, 2 cm aluminium bar handles
    // (measured). The sides and the top frame the drawer fronts; the handles are flat bars 19 cm long (38 % of a
    // front, photo), 6 mm thick, on two round posts 22 mm out, in the middle of each front.
    def('walnut', 'Walnut chest', (key, name, at) => chest(key, name, 'Walnut chest', 1480, 460, 850, at, {
      base: 50, look: [C.walnut, 'walnut'], side: 18, r: 1.5, rows: [3, 3, 3],
      foot: u => u.part(30, u.W - 30, 20, u.D - 30, 0, 50, [0x2a1d14]),  // plinth, set back
      handle: (u, a, z) => {
        const L = 190, ALU = [C.alu];
        const bar = deco(u, slabGeo(L, 6, 20, 1), ALU, a, u.D + 25, z);
        [-1, 1].forEach(sd => { const post = deco(u, new THREE.CylinderGeometry(mm(4), mm(4), mm(22), 10), ALU, a + sd * (L / 2 - 12), u.D + 11, z); post.rotation.x = Math.PI / 2; });
        return bar;
      } }));
    types.walnut.build('walnut', 'Walnut chest', { cx: 400 + 740, cy: 1450 + 230, z: 0, rot: 0 });
    // white, in front of the stove: about 100 x 45 x 72 cm (estimated). Photos: 2 x 4 drawers with no handles (they
    // open by pushing), the fronts covering the sides, a thin top flush with them, on four round steel legs 8 cm tall.
    def('white', 'White chest', (key, name, at) => chest(key, name, 'White chest', 1000, 450, 720, at, {
      base: 80, topT: 18, look: [C.white], r: 1.5, rows: [2, 2, 2, 2],
      foot: u => [[45, 45], [u.W - 45, 45], [45, u.D - 45], [u.W - 45, u.D - 45]].forEach(([a, d]) => {
        deco(u, new THREE.CylinderGeometry(mm(16), mm(16), mm(80), 16), [C.chrome], a, d, 40);
        const st = { size: [mm(32), mm(80), mm(32)], pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
        statics.push(st); u.frame.children[u.frame.children.length - 1].userData.static = st;
      }) }));
    types.white.build('white', 'White chest', { cx: 1650, cy: 5250 - 225, z: 0, rot: 180 });

    // pine, the one the cat sits on: 94 cm wide, 45.5 cm deep to the drawer fronts, 82 cm tall on 9 cm legs,
    // wooden knobs 3.5 cm (measured). From the photos: four drawers the full width, the top one lower, each with two
    // mushroom knobs at a quarter in from its ends, in a face frame; a 25 mm top with a rounded edge (r 11) and
    // rounded front corners (r 35) standing 20 mm out at the front and the sides; the 9 cm is a bun foot 5 cm tall
    // and a moulded plinth 4 cm tall that stands 12 mm out of the carcass.
    def('pine', 'Pine chest', (key, name, at) => {
      const W = 940, D = 455, H = 820, PINE = [C.pine, 'pine'], OS = 20, z0 = 90, tt = 25, zt = H - tt, ST = 22, gap = 3, rail = 12;
      const u = piece(key, name, W, D, H, 'floor', at), p = u.part;
      const BUN = [[0, 0], [18, 0], [28, 5], [34, 17], [35, 24], [32, 36], [25, 45], [22, 50]];
      [[OS + 45, 45], [W - OS - 45, 45], [OS + 45, D - 45], [W - OS - 45, D - 45]].forEach(([a, d]) => turned(u, BUN, PINE, a, d, 0));
      p(OS - 12, W - OS + 12, 0, D + 12, 50, z0, PINE, true, 8);  // the plinth
      p(OS, W - OS, 8, D - 20, z0, zt, PINE);  // the carcass
      p(OS, OS + ST, D - 20, D, z0, zt, PINE, false, 3); p(W - OS - ST, W - OS, D - 20, D, z0, zt, PINE, false, 3);  // the face frame's stiles
      let z = zt;
      [125, 193, 193, 194].forEach((h, i, rows) => {
        const zb = z - h, last = i === rows.length - 1, a0 = OS + ST + gap, a1 = W - OS - ST - gap, f0 = zb + (last ? 0 : rail) + gap, f1 = z - gap;
        if (!last) p(OS + ST, W - OS - ST, D - 20, D - 2, zb, zb + rail, PINE, false);  // the rail under it
        p(a0, a1, D - 20, D, f0, f1, PINE, false, 3);
        [a0 + (a1 - a0) / 4, a1 - (a1 - a0) / 4].forEach(a => knob(u, a, (f0 + f1) / 2, PINE));
        z = zb;
      });
      const top = p(0, W, 0, D + 20, zt, H, PINE, true, 11, 35);
      u.surface('top', 'Pine chest top', 'roof', 10, W - 10, 5, D - 5, H, 400, top);
      return u.done();
    });
    types.pine.build('pine', 'Pine chest', { cx: room.w - 228, cy: 7838 - 30 - 470, z: 0, rot: 90 });

    // ---------- the chatol ----------
    // A Danish bureau with a glass cabinet on top: 1.91 m tall, 97 cm wide, 45 cm deep at the drawers and 23 cm at the
    // glass cabinet (measured). The heights of the parts and the arched top are read from the photo, and so are: four
    // rows of drawers with a serpentine front (out at the ends, 30 mm in at the middle), each with two iron drop
    // handles near its ends and a keyhole in the middle; bracket feet and a shaped apron under a moulded base; the
    // writing flap with a raised panel with stepped corners; a moulding round the foot of the cabinet; glass doors
    // whose tops arch up to the middle, with lead lines; and a cornice that rises in an arch over the doors.
    def('chatol', 'Chatol', (key, name, at) => {
      const W = 970, D = 450, Du = 230, H = 1910, PINE = [C.pine, 'pine'], IRON = [C.iron];
      const u = piece(key, name, W, D, H, 'floor', at), p = u.part;
      const zf = 110, zb = 140, zd = 820, zs = 1060, zc = 1800, B = 30, TS = 22;
      const front = a => D - B * (1 - Math.cos(2 * Math.PI * a / W)) / 2;  // the serpentine front, seen from above
      const slope = a => -B * Math.PI / W * Math.sin(2 * Math.PI * a / W);
      // feet and apron: a bracket foot at each corner, its outline seen from the front (x in from the corner)
      const FOOT = [[0, zf], [0, 72], [-6, 50], [-5, 30], [2, 12], [3, 0], [44, 0], [46, 12], [58, 34], [82, 52], [118, 62], [150, 64], [150, zf]];
      const mirror = (pts, L) => pts.map(([x, y]) => [L - x, y]).reverse();
      cut(u, 'az', FOOT, D - TS, TS, PINE, 2); cut(u, 'az', mirror(FOOT, W), D - TS, TS, PINE, 2);
      // each side in one piece seen from the side (x = d): the back foot, a curve between, the front foot
      const side = FOOT.slice(0, -1).concat([[D / 2 - 50, 80], [D / 2, 70], [D / 2 + 50, 80]], FOOT.slice(0, -1).map(([x, y]) => [D - x, y]).reverse());
      [0, W - TS].forEach(a => cut(u, 'dz', side, a, TS, PINE, 2));
      // the apron between the front feet, set back to the middle of the serpentine, its lower edge in two curves
      const AP = [[150, zf], [150, 64], [230, 70], [330, 86], [W / 2 - 60, 80], [W / 2, 58], [W / 2 + 60, 80], [W - 330, 86], [W - 230, 70], [W - 150, 64], [W - 150, zf]];
      cut(u, 'az', AP, D - B - TS, TS, PINE, 2);
      // the base moulding along the serpentine and round the sides
      const curve = []; for (let i = 0; i <= 24; i++) { const a = W * i / 24; curve.push([a, front(a)]); }
      sweep(u, [[0, 0], [14, 0], [14, 0], [14, 6], [12, 13], [8, 20], [3, 26], [0, 30]], [[0, 0], [0, D]].concat(curve.slice(1, -1), [[W, D], [W, 0]]), zf, PINE);
      // the carcass, its sides, and the four rows of drawers
      p(TS, W - TS, 0, D - B - 20, zb, zd, PINE);
      p(0, TS, 0, D, zf, zd, PINE, true, 3); p(W - TS, W, 0, D, zf, zd, PINE, true, 3);
      let z = zd;
      [175, 175, 175, 155].forEach(h => {
        const a0 = TS + 3, a1 = W - TS - 3, z0 = z - h + 2, z1 = z - 2, pts = [];
        for (let i = 0; i <= 32; i++) { const a = a0 + (a1 - a0) * i / 32; pts.push([a, front(a)]); }
        for (let i = 32; i >= 0; i--) { const a = a0 + (a1 - a0) * i / 32; pts.push([a, front(a) - 20]); }
        cut(u, 'ad', pts, z0, z1 - z0, PINE, 3);
        const zm = (z0 + z1) / 2;
        [0.13, 0.87].forEach(k => {  // a drop handle: two cast backplates with a thin bail hanging from their posts
          // each backplate is a scrolled leaf 32 x 64 mm and 2 mm thick, open in the middle and leaning out a little at the
          // top; a post stands out of its middle, and the bail, 3 mm thick, hangs from the two posts in a swan neck 24 mm
          // deep (photo 214023, which shows them at an angle: the height is 0.4 of a drawer, the spacing estimated)
          const ac = W * k, leaf = (s, f) => {
            const p = Array.from({ length: 40 }, (_, i) => { const t = 2 * Math.PI * i / 40, l = 1 + 0.2 * Math.cos(5 * t) * Math.abs(Math.sin(t)), y = f * 32 * l * Math.sin(t);
              return new THREE.Vector2(s * (f * 16 * l * Math.cos(t) * (1 - 0.15 * Math.sin(t)) + 0.1 * y), y); });
            return s < 0 ? p.reverse() : p;  // anticlockwise either side
          };
          [-1, 1].forEach(s => {
            const a = ac + s * 42, hg = new THREE.Group(); hg.position.set(mm(a), mm(zm), -mm(front(a))); hg.rotation.y = Math.atan(slope(a)); u.frame.add(hg);
            const plate = new THREE.Shape(leaf(s, 1)); plate.holes.push(new THREE.Path(leaf(s, 0.42).reverse()));
            const pg = extrude(plate, 2, 0.5, 1); pg.scale(0.001, 0.001, 0.001); deco(u, smooth(pg), IRON, 0, 2, 0, hg);
            deco(u, new THREE.CylinderGeometry(mm(2.2), mm(2.6), mm(7), 8), IRON, 0, 5.5, 0, hg).rotation.x = Math.PI / 2;
            deco(u, new THREE.SphereGeometry(mm(2.8), 8, 6), IRON, 0, 9, 0, hg);
          });
          const half = [[42, 0, 8], [41, -8, 7], [34, -18, 5], [18, -23.5, 4]], neck = [...half.map(([x, z, o]) => [-x, z, o]), [0, -24, 4], ...half.reverse()];
          const curve = new THREE.CatmullRomCurve3(neck.map(([x, z, o]) => new THREE.Vector3(mm(ac + x), mm(zm + z), -mm(front(ac + x) + o))));
          deco(u, new THREE.TubeGeometry(curve, 28, mm(1.5), 6), IRON);
        });
        const kg = extrude(new THREE.Shape([[-11, -18], [11, -18], [13, 6], [0, 20], [-13, 6]].map(([x, y]) => new THREE.Vector2(x, y))), 2.5, 0.6);
        kg.scale(0.001, 0.001, 0.001); deco(u, smooth(kg), IRON, W / 2, front(W / 2) + 2.5, zm);  // the keyhole
        z -= h;
      });
      // the slanted writing flap from the front of the drawers back to the cabinet, with the sides that close it
      const run = D - Du, rise = zs - zd, len = Math.hypot(run, rise);
      const flap = addMesh(slabGeo(W - 20, 20, len, 4), C.pine, 'shelf', null, 'pine', u.frame);
      boardUV(flap.geometry, [W - 20, len, 20], TEX.pine.size);
      flap.rotation.x = Math.atan2(run, rise); flap.position.set(mm(W / 2), mm((zd + zs) / 2), -mm((D + Du) / 2)); flap.userData.unit = u.id;
      // its raised panel: a moulded frame with stepped corners standing 6 mm out of the flap (the flap's outside is -z)
      const stepped = (w, h, nx, ny) => [[-w / 2 + nx, -h / 2], [w / 2 - nx, -h / 2], [w / 2 - nx, -h / 2 + ny], [w / 2, -h / 2 + ny], [w / 2, h / 2 - ny], [w / 2 - nx, h / 2 - ny],
        [w / 2 - nx, h / 2], [-w / 2 + nx, h / 2], [-w / 2 + nx, h / 2 - ny], [-w / 2, h / 2 - ny], [-w / 2, -h / 2 + ny], [-w / 2 + nx, -h / 2 + ny]];
      const pw = W - 160, ph = len - 90;
      const panel = cut(u, 'az', stepped(pw, ph, 60, 40), 0, 6, PINE, 1.5, [stepped(pw - 36, ph - 36, 60, 40)], flap);
      panel.position.set(0, 0, -mm(10));
      const fk = extrude(new THREE.Shape([[-14, -16], [14, -16], [18, 4], [0, 22], [-18, 4]].map(([x, y]) => new THREE.Vector2(x, y))), 3, 0.6); fk.scale(0.001, 0.001, 0.001);
      const flapKey = deco(u, smooth(fk), IRON, 0, 0, 0, flap); flapKey.position.set(0, mm(len / 2 - 45), -mm(13));
      [0, W - 20].forEach(a => {
        const sh = new THREE.Shape([[0, zd], [D, zd], [Du, zs], [0, zs]].map(([d, zz]) => new THREE.Vector2(mm(d), mm(zz))));
        const sd = addMesh(new THREE.ExtrudeGeometry(sh, { depth: mm(20), bevelEnabled: false }), C.pine, 'shelf', null, 'pine', u.frame);
        sd.rotation.y = Math.PI / 2; sd.position.x = mm(a); sd.userData.unit = u.id;
      });
      p(20, W - 20, 0, Du, zd, zs - 20, PINE);  // what is behind the flap
      // the moulding round the foot of the cabinet
      sweep(u, [[0, 0], [22, 0], [22, 0], [22, 7], [18, 13], [11, 17], [6, 23], [0, 28]], [[0, 0], [0, Du], [W, Du], [W, 0]], zs - 8, PINE);
      // the glass cabinet: sides, back, floor, two shelves, glass doors with a frame
      p(0, 22, 0, Du, zs, zc, PINE, true, 2); p(W - 22, W, 0, Du, zs, zc, PINE, true, 2); p(22, W - 22, 0, 8, zs, zc, PINE);
      const floor = p(22, W - 22, 0, Du, zs - 20, zs, PINE), tz = [zs, 1300, 1550, zc - 20];
      const sh1 = p(22, W - 22, 8, Du - 25, tz[1] - 18, tz[1], PINE), sh2 = p(22, W - 22, 8, Du - 25, tz[2] - 18, tz[2], PINE);
      u.surface('c3', 'Chatol 3', 'shelf', 22, W - 22, 8, Du - 25, zs, tz[1] - 18 - zs, floor);
      u.surface('c2', 'Chatol 2', 'shelf', 22, W - 22, 8, Du - 25, tz[1], tz[2] - 18 - tz[1], sh1);
      u.surface('c1', 'Chatol 1', 'shelf', 22, W - 22, 8, Du - 25, tz[2], tz[3] - tz[2], sh2);
      p(22, W - 22, 0, Du, zc - 20, zc, PINE);
      // the doors' tops make one arch over both, 90 mm higher in the middle than at the sides
      const arch = a => 1655 + 90 * (1 - Math.pow((a - W / 2) / (W / 2 - 22), 2));
      const along = (a0, a1, f, n = 12) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([a, f(a)]); } return o; };
      const FR = 45;
      [[22, W / 2 - 1.5], [W / 2 + 1.5, W - 22]].forEach(([a0, a1]) => {
        const outer = [[a0, zs], [a1, zs]].concat(along(a1, a0, arch)), hole = [[a0 + FR, zs + FR], [a1 - FR, zs + FR]].concat(along(a1 - FR, a0 + FR, a => arch(a) - FR));
        cut(u, 'az', outer, Du - 22, 22, PINE, 2, [hole]);
        glass(u, hole, Du - 18);
        // lead lines: two upright and six across, on the outside of the glass
        const gw = a1 - a0 - 2 * FR, top = Math.min(arch(a0 + FR), arch(a1 - FR)) - FR;
        [1, 2].forEach(k => { const a = a0 + FR + gw * k / 3; p(a - 1.5, a + 1.5, Du - 12, Du - 9, zs + FR, arch(a) - FR, [C.lead], false); });
        for (let k = 1; k <= 6; k++) { const zz = zs + FR + (top - zs - FR) * k / 6.6; p(a0 + FR, a1 - FR, Du - 12, Du - 9, zz - 1.5, zz + 1.5, [C.lead], false); }
      });
      knob(u, W / 2, (zs + zc) / 2, IRON, Du, KNOB.small);
      // the board over the doors and the cornice: flat along the sides, rising in an arch over the front
      const lift = a => { const t = Math.min(1, Math.max(0, 1 - Math.abs(a - W / 2) / (W / 2 - 60))); return 65 * t * t * (3 - 2 * t); };
      cut(u, 'az', along(22, W - 22, arch, 24).concat(along(W - 22, 22, a => zc + lift(a), 24)), Du - 22, 22, PINE);
      p(0, W, 0, Du - 22, zc, zc + 45, PINE);  // the top of the cabinet
      const CROWN = [[0, 0], [6, 0], [6, 0], [6, 5], [14, 10], [24, 19], [32, 30], [35, 37], [35, 45], [35, 45], [0, 45]];
      sweep(u, CROWN, [[0, 0], [0, Du]], zc, PINE); sweep(u, CROWN, [[W, Du], [W, 0]], zc, PINE);
      cut(u, 'az', along(-35, W + 35, a => zc + lift(a), 32).concat(along(W + 35, -35, a => zc + 45 + lift(a), 32)), Du - 22, 57, PINE, 8);
      turned(u, [[0, 0], [9, 0], [12, 8], [7, 18], [10, 26], [6, 36], [0, 40]], PINE, W / 2, Du + 20, zc + 45 + 65 - 30);  // the finial at the top of the arch
      return u.done();
    });
    types.chatol.build('chatol', 'Chatol', { cx: room.w - 450 / 2, cy: 7838 - 30 - 940 - 40 - 970 / 2, z: 0, rot: 90 });

    // ---------- the KALLAX: 2 x 2 cubes, 77 x 39 x 77 cm ----------
    // its boards in the black-brown foil with a faint grain, the edges rounded 2 mm outside and 1 mm inside
    def('K', 'KALLAX, 2 × 2', (key, name, at) => {
      const W = 770, D = 390, H = 770, o = 39, i = 16, K = [C.kallax, 'kallax'], cw = (W - 2 * o - i) / 2, ch = (H - 2 * o - i) / 2;
      const u = piece(key, name, W, D, H, 'floor', at), p = u.part;
      p(0, o, 0, D, 0, H, K, true, 2); p(W - o, W, 0, D, 0, H, K, true, 2);
      const bottom = p(o, W - o, 0, D, 0, o, K, true, 2), top = p(o, W - o, 0, D, H - o, H, K, true, 2), mid = p(o, W - o, 0, D, o + ch, o + ch + i, K, true, 1);
      p(o + cw, o + cw + i, 0, D, o, H - o, K, true, 1);
      // numbered like the bookcases: the top row first, then right to left as seen from the front
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const a0 = o + c * (cw + i), z = r ? o + ch + i : o;
        u.surface('r' + r + 'c' + c, 'K' + ((1 - r) * 2 + c + 1), 'shelf', a0, a0 + cw, 2, D, z, ch, r ? mid : bottom);
      }
      u.surface('top', 'K top', 'roof', 5, W - 5, 2, D - 2, H, 400, top);
      return u.done();
    }, { short: 'KALLAX' });
    types.K.build('K', 'KALLAX', { cx: 400 + 390 / 2, cy: 1950 + 770 / 2, z: 0, rot: -90 });

    // ---------- the coffee table ----------
    // A black-stained oak top 30 mm thick on a frame of chromed flat bar (photo; sizes estimated): flat legs 40 x 12
    // at the corners, a rail just under the top along each long side, a bar along the floor at each end on two glides.
    def('table', 'Coffee table', (key, name, at) => {
      const W = 1300, D = 700, H = 420, ST = [C.chrome], tz = H - 30, e = 15, bw = 40, bt = 12, gl = 12;
      const u = piece(key, name, W, D, H, 'floor', at), p = u.part;
      const top = p(0, W, 0, D, tz, H, [C.stone, 'blackoak'], true, 2);
      [[e, e], [W - e - bw, e], [e, D - e - bt], [W - e - bw, D - e - bt]].forEach(([a, d]) => p(a, a + bw, d, d + bt, gl, tz, ST, true, 1));
      p(e + bw, W - e - bw, e, e + bt, tz - 30, tz, ST, true, 1); p(e + bw, W - e - bw, D - e - bt, D - e, tz - 30, tz, ST, true, 1);
      [e, W - e - bt].forEach(a => {
        p(a, a + bt, e + bt, D - e - bt, gl, gl + 30, ST, true, 1); p(a, a + bt, e + bt, D - e - bt, tz - 30, tz, ST, true, 1);
        [e + 40, D - e - 40].forEach(d => deco(u, new THREE.CylinderGeometry(mm(14), mm(16), mm(gl), 16), [0x3a3a3c], a + bt / 2, d, gl / 2));
      });
      u.surface('top', 'Coffee table', 'roof', 10, W - 10, 10, D - 10, H, 400, top);
      return u.done();
    });
    types.table.build('table', 'Coffee table', { cx: 1500, cy: 3000, z: 0, rot: -90 });

    // ---------- a book stand: a small easel that shows one book with its cover out ----------
    // 18 x 12 cm, a back leaning 16 degrees and a lip in front, in dark wood. It stands on a shelf, a table or the top
    // of a bookcase (mount 'shelf'), not on the floor. A book put on it leans against the back, cover out; the
    // surface's lean and foot (how far out from the back the leaning back meets the base) tell the game how.
    def('stand', 'Book stand', (key, name, at) => {
      const W = 180, D = 120, base = 8, lip = 12, lean = 16, foot = D - lip - 45, len = 140, th = lean * Math.PI / 180, WOOD = [C.walnut, 'walnut'];
      const u = piece(key, name, W, D, base + Math.ceil(len * Math.cos(th)) + 2, 'shelf', at), p = u.part;
      const plate = p(0, W, 0, D, 0, base, WOOD);
      p(0, W, D - lip, D, base, base + 14, WOOD);  // the lip the book stands against
      p(W / 2 - 8, W / 2 + 8, 8, 34, base, 100, WOOD);  // the prop behind the back
      const back = addMesh(new THREE.BoxGeometry(mm(W - 20), mm(len), mm(6)), C.walnut, 'shelf', null, 'walnut', u.frame);
      boardUV(back.geometry, [W - 20, len, 6], TEX.walnut.size);
      back.rotation.x = th;  // its top towards the back
      back.position.set(mm(W / 2), mm(base + len / 2 * Math.cos(th) - 3 * Math.sin(th)), -mm(foot) + mm(len / 2 * Math.sin(th) + 3 * Math.cos(th)));
      back.userData.unit = u.id;
      const st = { size: [mm(W - 20), mm(len), mm(6)], pos: new THREE.Vector3(), quat: new THREE.Quaternion() }; statics.push(st); back.userData.static = st;
      const s = u.surface('rest', 'Stand ' + key.replace(/^stand/, ''), 'stand', 10, W - 10, 5, D - lip, base, 400, plate);
      s.lean = lean; s.foot = foot;
      return u.done();
    }, { series: 'Book stand ', prefix: 'stand', from: 1 });
  };
})(window);
