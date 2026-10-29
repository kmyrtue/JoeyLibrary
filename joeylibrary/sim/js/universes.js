// Universes: named versions of the room, inside Joey's Library. Each has its own places of books, bookcases, zones
// and furniture, so a layout can be tried out and another picked up again where it was left. The books themselves
// (the workshop) and the book types are the same in all of them. Switching waits for every save to get through,
// tells the library which one the room opens in, and loads the page again in it.
(function () {
  const S = window.Store, $ = id => document.getElementById(id);
  if (!S.lib) return;  // the preview outside the library has one room only
  const bar = $('uniBar'), sel = $('uniSel'), dlg = $('uniDlg'), name = $('uniName'), msg = $('uniMsg');
  const current = () => S.universes.find(u => u.id === S.universe) || { name: '' };

  // shown with the room, the bookcases and the zones; not with the workshop and the book types, which are shared
  const SHOWN = ['vRoom', 'vCases', 'vZones'];
  const viewNow = () => (document.querySelector('.view:not([hidden])') || {}).id;
  const place = () => {
    const hide = !S.universes.length || !SHOWN.includes(viewNow());
    if (bar.hidden !== hide) bar.hidden = hide;  // only on a change: setting it is itself seen by the observer below
  };
  new MutationObserver(place).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });

  function render() {
    sel.replaceChildren(...S.universes.map(u => Object.assign(document.createElement('option'), { value: u.id, textContent: u.name, selected: u.id === S.universe })));
    $('uniDel').disabled = S.universes.length < 2;
    place();
  }

  // a small form in a dialog: resolves with the name typed (or true when there is nothing to type), null if cancelled
  // check(value) returns a promise that throws to keep the dialog open with the reason
  function ask(title, text, value, ok, check) {
    $('uniDlgTitle').textContent = title; $('uniDlgText').textContent = text; $('uniOk').textContent = ok;
    name.hidden = value === null; name.value = value || ''; msg.textContent = '';
    if (document.pointerLockElement) document.exitPointerLock();
    dlg.showModal(); if (!name.hidden) { name.focus(); name.select(); }
    return new Promise(done => {
      const form = dlg.querySelector('form');
      form.onsubmit = async e => {
        if (e.submitter && e.submitter.value === 'cancel') return;  // closes the dialog
        e.preventDefault();
        const v = name.hidden ? true : name.value.trim();
        if (!name.hidden && !v) { msg.textContent = 'Give it a name'; return; }
        $('uniOk').disabled = true;
        try { await check(v); dlg.close(); done(v); } catch (err) { msg.textContent = err.message; } finally { $('uniOk').disabled = false; }
      };
      dlg.onclose = () => done(null);
    });
  }

  // every change made here has to reach the library before the room is loaded again in another version
  async function saved() {
    if (await S.settled(15000)) return;
    throw new Error('Some changes in this universe have not been saved yet (' + ($('dbState').textContent || '') + '). Try again in a moment.');
  }
  // load the page again in the version the library now opens in, in the same view
  function reload() {
    const q = new URLSearchParams(location.search); q.set('view', viewNow() || 'vRoom');
    location.replace(location.pathname + '?' + q + location.hash);
  }
  const unique = base => { let n = base, i = 2; while (S.universes.some(u => u.name.toLowerCase() === n.toLowerCase())) n = base + ' ' + i++; return n; };

  sel.onchange = async () => {
    const id = Number(sel.value);
    if (id === S.universe) return;
    sel.disabled = true;
    try { await saved(); await S.api('POST', 'universes/' + id + '/open'); reload(); }
    catch (e) { sel.value = S.universe; sel.disabled = false; ask('Not switched', e.message, null, 'OK', async () => { }); }
  };
  $('uniCopy').onclick = () => ask('New copy of "' + current().name + '"',
    'A new universe that starts as this one is now: the same places of books, bookcases, zones and furniture. Changes in one do not reach the other.',
    unique(current().name + ' (copy)'), 'Make the copy',
    async v => { await saved(); await S.api('POST', 'universes', { name: v, copyOf: S.universe }); reload(); });
  $('uniNew').onclick = () => ask('New empty universe',
    'A new universe with the furniture where it was built and the bookcases as they came. Every book arrives in a parcel on the coffee table, to be opened and put on a shelf by hand.',
    unique('New room'), 'Make it',
    async v => { await saved(); await S.api('POST', 'universes', { name: v, copyOf: null }); reload(); });
  $('uniRename').onclick = () => ask('Rename "' + current().name + '"', 'The new name of this universe.', current().name, 'Rename',
    async v => {
      await S.api('PUT', 'universes/' + S.universe, { name: v });
      current().name = v.replace(/\s+/g, ' '); render();
    });
  $('uniDel').onclick = () => {
    if (S.universes.length < 2) return;
    ask('Delete "' + current().name + '"?',
      'Where every book stands in this universe, its bookcases, zones and furniture are forgotten for good. The books themselves, their looks and the book types are not touched, and the other universes stay as they are.',
      null, 'Delete it',
      async () => { await saved(); await S.api('DELETE', 'universes/' + S.universe); reload(); });
  };

  S.ready.then(render).catch(() => { });
})();
