// The "Zones" view: bookcases and the other furniture books can go on, gathered into named zones (Fantasy, Sci-fi)
// the way a library has them. A zone has a letter or number of its own, written in front of the bookcase and the
// shelf, so the third shelf in the second bookcase of zone A is A-B3 (or A-02-3, 1-2-3 ...). The bookcases in a
// zone count from the first one in it, in the order shown here. Kept with the bookcases, as 'zones':
// {list: [{id, name, units: [unit key]}]}.
(function () {
  const S = window.Store, $ = id => document.getElementById(id), G = () => window.Game;
  const list = () => G().R.zones.map(z => ({ id: z.id, name: z.name, units: z.units.slice() }));
  const save = l => S.saveCase('zones', { list: l });
  const nameOf = u => (S.cases.get(u.key) || {}).name || u.name;
  const books = u => u.surfs.reduce((n, s) => n + G().booksOn(s.id).length, 0);
  const shelfy = () => G().R.units.filter(u => !u.gone && u.surfs.length);
  function btn(text, fn, label) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn;
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  const move = (arr, i, step) => { const j = i + step; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

  function card(z, zi) {
    const R = G().R, el = document.createElement('div'); el.className = 'card casecard zonecard';
    const head = document.createElement('div'); head.className = 'casehead';
    const letter = document.createElement('span'); letter.className = 'caseletter'; letter.textContent = R.zoneLabel(z);
    const name = document.createElement('input'); name.className = 'casename'; name.value = z.name; name.placeholder = 'Name of the zone, e.g. Fantasy';
    name.setAttribute('aria-label', 'Name of zone ' + R.zoneLabel(z));
    name.addEventListener('change', () => { const l = list(); l[zi].name = name.value.trim(); save(l); });
    head.append(letter, name,
      btn('▲', () => { const l = list(); if (move(l, zi, -1)) save(l); }, 'Move the zone up'),
      btn('▼', () => { const l = list(); if (move(l, zi, 1)) save(l); }, 'Move the zone down'),
      btn('Remove the zone', () => { const l = list(); l.splice(zi, 1); save(l); }));
    el.append(head);
    const units = z.units.map(k => R.units.find(o => o.key === k)).filter(Boolean);
    const tbl = document.createElement('table'); tbl.className = 'shelves zoneunits';
    tbl.innerHTML = '<thead><tr><th>Code</th><th>Bookcase or piece</th><th>Shelves</th><th class="num">Books</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    units.forEach((u, ui) => {
      const tr = document.createElement('tr'), codes = u.surfs.map(s => R.code(s.id));
      tr.innerHTML = `<td><b></b></td><td></td><td class="muted"></td><td class="num">${books(u) || ''}</td><td class="inline"></td>`;
      tr.cells[0].firstChild.textContent = u.gone ? '–' : R.unitCode(u);
      tr.cells[1].textContent = nameOf(u) + (u.gone ? ' (taken out of the room)' : '');
      tr.cells[2].textContent = u.gone ? '' : codes.length > 3 ? codes[0] + ' … ' + codes[codes.length - 1] : codes.join(', ');
      const ki = z.units.indexOf(u.key);
      tr.cells[4].append(
        btn('▲', () => { const l = list(); if (move(l[zi].units, ki, -1)) save(l); }, 'Earlier in the zone'),
        btn('▼', () => { const l = list(); if (move(l[zi].units, ki, 1)) save(l); }, 'Later in the zone'),
        btn('Take out', () => { const l = list(); l[zi].units.splice(ki, 1); save(l); }, 'Take ' + nameOf(u) + ' out of the zone'));
      tb.append(tr);
    });
    tbl.append(tb);
    if (units.length) el.append(tbl);
    else el.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing in this zone yet.' }));
    // add one of the pieces that are in no zone
    const free = shelfy().filter(u => !R.zoneOf(u));
    if (free.length) {
      const row = document.createElement('div'); row.className = 'inline'; row.style.marginTop = '8px';
      const pick = document.createElement('select'); pick.setAttribute('aria-label', 'Add to zone ' + R.zoneLabel(z));
      pick.append(new Option('Add a bookcase or piece to this zone…', ''), ...free.map(u => new Option((R.unitCode(u) ? R.unitCode(u) + ' · ' : '') + nameOf(u), u.key)));
      pick.onchange = () => { if (!pick.value) return; const l = list(); l[zi].units.push(pick.value); save(l); };
      row.append(pick); el.append(row);
    }
    return el;
  }

  function render() {
    if (!G()) return;
    const R = G().R;
    $('fmtZones').value = R.labels.zones;
    $('zoneList').replaceChildren(...R.zones.map(card));
    const free = shelfy().filter(u => !R.zoneOf(u));
    $('zoneFree').textContent = free.length ? free.map(u => (R.unitCode(u) ? R.unitCode(u) + ' ' : '') + nameOf(u)).join(' · ') : 'Everything is in a zone.';
    const z = R.zones.find(o => R.zoneUnits(o).length > 1), u = z && R.zoneUnits(z)[1], s = u && u.surfs.filter(o => o.kind !== 'roof')[2];
    $('zoneEx').textContent = s ? `The third shelf in the second piece of ${z.name || 'zone ' + R.zoneLabel(z)} is ${R.code(s.id)}.` : '';
  }
  $('fmtZones').addEventListener('change', () => S.saveCase('labels', Object.assign({}, G().R.labels, { zones: $('fmtZones').value })));
  $('zoneAdd').onclick = () => {
    const l = list(); l.push({ id: 'z' + Date.now().toString(36), name: $('zoneNew').value.trim(), units: [] });
    $('zoneNew').value = ''; save(l);
  };
  $('zoneNew').addEventListener('keydown', e => { if (e.key === 'Enter') $('zoneAdd').click(); });
  S.on(kind => { if ((kind === 'case' || kind === 'placesLoaded' || kind === 'furniture') && !$('vZones').hidden) render(); });
  window.Zones = { render };
})();
