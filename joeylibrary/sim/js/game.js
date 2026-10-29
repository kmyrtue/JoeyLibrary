// The walkable room with books you can take out, carry, snap onto a shelf or drop.
// A placed book is described in its bookcase's frame (mm): surf = the board it stands on ('B:fixed', 'B:d2', ...),
// a = centre across the shelf, zb = height of its underside, inset = how far its front face is behind the shelf's front edge,
// flat = lying down, fore = fore-edge out instead of spine out, over = turned over, face = turned a quarter so the front
// cover faces out, yaw and lean = degrees it is turned round (seen from above) and leant back (Ctrl + mouse); a book on
// a book stand leans back against it, cover out. In the database zb is kept as zr,
// the height above the board, so a book moves with its shelf when the shelf is moved.
(function () {
  const S = window.Store, B = window.Books, $ = id => document.getElementById(id);
  const stage = $('stage'), cv = $('cv'), tip = $('tip');
  if (!window.THREE) { tip.textContent = 'Three.js did not load.'; return; }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); }
  catch (e) { $('start').innerHTML = '<span>This browser cannot show 3D (WebGL is off).</span>'; return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 80);
  const R = buildRoom(THREE, scene, renderer), mm = R.mm;
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ---------- physics ----------
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0); world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true;
  world.solver.iterations = 14; world.defaultContactMaterial.friction = 0.55; world.defaultContactMaterial.restitution = 0.05;
  const staticBody = new Map();
  function addStatic(s) {
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)));
    b.position.copy(s.pos); b.quaternion.copy(s.quat); world.addBody(b); staticBody.set(s, b);
  }
  function removeStatic(s) { const b = staticBody.get(s); if (b) { world.removeBody(b); staticBody.delete(s); } }
  R.statics.forEach(addStatic);
  function bodyFor(it, mass) {
    const sz = it.sz, b = new CANNON.Body({ mass, linearDamping: 0.05, angularDamping: 0.15, sleepSpeedLimit: 0.05, sleepTimeLimit: 0.6 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(mm(sz.w) / 2, mm(sz.h) / 2, mm(sz.t) / 2)));
    b.position.copy(it.mesh.position); b.quaternion.copy(it.mesh.quaternion);
    world.addBody(b); it.body = b; it.dyn = mass > 0; it.age = 0; it.was = null; it.awake = 0; ofBody.set(b, it);
    // a falling book that hits a resting one hard enough knocks it loose
    if (it.dyn) b.addEventListener('collide', e => { const o = ofBody.get(e.body); if (o && !o.dyn && !o.place && o !== held && b.velocity.length() > 0.8) o.thaw = true; });
    return b;
  }
  const ofBody = new WeakMap();
  function dropBody(it) { if (it.body) { world.removeBody(it.body); it.body = null; it.dyn = false; } }
  // a book lying loose (on the floor, a heap, a table) that has come to rest becomes a fixed body like the shelved ones,
  // because a heap of boxes in cannon.js never quite stops creeping; it is made movable again when something disturbs it
  function freeze(it) { const f = pose(it.mesh); dropBody(it); bodyFor(it, 0); S.savePlace(it.id, withParcel(it, { free: f })); }
  function thaw(it) { it.thaw = false; if (it.dyn || it.place || held === it || !items.has(it.id)) return; dropBody(it); bodyFor(it, massOf(it.sz)); }
  const pose = m => [m.position.x, m.position.y, m.position.z, m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w].map(v => +v.toFixed(5));
  const massOf = sz => Math.max(0.08, sz.w * sz.h * sz.t * 0.7e-6);

  // ---------- orientation and fitting ----------
  function basis(o) {
    const bx = new THREE.Vector3(0, 0, o.fore ? -1 : 1);
    let by, bz;
    if (o.flat) { bz = new THREE.Vector3(0, o.over ? -1 : 1, 0); by = new THREE.Vector3().crossVectors(bz, bx); }
    else { by = new THREE.Vector3(0, o.over ? -1 : 1, 0); bz = new THREE.Vector3().crossVectors(bx, by); }
    const m = new THREE.Matrix4().makeBasis(bx, by, bz);
    if (!o.face && !o.yaw && !o.lean) return m;
    // turned round, then leant back (the top towards the back of the shelf); cover out is a quarter turn before both
    const r = new THREE.Matrix4().makeRotationY((o.yaw || 0) * Math.PI / 180).multiply(new THREE.Matrix4().makeRotationX((o.lean || 0) * Math.PI / 180));
    if (o.face) r.multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    return r.multiply(m);
  }
  // the way a book is turned, as a place keeps it (the angles only when it has them)
  function orient(o, flat) {
    const p = { flat: flat === undefined ? !!o.flat : flat, fore: !!o.fore, over: !!o.over };
    if (o.face) p.face = true;
    if (o.yaw) p.yaw = o.yaw;
    if (o.lean) p.lean = o.lean;
    return p;
  }
  // book stands standing on a board, and the room one takes up there (its own frame turned by on.rot)
  const standsOn = id => R.units.filter(u => u.mount === 'shelf' && !u.gone && u.on && u.on.surf === id);
  function standBox(u, on) {
    const t = (on.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    const ew = c * u.W + s * u.D, ed = s * u.W + c * u.D;
    return { a0: on.a - ew / 2, a1: on.a + ew / 2, d0: on.d - ed / 2, d1: on.d + ed / 2, ew, ed };
  }
  function extents(sz, o) {
    const m = basis(o).elements, dims = [sz.w, sz.h, sz.t], e = [0, 0, 0];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) e[r] += Math.abs(m[c * 4 + r]) * dims[c];
    return { x: e[0], y: e[1], z: e[2] };
  }
  const GAP = 0.6, SNAP = 25, INSET = 10;
  const overlap = (a0, a1, b0, b1) => a0 < b1 - 0.01 && b0 < a1 - 0.01;
  // where a book with orientation o can go on surface s (within range = [a from, a to]), nearest to aWant; stackOn = a lying book to put it on top of.
  // A book on a pile may be bigger than the one below and need not be centred on it: its middle only has to rest on it.
  function solve(it, o, s, aWant, stackOn, range) {
    if (s.lean) return onStand(it, s);
    const ex = extents(it.sz, o);
    let zb = s.z, iLo = -ex.z / 3, iHi = s.d1 - s.d0 - ex.z, sup = null;
    if (stackOn) {
      zb = stackOn.box.z1; sup = [stackOn.box.a0, stackOn.box.a1];
      iLo = Math.max(iLo, s.d1 - stackOn.box.d1 - ex.z / 2); iHi = Math.min(iHi, s.d1 - stackOn.box.d0 - ex.z / 2);
    }
    const inset = Math.max(iLo, Math.min(iHi, o.inset));
    const d = s.d1 - inset - ex.z / 2;
    const place = Object.assign({ surf: s.id, a: aWant, zb, inset }, orient(o));
    if (zb + ex.y > s.z + s.clear - 1) return { place, ex, bad: 'Too tall for this shelf' + (o.flat ? '' : ' (R lays it down)') };
    const obs = [];
    standsOn(s.id).forEach(u => {  // a book stand on the board is in the way like a book
      const b = standBox(u, u.on);
      if (overlap(s.z, s.z + u.H, zb, zb + ex.y) && overlap(b.d0, b.d1, d - ex.z / 2, d + ex.z / 2)) obs.push([b.a0, b.a1]);
    });
    items.forEach(b => {
      if (b === it || !b.box || b.place.surf !== s.id) return;
      if (overlap(b.box.z0, b.box.z1, zb, zb + ex.y) && overlap(b.box.d0, b.box.d1, d - ex.z / 2, d + ex.z / 2)) obs.push([b.box.a0, b.box.a1]);
    });
    const lo = Math.max(s.a0, range ? range[0] : s.a0) + ex.x / 2, hi = Math.min(s.a1, range ? range[1] : s.a1) - ex.x / 2;
    const free = c => c >= lo - 0.01 && c <= hi + 0.01 && (!sup || (c >= sup[0] && c <= sup[1])) &&
      obs.every(([o0, o1]) => c + ex.x / 2 <= o0 + 0.01 || c - ex.x / 2 >= o1 - 0.01);
    const cands = [aWant, lo, hi].concat(...obs.map(([o0, o1]) => [o0 - GAP - ex.x / 2, o1 + GAP + ex.x / 2]));
    if (sup) cands.push(Math.max(sup[0], Math.min(sup[1], aWant)), (sup[0] + sup[1]) / 2);
    let c = null;
    cands.filter(free).forEach(k => { if (c === null || Math.abs(k - aWant) < Math.abs(c - aWant)) c = k; });
    if (c === null) return { place, ex, bad: 'No room here' };
    if (!stackOn) {  // close a small gap to the neighbour or the side of the bookcase
      const left = Math.max(s.a0, ...obs.filter(([, o1]) => o1 <= c).map(([, o1]) => o1)), right = Math.min(s.a1, ...obs.filter(([o0]) => o0 >= c).map(([o0]) => o0));
      const gl = c - ex.x / 2 - left, gr = right - (c + ex.x / 2);
      if (gl < SNAP && gl <= gr) c -= gl - (left === s.a0 ? 0 : GAP); else if (gr < SNAP) c += gr - (right === s.a1 ? 0 : GAP);
    }
    place.a = c;
    return { place, ex };
  }
  // a book on a book stand: in the middle, cover out, its back against the stand's back leaning at the stand's angle
  function onStand(it, s) {
    const o = { face: true, lean: s.lean }, ex = extents(it.sz, o), th = s.lean * Math.PI / 180;
    const place = Object.assign({ surf: s.id, a: (s.a0 + s.a1) / 2, zb: s.z, inset: s.d1 - (s.foot + it.sz.t * Math.cos(th)) }, orient(o));
    if (ex.y > s.clear - 1) return { place, ex, bad: 'Too tall to stand here' };
    if ([...items.values()].some(b => b !== it && b.box && b.place.surf === s.id)) return { place, ex, bad: 'There is a book on this stand already' };
    return { place, ex };
  }
  // world pose and occupied box of a placed book
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  function poseOf(it, p) {
    const s = R.surfaces[p.surf], fr = R.units[s.unit].frame, ex = extents(it.sz, p), d = s.d1 - p.inset - ex.z / 2;
    const pos = new THREE.Vector3(mm(p.a), mm(p.zb + ex.y / 2), -mm(d)).applyMatrix4(fr.matrixWorld);
    const q = fr.quaternion.clone().multiply(_q.setFromRotationMatrix(basis(p)));
    return { pos, q, box: { a0: p.a - ex.x / 2, a1: p.a + ex.x / 2, z0: p.zb, z1: p.zb + ex.y, d0: d - ex.z / 2, d1: d + ex.z / 2 } };
  }

  // places as the database keeps them: height above the board instead of above the floor; places saved before the
  // shelves could be moved name the board by number
  function toStore(p) { const q = Object.assign({}, p, { zr: +(p.zb - R.surfaces[p.surf].z).toFixed(2) }); delete q.zb; return q; }
  function fromStore(p) {
    if (!p || p.free) return p;
    let surf = p.surf, zr = p.zr;
    if (typeof surf === 'number') { const l = R.legacy[surf]; if (!l) return null; surf = l.id; zr = p.zb - l.z; }
    const s = R.surfaces[surf]; if (!s) return null;
    const q = Object.assign({}, p, { surf, zb: s.z + (zr || 0) }); delete q.zr; return q;
  }
  // a book still in its mailer is saved with parcel: true, so it is still unopened after a reload
  const withParcel = (it, p) => (it.parcel ? Object.assign(p, { parcel: true }) : p);
  const savePlace = (it, p) => S.savePlace(it.id, withParcel(it, toStore(p)));

  // ---------- books ----------
  const items = new Map();  // id -> {id, mesh, sz, place, box, body, dyn, held}
  const crtMat = new THREE.MeshBasicMaterial({ color: 0x020803, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  function makeMesh(b) {
    const mesh = B.makeBook(THREE, b, { load: loader, anisotropy: aniso, px: 2 });
    mesh.userData.id = b.id; mesh.userData.tex = mesh.material;
    mesh.userData.flat = new THREE.MeshLambertMaterial({ color: b.spineColor || '#777' });
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x7dffa8 }));
    e.visible = false; mesh.add(e); mesh.userData.edges = e;
    applyLook(mesh); scene.add(mesh);
    return mesh;
  }
  function ensure(id) {
    const b = S.books.get(id); if (!b) return null;
    let it = items.get(id);
    if (!it) { const mesh = makeMesh(b); it = { id, mesh, sz: mesh.userData.size, place: null, box: null, body: null }; items.set(id, it); }
    return it;
  }
  function rebuild(id) {
    const it = items.get(id), b = S.books.get(id);
    if (!it) { if (b) { ensure(id); autoPlace(items.get(id)); } return; }
    if (opening && opening.it === it) return;
    const was = it.parcel; if (was) unwrap(it);
    const old = it.mesh; it.mesh = makeMesh(b); it.sz = it.mesh.userData.size;
    it.mesh.position.copy(old.position); it.mesh.quaternion.copy(old.quaternion);
    scene.remove(old); B.disposeBook(old);
    if (was) wrap(it);
    if (held === it) return;
    if (it.place) { const p = it.place; unplace(it); const r = solve(it, p, R.surfaces[p.surf], p.a, null); if (r.bad) autoPlace(it); else { setPlace(it, r.place); keep(it); } }
    else if (it.body) { const dyn = it.dyn; dropBody(it); bodyFor(it, dyn ? massOf(it.sz) : 0); }
  }
  function removeItem(id) {
    const it = items.get(id); if (!it) return;
    if (held === it) held = null;
    if (opening && opening.it === it) endOpen();
    if (it.parcel) unwrap(it);
    unplace(it); dropBody(it); scene.remove(it.mesh); B.disposeBook(it.mesh); items.delete(id);
  }
  function unplace(it) { it.place = null; it.box = null; dropBody(it); }
  function setPlace(it, p) {
    dropBody(it);
    const ps = poseOf(it, p);
    it.place = p; it.box = ps.box; it.mesh.position.copy(ps.pos); it.mesh.quaternion.copy(ps.q);
    bodyFor(it, loose ? massOf(it.sz) : 0);
  }
  function setFree(it, f) {
    unplace(it);
    it.mesh.position.set(f[0], f[1], f[2]); it.mesh.quaternion.set(f[3], f[4], f[5], f[6]);
    bodyFor(it, 0);
  }

  // default layout: like a library, sorted by author, filling the eye-level shelves of the corner bookcase first and
  // finishing each shelf with a small pile of books lying down
  let ORDER;
  // finishing with the shelves of the other furniture (not the tops of chests and tables)
  const reorder = () => {
    const billy = R.surfList().filter(s => R.units[s.unit].kind === 'billy');
    ORDER = [1, 0, 3, 2].flatMap(u => billy.filter(s => s.unit === u && s.z > 300 && s.z < 1800).sort((a, b) => b.z - a.z))
      .concat(billy.filter(s => s.z <= 300 || (s.z >= 1800 && s.clear < 400)))
      .concat(R.units.filter(u => u.kind !== 'billy' && !u.gone).flatMap(u => u.surfs.filter(s => s.kind === 'shelf')));
  };
  reorder();
  function autoPlace(it) {
    for (const s of ORDER) {
      // seen from the room, a runs from right to left, so a shelf fills from a1 down, leaving room for a pile at a0
      let r = solve(it, { inset: INSET }, s, s.a1, null, [s.a1 - s.a0 > 600 ? s.a0 + 200 : s.a0 + 30, s.a1]);
      if (r.bad) {
        const pile = [...items.values()].filter(b => b.place && b.place.surf === s.id && b.place.flat)
          .sort((a, b) => b.box.z1 - a.box.z1)[0];
        if (pile && pile.box.z1 - s.z < 120) r = solve(it, { flat: true, inset: INSET }, s, pile.place.a, pile);
        else r = solve(it, { flat: true, inset: INSET }, s, s.a0, null);
      }
      if (!r.bad) { setPlace(it, r.place); keep(it); return true; }
    }
    // no room anywhere: on the floor in front of the bookcases
    setFree(it, [1.2 + Math.random() * 0.6, mm(it.sz.t) / 2 + 0.002, -1.2 - Math.random() * 0.6, ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * 3)).toArray()]);
    keep(it);
    return false;
  }
  // A book the room put somewhere by itself is saved there too, so the shelves look the same next time even when
  // books are added or moved in between. While many books are laid out at once they are saved in one go.
  let batch = null;
  function keep(it) {
    if (!S.live) return;  // the saved places are not loaded yet; the layout is done again when they are
    const p = it.place ? toStore(it.place) : { free: pose(it.mesh) };
    withParcel(it, p);
    if (batch) batch[it.id] = p; else S.savePlace(it.id, p);
  }
  const surname = b => (b.author || '').split(/\s+/).filter(Boolean).pop() || '';
  // byAuthor (Reset the shelves): every opened book goes back on the shelves by author, even in the library
  function layoutAll(byAuthor) {
    // in the library nothing is laid out until the saved places are known, so no book is ever put on a shelf by itself
    if (S.lib && !S.live) return;
    items.forEach(it => { if (it !== held) unplace(it); });
    const rest = [], post = [];
    // once the room has been laid out, a book it has never placed is new to the library: it comes in the post.
    // In the library every book without a place in the room comes in the post, the first time the room is opened too,
    // and so does one whose shelf is no longer there. A book opened but not put anywhere goes back on the coffee table.
    const fresh = S.places.size > 0, opened = [];
    S.books.forEach((b, id) => {
      const it = ensure(id); if (it === held) return;
      const saved = S.places.get(id), p = fromStore(saved);
      if (p) (p.parcel ? wrap : unwrap)(it);
      if (p && p.free) setFree(it, p.free);
      else if (p) setPlace(it, p);
      else if (S.lib && !byAuthor && saved && saved.opened) { unwrap(it); opened.push(it); }
      else if (it.parcel || (!byAuthor && S.live && (S.lib || (fresh && !saved)))) post.push(it);
      else rest.push(it);
    });
    batch = {};
    rest.sort((a, b) => { const A = S.books.get(a.id), Bk = S.books.get(b.id); return surname(A).localeCompare(surname(Bk)) || (A.title || '').localeCompare(Bk.title || ''); })
      .forEach(autoPlace);
    post.sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(it => { wrap(it); deliver(it); });
    opened.forEach(deliver);
    if (Object.keys(batch).length) S.savePlaces(batch);
    batch = null;
    status();
  }

  // ---------- parcels ----------
  // A book new to the library arrives in a cardboard mailer (books.js), piled on the coffee table. Pick one up and
  // press O: it is torn open, the cardboard falls away and the book is in your hand.
  function makeParcelMesh(id, bs) {
    const mesh = B.makeParcel(THREE, bs, { anisotropy: aniso });
    mesh.userData.id = id;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), new THREE.LineBasicMaterial({ color: 0x7dffa8 }));
    e.visible = false; mesh.add(e); mesh.userData.edges = e;
    applyLook(mesh); scene.add(mesh);
    return mesh;
  }
  // the book goes into its mailer (and the mailer is what sits on the table, is picked up, falls)
  function wrap(it) {
    if (it.parcel) return;
    if (hover === it) setHover(null);
    const book = it.mesh; scene.remove(book);
    it.mesh = makeParcelMesh(it.id, book.userData.size);
    it.mesh.position.copy(book.position); it.mesh.quaternion.copy(book.quaternion);
    it.book = book; it.parcel = true; it.sz = it.mesh.userData.size;
  }
  // and out of it, where the mailer was
  function unwrap(it) {
    if (!it.parcel) return;
    if (hover === it) setHover(null);
    const box = it.mesh; it.mesh = it.book; it.book = null; it.parcel = false; it.sz = it.mesh.userData.size;
    it.mesh.position.copy(box.position); it.mesh.quaternion.copy(box.quaternion);
    scene.remove(box); B.disposeParcel(box); applyLook(it.mesh); scene.add(it.mesh);
  }
  // on the coffee table, lying flat on the pile in the middle; when that is as high as the table allows, a pile beside it
  function deliver(it) {
    const u = R.units.find(o => o.key === 'table' && !o.gone) || R.units.find(o => o.type === 'table' && !o.gone);
    const s = u && u.surfs.find(o => o.kind === 'roof');
    if (s) {
      const o = { flat: true, inset: 0 }, ex = extents(it.sz, o), mid = (s.a0 + s.a1) / 2;
      o.inset = (s.d1 - s.d0 - ex.z) / 2 + (Math.random() - 0.5) * 16;
      for (const a of [mid, mid - ex.x - 40, mid + ex.x + 40]) {
        const top = [...items.values()].filter(b => b !== it && b.box && b.place.surf === s.id && b.place.flat && b.box.a0 < a && b.box.a1 > a)
          .sort((p, q) => q.box.z1 - p.box.z1)[0];
        const r = solve(it, o, s, a + (Math.random() - 0.5) * 20, top || null);
        if (!r.bad) { setPlace(it, r.place); keep(it); return; }
      }
    }
    // no coffee table, or no room left on it: in neat piles on the floor (a whole library arrives at once the first time)
    const [x, y, z] = floorPile(it);
    setFree(it, [x, y, z, ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.3)).toArray()]);
    keep(it);
  }
  // where the next parcel goes on the floor, in m: on the first pile under 40 cm, the piles taking up free floor
  // nearest the coffee table, out of the way of the furniture and of where you stand at the start
  const PILE = 0.36, PILE_H = 0.4;
  function floorPile(it) {
    const u = R.units.find(o => o.key === 'table' && !o.gone) || R.units.find(o => o.type === 'table' && !o.gone);
    const c = u ? R.atOf(u) : { cx: 1500, cy: 2400 };
    const boxes = R.units.filter(o => !o.gone).map(o => bbox(R.footprint(o, R.atOf(o)).pts)).concat(R.fixedBlocks.map(f => bbox(f.pts)));
    const free = (x, y) => x > 250 && y > 250 && x < R.w - 250 && y < R.L - 250 && Math.hypot(x - START.x * 1000, y + START.z * 1000) > 600
      && !boxes.some(b => x > b.x0 - 220 && x < b.x1 + 220 && y > b.y0 - 220 && y < b.y1 + 220);
    const spots = [];
    for (let r = 0; r <= 12 && spots.length < 400; r++)
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = c.cx + i * PILE * 1000, y = c.cy + j * PILE * 1000;
        if (free(x, y)) spots.push([x / 1000, -y / 1000]);
      }
    const floor = [...items.values()].filter(b => b !== it && b !== held && !b.place);
    for (const [x, z] of spots) {
      const top = floor.filter(b => Math.abs(b.mesh.position.x - x) < PILE / 3 && Math.abs(b.mesh.position.z - z) < PILE / 3)
        .reduce((h, b) => Math.max(h, b.mesh.position.y + mm(b.sz.t) / 2), 0);
      if (top + mm(it.sz.t) <= PILE_H) return [x + (Math.random() - 0.5) * 0.02, top + mm(it.sz.t) / 2 + 0.001, z + (Math.random() - 0.5) * 0.02];
    }
    return [1.2 + Math.random() * 0.6, mm(it.sz.t) / 2 + 0.002, -2.2 - Math.random() * 0.4];  // nowhere left: where they always went
  }
  // the opening, in the hand: the lid is torn up along one side, then the cardboard drops away and fades
  let opening = null;
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  function openParcel(it) {
    const m = B.MAILER, k = 1 / 1000, W = it.sz.w * k, T = it.sz.t * k / 2, L = it.sz.h * k / 2, bd = m.board * k;
    const hb = (it.book.userData.size.h / 2 + m.end) * k;
    const mat = look === 'mCrt' ? new THREE.MeshBasicMaterial({ color: 0x020803, transparent: true })
      : look === 'mFlat' ? new THREE.MeshLambertMaterial({ color: 0x9c6c40, transparent: true })
      : new THREE.MeshStandardMaterial({ map: B.kraft(THREE), roughness: 0.95, transparent: true });
    const g = new THREE.Group(), tray = new THREE.Group(), hinge = new THREE.Group();
    const box = (w, h, d, x, y, z, parent) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); parent.add(b); };
    box(W, 2 * L, bd, 0, 0, -T + bd / 2, tray);  // the bottom, tabs and all
    box(bd, 2 * hb, 2 * T - bd, -W / 2 + bd / 2, 0, 0, tray); box(bd, 2 * hb, 2 * T - bd, W / 2 - bd / 2, 0, 0, tray);  // the sides
    box(W, bd, 2 * T - bd, 0, hb - bd / 2, 0, tray); box(W, bd, 2 * T - bd, 0, -hb + bd / 2, 0, tray);  // the ends
    hinge.position.set(-W / 2, 0, T); tray.add(hinge);
    box(W, 2 * hb, bd, W / 2, 0, -bd / 2, hinge);  // the lid
    const label = it.mesh.userData.deco.children[0].clone(); label.material = label.material.clone(); label.material.transparent = true;
    label.position.set(W / 2, label.position.y, 0.0003); label.visible = look !== 'mCrt'; hinge.add(label);
    g.add(tray); g.add(it.book); it.book.position.set(0, 0, 0); it.book.quaternion.identity(); applyLook(it.book);
    it.mesh.visible = false; scene.add(g); ghost.visible = false; aim = null;
    opening = { it, g, tray, hinge, mat, label, t: 0 };
    status();
  }
  function stepOpen(dt) {
    const o = opening, t = (o.t += dt);
    o.g.position.copy(o.it.mesh.position); o.g.quaternion.copy(o.it.mesh.quaternion); o.g.updateMatrixWorld();
    o.hinge.rotation.y = -2.5 * smooth(t / 0.45);
    const f = smooth((t - 0.5) / 0.55);
    o.tray.position.copy(_v.set(0, -1, 0).applyQuaternion(o.g.quaternion.clone().invert()).multiplyScalar(0.4 * f * f));
    o.mat.opacity = o.label.material.opacity = 1 - f;
    if (t >= 1.1) endOpen();
  }
  function endOpen() {
    const { it, g, tray, mat, label } = opening; opening = null;
    scene.remove(g); g.remove(it.book);
    tray.traverse(m => { if (m.isMesh && m !== label) m.geometry.dispose(); }); mat.dispose(); label.material.dispose();
    it.mesh.visible = true;
    unwrap(it);
    // opened but not put anywhere yet: after a reload it lies on the coffee table (outside the library: on the shelves)
    if (items.has(it.id)) S.savePlace(it.id, { opened: true });
    status();
  }

  // ---------- looks ----------
  function addEdge(p) {
    // a board with rounded edges is outlined as the plain box it fills (furniture.js keeps that box in userData.outline)
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(p.mesh.geometry.userData.outline || p.mesh.geometry, 25),
      new THREE.LineBasicMaterial({ color: p.kind === 'shelf' ? 0x7dffa8 : 0x1fae55, transparent: true, opacity: p.kind === 'ceiling' ? .35 : 1 }));
    e.position.copy(p.mesh.position); e.rotation.copy(p.mesh.rotation); e.visible = false; (p.mesh.parent || scene).add(e); p.edge = e;
  }
  R.parts.forEach(addEdge);
  let look = 'mTex';
  function lookPart(p) { const crt = look === 'mCrt'; p.mesh.material = crt ? crtMat : look === 'mTex' ? p.textured : p.flat; p.edge.visible = crt; }
  const LOOKS = { mTex: 'Textured', mFlat: 'Flat colours', mCrt: 'RobCo terminal' };
  function applyLook(mesh) {
    const crt = look === 'mCrt';
    mesh.material = crt ? crtMat : look === 'mFlat' ? mesh.userData.flat : mesh.userData.tex;
    mesh.userData.edges.visible = crt;
    if (mesh.userData.deco) mesh.userData.deco.visible = !crt;
  }
  function setLook(id) {
    look = id; const crt = id === 'mCrt';
    R.parts.forEach(lookPart);
    items.forEach(it => applyLook(it.mesh));
    scene.background = new THREE.Color(crt ? 0x000000 : 0xdfe6ea);
    stage.classList.toggle('crt', crt);
    Object.keys(LOOKS).forEach(k => $(k).setAttribute('aria-pressed', String(k === id)));
  }
  scene.background = new THREE.Color(0xdfe6ea);
  Object.keys(LOOKS).forEach(k => { $(k).onclick = () => setLook(k); });

  // ---------- player ----------
  const pos = new THREE.Vector3(), START = { x: 1.75, y: 1.6, z: -2.6, yaw: 2.6, pitch: -0.12 };
  let yaw, pitch;
  function home() { pos.set(START.x, START.y, START.z); yaw = START.yaw; pitch = START.pitch; }
  home(); $('mHome').onclick = home;
  const keys = new Set();
  const isDown = () => keys.has('KeyC') || keys.has('AltLeft') || keys.has('AltRight');
  const locked = () => document.pointerLockElement === cv;
  const startBtn = $('start');
  const lock = () => { try { const p = cv.requestPointerLock && cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
  startBtn.addEventListener('click', () => { startBtn.hidden = true; cv.focus(); if (matchMedia('(pointer: fine)').matches) lock(); });
  document.addEventListener('pointerlockchange', () => { if (!locked() && matchMedia('(pointer: fine)').matches) { startBtn.hidden = false; keys.clear(); } });
  document.addEventListener('keydown', e => {
    if (!locked() && document.activeElement !== cv) return;
    // Ctrl is not a game key: with W it closes the tab, with D it bookmarks. The browser never lets a page stop
    // Ctrl+W, Ctrl+T or Ctrl+N, so stop what can be stopped and say so; leaving while walking asks first (below).
    // Ctrl held with a book in the hand: the mouse turns and leans the book (see mousemove)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); keys.clear();
      if (!e.repeat) {
        flashText = e.key === 'Control' && held && !moving ? 'Ctrl + mouse: left and right turns the book round, up and down leans it · T straightens it'
          : 'Ctrl is not used here (Ctrl+W closes the tab) · go down with Alt or C';
        flashUntil = performance.now() + 3500;
      }
      return;
    }
    keys.add(e.code);
    if (e.altKey) e.preventDefault();  // Alt goes down; keep Alt+D, Alt+F and the like from reaching the browser
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    const act = { KeyR: 'turn', KeyF: 'flip', KeyV: 'over', KeyQ: 'face', KeyT: 'straight', KeyZ: 'in', KeyX: 'out', Digit1: 'front', Digit2: 'back', KeyG: 'drop', KeyE: 'edit', Enter: 'use', Delete: 'remove', Backspace: 'remove', KeyO: 'open' }[e.code];
    if (act) { e.preventDefault(); action(act, e.shiftKey); }
  });
  document.addEventListener('keyup', e => { keys.delete(e.code); if (e.key === 'Alt' && (locked() || document.activeElement === cv)) e.preventDefault(); });  // a lone Alt would open the browser menu
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('beforeunload', e => { if (locked() || document.activeElement === cv) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('mousemove', e => {
    if (!locked()) return;
    if (e.ctrlKey && held && !moving) { twist(e.movementX * 0.35, -e.movementY * 0.35); return; }
    yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022));
  });
  cv.addEventListener('mousedown', e => {
    if (!locked()) return;
    e.preventDefault(); action(e.button === 2 ? 'drop' : 'use');
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { if (!locked() || !(held || carry)) return; e.preventDefault(); action(e.deltaY > 0 ? 'in' : 'out', e.shiftKey); }, { passive: false });
  cv.addEventListener('click', () => { if (!locked() && matchMedia('(pointer: fine)').matches) { startBtn.hidden = true; lock(); } });
  let drag = null;  // touch: drag to look
  cv.addEventListener('pointerdown', e => { if (locked() || e.pointerType === 'mouse') return; drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); startBtn.hidden = true; });
  cv.addEventListener('pointermove', e => { if (!drag) return; yaw += (e.clientX - drag[0]) * 0.005; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', () => drag = null); cv.addEventListener('pointercancel', () => drag = null);
  document.querySelectorAll('.pad button').forEach(b => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); keys.add(k); startBtn.hidden = true; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => keys.delete(k)));
  });
  document.querySelectorAll('.touch button').forEach(b => b.addEventListener('click', () => { startBtn.hidden = true; action(b.dataset.act); }));

  // ---------- taking, placing, dropping ----------
  let held = null, hover = null, aim = null, loose = false;
  const hand = { flat: false, fore: false, over: false, face: false, yaw: 0, lean: 0, inset: INSET };
  const ray = new THREE.Raycaster(); ray.far = 3.2;
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, opacity: 0.22, depthWrite: false }));
  const ghostLine = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: 0x4dff88 }));
  ghost.add(ghostLine); ghost.visible = false; scene.add(ghost);
  let shelfParts = R.parts.filter(p => p.kind === 'shelf').map(p => p.mesh);

  function setHover(it) {
    if (hover === it) return;
    if (hover) mats(hover.mesh).forEach(m => m.emissive && m.emissive.setHex(0));
    hover = it;
    if (hover) mats(hover.mesh).forEach(m => m.emissive && m.emissive.setHex(0x2a2a1a));
  }
  const mats = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  function findAim() {
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const meshes = [...items.values()].filter(it => it !== held).map(it => it.mesh);
    const hits = ray.intersectObjects(meshes.concat(shelfParts), false);
    if (!hits.length) return null;
    const h = hits[0], id = h.object.userData.id;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { hit: h, item: id ? items.get(id) : null, n };
  }
  function target(a) {  // where the held book would go, from what the crosshair is on
    if (!a) return null;
    let s = null, stackOn = null;
    if (a.item) {
      if (!a.item.place) return null;
      s = R.surfaces[a.item.place.surf];
      if (a.n.y > 0.7 && !s.lean) { if (a.item.place.flat) stackOn = a.item; else return across(a, s); }
    } else if (a.hit.object.userData.surface !== undefined) {
      s = R.surfaces[a.hit.object.userData.surface];
      if (a.n.y < -0.5) s = R.surfList().filter(o => o.unit === s.unit && o.z < s.z).sort((p, q) => q.z - p.z)[0] || null;
    }
    if (!s) return null;
    const local = R.units[s.unit].frame.worldToLocal(a.hit.point.clone());
    return solve(held, hand, s, local.x * 1000, stackOn);
  }

  // aiming at the top of a standing book: the held book is laid flat across the tops, level with the tallest one under it,
  // and let go to physics, so it tips over or slides off to where it can actually rest
  function across(a, s) {
    const o = Object.assign({}, hand, { flat: true }), ex = extents(held.sz, o);
    const local = R.units[s.unit].frame.worldToLocal(a.hit.point.clone());
    const c = Math.max(s.a0 + ex.x / 2, Math.min(s.a1 - ex.x / 2, local.x * 1000));
    const inset = Math.max(-ex.z / 3, Math.min(s.d1 - s.d0 - ex.z, o.inset)), d = s.d1 - inset - ex.z / 2;
    let zb = s.z;
    items.forEach(b => {
      if (b !== held && b.box && b.place.surf === s.id && overlap(b.box.a0, b.box.a1, c - ex.x / 2, c + ex.x / 2) &&
        overlap(b.box.d0, b.box.d1, d - ex.z / 2, d + ex.z / 2)) zb = Math.max(zb, b.box.z1);
    });
    const place = Object.assign({ surf: s.id, a: c, zb: zb + 1, inset }, orient(o, true));
    if (zb + ex.y > s.z + s.clear - 1) return { place, ex, bad: 'No room above these books' };
    return { place, ex, fall: true };
  }

  function action(act, big) {
    if (moving) { furnAction(act, big); return; }
    if (act === 'remove' || opening) return;
    if (act === 'open') {
      const it = held || hover;
      if (!it || !it.parcel) { flash('Pick up a parcel to open it'); return; }
      if (held !== it) take(it);
      openParcel(it); return;
    }
    if (act === 'edit') { const it = held || hover; if (it && it.parcel) { flash('Open it first: O'); return; } if (it && window.Workshop) { document.exitPointerLock && document.exitPointerLock(); Workshop.open(it.id); } return; }
    if (act === 'use') {
      if (held) {
        if (aim && !aim.bad && aim.fall) {  // laid across standing books: physics decides where it ends up
          const it = held, ps = poseOf(it, aim.place); held = null;
          it.mesh.position.copy(ps.pos); it.mesh.quaternion.copy(ps.q); bodyFor(it, massOf(it.sz)); ghost.visible = false; aim = null;
        } else if (aim && !aim.bad) { const it = held; held = null; setPlace(it, aim.place); savePlace(it, aim.place); ghost.visible = false; aim = null; }
        else flash(aim ? aim.bad : 'Aim at a shelf to put it there, or right-click / G to let go');
      } else if (hover) take(hover);
      status(); return;
    }
    if (act === 'drop') {
      if (!held) return;
      const it = held; held = null; ghost.visible = false; aim = null;
      const b = bodyFor(it, massOf(it.sz)), f = new THREE.Vector3(); camera.getWorldDirection(f);
      b.velocity.set(f.x * 1.2, f.y * 1.2 + 0.3, f.z * 1.2); b.angularVelocity.set(Math.random() - .5, Math.random() - .5, Math.random() - .5);
      status(); return;
    }
    if (!held) return;
    const step = big ? 20 : 5;
    if (act === 'turn') hand.flat = !hand.flat;
    if (act === 'flip') hand.fore = !hand.fore;
    if (act === 'over') hand.over = !hand.over;
    if (act === 'face') hand.face = !hand.face;
    if (act === 'straight') { hand.yaw = 0; hand.lean = 0; hand.twist = null; }
    if (act === 'twist') twist(15, 0);
    if (act === 'lean') twist(0, hand.lean >= 30 ? -hand.lean : 5);
    if (act === 'in') hand.inset += step;
    if (act === 'out') hand.inset -= step;
    if (act === 'front') hand.inset = 0;
    if (act === 'back') hand.inset = 999;
    hand.inset = Math.max(-80, Math.min(400, hand.inset));
    status();
  }
  // turning the book in the hand by degrees (Ctrl + mouse): round, any way, and leant back or forward up to 80 degrees.
  // Square angles and upright hold it a little, so they are easy to find again.
  function twist(dy, dl) {
    const t = hand.twist || (hand.twist = { yaw: hand.yaw || 0, lean: hand.lean || 0 });
    t.yaw = ((t.yaw + dy + 540) % 360) - 180; t.lean = Math.max(-80, Math.min(80, t.lean + dl));
    const sticky = (v, step) => { const k = Math.round(v / step) * step; return Math.abs(v - k) < 4 ? k : Math.round(v); };
    hand.yaw = sticky(t.yaw, 90); hand.lean = sticky(t.lean, 90);
    if (hand.yaw === -180) hand.yaw = 180;
    status();
  }
  function take(it) {
    setHover(null);
    it.from = it.place;
    hand.twist = null;
    if (it.place && R.surfaces[it.place.surf] && R.surfaces[it.place.surf].lean) Object.assign(hand, { face: false, yaw: 0, lean: 0, inset: INSET });  // off a stand: back to how it was held
    else if (it.place) { Object.assign(hand, { flat: it.place.flat, fore: it.place.fore, over: it.place.over, face: !!it.place.face, yaw: it.place.yaw || 0, lean: it.place.lean || 0, inset: Math.min(it.place.inset, 300) }); }
    // loose books lying on top of it fall into the gap
    if (it.body) items.forEach(o => { if (o !== it && !o.place && o.body && o.body.position.y > it.body.position.y && o.body.position.distanceTo(it.body.position) < 0.3) { thaw(o); o.body.wakeUp(); } });
    unplace(it); held = it;
    // lift the books that were lying on it so they don't float
    settlePiles();
  }
  function settlePiles() {
    let moved = true;
    while (moved) {
      moved = false;
      items.forEach(b => {
        if (!b.place || b.place.zb <= R.surfaces[b.place.surf].z + 0.01) return;
        const under = [...items.values()].some(o => o !== b && o.box && o.place.surf === b.place.surf && Math.abs(o.box.z1 - b.place.zb) < 0.5 &&
          overlap(o.box.a0, o.box.a1, b.box.a0, b.box.a1));
        if (!under) {
          const below = Math.max(R.surfaces[b.place.surf].z, ...[...items.values()].filter(o => o !== b && o.box && o.place.surf === b.place.surf &&
            o.box.z1 <= b.place.zb + 0.01 && overlap(o.box.a0, o.box.a1, b.box.a0, b.box.a1) && overlap(o.box.d0, o.box.d1, b.box.d0, b.box.d1)).map(o => o.box.z1));
          const p = Object.assign({}, b.place, { zb: below }); setPlace(b, p); savePlace(b, p); moved = true;
        }
      });
    }
  }
  let flashText = '', flashUntil = 0;
  function flash(t) { flashText = t; flashUntil = performance.now() + 2200; }

  function status() {
    const angle = (hand.yaw ? ` · turned ${hand.yaw}°` : '') + (hand.lean ? ` · leant ${hand.lean > 0 ? 'back' : 'forward'} ${Math.abs(hand.lean)}°` : '');
    $('hudhand').textContent = held ? `${held.parcel ? 'A parcel' : (S.books.get(held.id) || {}).title || ''} · ${hand.flat ? 'lying' : 'upright'} · ${hand.face ? 'cover out' : hand.fore ? 'edges out' : 'spine out'}${angle} · ${Math.round(hand.inset)} mm in` : `${items.size} books`;
  }
  $('mLoose').onclick = () => {
    loose = !loose; $('mLoose').setAttribute('aria-pressed', String(loose));
    items.forEach(it => { if (it.place) setPlace(it, it.place); else if (loose) thaw(it); });  // shelved books become falling bodies, or go back to their places
  };
  // every book falls from the ceiling onto the floor in front of the bookcases, a few at a time, to be put back by hand
  let rainArmed = 0, raining = 0;
  $('mRain').onclick = () => {
    if (performance.now() - rainArmed > 4000) { rainArmed = performance.now(); $('mRain').textContent = 'Click again: every book falls on the floor'; return; }
    rainArmed = 0; $('mRain').textContent = 'Drop every book from the ceiling';
    if (loose) $('mLoose').click();
    const all = [...items.values()].filter(it => it !== held).sort(() => Math.random() - 0.5), run = ++raining;
    let i = 0;
    const next = () => {
      if (run !== raining) return;
      for (let k = 0; k < 3 && i < all.length; k++, i++) {
        const it = all[i]; if (!items.has(it.id) || held === it) continue;
        const all = R.units.filter(o => !o.gone), u = all[Math.floor(Math.random() * all.length)];
        const p = new THREE.Vector3(mm(150 + Math.random() * (u.W - 300)), 0, -mm(u.D + 250 + Math.random() * 700)).applyMatrix4(u.frame.matrixWorld);
        unplace(it);
        it.mesh.position.set(p.x, 2.25 + Math.random() * 0.2, p.z);
        it.mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
        const b = bodyFor(it, massOf(it.sz));
        b.angularVelocity.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
      }
      if (i < all.length) { setTimeout(next, 120); return; }
      status();
      // once the heap has landed, it stays as it lies
      setTimeout(() => { if (run === raining && !loose) all.forEach(it => { if (it.dyn && !it.place && held !== it) freeze(it); }); }, 5000);
    };
    next();
  };
  let resetArmed = 0;
  $('mReset').onclick = async () => {
    if (performance.now() - resetArmed > 4000) { resetArmed = performance.now(); $('mReset').textContent = 'Click again: put every book back by author'; return; }
    resetArmed = 0; $('mReset').textContent = 'Reset the shelves';
    if (opening) { flash('Wait until the parcel is open'); return; }
    // the book in your hand goes back too (left out, it would have no place and come in the post again next time)
    if (held) { held = null; ghost.visible = false; aim = null; }
    raining++; S.clearPlaces(); layoutAll(true);
  };

  // ---------- loop ----------
  function resize() { const rr = stage.getBoundingClientRect(); renderer.setSize(rr.width, rr.height, false); camera.aspect = rr.width / rr.height; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize); resize();
  new ResizeObserver(resize).observe(stage);
  const hud = $('hudpos'), handQ = new THREE.Quaternion(), turnQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let last = performance.now(), frame = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!document.getElementById('vRoom').hidden) {
      const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.2 : 1.6) * dt, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let mx = 0, mz = 0;
      if (keys.has('KeyW')) { mx += fx; mz += fz; } if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyA')) { mx += fz; mz -= fx; } if (keys.has('KeyD')) { mx -= fz; mz += fx; }
      const len = Math.hypot(mx, mz) || 1; pos.x += mx / len * sp; pos.z += mz / len * sp;
      if (keys.has('Space')) pos.y += sp; if (isDown()) pos.y -= sp;
      pos.x = Math.max(0.2, Math.min(mm(R.w) - 0.2, pos.x)); pos.z = Math.min(-0.2, Math.max(-mm(R.L) + 0.2, pos.z));
      pos.y = Math.max(0.3, Math.min(mm(R.slope(pos.x * 1000)) - 0.15, pos.y));
      camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld();

      world.step(1 / 60, dt, 4);
      items.forEach(it => {
        if (it.thaw) thaw(it);
        if (!it.dyn || !it.body) return;
        it.mesh.position.copy(it.body.position); it.mesh.quaternion.copy(it.body.quaternion);
        if (it.body.position.y < -2) { it.body.position.set(1.6, 0.5, -3); it.body.velocity.set(0, 0, 0); }
        // after a few seconds a loose book is damped hard, and once it has barely moved for a second it is fixed where it lies
        const b = it.body;
        if (loose || it.place) return;
        if ((it.age += dt) > 3 && b.linearDamping < 0.9) { b.linearDamping = 0.9; b.angularDamping = 0.9; }
        if (b.sleepState === 2) { freeze(it); return; }
        it.awake = (it.awake || 0) + dt;
        if (!it.was) it.was = { t: 0, p: b.position.clone(), q: b.quaternion.clone() };
        if ((it.was.t += dt) < 1) return;
        const moved = b.position.distanceTo(it.was.p), turned = Math.abs(b.quaternion.x * it.was.q.x + b.quaternion.y * it.was.q.y + b.quaternion.z * it.was.q.z + b.quaternion.w * it.was.q.w);
        const still = (moved < 0.006 && turned > 0.9998) || (it.awake > 4 && moved < 0.03 && turned > 0.999);
        it.was = null;
        if (still) freeze(it);
      });
      const a = moving ? null : findAim();
      if (moving) furnTick();
      else if (held) {
        setHover(null);
        handQ.setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(turnQ).multiply(_q.setFromRotationMatrix(basis(hand)));
        const f = new THREE.Vector3(); camera.getWorldDirection(f);
        held.mesh.position.copy(pos).addScaledVector(f, 0.42).add(_v.set(0, -0.14, 0));
        held.mesh.quaternion.copy(handQ);
        aim = opening ? null : target(a);
        if (opening) stepOpen(dt);
        else if (aim) {
          const ps = poseOf(held, aim.place);
          ghost.visible = true; ghost.position.copy(ps.pos); ghost.quaternion.copy(ps.q);
          ghost.scale.set(mm(held.sz.w), mm(held.sz.h), mm(held.sz.t));
          const col = aim.bad ? 0xff5040 : aim.fall ? 0xffc040 : 0x4dff88; ghost.material.color.setHex(col); ghostLine.material.color.setHex(col);
        } else ghost.visible = false;
      } else setHover(a && a.item ? a.item : null);
      if (++frame % 6 === 0) {
        hud.textContent = `x ${pos.x.toFixed(2)} m · y ${(-pos.z).toFixed(2)} m`;
        const t = performance.now() < flashUntil ? `<span class="bad">${flashText}</span>` : moving ? furnTip() :
          opening ? '' : held ? (held.parcel ? '<b>O</b> open it · ' : '') + (aim ? (aim.bad ? `<span class="bad">${aim.bad}</span>` : '<b>click</b> put it here · wheel deeper/shallower · R lie/stand · F spine/edges · Q cover out · Ctrl+mouse angle') : 'Aim at a shelf · <b>right-click</b> or G lets go') :
          hover && hover.parcel ? '<b>A parcel</b> · a new book · click to pick it up · <b>O</b> open it' :
          hover ? `<b>${esc((S.books.get(hover.id) || {}).title || '')}</b> · ${esc((S.books.get(hover.id) || {}).author || '')}${locText(hover)} · click to take it · E to edit` : '';
        if (tip.innerHTML !== t) tip.innerHTML = t;
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- bookcases ----------
  // move a bookcase's shelves; books on a shelf go with it, books on a shelf that was taken out fall onto the one below,
  // and books that no longer fit under the shelf above are laid down, or moved to another shelf. Returns what happened.
  function applyCase(u, list) {
    const unit = R.units[u], before = new Map(unit.surfs.map(s => [s.id, s.z])), out = { fell: 0, laid: 0, moved: 0 };
    if (unit.gone) return out;
    const res = R.setShelves(u, list);
    if (!res.removed.parts.length && !res.added.parts.length) return out;
    res.removed.statics.forEach(removeStatic); res.added.statics.forEach(addStatic);
    res.removed.parts.forEach(p => { p.edge.parent.remove(p.edge); p.edge.geometry.dispose(); });
    res.added.parts.forEach(p => { addEdge(p); lookPart(p); });
    shelfParts = R.parts.filter(p => p.kind === 'shelf').map(p => p.mesh); unitMeshes = null; reorder();
    if (aim) aim = null;
    const mine = [...items.values()].filter(it => it.place && before.has(it.place.surf)).sort((a, b) => a.place.zb - b.place.zb);
    const fromId = new Map(mine.map(it => [it, it.place.surf]));
    const tooTall = [], down = [];
    mine.forEach(it => {
      const s = R.surfaces[it.place.surf];
      if (!s) { unplace(it); down.push(it); return; }
      const p = Object.assign({}, it.place, { zb: it.place.zb + s.z - before.get(s.id) });
      if (p.zb + extents(it.sz, p).y <= s.z + s.clear - 1) setPlace(it, p); else { unplace(it); tooTall.push([it, s, p]); }
    });
    tooTall.forEach(([it, s, p]) => {
      const r = solve(it, Object.assign({}, p, { flat: true }), s, p.a, null);
      if (!r.bad) { setPlace(it, r.place); out.laid++; } else { autoPlace(it); out.moved++; }
      if (it.place) savePlace(it, it.place);
    });
    // books whose shelf was taken out go onto the next board down (they would fall there), else wherever there is room
    down.forEach(it => {
      const z = before.get(fromId.get(it)), below = unit.surfs.filter(o => o.z < z - 1)[0];
      const p = below && fitOn(it, below);
      if (p) { setPlace(it, p); out.fell++; } else { autoPlace(it); out.moved++; }
      if (it.place) savePlace(it, it.place);
    });
    // loose books lying in or by the bookcase settle again
    const c = new THREE.Vector3(mm(unit.W / 2), 1, -mm(unit.D / 2)).applyMatrix4(unit.frame.matrixWorld);
    items.forEach(it => { if (!it.place && it.body && !it.dyn && Math.hypot(it.mesh.position.x - c.x, it.mesh.position.z - c.z) < 0.9) thaw(it); });
    moveStands(unit);
    return out;
  }
  const caseList = key => { const c = S.cases.get(key); return c && Array.isArray(c.shelves) ? c.shelves : R.BILLY.defaults; };
  // which shelf a book is on: the board it was put on, or for a loose book the board under where it lies
  function locate(it) {
    if (it.place) return it.place.surf;
    if (!it.body) return null;
    for (const u of R.units) {
      if (u.gone) continue;
      const l = u.frame.worldToLocal(it.mesh.position.clone()), a = l.x * 1000, d = -l.z * 1000, z = l.y * 1000;
      if (a < 0 || a > u.W || d < 0 || d > u.D + 30) continue;
      const s = u.surfs.find(o => z >= o.z - 5 && z < o.z + o.clear);
      if (s) return s.id;
    }
    return null;
  }
  const shelfName = id => { const s = R.surfaces[id]; if (!s) return ''; const c = S.cases.get(R.units[s.unit].key); return (c && c.names && c.names[s.sid]) || ''; };
  const locText = it => { const id = locate(it); return id ? ` · <span class="muted">shelf</span> ${esc(R.code(id))}${shelfName(id) ? ' ' + esc(shelfName(id)) : ''}` : ''; };
  // put a book on a given shelf: standing at the first free spot from the right, else on the pile, else lying at the left
  function moveTo(id, surf) {
    const it = ensure(id), s = R.surfaces[surf]; if (!it || !s) return 'No such shelf';
    if (held === it) { held = null; ghost.visible = false; aim = null; }
    const was = it.place, wasFree = !it.place && it.body ? pose(it.mesh) : null;
    unplace(it);
    const p = fitOn(it, s);
    if (!p) { if (was) setPlace(it, was); else if (wasFree) setFree(it, wasFree); status(); return 'there is no room left on ' + R.code(surf); }
    setPlace(it, p); savePlace(it, p); settlePiles(); status();
    return '';
  }
  function fitOn(it, s) {
    let r = solve(it, { inset: INSET }, s, s.a1, null);
    if (r.bad) {
      const pile = [...items.values()].filter(b => b !== it && b.place && b.place.surf === s.id && b.place.flat).sort((a, b) => b.box.z1 - a.box.z1)[0];
      r = pile ? solve(it, { flat: true, inset: INSET }, s, pile.place.a, pile) : r;
      if (r.bad) r = solve(it, { flat: true, inset: INSET }, s, s.a0, null);
    }
    return r.bad ? null : r.place;
  }

  // ---------- moving the furniture ----------
  // In this mode a click picks up the bookcase or piece of furniture under the crosshair. Its outline follows the
  // crosshair over the floor (a shelf on the wall slides along its wall instead), R turns it a quarter, the wheel 5
  // degrees (Shift 1), and a click puts it down where the outline is green. Right-click or G puts it back. Edges snap to
  // the walls and to the furniture next to it. The books on it go with it; loose books near it fall.
  let moving = false, carry = null, furnHover = null, unitMeshes = null;
  const furnRay = new THREE.Raycaster(); furnRay.far = 8;
  const outline = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, opacity: 0.12, depthWrite: false }));
  const outlineLine = new THREE.LineSegments(new THREE.EdgesGeometry(outline.geometry), new THREE.LineBasicMaterial({ color: 0x4dff88 }));
  outline.add(outlineLine); outline.visible = false; scene.add(outline);
  const frontOf = rot => { const t = rot * Math.PI / 180; return [-Math.sin(t), Math.cos(t)]; };  // room x, y
  function pickUnit() {
    if (!unitMeshes) unitMeshes = R.parts.filter(p => p.mesh.userData.unit !== undefined).map(p => p.mesh);
    furnRay.setFromCamera({ x: 0, y: 0 }, camera);
    const h = furnRay.intersectObjects(unitMeshes, false)[0];
    return h ? R.units[h.object.userData.unit] : null;
  }
  function showOutline(u, at, color) {
    outline.visible = true;
    outline.position.set(mm(at.cx), mm((at.z || 0) + u.H / 2), -mm(at.cy)); outline.rotation.set(0, at.rot * Math.PI / 180, 0);
    outline.scale.set(mm(u.W) + 0.01, mm(u.H) + 0.01, mm(u.D) + 0.01);
    outline.material.color.setHex(color); outlineLine.material.color.setHex(color);
  }
  function furnTick() {
    setHover(null); ghost.visible = false;
    if (!carry) { furnHover = pickUnit(); if (furnHover) showOutline(furnHover, R.atOf(furnHover), 0xffffff); else outline.visible = false; return; }
    const at = followAt(); if (at) carry.at = at;
    carry.why = check(carry.u, carry.at);
    showOutline(carry.u, carry.at, carry.why ? 0xff5040 : 0x4dff88);
  }
  function furnTip() {
    if (carry) return (carry.why ? `<span class="bad">${esc(carry.why)}</span>` : `<b>click</b> put ${esc(carry.u.name)} here`) +
      ` · ${carry.u.mount === 'wall' ? 'it slides along the wall' : 'R quarter turn · wheel turn'} · <b>right-click</b> or G ${carry.fresh ? 'leaves it out' : 'puts it back'} · Delete takes it out`;
    return furnHover ? `<b>${esc(furnHover.name)}</b> · click to move it · Delete takes it out of the room` : 'Moving furniture: aim at a bookcase or a piece of furniture';
  }
  const toRoom = v => ({ x: v.x * 1000, y: -v.z * 1000, z: v.y * 1000 });
  function hitPlane() {
    furnRay.setFromCamera({ x: 0, y: 0 }, camera);
    const v = new THREE.Vector3();
    return furnRay.ray.intersectPlane(carry.plane, v) && v.distanceTo(camera.position) < 12 ? toRoom(v) : null;
  }
  // A book stand (mount 'shelf') stands on a board instead of the floor: it is kept as on = {surf, a, d, rot}, the
  // middle of it across and out from the back of the board and its turn on it, and goes with the board when the
  // board or its bookcase is moved. Its room position comes from that.
  function standAt(u, on) {
    on = on || u.on; const s = on && R.surfaces[on.surf]; if (!s) return null;
    const hu = R.units[s.unit], p = new THREE.Vector3(mm(on.a), mm(s.z), -mm(on.d)).applyMatrix4(hu.frame.matrixWorld);
    return { cx: Math.round(p.x * 1000), cy: Math.round(-p.z * 1000), z: +(p.y * 1000).toFixed(1), rot: ((R.atOf(hu).rot + (on.rot || 0) + 540) % 360) - 180 };
  }
  function followStand() {
    const u = carry.u;
    furnRay.setFromCamera({ x: 0, y: 0 }, camera);
    const mine = new Set(u.frame.children);
    const h = furnRay.intersectObjects(shelfParts.concat([...items.values()].map(it => it.mesh)), false).find(x => !mine.has(x.object));
    carry.on = null;
    if (!h) return null;
    let s = null;
    const id = h.object.userData.id;
    if (id) { const it = items.get(id); s = it && it.place ? R.surfaces[it.place.surf] : null; }
    else if (h.object.userData.surface !== undefined) {
      s = R.surfaces[h.object.userData.surface];
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      if (s && n.y < -0.5) s = R.surfList().filter(o => o.unit === s.unit && o.z < s.z).sort((p, q) => q.z - p.z)[0] || null;
    }
    if (!s || s.lean) return null;
    const l = R.units[s.unit].frame.worldToLocal(h.point.clone()), on = { surf: s.id, a: l.x * 1000, d: -l.z * 1000, rot: carry.rot };
    const b = standBox(u, on), clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
    on.a = Math.round(clamp(on.a, s.a0 + b.ew / 2, s.a1 - b.ew / 2)); on.d = Math.round(clamp(on.d, s.d0 + b.ed / 2, s.d1 + 15 - b.ed / 2));
    carry.on = on;
    return standAt(u, on);
  }
  function checkStand(u) {
    const on = carry && carry.u === u ? carry.on : u.on, s = on && R.surfaces[on.surf];
    if (!s) return 'Aim at a shelf, a table or the top of a bookcase';
    const b = standBox(u, on);
    if (b.ew > s.a1 - s.a0 + 1) return 'The shelf is too narrow for it';
    if (b.ed > s.d1 - s.d0 + 16) return 'The shelf is not deep enough for it';
    if (u.H > s.clear - 1) return 'There is not room enough above this shelf';
    if ([...items.values()].some(it => it !== held && it.box && it.place.surf === s.id && overlap(it.box.a0, it.box.a1, b.a0, b.a1) && overlap(it.box.d0, it.box.d1, b.d0, b.d1))) return 'There are books in the way';
    if (standsOn(s.id).some(o => o !== u && (() => { const c = standBox(o, o.on); return overlap(c.a0, c.a1, b.a0, b.a1) && overlap(c.d0, c.d1, b.d0, b.d1); })())) return 'Another book stand is there';
    return '';
  }
  // the stands on a unit's boards go with it; a stand whose board was taken out is taken out with it
  function moveStands(u) {
    R.units.filter(o => o.mount === 'shelf' && !o.gone && o.on && String(o.on.surf).startsWith(u.key + ':')).forEach(o => {
      const at = standAt(o);
      if (at) moveUnit(o, at); else removePiece(o, true);
    });
  }
  function pickUp(u) {
    const from = R.atOf(u), n = frontOf(from.rot);
    carry = { u, from, at: Object.assign({}, from), rot: u.mount === 'shelf' ? (u.on && u.on.rot) || 0 : from.rot, why: '', on: u.on || null };
    if (u.mount === 'wall') {  // the plane of its back
      carry.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(n[0], 0, -n[1]),
        new THREE.Vector3(mm(from.cx - n[0] * u.D / 2), 0, -mm(from.cy - n[1] * u.D / 2)));
    } else carry.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const h = hitPlane();
    carry.off = h ? { x: from.cx - h.x, y: from.cy - h.y, z: (from.z || 0) - h.z } : { x: 0, y: 0, z: 0 };
  }
  function followAt() {
    if (carry.u.mount === 'shelf') return followStand();
    const h = hitPlane(), u = carry.u; if (!h) return null;
    let at;
    if (u.mount === 'wall') {
      const n = frontOf(carry.from.rot);
      at = { cx: h.x + carry.off.x, cy: h.y + carry.off.y, z: h.z + carry.off.z, rot: carry.from.rot };
      const dn = (at.cx - carry.from.cx) * n[0] + (at.cy - carry.from.cy) * n[1]; at.cx -= dn * n[0]; at.cy -= dn * n[1];
    } else at = { cx: h.x + carry.off.x, cy: h.y + carry.off.y, z: carry.from.z || 0, rot: carry.rot };
    return snap(u, at);
  }
  const bbox = pts => ({ x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) });
  const FURN_SNAP = 50;
  function snap(u, at) {
    at.cx = Math.round(at.cx / 5) * 5; at.cy = Math.round(at.cy / 5) * 5; at.z = Math.max(0, Math.round(at.z / 5) * 5);
    const others = R.units.filter(o => o !== u && !o.gone && o.mount !== 'shelf').map(o => ({ o, at: R.atOf(o) }));
    const square = r => Math.abs(r / 90 - Math.round(r / 90)) < 1e-6;
    if (square(at.rot)) {
      const b = bbox(R.footprint(u, at).pts), xs = [0, R.w], ys = [0, R.L];
      others.forEach(({ o, at: oa }) => { if (square(oa.rot)) { const ob = bbox(R.footprint(o, oa).pts); xs.push(ob.x0, ob.x1); ys.push(ob.y0, ob.y1); } });
      R.fixedBlocks.forEach(f => { const fb = bbox(f.pts); xs.push(fb.x0, fb.x1); ys.push(fb.y0, fb.y1); });
      const best = (lo, hi, list) => { let d = FURN_SNAP, s = 0; list.forEach(c => [c - lo, c - hi].forEach(k => { if (Math.abs(k) < d) { d = Math.abs(k); s = k; } })); return s; };
      const n = u.mount === 'wall' ? frontOf(at.rot) : [0, 0];
      if (Math.abs(n[0]) < 0.5) at.cx += best(b.x0, b.x1, xs);  // a shelf on the wall keeps to its wall
      if (Math.abs(n[1]) < 0.5) at.cy += best(b.y0, b.y1, ys);
    }
    if (u.mount === 'wall') {  // level with the shelves next to it
      let d = FURN_SNAP, s = 0;
      others.filter(({ o }) => o.mount === 'wall').forEach(({ o, at: oa }) => [oa.z, oa.z + o.H].forEach(c => [c - at.z, c - at.z - u.H].forEach(k => { if (Math.abs(k) < d) { d = Math.abs(k); s = k; } })));
      at.z += s;
    }
    return at;
  }
  // two convex outlines overlap unless some edge direction separates them
  function overlaps(a, b) {
    for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], nx = q[1] - p[1], ny = p[0] - q[0];
      const pa = a.map(v => v[0] * nx + v[1] * ny), pb = b.map(v => v[0] * nx + v[1] * ny), eps = Math.hypot(nx, ny) * 1;
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
    return true;
  }
  function check(u, at) {
    if (u.mount === 'shelf') return checkStand(u);
    const f = R.footprint(u, at);
    if (f.pts.some(([x, y]) => x < -1 || x > R.w + 1 || y < -1 || y > R.L + 1)) return 'That is through a wall';
    // the ceiling over each corner, a little in from the corner so a back against the low-ceiling wall counts as under the slope
    const inset = ([x, y]) => [x + Math.sign(at.cx - x) * 3, y + Math.sign(at.cy - y) * 3];
    if (f.pts.map(inset).some(([x, y]) => f.z1 > R.ceilingAt(x, y) + 1)) return 'It does not fit under the ceiling there';
    for (const b of R.fixedBlocks) if (f.z0 < b.z1 && overlaps(f.pts, b.pts)) return 'It would stand in ' + b.name;
    if (u.mount === 'wall' && f.z1 > R.win.z0 && f.z0 < R.win.z1 && f.pts.some(p => p[0] < 5) && Math.max(...f.pts.map(p => p[1])) > R.win.y0 && Math.min(...f.pts.map(p => p[1])) < R.win.y1)
      return 'It would hang in front of the window';
    for (const o of R.units) {
      if (o === u || o.gone || o.mount === 'shelf') continue;
      const g = R.footprint(o, R.atOf(o));
      if (f.z0 < g.z1 - 1 && g.z0 < f.z1 - 1 && overlaps(f.pts, g.pts)) return 'It would stand in ' + o.name;
    }
    return '';
  }
  function moveUnit(u, at) {
    const before = new THREE.Vector3(mm(u.W / 2), 0, -mm(u.D / 2)).applyMatrix4(u.frame.matrixWorld);
    R.staticsOf(u).forEach(removeStatic);
    R.placeUnit(u, at);
    R.staticsOf(u).forEach(addStatic);
    const after = new THREE.Vector3(mm(u.W / 2), 0, -mm(u.D / 2)).applyMatrix4(u.frame.matrixWorld), reach = Math.max(u.W, u.D) / 2000 + 0.3;
    const near = p => [before, after].some(c => Math.hypot(p.x - c.x, p.z - c.z) < reach);
    items.forEach(it => {
      if (it === held) return;
      if (it.place) { const s = R.surfaces[it.place.surf]; if (s && s.unit === u.id) setPlace(it, it.place); }
      else if (it.body && !it.dyn && near(it.mesh.position)) thaw(it);
    });
    if (u.mount !== 'shelf') moveStands(u);
  }
  function furnAction(act, big) {
    if (act === 'use') {
      if (!carry) { const u = pickUnit(); if (u) pickUp(u); return; }
      carry.why = check(carry.u, carry.at);  // again: a click can come before the first frame has checked
      if (carry.why) { flash(carry.why); return; }
      const { u, at, on } = carry; carry = null; outline.visible = false;
      if (u.mount === 'shelf') u.on = on;
      moveUnit(u, at);
      saveUnit(u, at);
      renderFurn();
      return;
    }
    if (act === 'remove') {
      const u = carry ? carry.u : furnHover; if (!u) return;
      const fresh = carry && carry.fresh; carry = null; furnHover = null; outline.visible = false;
      removePiece(u, !fresh);
      flash(u.name + ' is out of the room' + (fresh ? '' : ' · ADD OR TAKE OUT FURNITURE puts it back'));
      renderFurn();
      return;
    }
    if (!carry) return;
    if (act === 'drop') {
      const { u, fresh } = carry; carry = null; outline.visible = false;
      if (fresh) { takeOut(u); renderFurn(); }  // it was not in the room before
      return;
    }
    if (carry.u.mount === 'wall') return;
    const step = { turn: 90, in: big ? 1 : 5, out: big ? -1 : -5 }[act];
    if (step) carry.rot = ((carry.rot + step + 540) % 360) - 180;
  }
  function setMoving(on) {
    if (on && held) { flash('Put the book down first'); return; }
    if (carry && carry.fresh) takeOut(carry.u);
    moving = on; carry = null; furnHover = null; outline.visible = false; unitMeshes = null; aim = null;
    $('mFurn').setAttribute('aria-pressed', String(on));
    $('mFurn').textContent = on ? 'Done moving furniture' : 'Move furniture';
  }
  $('mFurn').onclick = () => setMoving(!moving);
  let furnArmed = 0;
  $('mFurnReset').onclick = () => {
    if (performance.now() - furnArmed > 4000) { furnArmed = performance.now(); $('mFurnReset').textContent = 'Click again: every piece back where it was'; return; }
    furnArmed = 0; $('mFurnReset').textContent = 'Furniture back where it was';
    if (carry && carry.fresh) takeOut(carry.u);
    carry = null; outline.visible = false;
    // the room's own pieces only: the ones added stay where they are
    R.units.forEach(u => {
      if (u.copy || !S.furniture.has(u.key)) return;
      if (u.gone) putBack(u, u.home); else moveUnit(u, u.home);
      S.saveFurniture(u.key, null);
    });
    renderFurn();
  };

  // ---------- taking furniture out, putting it back, adding more ----------
  // A piece taken out leaves the room; the books on it go to the other shelves, books lying on it fall. The room's own
  // pieces are saved as {gone: true} and can be put back; an added piece ({of: type, cx, cy, z, rot}) is simply deleted.
  function refreshShelves() { shelfParts = R.parts.filter(p => p.kind === 'shelf').map(p => p.mesh); unitMeshes = null; aim = null; reorder(); }
  function saveUnit(u, at) {
    const home = !u.copy && ['cx', 'cy', 'z', 'rot'].every(k => Math.abs((at[k] || 0) - (u.home[k] || 0)) < 0.5);
    S.saveFurniture(u.key, u.copy ? Object.assign({ of: u.type }, R.atOf(u), u.on ? { on: u.on } : {}) : home ? null : R.atOf(u));
  }
  // taken out by hand, and saved so (save false: a new piece that was never put down)
  function removePiece(u, save) {
    const key = u.key, d = u.copy ? null : Object.assign({ gone: true }, R.atOf(u));
    takeOut(u);
    if (save) S.saveFurniture(key, d);
  }
  function takeOut(u) {
    if (u.gone) return;
    R.units.filter(o => o !== u && o.mount === 'shelf' && !o.gone && o.on && String(o.on.surf).startsWith(u.key + ':')).forEach(o => removePiece(o, true));
    const on = [...items.values()].filter(it => it !== held && it.place && R.surfaces[it.place.surf] && R.surfaces[it.place.surf].unit === u.id);
    on.forEach(unplace);
    R.staticsOf(u).forEach(removeStatic);
    const c = new THREE.Vector3(mm(u.W / 2), 0, -mm(u.D / 2)).applyMatrix4(u.frame.matrixWorld), reach = Math.max(u.W, u.D) / 2000 + 0.3;
    R.detachUnit(u);
    if (u.copy) u.key = '~' + u.id;  // an added piece is gone for good; its name is free for the next one
    refreshShelves();
    batch = {}; on.forEach(autoPlace);
    if (Object.keys(batch).length) S.savePlaces(batch);
    batch = null;
    items.forEach(it => { if (!it.place && it.body && !it.dyn && Math.hypot(it.mesh.position.x - c.x, it.mesh.position.z - c.z) < reach) thaw(it); });
    status();
  }
  function putBack(u, at) {
    if (!u.gone) return;
    R.attachUnit(u);
    R.parts.filter(p => p.mesh.parent === u.frame).forEach(lookPart);
    moveUnit(u, at);
    refreshShelves();
  }
  // a new piece of a type: built, and its books (if it was saved with some on it) put back on it
  function buildCopy(type, key, at) {
    const nm = R.copyName(type, key); if (!nm) return null;
    const n0 = R.parts.length, s0 = R.statics.length;
    const u = R.types[type].build(nm.key, nm.name, at, nm.sfx);
    u.copy = true; u.home = R.atOf(u);
    R.parts.slice(n0).forEach(p => { addEdge(p); lookPart(p); });
    R.statics.slice(s0).forEach(addStatic);
    if (u.kind === 'billy' && S.cases.has(u.key)) applyCase(u.id, caseList(u.key));
    refreshShelves();
    if (placesSeen) S.places.forEach((p, id) => {
      const it = items.get(id); if (!it || it === held || !p || !p.surf || !String(p.surf).startsWith(u.key + ':')) return;
      const q = fromStore(p); if (q) setPlace(it, q);
    });
    return u;
  }
  // somewhere to start carrying a new piece: on the floor in front of you, its front towards you
  function startAt(type) {
    const tpl = R.units.find(o => o.type === type && !o.copy), t = R.types[type], cx = pos.x * 1000, cy = -pos.z * 1000;
    if (tpl && tpl.mount === 'wall') return Object.assign({}, tpl.home, { cy: Math.max(500, Math.min(R.L - 500, cy)) });
    const lx = -Math.sin(yaw), ly = Math.cos(yaw), size = tpl || { D: 500 };
    const r = Math.round((yaw * 180 / Math.PI + 180) / 90) * 90, rot = (((r % 360) + 540) % 360) - 180;
    return { cx: cx + lx * (1100 + size.D / 2), cy: cy + ly * (1100 + size.D / 2), z: 0, rot };
  }
  function carryNew(u) {
    setMoving(true); if (!moving) return;
    pickUp(u); carry.fresh = true;
    flash('Click in the room, then put ' + u.name + ' where the outline is green');
  }
  function addPiece(type) {
    if (held) { flash('Put the book down first'); return; }
    const u = buildCopy(type, null, startAt(type));
    if (!u) { flash('There is no free letter left for another BILLY'); return; }
    carryNew(u); renderFurn();
  }
  function bringBack(u) {
    if (held) { flash('Put the book down first'); return; }
    const d = S.furniture.get(u.key);
    putBack(u, d && d.cx !== undefined ? d : u.home);
    carryNew(u); renderFurn();
  }
  // what the database says about a piece: moved, taken out, added, or nothing (where it was built)
  function furnFromStore(key) {
    const d = S.furniture.get(key);
    let u = R.units.find(o => o.key === key);
    if (carry && carry.u === u) return;
    if (!u) {
      if (d && d.of && R.types[d.of]) { const nu = buildCopy(d.of, key, d); if (nu && d.on) { nu.on = d.on; const a = standAt(nu); if (a) moveUnit(nu, a); } }
      return;
    }
    if (d && d.on) { u.on = d.on; d = Object.assign({}, d, standAt(u) || {}); }
    if (!d) { if (u.copy) takeOut(u); else if (u.gone) putBack(u, u.home); else moveUnit(u, u.home); }
    else if (d.gone) takeOut(u);
    else if (u.gone) putBack(u, d); else moveUnit(u, d);
  }
  // the list under the room: every piece, in or out, and the kinds that can be added
  const furnPanel = $('furnPanel');
  function renderFurn() {
    if (!furnPanel || furnPanel.hidden) return;
    const row = (label, btn, fn) => {
      const r = document.createElement('div'), s = document.createElement('span'), b = document.createElement('button');
      r.className = 'furnrow'; s.textContent = label; b.type = 'button'; b.textContent = btn; b.onclick = fn; r.append(s, b); return r;
    };
    const title = u => u.kind === 'billy' ? 'BILLY ' + R.unitCode(u) + (u.name === 'BILLY ' + u.key ? '' : ' · ' + u.name) : u.name + (R.caseNo(u) >= 0 ? ' · ' + R.unitCode(u) : '');
    const byName = (a, b) => title(a).localeCompare(title(b), undefined, { numeric: true });
    const inRoom = R.units.filter(u => !u.gone).sort(byName), out = R.units.filter(u => u.gone && !u.copy).sort(byName);
    $('furnIn').replaceChildren(...inRoom.map(u => row(title(u), 'Take out', () => {
      if (carry && carry.u === u) { removePiece(u, !carry.fresh); carry = null; outline.visible = false; } else removePiece(u, true);
      renderFurn();
    })));
    $('furnOut').replaceChildren(...(out.length ? out.map(u => row(title(u), 'Put back', () => bringBack(u))) : [Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing taken out.' })]));
    $('furnAdd').replaceChildren(...Object.entries(R.types).map(([type, t]) => row(t.name, 'Add', () => addPiece(type))));
  }
  $('mFurnList').onclick = () => {
    furnPanel.hidden = !furnPanel.hidden;
    $('mFurnList').setAttribute('aria-pressed', String(!furnPanel.hidden));
    renderFurn();
  };

  // ---------- data ----------
  let placesSeen = false;
  S.on((kind, id) => {
    if (kind === 'book') rebuild(id);
    if (kind === 'case' && id === 'labels') R.setLabels(S.cases.get(id));  // how zones, bookcases and shelves are written
    else if (kind === 'case' && id === 'zones') R.setZones(S.cases.get(id));
    else if (kind === 'case') {
      R.setMark(id, (S.cases.get(id) || {}).no);  // a number given to a bookcase or a piece of furniture
      const u = R.units.find(o => o.key === id); if (u && !u.gone && u.kind === 'billy') applyCase(u.id, caseList(id));
    }
    if (kind === 'case') renderFurn();
    if (kind === 'bookGone') removeItem(id);
    if (kind === 'furniture') { furnFromStore(id); renderFurn(); }
    if (kind === 'placesLoaded' && !placesSeen) { placesSeen = true; layoutAll(); }
    if (kind === 'place' && placesSeen && !loose) {  // someone else moved a book
      const it = items.get(id), p = fromStore(S.places.get(id)); if (!it || it === held || !p) return;
      (p.parcel ? wrap : unwrap)(it);
      if (p.free) { if (!it.dyn) setFree(it, p.free); } else if (JSON.stringify(p) !== JSON.stringify(it.place)) setPlace(it, p);
    }
  });
  S.ready.then(() => { layoutAll(); requestAnimationFrame(tick); S.connect(); }).catch(e => { tip.textContent = 'Could not load the books: ' + e.message; });

  window.Game = {
    hold(id) {
      const it = ensure(id); if (!it) return;
      if (held && held !== it) action('drop');
      if (held !== it) take(it);
      status();
    },
    // bookcases: change one's shelves, where a book is, put a book on a shelf
    applyCase, caseList, locate(id) { const it = items.get(id); return it ? locate(it) : null; }, moveTo, shelfName,
    booksOn(surf) { return [...items.values()].filter(it => locate(it) === surf).map(it => it.id); },
    items, R, solve, poseOf, layoutAll, parcels: { wrap, unwrap, deliver, open(id) { const it = items.get(id); if (it && it.parcel) { if (held !== it) take(it); openParcel(it); } }, get opening() { return opening; } }, // used by previews and checks
    lookFrom(x, y, h, yw, pt) { pos.set(mm(x), mm(h), -mm(y)); yaw = yw; pitch = pt; }, furniture: { moveUnit, check, setMoving, pickUp, furnAction, takeOut, putBack, addPiece, bringBack, renderFurn, get carry() { return carry; } },
  };
})();
