// The books and where they stand. The top-100 list ships with the page; books made or changed in the workshop,
// and every placement on the shelves, are kept in this artifact's database so they are the same for everyone.
// Without a database (a local preview) everything still works, but only until the page is reloaded.
// Inside Joey's Library (?lib=1) the books are the library's own, and everything is saved by the library's server in
// the room's own database. Every change is saved the moment it is made: writes go out one at a time in the order they
// were made, and one that fails is tried again until it gets through (the page asks before closing while any wait).

(function (g) {
  const LIB = new URLSearchParams(location.search).has('lib');
  const listeners = [];
  const S = {
    books: new Map(), base: new Map(), places: new Map(), cases: new Map(), furniture: new Map(), db: null, assets: null, canWrite: false, live: false, lib: LIB,
    universe: null, universes: [],  // in the library: the version of the room shown (its id), and all of them
    photoUrl: id => (LIB ? '/api/sim/photos/' : '/_blob/') + id,
    on(fn) { listeners.push(fn); },
  };
  const emit = (kind, id) => listeners.forEach(f => { try { f(kind, id); } catch (e) { console.error(e); } });
  const state = t => { const el = document.getElementById('dbState'); if (el) el.textContent = t; };

  // photos live in the asset store; a book row keeps only their ids
  function withFaces(b) {
    const faces = {};
    Object.entries(b.faceIds || {}).forEach(([k, id]) => { if (id) faces[k] = S.photoUrl(id); });
    Object.entries(b.localFaces || {}).forEach(([k, url]) => { if (url) faces[k] = url; });
    return Object.assign({}, b, { faces });
  }

  // the library's server: JSON in and out, and an error that says what went wrong
  // keepalive: a save sent just before the window closes still arrives
  async function api(method, path, body, keepalive) {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const r = await fetch('/api/sim/' + path, { method, headers: json === undefined ? {} : { 'Content-Type': 'application/json' },
      body: json, keepalive: !!keepalive && (json || '').length < 60000 });
    if (!r.ok) { let t = r.statusText; try { t = (await r.json()).detail || t; } catch (e) { } throw Object.assign(new Error(t), { code: r.status + ' ' + t, status: r.status }); }
    return r.json();
  }
  S.api = api;
  // the queue of saves to the library's server
  const queue = [];
  let sending = false, failing = false;
  // the places, bookcases and furniture saved are those of the version of the room this page shows
  function write(method, path, body) {
    if (/^(places|cases|furniture)(\/|$)/.test(path) && S.universe != null) path += '?u=' + S.universe;
    const last = queue[queue.length - 1];
    if (last && !last.sent && last.method === method && last.path === path) last.body = body;  // the newer one is enough
    else queue.push({ method, path, body });
    pump();
  }
  async function pump() {
    if (sending) return;
    sending = true;
    while (queue.length) {
      const q = queue[0]; q.sent = true;
      try {
        await api(q.method, q.path, q.body, true);
        queue.shift();
        if (failing) { failing = false; state('Saved in the library'); }
      } catch (e) {
        if (e.status >= 400 && e.status < 500) { queue.shift(); refused(e); continue; }  // refused, not lost: trying again would not help
        failing = true; q.sent = false;
        state('Not saved yet (' + (e.code || e.message) + '): trying again…');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    sending = false;
  }
  S.unsaved = () => queue.length;
  // resolves true once every save has got through, or false if some still wait after ms
  S.settled = (ms = 10000) => new Promise(done => {
    const t0 = performance.now();
    (function check() { if (!queue.length) done(true); else if (performance.now() - t0 > ms) done(false); else setTimeout(check, 100); })();
  });
  if (LIB) window.addEventListener('beforeunload', e => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } });
  let libState = null;
  S.ready = LIB
    ? api('GET', 'state').then(st => {
      libState = st;
      S.universe = st.universe; S.universes = st.universes || [];
      st.books.forEach(({ base, saved }) => { S.base.set(base.id, base); S.books.set(base.id, withFaces(Object.assign({}, base, saved || {}, { id: base.id }))); });
    })
    : fetch('data/books.json').then(r => r.json()).then(list => {
      list.forEach(b => { S.base.set(b.id, b); S.books.set(b.id, withFaces(b)); });
    });

  S.connect = async function () {
    if (LIB) {
      await S.ready;
      S.canWrite = true; state('Saved in the library');
      Object.entries(libState.cases).forEach(([k, c]) => { S.cases.set(k, c); emit('case', k); });
      Object.entries(libState.furniture || {}).forEach(([k, a]) => { S.furniture.set(k, a); emit('furniture', k); });
      Object.entries(libState.places).forEach(([k, p]) => { if (S.books.has(k)) { S.places.set(k, p); emit('place', k); } });
      S.live = true; emit('placesLoaded');
      return;
    }
    if (!window.claude || !claude.use) { state('Preview: changes are not saved'); return; }
    state('Connecting…');
    const [db, user, assets] = await Promise.all([claude.use('db'), claude.use('user'), claude.use('assets')]);
    S.db = db; S.assets = assets;
    if (!db) { state('Not saved: sign in to keep changes'); return; }
    const can = user ? await user.can('data.write') : null;
    S.canWrite = can !== false;
    state(S.canWrite ? 'Changes are saved for everyone' : 'View only: you can play, changes are not saved');
    db.collection('books').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed') { const b = S.base.get(id); b ? S.books.set(id, withFaces(b)) : S.books.delete(id); }
        else S.books.set(id, withFaces(Object.assign({}, S.base.get(id) || {}, ch.doc.data(), { id })));
        emit(ch.type === 'removed' && !S.base.has(id) ? 'bookGone' : 'book', id);
      });
    }, e => state('Database: ' + e.code));
    // where the furniture has been moved to
    db.collection('furniture').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed') S.furniture.delete(id); else S.furniture.set(id, ch.doc.data());
        emit('furniture', id);
      });
    }, e => state('Database: ' + e.code));
    // the bookcases (where their shelves are, their names) come first, so the books find the shelves they stand on
    let placesOn = false;
    db.collection('cases').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed') S.cases.delete(id); else S.cases.set(id, ch.doc.data());
        emit('case', id);
      });
      if (!placesOn) { placesOn = true; places(); }
    }, e => { state('Database: ' + e.code); if (!placesOn) { placesOn = true; places(); } });
    const places = () => db.collection('places').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed') S.places.delete(id); else S.places.set(id, ch.doc.data());
        emit('place', id);
      });
      S.live = true; emit('placesLoaded');
    }, e => state('Database: ' + e.code));
  };

  function refused(e) {
    if (LIB) { state('Not saved: ' + (e && (e.code || e.message) || e)); return; }
    if (e && e.code === 'invalid_argument') { S.canWrite = false; state('View only: changes are not saved'); }
    else state('Not saved: ' + (e && e.code || e));
  }
  S.savePlace = function (id, place) {
    S.places.set(id, place);
    if (LIB) write('PUT', 'places/' + id, place);
    else if (S.db && S.canWrite) S.db.collection('places').doc(id).set(place).catch(refused);
  };
  // many places at once, {id: place}
  S.savePlaces = function (places) {
    Object.entries(places).forEach(([id, p]) => S.places.set(id, p));
    if (LIB) write('PUT', 'places', places);
    else if (S.db && S.canWrite) Object.entries(places).forEach(([id, p]) => S.db.collection('places').doc(id).set(p).catch(refused));
  };
  // a bookcase, by its letter: {name, shelves: [{id, sec, i}] (the movable shelves and the holes they sit in), names: {shelf id: name}}
  S.saveCase = function (key, doc) {
    S.cases.set(key, doc); emit('case', key);
    if (LIB) write('PUT', 'cases/' + key, doc);
    else if (S.db && S.canWrite) S.db.collection('cases').doc(key).set(doc).catch(refused);
  };
  // where a bookcase or a piece of furniture stands, by its key: {cx, cy, z, rot}; null = where it was built
  S.saveFurniture = function (key, at) {
    if (at) S.furniture.set(key, at); else S.furniture.delete(key);
    if (LIB) write('PUT', 'furniture/' + key, at);
    else if (S.db && S.canWrite) (at ? S.db.collection('furniture').doc(key).set(at) : S.db.collection('furniture').doc(key).delete()).catch(refused);
  };
  S.clearFurniture = async function () {
    const keys = [...S.furniture.keys()]; S.furniture.clear();
    if (LIB) { write('DELETE', 'furniture'); return; }
    if (S.db && S.canWrite) for (const k of keys) await S.db.collection('furniture').doc(k).delete().catch(refused);
  };
  S.clearPlaces = async function () {
    const ids = [...S.places.keys()]; S.places.clear();
    if (LIB) { write('DELETE', 'places'); return; }
    if (S.db && S.canWrite) for (const id of ids) await S.db.collection('places').doc(id).delete().catch(refused);
  };
  // rec: the book as the workshop edits it. localFaces are blob: urls of photos that could not be uploaded.
  // Returns the id the book is saved under (a new library book gets its number from the library), or false if not saved.
  S.saveBook = async function (rec) {
    const clean = JSON.parse(JSON.stringify(Object.assign({}, rec, { faces: undefined, localFaces: undefined })));
    if (LIB) {
      const isNew = !S.base.has(rec.id);
      const { id } = await api(isNew ? 'POST' : 'PUT', isNew ? 'books' : 'books/' + rec.id, clean);
      if (isNew) {
        if (S.books.has(rec.id)) { S.books.delete(rec.id); emit('bookGone', rec.id); }
        S.base.set(id, Object.assign({}, clean, { id, autoColor: false }));
      }
      rec = Object.assign({}, rec, { id, autoColor: false });
      S.books.set(id, withFaces(rec)); emit('book', id);
      return id;
    }
    S.books.set(rec.id, withFaces(rec));
    emit('book', rec.id);
    if (S.db && S.canWrite) { await S.db.collection('books').doc(rec.id).set(clean); return rec.id; }
    return false;
  };
  // in the library this only forgets the room's changes; a book is deleted in the library itself
  S.deleteBook = async function (id) {
    if (LIB) await api('DELETE', 'books/' + id);
    const b = S.base.get(id);
    b ? S.books.set(id, withFaces(b)) : S.books.delete(id);
    emit(b ? 'book' : 'bookGone', id);
    if (!LIB && S.db && S.canWrite) await S.db.collection('books').doc(id).delete();
  };
  // returns {id} for a stored photo, or {url} kept only in this browser tab
  S.upload = async function (blob) {
    if (LIB) {
      const r = await fetch('/api/sim/photos', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
      if (!r.ok) throw new Error('the photo could not be saved (' + r.status + ')');
      return { id: (await r.json()).id };
    }
    if (S.assets) { const r = await S.assets.upload(blob); return { id: r.id }; }
    return { url: URL.createObjectURL(blob) };
  };

  g.Store = S;
})(window);
