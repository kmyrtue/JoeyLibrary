// Book formats and 3D book meshes, shared by the room and the book workshop.
// Book-local axes: X = cover width (spine at -X, fore-edge at +X), Y = height (top at +Y), Z = thickness (front cover at +Z).
// All sizes in mm.
(function (g) {
  // w x h is the trim size of the page block. Hardcover boards stand 3 mm proud of it at the top, bottom and fore-edge.
  // leaf = thickness of one sheet (two pages), measured from listed thicknesses of real books.
  const FORMATS = [
    { id: 'us-mm', kind: 'paperback', region: 'US', name: 'Mass market (rack size)', w: 106, h: 175, leaf: 0.095,
      note: '4¼ × 6⅞ in. The supermarket and airport rack paperback; cheap, slightly yellow paper.' },
    { id: 'us-mm-tall', kind: 'paperback', region: 'US', name: 'Premium mass market (tall)', w: 106, h: 190, leaf: 0.095,
      note: '4¼ × 7½ in. Same width, taller; common at Tor, Bantam and Del Rey since the 2000s. A publisher habit, not a formal standard.' },
    { id: 'us-tpb', kind: 'paperback', region: 'US', name: 'Trade paperback', w: 140, h: 216, leaf: 0.11,
      note: '5½ × 8½ in. The "trade edition": better paper, same page size as many hardcovers.' },
    { id: 'us-tpb-lg', kind: 'paperback', region: 'US', name: 'Trade paperback, large', w: 152, h: 229, leaf: 0.11,
      note: '6 × 9 in. Same page size as the standard US hardcover.' },
    { id: 'us-gn', kind: 'paperback', region: 'US', name: 'Comic / graphic novel trade', w: 168, h: 258, leaf: 0.1,
      note: '6⅝ × 10³⁄₁₆ in. Collected comics such as Watchmen and The Sandman.' },
    { id: 'us-hc', kind: 'hardcover', region: 'US', name: 'Hardcover 6 × 9', w: 152, h: 229, leaf: 0.115,
      note: '6 × 9 in pages, about 6¼ × 9¼ in over the boards. The usual US novel hardcover.' },
    { id: 'us-hc-sm', kind: 'hardcover', region: 'US', name: 'Hardcover 5½ × 8¼', w: 140, h: 210, leaf: 0.115,
      note: 'Smaller hardcover used for shorter novels.' },
    { id: 'uk-a', kind: 'paperback', region: 'UK', name: 'A-format (pocket)', w: 111, h: 178, leaf: 0.095,
      note: '111 × 178 mm. The British mass-market paperback.' },
    { id: 'uk-b', kind: 'paperback', region: 'UK', name: 'B-format', w: 129, h: 198, leaf: 0.1,
      note: '129 × 198 mm. The everyday British novel paperback.' },
    { id: 'uk-c', kind: 'paperback', region: 'UK', name: 'C-format (trade / airport export)', w: 135, h: 216, leaf: 0.11,
      note: '135 × 216 mm. Trade paperback; also the "export" or "airport" edition sold before the small paperback comes out.' },
    { id: 'uk-hb-demy', kind: 'hardcover', region: 'UK', name: 'Hardback, Demy', w: 138, h: 216, leaf: 0.115,
      note: '138 × 216 mm pages. The common British fiction hardback.' },
    { id: 'uk-hb-royal', kind: 'hardcover', region: 'UK', name: 'Hardback, Royal', w: 156, h: 234, leaf: 0.115,
      note: '156 × 234 mm pages. Bigger fiction and most non-fiction hardbacks.' },
    { id: 'dk-a', kind: 'paperback', region: 'DK', name: 'A-format (pocket / billigbog)', w: 115, h: 185, leaf: 0.095,
      note: '115 × 185 mm. Danish pocket books vary; there is no fixed pocket size.' },
    { id: 'dk-b', kind: 'paperback', region: 'DK', name: 'B-format (paperback)', w: 125, h: 200, leaf: 0.1,
      note: '125 × 200 mm. The usual Danish paperback.' },
    { id: 'dk-c', kind: 'paperback', region: 'DK', name: 'C-format (hæftet)', w: 138, h: 220, leaf: 0.11,
      note: '138 × 220 mm. Fiction and smaller textbooks with a soft cover.' },
    { id: 'dk-hc-c', kind: 'hardcover', region: 'DK', name: 'Indbundet, C-format', w: 138, h: 220, leaf: 0.115,
      note: '138 × 220 mm pages. The usual Danish hardback novel.' },
    { id: 'dk-hc-d', kind: 'hardcover', region: 'DK', name: 'Indbundet, D-format', w: 155, h: 230, leaf: 0.115,
      note: '155 × 230 mm pages. Larger hardbacks and illustrated books.' },
  ];
  const FMT = {}; FORMATS.forEach(f => FMT[f.id] = f);
  const BOARD = 2.8, SQUARE = 3, SOFT = 0.35;

  // outer size of a book: measured if we have it, else from its format and page count
  function bookSize(b) {
    const f = FMT[b.format] || FMT['us-tpb'], hc = f.kind === 'hardcover';
    const block = Math.max(2, (b.pages || 400) / 2 * f.leaf), cover = hc ? BOARD : SOFT;
    const s = { w: f.w + (hc ? SQUARE : 0), h: f.h + (hc ? 2 * SQUARE : 0), t: block + 2 * cover, hc, cover, square: hc ? SQUARE : 0, f };
    const d = b.size || b.dims;  // size: set in the workshop; dims: measured by Open Library
    if (d) { s.w = +d.w || s.w; s.h = +d.h || s.h; s.t = +d.t || s.t; }
    return s;
  }

  function lum(hex) { const c = parseInt(hex.slice(1), 16); return (0.299 * (c >> 16) + 0.587 * (c >> 8 & 255) + 0.114 * (c & 255)) / 255; }
  function shade(hex, k) {
    const c = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [c >> 16, c >> 8 & 255, c & 255].map(v => f(v).toString(16).padStart(2, '0')).join('');
  }
  // deterministic noise so a book looks the same on every load
  function rng(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; s = s || 7; return () => (s = s * 16807 % 2147483647) / 2147483647; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; }

  // Sprayed edges: colour, pattern and which edges. gilt = metallic gold.
  const SPRAYS = { none: 'Plain pages', solid: 'Solid colour', speckle: 'Speckled', fade: 'Fade to the spine', stars: 'Stars stencil', gilt: 'Gilt (gold foil)' };

  // An edge face of the page block. along = mm along the pages (W or H), across = mm through the book (T).
  // acrossFlip puts the front cover at the far side of the canvas. Pages run parallel to the covers.
  function drawEdge(b, sz, which, px) {
    const top = which !== 'fore', along = top ? sz.w : sz.h, across = sz.t;
    const c = canvas(along * px, across * px), x = c.getContext('2d'), r = rng(b.id + which);
    const e = b.edges || {}, sides = e.sides || ['top', 'fore', 'bottom'], sprayed = e.pattern && e.pattern !== 'none' && sides.includes(which);
    const paper = e.paper || (sz.f.leaf <= 0.095 ? '#e9dfc2' : '#f1ece0');
    const cov = sz.cover * px, sq = sz.square * px, bound = b.spineColor || '#555';
    // covers along both long sides (canvas top and bottom rows = the two covers)
    x.fillStyle = sz.hc ? shade(bound, 0.8) : shade(b.backColor || bound, 1);
    x.fillRect(0, 0, c.width, c.height);
    // page block, recessed behind the hardcover square
    const p0 = cov, p1 = c.height - cov, a0 = top ? cov * 1.2 : sq, a1 = c.width - sq;
    x.fillStyle = sprayed ? (e.pattern === 'gilt' ? '#c9a443' : e.color || '#b0302a') : paper;
    x.fillRect(a0, p0, a1 - a0, p1 - p0);
    // page lines
    const n = Math.max(8, Math.round((p1 - p0) / 1.6));
    for (let i = 0; i < n; i++) {
      const yy = p0 + (i + r()) * (p1 - p0) / n;
      x.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.08})`; x.fillRect(a0, yy, a1 - a0, 0.6 + r() * 0.6);
    }
    if (sprayed) {
      if (e.pattern === 'speckle') for (let i = 0; i < (a1 - a0) * (p1 - p0) / 6; i++) {
        x.fillStyle = r() < 0.5 ? (e.color2 || '#1b1b1b') : shade(e.color || '#b0302a', 1.4);
        x.beginPath(); x.arc(a0 + r() * (a1 - a0), p0 + r() * (p1 - p0), 0.4 + r() * 1.3, 0, 7); x.fill();
      }
      if (e.pattern === 'fade') {
        const gr = top ? x.createLinearGradient(a0, 0, a1, 0) : x.createLinearGradient(0, 0, 0, 1);
        gr.addColorStop(0, paper); gr.addColorStop(1, 'rgba(255,255,255,0)');
        if (top) { x.globalAlpha = 0.85; x.fillStyle = gr; x.fillRect(a0, p0, a1 - a0, p1 - p0); x.globalAlpha = 1; }
      }
      if (e.pattern === 'stars') {
        x.fillStyle = e.color2 || '#f3e6b0';
        for (let i = 0; i < (a1 - a0) * (p1 - p0) / 260; i++) star(x, a0 + r() * (a1 - a0), p0 + r() * (p1 - p0), 1.5 + r() * 3);
      }
      if (e.pattern === 'gilt') for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,240,180,${r() * 0.25})`; x.fillRect(a0 + r() * (a1 - a0), p0, 1 + r() * 3, p1 - p0); }
      // spray bleeds a little into the pages: soft darker line where the colour stops
      x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(a0, p0, a1 - a0, 1); x.fillRect(a0, p1 - 1, a1 - a0, 1);
    }
    if (sz.hc) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(a1, p0, c.width - a1, p1 - p0); if (!top) { x.fillRect(0, p0, a0, p1 - p0); } }
    if (top) return c;
    // the fore-edge face is mapped with thickness across and height up: turn the drawing a quarter
    const t = canvas(c.height, c.width), tx = t.getContext('2d');
    tx.translate(t.width, 0); tx.rotate(Math.PI / 2); tx.drawImage(c, 0, 0);
    return t;
  }
  function star(x, cx, cy, r) {
    x.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; x.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    x.closePath(); x.fill();
  }

  function fitText(x, text, maxW, size, font) {
    let s = size; x.font = `${font.replace('$', s)}`;
    while (s > 6 && x.measureText(text).width > maxW) { s -= 1; x.font = `${font.replace('$', s)}`; }
    return s;
  }
  // spine: title and author running top to bottom, as on English and Danish books
  function drawSpine(b, sz, px) {
    const c = canvas(sz.t * px, sz.h * px), x = c.getContext('2d'), col = b.spineColor || '#40506a', ink = lum(col) > 0.55 ? '#141414' : '#f6f1e6';
    x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    if (sz.hc) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 0, c.width, 6 * px); x.fillRect(0, c.height - 6 * px, c.width, 6 * px); }
    x.save(); x.translate(c.width / 2, 0); x.rotate(Math.PI / 2);
    x.fillStyle = ink; x.textBaseline = 'middle';
    const room = c.height * 0.94, lane = c.width * 0.78;
    const title = b.title || 'Untitled', author = (b.author || '').split(/[ ,]+/).filter(Boolean).pop() || '';
    const ts = fitText(x, title, room * 0.68, Math.min(lane * 0.62, 11 * px), '700 $px Georgia, serif');
    x.textAlign = 'left'; x.fillText(title, c.height * 0.04, 0);
    fitText(x, author.toUpperCase(), room * 0.24, Math.min(lane * 0.5, ts * 0.8), '600 $px Arial, sans-serif');
    x.textAlign = 'right'; x.fillText(author.toUpperCase(), c.height * 0.96, 0);
    x.restore();
    return c;
  }
  function drawBack(b, sz, px) {
    const c = canvas(sz.w * px, sz.h * px), x = c.getContext('2d'), col = b.backColor || '#40506a', ink = lum(col) > 0.55 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.6)';
    x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = ink; const r = rng(b.id + 'back');
    for (let i = 0; i < 12; i++) x.fillRect(c.width * 0.12, c.height * (0.2 + i * 0.035), c.width * (0.6 + r() * 0.16), Math.max(1, px * 1.2));
    x.fillStyle = '#fff'; x.fillRect(c.width * 0.55, c.height * 0.82, c.width * 0.36, c.height * 0.12);
    x.fillStyle = '#000'; for (let i = 0; i < 40; i++) if (r() > 0.35) x.fillRect(c.width * (0.57 + i * 0.008), c.height * 0.835, Math.max(1, px * 0.5), c.height * 0.07);
    return c;
  }

  // The colour along the spine edge of a cover picture, for books that have no spine colour of their own (autoColor).
  const sampled = new Map();
  function spineColorOf(image) {
    const c = canvas(16, 64), x = c.getContext('2d');
    x.drawImage(image, 0, 0, Math.max(1, image.width * 0.06), image.height, 0, 0, 16, 64);
    let d; try { d = x.getImageData(0, 0, 16, 64).data; } catch (e) { return null; }  // a picture from another site
    let r = 0, g = 0, bl = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
    const n = d.length / 4, hex = v => Math.round(v / n).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(bl);
  }

  // One box, six materials in BoxGeometry order: +X fore, -X spine, +Y top, -Y bottom, +Z front, -Z back.
  // faces = {front, back, spine, top, bottom, fore}: image urls that replace the generated textures.
  function makeBook(THREE, b, opts) {
    const o = Object.assign({ px: 2, load: null, anisotropy: 4 }, opts), sz = bookSize(b), px = o.px;
    const geo = new THREE.BoxGeometry(sz.w / 1000, sz.h / 1000, sz.t / 1000);
    const tex = c => { const t = new THREE.CanvasTexture(c); t.anisotropy = o.anisotropy; return t; };
    const faces = b.faces || {}, gilt = b.edges && b.edges.pattern === 'gilt';
    const mat = (map, rough, metal) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal || 0 });
    const img = (url, onLoad, onError) => { const t = (o.load || new THREE.TextureLoader()).load(url, onLoad, undefined, onError); t.anisotropy = o.anisotropy; return t; };
    const edgeMat = which => faces[which] ? mat(img(faces[which]), 0.9) : mat(tex(drawEdge(b, sz, which, px)), gilt ? 0.35 : 0.9, gilt ? 0.6 : 0);
    const coverUrl = faces.front || b.cover, drawnFront = () => tex(drawBack(Object.assign({}, b, { backColor: b.spineColor }), sz, px));
    if (b.autoColor && sampled.has(coverUrl)) b.spineColor = b.backColor = sampled.get(coverUrl);
    // a cover that cannot be fetched is drawn instead; one that loads gives an autoColor book its spine colour
    const coverLoaded = t => {
      if (!b.autoColor || sampled.has(coverUrl)) return;
      const col = spineColorOf(t.image); if (!col) return;
      sampled.set(coverUrl, col); b.spineColor = b.backColor = col;
      [[1, () => drawSpine(b, sz, Math.max(3, px * 1.5)), !faces.spine], [5, () => drawBack(b, sz, px * 0.75), !faces.back],
        [0, () => drawEdge(b, sz, 'fore', px), !faces.fore], [2, () => drawEdge(b, sz, 'top', px), !faces.top], [3, () => drawEdge(b, sz, 'bottom', px), !faces.bottom]]
        .forEach(([i, draw, drawn]) => { if (drawn) { mats[i].map.dispose(); mats[i].map = tex(draw()); mats[i].needsUpdate = true; } });
    };
    const front = coverUrl ? mat(img(coverUrl, coverLoaded, () => { front.map.dispose(); front.map = drawnFront(); front.needsUpdate = true; }), 0.55) : mat(drawnFront(), 0.55);
    const mats = [edgeMat('fore'), faces.spine ? mat(img(faces.spine), 0.6) : mat(tex(drawSpine(b, sz, Math.max(3, px * 1.5))), 0.6),
      edgeMat('top'), edgeMat('bottom'), front, faces.back ? mat(img(faces.back), 0.6) : mat(tex(drawBack(b, sz, px * 0.75)), 0.6)];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.book = b; mesh.userData.size = sz;
    return mesh;
  }
  function disposeBook(mesh) {
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  }

  // ---------- the cardboard book mailer a new book arrives in ----------
  // A flat corrugated tray the size of the book, closed with a few mm to spare at the sides and ends; past the ends the
  // board is pressed down into flat tabs, and a red tear strip runs across the top near one end. Same axes as the book:
  // x across, y along its height, z through it (the label is on +z, over the front cover).
  const MAILER = { side: 6, end: 4, ramp: 14, tab: 24, board: 3 };
  function parcelSize(bs) {
    const m = MAILER;
    return { w: bs.w + 2 * m.side, h: bs.h + 2 * (m.end + m.ramp + m.tab), t: bs.t + 2 * m.board };
  }
  let kraftMap = null;
  function kraft(THREE) {
    if (kraftMap) return kraftMap;
    const c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#946437'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {  // the fibres of the board
      x.strokeStyle = `rgba(${Math.random() < 0.5 ? '96,62,30' : '232,204,160'},${(Math.random() * 0.2).toFixed(3)})`;
      const px = Math.random() * 256, py = Math.random() * 256;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.random() * 12 - 6, py + Math.random() * 3 - 1.5); x.stroke();
    }
    kraftMap = new THREE.CanvasTexture(c); kraftMap.wrapS = kraftMap.wrapT = THREE.RepeatWrapping; kraftMap.repeat.set(6, 6);
    return kraftMap;
  }
  function parcelLabel(px) {
    const c = canvas(64 * px, 40 * px), x = c.getContext('2d'), u = px;
    x.fillStyle = '#f6f4ee'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#222'; x.font = `bold ${5 * u}px sans-serif`; x.fillText('JOEY', 4 * u, 8 * u);
    x.font = `${3 * u}px sans-serif`; x.fillText("Joey's Library", 4 * u, 12.5 * u);
    [16, 19, 22].forEach((y, i) => x.fillRect(4 * u, y * u, (i === 2 ? 22 : 34) * u, 1.2 * u));
    for (let bx = 4 * u; bx < 60 * u; bx += u * (1 + (bx * 7 % 3))) x.fillRect(bx, 27 * u, u * (0.5 + (bx * 13 % 2)), 9 * u);  // a barcode
    x.strokeStyle = '#222'; x.lineWidth = u * 0.6; x.strokeRect(46 * u, 3 * u, 14 * u, 14 * u);
    return c;
  }
  function tearStrip(px, w) {
    const c = canvas(Math.round(w / 2) * px, 6 * px), x = c.getContext('2d');
    x.fillStyle = '#c8392b'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.font = `bold ${3.4 * px}px sans-serif`;
    for (let i = 0, step = 26 * px; i * step < c.width; i++) x.fillText('PULL TO OPEN ›', 2 * px + i * step, 4.3 * px);
    return c;
  }
  // geometry and materials in metres, like the book's; userData as makeBook gives it (size, tex, flat) plus deco
  function makeParcel(THREE, bs, opts) {
    const o = Object.assign({ px: 4, anisotropy: 4 }, opts), m = MAILER, sz = parcelSize(bs), k = 1 / 1000;
    const hb = bs.h / 2 + m.end, L = sz.h / 2, T = sz.t / 2, tab = -T + m.board;
    // the side view: flat underneath, the top pressed down to the tabs past the ends of the book
    const pts = [[-L, -T], [L, -T], [L, tab], [hb + m.ramp, tab], [hb, T], [-hb, T], [-hb - m.ramp, tab], [-L, tab]];
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a * k, b * k))), { depth: sz.w * k, bevelEnabled: false });
    // drawn along y and through z, pulled out along x
    geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -sz.w * k / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    const tex = new THREE.MeshStandardMaterial({ map: kraft(THREE), roughness: 0.95 });
    const mesh = new THREE.Mesh(geo, tex);
    mesh.castShadow = mesh.receiveShadow = true;
    const decal = (c, w, h, y) => {
      const t = new THREE.CanvasTexture(c); t.anisotropy = o.anisotropy;
      const d = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k),
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      d.position.set(0, y * k, (T + 0.3) * k); return d;
    };
    const deco = new THREE.Group();
    const lw = Math.min(100, sz.w * 0.62);
    deco.add(decal(parcelLabel(o.px), lw, lw * 0.62, hb * 0.12));
    deco.add(decal(tearStrip(o.px, sz.w), sz.w + 0.4, 12, -(hb - 24)));
    mesh.add(deco);
    Object.assign(mesh.userData, { size: sz, book: bs, tex, flat: new THREE.MeshLambertMaterial({ color: 0x9c6c40 }), deco, parcel: true });
    return mesh;
  }
  function disposeParcel(mesh) {
    mesh.geometry.dispose(); mesh.userData.tex.dispose(); mesh.userData.flat.dispose();
    mesh.userData.deco.children.forEach(d => { d.geometry.dispose(); d.material.map.dispose(); d.material.dispose(); });
  }

  g.Books = { FORMATS, FMT, SPRAYS, MAILER, bookSize, makeBook, disposeBook, parcelSize, makeParcel, disposeParcel, kraft, drawEdge, drawSpine, drawBack, shade, lum };
})(window);
