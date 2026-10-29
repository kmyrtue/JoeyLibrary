// The "Bookcases" view: each BILLY drawn from the front to scale, with the holes its shelves can sit in.
// Click a shelf to pick it, then a hole (or ▲ ▼) to move it; click a hole with nothing picked to add a shelf there.
// Bookcases have a letter (A-D, left to right as seen from the room) and shelves a number from the top, so B3 is the
// third shelf down in bookcase B; both can also be given a name. The other furniture books can go on is listed below
// the bookcases, so its shelves can be named and the piece given a number like a bookcase's.
(function () {
  const S = window.Store, $ = id => document.getElementById(id), G = () => window.Game;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sel = {};  // bookcase letter -> picked shelf id
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cm = v => (v / 10).toFixed(v % 10 ? 1 : 0).replace('.', ',') + ' cm';

  function doc(u) {
    const c = S.cases.get(u.key) || {}, d = { name: c.name || '', names: Object.assign({}, c.names || {}) };
    if (c.no > 0) d.no = c.no;
    if (u.kind === 'billy') d.shelves = (Array.isArray(c.shelves) ? c.shelves : G().R.BILLY.defaults).map(b => Object.assign({}, b));
    return d;
  }
  // a shelf can sit in a hole of its group when no other shelf there is fewer than minHoles holes away
  function fits(u, list, sec, i, except) {
    const BL = G().R.BILLY;
    return i >= 0 && i < BL.groups[sec].n && list.every(b => b.id === except || b.sec !== sec || Math.abs(b.i - i) >= BL.minHoles);
  }
  function commit(u, d, msgText) {
    const out = G().applyCase(u.id, d.shelves);
    S.saveCase(u.key, d);
    const bits = [];
    if (out.fell) bits.push(`${out.fell} book${out.fell > 1 ? 's' : ''} fell onto the shelf below`);
    if (out.laid) bits.push(`${out.laid} too tall now, laid down`);
    if (out.moved) bits.push(`${out.moved} moved to another shelf`);
    render(u.key, [msgText, bits.join(' · ')].filter(Boolean).join('. '));
  }

  function card(u) {
    const el = document.createElement('div'); el.className = 'card casecard'; el.id = 'case_' + u.key;
    const head = `<div class="casehead"><span class="caseletter"></span><input class="casename"><label class="caseno">Number <select></select></label></div>`;
    if (u.kind !== 'billy') el.innerHTML = head + `<div class="msg casemsg" aria-live="polite"></div>
      <table class="shelves"><thead><tr><th>Shelf</th><th>Name</th><th class="num">Height</th><th class="num">Room above</th><th class="num">Books</th></tr></thead><tbody></tbody></table>`;
    else el.innerHTML = head + `
      <div class="casebody"><svg class="casesvg" role="img" tabindex="0"></svg>
      <div class="caseside">
        <div class="inline"><button type="button" data-a="add">Add a shelf</button><button type="button" data-a="up" aria-label="Move the shelf up one hole">▲</button><button type="button" data-a="down" aria-label="Move the shelf down one hole">▼</button><button type="button" data-a="remove">Take it out</button></div>
        <div class="msg casemsg" aria-live="polite"></div>
        <table class="shelves"><thead><tr><th>Shelf</th><th>Name</th><th class="num">Height</th><th class="num">Room above</th><th class="num">Books</th></tr></thead><tbody></tbody></table>
        <div class="inline" style="margin-top:8px"><button type="button" data-a="default">Back to how IKEA ships it</button></div>
      </div></div>`;
    el.querySelector('.casename').placeholder = u.name;
    el.querySelector('.casename').addEventListener('change', e => { const d = doc(u); d.name = e.target.value.trim(); S.saveCase(u.key, d); });
    el.querySelector('.caseno select').addEventListener('change', e => { const d = doc(u); if (+e.target.value) d.no = +e.target.value; else delete d.no; S.saveCase(u.key, d); });
    if (u.kind !== 'billy') return el;
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(u, b.dataset.a));
    el.querySelector('.casesvg').addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); act(u, e.key === 'ArrowUp' ? 'up' : 'down'); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act(u, 'remove'); }
    });
    return el;
  }

  function act(u, a) {
    const BL = G().R.BILLY, d = doc(u), picked = d.shelves.find(b => b.id === sel[u.key]);
    if (a === 'default') { sel[u.key] = null; d.shelves = BL.defaults.map(b => Object.assign({}, b)); commit(u, d, 'Four shelves where IKEA puts them'); return; }
    if (a === 'add') {
      // the middle of the tallest gap that has holes
      let best = null;
      Object.keys(BL.groups).forEach(sec => { for (let i = 0; i < BL.groups[sec].n; i++) if (fits(u, d.shelves, sec, i)) {
        const z = BL.holeZ(sec, i), s = G().R.units[u.id].surfs.find(o => o.z <= z && z < o.z + o.clear);
        const room = s ? Math.min(z - s.z, s.z + s.clear - z) : 0;
        if (!best || room > best.room) best = { sec, i, room };
      } });
      if (!best) { render(u.key, 'There is no free hole left'); return; }
      const id = 's' + Date.now().toString(36).slice(-6);
      d.shelves.push({ id, sec: best.sec, i: best.i }); sel[u.key] = id; commit(u, d, 'Added a shelf'); return;
    }
    if (!picked) { render(u.key, 'Click a shelf in the drawing first'); return; }
    if (a === 'remove') { d.shelves = d.shelves.filter(b => b !== picked); sel[u.key] = null; commit(u, d, 'Shelf taken out'); return; }
    // up/down: the next hole in that direction it can go in, carrying on into the other group past the fixed shelf
    const holes = Object.keys(BL.groups).flatMap(sec => [...Array(BL.groups[sec].n).keys()].map(i => ({ sec, i, z: BL.holeZ(sec, i) }))).sort((p, q) => p.z - q.z);
    const at = holes.findIndex(h => h.sec === picked.sec && h.i === picked.i), step = a === 'up' ? 1 : -1;
    for (let k = at + step; k >= 0 && k < holes.length; k += step) {
      const h = holes[k];
      if (h.sec !== picked.sec && d.shelves.some(b => b !== picked && b.sec === picked.sec && (step > 0 ? b.i > picked.i : b.i < picked.i))) break;  // can't jump past another shelf
      if (fits(u, d.shelves, h.sec, h.i, picked.id)) { picked.sec = h.sec; picked.i = h.i; commit(u, d, ''); return; }
      if (h.sec === picked.sec && d.shelves.some(b => b !== picked && b.sec === h.sec && b.i === h.i)) break;
    }
    render(u.key, a === 'up' ? 'It cannot go higher' : 'It cannot go lower');
  }
  function clickHole(u, sec, i) {
    const d = doc(u), picked = d.shelves.find(b => b.id === sel[u.key]);
    if (!fits(u, d.shelves, sec, i, picked && picked.id)) { render(u.key, 'Too close to another shelf: leave at least one hole between them'); return; }
    if (picked) { picked.sec = sec; picked.i = i; commit(u, d, ''); }
    else { const id = 's' + Date.now().toString(36).slice(-6); d.shelves.push({ id, sec, i }); sel[u.key] = id; commit(u, d, 'Added a shelf'); }
  }

  function draw(u, svg) {
    const R = G().R, BL = R.BILLY, top = BL.H + (u.ext ? BL.E : 0), W = u.W, t = BL.t, Y = z => top - z;
    const L = 190, Rt = 330;  // room for labels left and right; every bookcase drawn to the same scale as an 80 cm one
    svg.setAttribute('viewBox', `${-L} -50 ${800 + L + Rt} ${BL.H + BL.E + 100}`);
    svg.setAttribute('aria-label', `Bookcase ${u.key} seen from the front, with its shelves and holes`);
    const d = doc(u);
    let h = '';
    // carcass: back, sides, the line where the height extension sits
    h += `<rect x="0" y="0" width="${W}" height="${top}" class="cback"/>`;
    h += `<rect x="0" y="0" width="${t}" height="${top}" class="cside"/><rect x="${W - t}" y="0" width="${t}" height="${top}" class="cside"/>`;
    if (u.ext) h += `<line x1="-8" x2="${W + 8}" y1="${Y(BL.H)}" y2="${Y(BL.H)}" class="cjoin"/>`;
    h += `<rect x="${t}" y="${Y(60)}" width="${W - 2 * t}" height="60" class="cside"/>`;
    // holes, and a click target for each
    Object.keys(BL.groups).forEach(sec => { for (let i = 0; i < BL.groups[sec].n; i++) {
      const z = BL.holeZ(sec, i);
      h += `<circle cx="${t + 22}" cy="${Y(z)}" r="5" class="hole"/><circle cx="${W - t - 22}" cy="${Y(z)}" r="5" class="hole"/>`;
      h += `<rect x="${t}" y="${Y(z) - 16}" width="${W - 2 * t}" height="32" class="hit" data-sec="${sec}" data-i="${i}"><title>Hole ${i + 1} ${BL.groups[sec].name}, ${cm(z)} up</title></rect>`;
    } });
    // boards, labels, gaps
    u.surfs.forEach(s => {
      const z0 = s.z - t, adj = s.kind === 'adj', picked = adj && sel[u.key] === s.sid, n = G().booksOn(s.id).length;
      h += `<rect x="${t}" y="${Y(s.z)}" width="${W - 2 * t}" height="${t}" class="board ${adj ? 'adj' : 'fixedb'}${picked ? ' picked' : ''}" ${adj ? `data-shelf="${s.sid}"` : ''}><title>${R.code(s.id)}${adj ? '' : s.kind === 'fixed' ? ': the fixed shelf' : ''}</title></rect>`;
      if (adj) h += `<rect x="${t}" y="${Y(s.z) - 10}" width="${W - 2 * t}" height="${t + 20}" class="hit board-hit" data-shelf="${s.sid}"/>`;
      const name = d.names[s.sid] || (s.kind === 'fixed' ? 'fixed' : s.kind === 'bottom' ? 'bottom' : '');
      h += `<text x="${W + 22}" y="${Y(z0 + t / 2) + 20}" class="lab${picked ? ' on' : ''}"><tspan class="code">${R.code(s.id)}</tspan>${name ? ` <tspan class="nm">${esc(name.length > 14 ? name.slice(0, 13) + '…' : name)}</tspan>` : ''}</text>`;
      if (s.kind !== 'roof' && s.clear > 60) {
        h += `<text x="-16" y="${Y(s.z + s.clear / 2) + 18}" class="gap" text-anchor="end">${cm(s.clear)}</text>`;
        if (n) h += `<text x="${W / 2}" y="${Y(s.z + Math.min(s.clear, 300) / 2) + 18}" class="cnt" text-anchor="middle">${n} book${n > 1 ? 's' : ''}</text>`;
      } else if (s.kind === 'roof' && n) h += `<text x="${W / 2}" y="${Y(s.z) - 14}" class="cnt" text-anchor="middle">${n} on top</text>`;
    });
    h += `<line x1="${-L}" x2="${W + Rt}" y1="${top}" y2="${top}" class="floor"/>`;
    svg.innerHTML = h;
    svg.querySelectorAll('[data-shelf]').forEach(r => r.addEventListener('click', e => { e.stopPropagation(); sel[u.key] = sel[u.key] === r.dataset.shelf ? null : r.dataset.shelf; render(u.key, ''); svg.focus(); }));
    svg.querySelectorAll('.hit[data-sec]').forEach(r => r.addEventListener('click', () => clickHole(u, r.dataset.sec, +r.dataset.i)));
  }

  function table(u, tb) {
    const R = G().R, d = doc(u); tb.innerHTML = '';
    u.surfs.forEach(s => {
      const tr = document.createElement('tr'); if (s.kind === 'adj' && sel[u.key] === s.sid) tr.className = 'on';
      const n = G().booksOn(s.id).length;
      tr.innerHTML = `<td><b>${R.code(s.id)}</b><div class="muted" style="font-size:12px">${{ adj: 'movable', fixed: 'fixed', bottom: 'bottom', top: 'top board', roof: 'on top', shelf: 'shelf' }[s.kind]}</div></td>` +
        `<td><input aria-label="Name of shelf ${R.code(s.id)}" placeholder="name"></td><td class="num">${cm(s.z)}</td><td class="num">${s.kind === 'roof' ? '–' : cm(s.clear)}</td><td class="num">${n || ''}</td>`;
      const inp = tr.querySelector('input'); inp.value = d.names[s.sid] || '';
      inp.addEventListener('change', () => { const dd = doc(u); if (inp.value.trim()) dd.names[s.sid] = inp.value.trim(); else delete dd.names[s.sid]; S.saveCase(u.key, dd); render(u.key, ''); });
      if (s.kind === 'adj') tr.addEventListener('click', e => { if (e.target === inp) return; sel[u.key] = s.sid; render(u.key, ''); });
      tb.append(tr);
    });
  }

  // the number a piece is given: automatic (by its letter, or its place in its zone), or one of the first 40
  function numberPick(u, pick) {
    const R = G().R, d = doc(u), z = R.zoneOf(u), m = R.marks[u.key];
    delete R.marks[u.key];  // what it would be without a number of its own
    const auto = u.kind === 'billy' || z ? 'Automatic: ' + R.caseLabel(u) + (z ? ', its place in ' + (z.name || 'zone ' + R.zoneLabel(z)) : '')
      : 'Own names: ' + R.code(u.surfs[u.surfs.length - 1].id) + ' …';
    if (m) R.marks[u.key] = m;
    const opts = [new Option(auto, '')];
    for (let n = 1; n <= 40; n++) opts.push(new Option(R.numbered(n - 1, R.labels.cases), n));
    pick.replaceChildren(...opts); pick.value = d.no || '';
  }
  function render(key, msgText) {
    if (!G()) return;
    const R = G().R, all = R.units.filter(u => !u.gone && u.surfs.length), units = all.filter(u => u.kind === 'billy').sort((a, b) => a.key.localeCompare(b.key));
    const others = all.filter(u => u.kind !== 'billy').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // a piece added or taken out in the room: the cards are made again
    [[$('caseList'), units], [$('furnCaseList'), others]].forEach(([list, us]) => {
      if ([...list.children].map(c => c.id).join() !== us.map(u => 'case_' + u.key).join()) { list.replaceChildren(); us.forEach(u => list.append(card(u))); }
    });
    // two pieces written the same way
    const codes = new Map(); all.forEach(u => { const c = R.unitCode(u); if (c) codes.set(c, (codes.get(c) || []).concat(u)); });
    units.concat(others).filter(u => !key || u.key === key).forEach(u => {
      const el = $('case_' + u.key), d = doc(u), c = R.unitCode(u), what = u.kind === 'billy' ? 'bookcase' : 'piece', msg = el.querySelector('.casemsg');
      if (document.activeElement !== el.querySelector('.casename')) el.querySelector('.casename').value = d.name;
      el.querySelector('.caseletter').textContent = c; el.querySelector('.caseletter').hidden = !c;
      el.querySelector('.casename').setAttribute('aria-label', 'Name of ' + what + ' ' + (c || u.name));
      el.querySelector('.caseno select').setAttribute('aria-label', 'Number of ' + what + ' ' + (c || u.name));
      numberPick(u, el.querySelector('.caseno select'));
      table(u, el.querySelector('tbody'));
      if (u.kind === 'billy') {
        draw(u, el.querySelector('.casesvg'));
        const picked = d.shelves.find(b => b.id === sel[u.key]);
        el.querySelectorAll('[data-a=up],[data-a=down],[data-a=remove]').forEach(b => b.disabled = !picked);
      }
      const same = (codes.get(c) || []).filter(o => o !== u);
      const warn = same.length ? `Written ${c} like ${same.map(o => (S.cases.get(o.key) || {}).name || o.name).join(', ')}: give one of them another number` : '';
      if (msgText !== undefined || warn) msg.textContent = [msgText, warn].filter(Boolean).join('. ');
      else if (msg.textContent.startsWith('Written ')) msg.textContent = '';
    });
  }
  // how bookcases and shelves are written: kept with the bookcases, as 'labels'
  function showFormat() {
    const l = G().R.labels;
    $('fmtCases').value = l.cases; $('fmtShelves').value = l.shelves;
    const u = G().R.units.find(o => o.key === 'B'), s = u && u.surfs.filter(o => o.kind !== 'roof')[2];
    $('fmtEx').textContent = s ? `The third shelf down in bookcase ${u.key} is ${G().R.code(s.id)}; on top of it is ${G().R.code(u.surfs.find(o => o.kind === 'roof').id)}.` : '';
  }
  ['fmtCases', 'fmtShelves'].forEach(id => $(id).addEventListener('change', () => S.saveCase('labels', Object.assign({}, G().R.labels, { cases: $('fmtCases').value, shelves: $('fmtShelves').value }))));
  S.on((kind, id) => {
    if (kind === 'case' && id === 'labels' && G()) showFormat();
    if ((kind === 'case' || kind === 'placesLoaded' || kind === 'furniture') && !$('vCases').hidden) { render(); showFormat(); }
  });
  window.Cases = { render() { render(...arguments); showFormat(); } };
})();
