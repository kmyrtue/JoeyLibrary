// The book workshop: make a book from an ISBN, set its type, size and edges, and straighten photos of its sides
// onto the 3D book. Also switches between the page's three views.
(function () {
  const S = window.Store, B = window.Books, $ = id => document.getElementById(id);
  const msg = (t, bad) => { $('wMsg').textContent = t; $('wMsg').classList.toggle('bad', !!bad); };

  // ---------- views ----------
  function show(view) {
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== view);
    if (document.pointerLockElement) document.exitPointerLock();
    if (view === 'vShop') { renderList(); preview.resize(); shelfPick(); }
    if (view === 'vCases' && window.Cases) Cases.render();
    if (view === 'vZones' && window.Zones) Zones.render();
    window.dispatchEvent(new Event('resize'));
    // inside the library the menu on the left follows the view
    if (S.lib && window.parent !== window) window.parent.postMessage({ type: 'sim-view', view }, location.origin);
  }
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
  window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data && e.data.type === 'sim-show' && $(e.data.view)) show(e.data.view);
  });

  // ---------- form ----------
  const fmtSel = $('fFormat');
  ['US', 'UK', 'DK'].forEach(r => {
    const og = document.createElement('optgroup'); og.label = { US: 'American', UK: 'British', DK: 'Danish' }[r];
    B.FORMATS.filter(f => f.region === r).forEach(f => og.append(new Option(`${f.kind === 'hardcover' ? 'Hardcover' : 'Paperback'} · ${f.name}`, f.id)));
    fmtSel.append(og);
  });
  Object.entries(B.SPRAYS).forEach(([k, v]) => $('fSpray').append(new Option(v, k)));
  const FACES = [['front', 'Front cover', 'top left = top of the spine side'], ['back', 'Back cover', 'top left = top of the fore-edge side'],
    ['spine', 'Spine', 'book standing up, back cover on the left'], ['top', 'Top edge', 'spine on the left, front cover nearest you'],
    ['fore', 'Fore-edge', 'book standing up, front cover on the left'], ['bottom', 'Bottom edge', 'spine on the left, front cover furthest away']];
  FACES.forEach(([k, name]) => {
    const d = document.createElement('div'); d.className = 'face';
    d.innerHTML = `<b>${name}</b><div class="thumb" id="th_${k}"></div><div class="inline"><button type="button" data-photo="${k}">Photo…</button><button type="button" data-clear="${k}">Clear</button></div>`;
    $('faces').append(d);
  });

  let cur = null, dirty = false;
  const blank = () => ({ id: '', isbn: '', title: '', author: '', pages: 320, format: 'dk-b', spineColor: '#2f4a6b', backColor: '#2f4a6b',
    edges: { pattern: 'none', color: '#b0302a', color2: '#1b1b1b', sides: ['top', 'fore', 'bottom'], paper: '#efe8d6' }, faceIds: {}, localFaces: {}, pending: {} });
  function load(b) {
    cur = Object.assign(blank(), JSON.parse(JSON.stringify(Object.assign({}, b, { faces: undefined }))), { pending: {} });
    cur.edges = Object.assign(blank().edges, b.edges || {}); cur.faceIds = Object.assign({}, b.faceIds || {}); cur.localFaces = Object.assign({}, b.localFaces || {});
    $('fIsbn').value = cur.isbn || ''; $('fTitle').value = cur.title || ''; $('fAuthor').value = cur.author || ''; $('fPages').value = cur.pages || '';
    fmtSel.value = cur.format; $('fSpine').value = cur.spineColor; $('fBack').value = cur.backColor;
    const sz = B.bookSize(cur); $('fW').value = round(sz.w); $('fH').value = round(sz.h); $('fT').value = round(sz.t);
    $('fSpray').value = cur.edges.pattern; $('fSprayC').value = cur.edges.color; $('fSprayC2').value = cur.edges.color2; $('fPaper').value = cur.edges.paper;
    $('sTop').checked = cur.edges.sides.includes('top'); $('sFore').checked = cur.edges.sides.includes('fore'); $('sBottom').checked = cur.edges.sides.includes('bottom');
    $('wDelete').hidden = !(cur.id && S.books.has(cur.id)); $('wDelete').textContent = S.base.has(cur.id) ? 'Undo my changes' : 'Delete this book';
    dirty = false; msg(''); refresh(); shelfPick();
  }
  // which shelf the book is on, and a list of every shelf to move it to
  function shelfPick() {
    const G = window.Game, sel = $('wShelf'), id = cur && cur.id;
    if (!G || !sel) return;
    const on = id && G.items.has(id) ? G.locate(id) : null;
    sel.innerHTML = ''; sel.disabled = !id || !S.books.has(id);
    sel.append(new Option(on ? '' : (id ? 'Not on a shelf' : 'Save the book first'), ''));
    [...G.R.units].filter(u => !u.gone).sort((a, b) => a.key.localeCompare(b.key)).forEach(u => {
      const c = S.cases.get(u.key), og = document.createElement('optgroup'); og.label = (G.R.unitCode(u) ? G.R.unitCode(u) + ' · ' : '') + ((c && c.name) || u.name);
      u.surfs.forEach(s => og.append(new Option(G.R.code(s.id) + (G.shelfName(s.id) ? ' · ' + G.shelfName(s.id) : ''), s.id)));
      sel.append(og);
    });
    sel.value = on || '';
    if (on) sel.options[0].remove();
    $('wWhere').textContent = !id ? '' : on ? (G.items.get(id).place ? (G.items.get(id).place.flat ? 'Lying on ' : 'Standing on ') : 'Lying loose on ') + G.R.code(on) + '.' : 'Not on a shelf.';
  }
  $('wShelf').addEventListener('change', e => {
    if (!e.target.value || !cur || !cur.id) return;
    const err = window.Game.moveTo(cur.id, e.target.value);
    shelfPick(); if (err) $('wWhere').textContent = 'It does not fit there: ' + err;
  });
  const round = v => Math.round(v * 10) / 10;
  function readForm() {
    cur.isbn = $('fIsbn').value.replace(/[^0-9Xx]/g, ''); cur.title = $('fTitle').value.trim(); cur.author = $('fAuthor').value.trim();
    cur.pages = +$('fPages').value || null; cur.format = fmtSel.value; cur.spineColor = $('fSpine').value; cur.backColor = $('fBack').value;
    cur.size = { w: +$('fW').value, h: +$('fH').value, t: +$('fT').value };
    cur.edges = { pattern: $('fSpray').value, color: $('fSprayC').value, color2: $('fSprayC2').value, paper: $('fPaper').value,
      sides: [['top', 'sTop'], ['fore', 'sFore'], ['bottom', 'sBottom']].filter(([, id]) => $(id).checked).map(([k]) => k) };
  }
  function autoSize() { const sz = B.bookSize(Object.assign({}, cur, { size: null, dims: null })); $('fW').value = round(sz.w); $('fH').value = round(sz.h); $('fT').value = round(sz.t); }
  document.querySelectorAll('#vShop .form input, #vShop .form select').forEach(el => el.addEventListener('input', () => {
    if (['fFormat', 'fPages'].includes(el.id)) { readForm(); autoSize(); }
    dirty = true; refresh();
  }));
  $('wAuto').onclick = () => { readForm(); autoSize(); dirty = true; refresh(); };
  $('wNew').onclick = () => { load(blank()); $('fIsbn').focus(); };

  function faceUrls() {
    const f = {};
    Object.entries(cur.faceIds).forEach(([k, id]) => { if (id) f[k] = S.photoUrl(id); });
    Object.entries(cur.localFaces).forEach(([k, u]) => { if (u) f[k] = u; });
    Object.entries(cur.pending).forEach(([k, p]) => { f[k] = p.url; });
    return f;
  }
  let timer = 0;
  function refresh() {
    readForm();
    const rec = Object.assign({}, cur, { faces: faceUrls(), id: cur.id || 'new' });
    FACES.forEach(([k]) => { const u = rec.faces[k] || (k === 'front' && rec.cover); $('th_' + k).style.backgroundImage = u ? `url("${u}")` : ''; $('th_' + k).textContent = u ? '' : 'drawn'; });
    const f = B.FMT[cur.format];
    $('wInfo').innerHTML = `<b>${f ? (f.kind === 'hardcover' ? 'Hardcover' : 'Paperback') + ' · ' + f.name : ''}</b><br>${f ? f.note : ''}` +
      (cur.formatHow ? `<br><br>Book type: ${{ measured: 'from the measured size', listed: 'as listed by Open Library', guessed: 'guessed from the publisher and the cover shape' }[cur.formatHow] || cur.formatHow}.` : '') +
      (cur.note ? `<br>${cur.note}` : '');
    clearTimeout(timer); timer = setTimeout(() => preview.set(rec), 120);
  }

  // ---------- list ----------
  function renderList() {
    const q = $('wFind').value.trim().toLowerCase(), list = $('wList'); list.innerHTML = '';
    [...S.books.values()].filter(b => !q || (b.title + ' ' + b.author + ' ' + b.isbn).toLowerCase().includes(q))
      .sort((a, b) => (a.title || '').localeCompare(b.title || '')).slice(0, 200).forEach(b => {
        const bt = document.createElement('button'); bt.type = 'button'; bt.setAttribute('role', 'option');
        const img = (b.faces && b.faces.front) || b.cover;
        bt.innerHTML = `${img ? `<img alt="" src="${img}">` : '<span style="width:22px"></span>'}<span><b></b> · <span class="muted"></span></span>`;
        bt.querySelector('b').textContent = b.title || '(no title)'; bt.querySelector('.muted').textContent = b.author || '';
        bt.onclick = () => load(S.books.get(b.id));
        list.append(bt);
      });
  }
  $('wFind').addEventListener('input', renderList);
  S.on(kind => { if ((kind === 'book' || kind === 'bookGone') && !$('vShop').hidden) renderList(); if (['case', 'place', 'placesLoaded'].includes(kind) && !$('vShop').hidden) shelfPick(); });

  // ---------- ISBN lookup (Open Library) ----------
  $('wLook').onclick = async () => {
    const isbn = $('fIsbn').value.replace(/[^0-9Xx]/g, '');
    if (isbn.length !== 10 && isbn.length !== 13) { msg('An ISBN has 10 or 13 digits.', true); return; }
    const known = [...S.books.values()].find(b => b.isbn === isbn);
    if (known) { load(known); msg('That book is already in the library; here it is.'); return; }
    msg('Looking up ' + isbn + '…');
    if (S.lib) return libLookup(isbn);
    try {
      const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=details`);
      const d = ((await r.json())['ISBN:' + isbn] || {}).details;
      if (!d) { msg('Open Library does not know this ISBN. Fill in the rest by hand and add a photo of the cover.', true); return; }
      cur.isbn = isbn; cur.id = cur.id || isbn;
      $('fTitle').value = d.title || ''; $('fAuthor').value = (d.authors || []).map(a => a.name).join(', ');
      if (d.number_of_pages) $('fPages').value = d.number_of_pages;
      const pf = (d.physical_format || '').toLowerCase();
      if (pf.includes('hardcover')) fmtSel.value = 'us-hc'; else if (pf.includes('mass market')) fmtSel.value = 'us-mm'; else if (pf.includes('paperback')) fmtSel.value = 'us-tpb';
      readForm(); autoSize(); dirty = true;
      if (d.covers && d.covers[0] > 0) {
        try {
          const blob = await (await fetch(`https://covers.openlibrary.org/b/id/${d.covers[0]}-L.jpg`)).blob();
          setPending('front', blob); msg('Found it, with the cover. Check the book type and save.');
        } catch (e) { msg('Found it, but the cover picture could not be fetched here. Take a photo of the cover instead.'); }
      } else msg('Found it, but Open Library has no cover. Take a photo of the cover.');
      refresh();
    } catch (e) {
      msg('This page could not reach Open Library (the browser or the page blocked it). Fill in the book by hand and use photos.', true);
    }
  };

  // inside the library: the library's own lookup, with its API keys, and covers through the library's server
  async function libLookup(isbn) {
    let d;
    try { d = await S.api('GET', 'isbn/' + isbn); } catch (e) { msg('The lookup failed: ' + (e.code || e.message), true); return; }
    if (d.error) { msg(d.error, true); return; }
    if (!d.found) { msg('No book database knows this ISBN. Fill in the rest by hand and add a photo of the cover.', true); return; }
    cur.isbn = isbn; cur.id = cur.id || isbn;
    $('fTitle').value = d.title || ''; $('fAuthor').value = d.author || '';
    if (d.pages) $('fPages').value = d.pages;
    readForm(); autoSize(); dirty = true;
    cur.cover = '/api/sim/cover/' + isbn;
    msg('Found it in ' + d.source + (d.format ? ' (' + d.format + ')' : '') + '. Check the book type and save. If no cover shows, take a photo of it.');
    refresh();
  }

  // ---------- photos ----------
  let photoFace = null;
  $('faces').addEventListener('click', e => {
    const p = e.target.dataset.photo, c = e.target.dataset.clear;
    if (p) { photoFace = p; $('fFile').value = ''; $('fFile').click(); }
    if (c) { delete cur.faceIds[c]; delete cur.localFaces[c]; delete cur.pending[c]; if (c === 'front') cur.cover = ''; dirty = true; refresh(); }
  });
  $('fFile').addEventListener('change', () => { const f = $('fFile').files[0]; if (f) warp.open(f, photoFace); });
  function setPending(k, blob) { if (cur.pending[k]) URL.revokeObjectURL(cur.pending[k].url); cur.pending[k] = { blob, url: URL.createObjectURL(blob) }; dirty = true; }

  // Perspective straightening: four corners in the photo -> a rectangle the size of that side of the book.
  const warp = (function () {
    const dlg = $('warp'), src = $('warpSrc'), out = $('warpOut'), sx = src.getContext('2d'), ox = out.getContext('2d');
    let img = null, pts = null, face = null, dragI = -1, scale = 1;
    function faceMm() {
      readForm(); const s = cur.size;
      return { front: [s.w, s.h], back: [s.w, s.h], spine: [s.t, s.h], fore: [s.t, s.h], top: [s.w, s.t], bottom: [s.w, s.t] }[face];
    }
    function open(file, k) {
      face = k; $('warpFace').textContent = FACES.find(f => f[0] === k)[1].toLowerCase() + ' (' + FACES.find(f => f[0] === k)[2] + ')';
      const im = new Image();
      im.onload = () => { setImage(im); dlg.showModal(); };
      im.src = URL.createObjectURL(file);
    }
    function setImage(im) {
      const k = Math.min(1, 1800 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      img = c; src.width = c.width; src.height = c.height;
      const m = 0.12; pts = [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]].map(([x, y]) => [x * c.width, y * c.height]);
      draw();
    }
    function draw() {
      sx.drawImage(img, 0, 0);
      sx.strokeStyle = '#4dff88'; sx.lineWidth = Math.max(2, img.width / 400);
      sx.beginPath(); pts.forEach(([x, y], i) => i ? sx.lineTo(x, y) : sx.moveTo(x, y)); sx.closePath(); sx.stroke();
      const r = Math.max(8, img.width / 70);
      pts.forEach(([x, y], i) => {
        sx.fillStyle = 'rgba(0,0,0,.6)'; sx.beginPath(); sx.arc(x, y, r, 0, 7); sx.fill();
        sx.fillStyle = '#4dff88'; sx.font = `bold ${r * 1.2}px sans-serif`; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText(i + 1, x, y);
      });
      render();
    }
    // homography from the unit square to the quad (Heckbert's square-to-quad)
    function sq2quad(q) {
      const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
      const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx_ = x0 - x1 + x2 - x3, sy_ = y0 - y1 + y2 - y3;
      let g = 0, h = 0;
      if (Math.abs(sx_) > 1e-9 || Math.abs(sy_) > 1e-9) { const den = dx1 * dy2 - dx2 * dy1; g = (sx_ * dy2 - dx2 * sy_) / den; h = (dx1 * sy_ - sx_ * dy1) / den; }
      return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
    }
    function render(full) {
      const [wm, hm] = faceMm(), px = full ? Math.min(6, 1400 / Math.max(wm, hm)) : Math.min(3, 320 / Math.max(wm, hm));
      out.width = Math.max(4, Math.round(wm * px)); out.height = Math.max(4, Math.round(hm * px));
      const sd = img.getContext('2d').getImageData(0, 0, img.width, img.height).data, od = ox.createImageData(out.width, out.height), o = od.data;
      const [a, b, c, d, e, f, g, h] = sq2quad(pts), W = img.width, H = img.height;
      for (let j = 0; j < out.height; j++) for (let i = 0; i < out.width; i++) {
        const u = (i + 0.5) / out.width, v = (j + 0.5) / out.height, w = g * u + h * v + 1;
        const x = Math.min(W - 1, Math.max(0, (a * u + b * v + c) / w)), y = Math.min(H - 1, Math.max(0, (d * u + e * v + f) / w));
        const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, x1 = Math.min(W - 1, xi + 1), y1 = Math.min(H - 1, yi + 1), k = (j * out.width + i) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const p00 = sd[(yi * W + xi) * 4 + ch], p10 = sd[(yi * W + x1) * 4 + ch], p01 = sd[(y1 * W + xi) * 4 + ch], p11 = sd[(y1 * W + x1) * 4 + ch];
          o[k + ch] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
        }
        o[k + 3] = 255;
      }
      ox.putImageData(od, 0, 0);
    }
    const at = e => { const r = src.getBoundingClientRect(); scale = src.width / r.width; return [(e.clientX - r.left) * scale, (e.clientY - r.top) * scale]; };
    src.addEventListener('pointerdown', e => {
      const p = at(e); let best = -1, bd = 1e9;
      pts.forEach((q, i) => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < bd) { bd = dd; best = i; } });
      if (bd < Math.max(40, img.width / 12)) { dragI = best; src.setPointerCapture(e.pointerId); }
    });
    let raf = 0;
    src.addEventListener('pointermove', e => { if (dragI < 0) return; pts[dragI] = at(e); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
    src.addEventListener('pointerup', () => dragI = -1);
    $('warpRot').onclick = () => {
      const c = document.createElement('canvas'); c.width = img.height; c.height = img.width;
      const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0); setImage(c);
    };
    $('warpCancel').onclick = () => dlg.close();
    $('warpOk').onclick = () => {
      render(true);
      out.toBlob(blob => { setPending(face, blob); if (face === 'front') cur.cover = ''; dlg.close(); refresh(); }, 'image/jpeg', 0.88);
    };
    return { open };
  })();

  // ---------- save ----------
  async function save() {
    readForm();
    if (!cur.title) { msg('Give the book a title first.', true); return null; }
    cur.id = cur.id || cur.isbn || ('b' + Date.now().toString(36));
    try {
      for (const [k, p] of Object.entries(cur.pending)) {
        const r = await S.upload(p.blob);
        if (r.id) { cur.faceIds[k] = r.id; delete cur.localFaces[k]; } else cur.localFaces[k] = r.url;
      }
      cur.pending = {};
      const rec = Object.assign({}, cur); delete rec.pending;
      const saved = await S.saveBook(rec);
      if (saved) cur.id = saved;
      dirty = false; $('wDelete').hidden = false; $('wDelete').textContent = S.base.has(cur.id) ? 'Undo my changes' : 'Delete this book';
      msg(!saved ? 'Kept until you reload this page (saving is not available here).' : S.lib ? 'Saved in the library.' : 'Saved. It is on the shelves for everyone.');
      shelfPick();
      renderList();
      return cur.id;
    } catch (e) { msg('Could not save: ' + (e.code || e.message || e), true); return null; }
  }
  $('wSave').onclick = save;
  $('wHold').onclick = async () => {
    const id = dirty || !S.books.has(cur.id) ? await save() : cur.id;
    if (!id || !window.Game) return;
    show('vRoom'); Game.hold(id);
  };
  let delArmed = 0;
  $('wDelete').onclick = async () => {
    if (performance.now() - delArmed > 4000) { delArmed = performance.now(); msg('Click again to confirm.'); return; }
    delArmed = 0;
    try {
      await S.deleteBook(cur.id);
      const done = S.lib ? 'Back to how the library has it.' : S.base.has(cur.id) ? 'Back to how it came from the list.' : 'Deleted.';
      load(S.books.get(cur.id) || blank()); renderList(); msg(done);
    }
    catch (e) { msg('Could not change it: ' + (e.code || e.message), true); }
  };

  // ---------- 3D preview ----------
  const preview = (function () {
    const cv = $('prev');
    let r; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return { set() {}, resize() {} }; }
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 10), pivot = new THREE.Group(); sc.add(pivot);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.9)); const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(1, 2, 2); sc.add(dl);
    let mesh = null, ry = -0.6, rx = 0.25, drag = null, idle = 0;
    function set(rec) {
      if (mesh) { pivot.remove(mesh); B.disposeBook(mesh); }
      mesh = B.makeBook(THREE, rec, { px: 4, anisotropy: 8 }); pivot.add(mesh);
      const sz = mesh.userData.size, R = Math.hypot(sz.w, sz.h, sz.t) / 1000;
      cam.position.set(0, 0, R * 2.6); cam.lookAt(0, 0, 0);
    }
    function resize() { const w = cv.clientWidth; if (!w) return; r.setSize(w, w * 0.75, false); cam.aspect = 4 / 3; cam.updateProjectionMatrix(); }
    cv.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drag) return; ry += (e.clientX - drag[0]) * 0.01; rx += (e.clientY - drag[1]) * 0.01; drag = [e.clientX, e.clientY]; idle = performance.now(); });
    cv.addEventListener('pointerup', () => drag = null);
    (function loop() {
      if (!$('vShop').hidden) {
        if (!drag && performance.now() - idle > 2500) ry += 0.006;
        pivot.rotation.set(rx, ry, 0); r.render(sc, cam);
      }
      requestAnimationFrame(loop);
    })();
    window.addEventListener('resize', resize);
    return { set, resize };
  })();

  S.ready.then(() => {
    const first = S.lib ? [...S.books.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''))[0] : S.books.get('9780441013593');
    load(first || blank());
    const start = new URLSearchParams(location.search).get('view');
    if (start && start !== 'vRoom' && $(start)) show(start);
  });
  window.Workshop = { open(id) { show('vShop'); const b = S.books.get(id); if (b) load(b); } };
})();
