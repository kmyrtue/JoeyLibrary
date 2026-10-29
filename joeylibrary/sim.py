"""The bookshelf simulation: a walkable 3D model of the living room whose bookcases hold the library's books.

The room itself is a web page in sim/ (three.js for the 3D, cannon.js for books that fall). It is shown in a frame
inside the library, and reads and saves its data through the routes below. Title, authors, pages and ISBN come from
the library; the room adds how a book looks, where it stands, the bookcases' shelves, where the furniture stands and
photos of book sides. Those are kept in the room's own database (roomdb.py), never in the library's.

The room can be kept in several named versions (universes), each with its own places, bookcases, zones and furniture.
The page names the version it shows in every save (?u=), so a second window still showing another version keeps
saving into that one, and a version deleted meanwhile refuses the save instead of it landing somewhere else.
"""
import hashlib
import json
import re
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from fastapi import HTTPException, Request, Response
from nicegui import app

from . import backup, db, isbn as isbn_lookup, roomdb

HERE = Path(__file__).resolve().parent
app.add_static_files('/sim-files', HERE / 'sim', max_cache_age=0)  # always the scripts of this version
COVER_DIR = db.DB_PATH.parent / 'sim-covers'  # covers fetched from the internet, kept so they load offline next time

# formats that are not books on a shelf
NOT_ON_SHELVES = re.compile(r'audio|e-?book|kindle|digital|lydbog|ljudbok|pdf|epub', re.I)
# spine colours for books the room has no colour for yet; it takes one from the cover once that has loaded
SPINES = ['#2f4a6b', '#6b2f2f', '#2f5a3a', '#5a4a2a', '#3a3a4a', '#7a5a3a', '#4a2f5a', '#1f3f4f', '#6a6a5a', '#8a3a2a']
# fields that belong to the library, so they are never kept in the room's own data
LIBRARY_FIELDS = {'id', 'isbn', 'title', 'author', 'pages', 'cover', 'faces', 'localFaces', 'pending', 'autoColor'}


def serial(book_id: int) -> str:
    return db.serial('owned', book_id)


def book_id(sid: str) -> int:
    """'L0012' -> 12"""
    m = re.fullmatch(r'L(\d+)', sid or '')
    if not m:
        raise HTTPException(404, 'No such book')
    return int(m.group(1))


def guess_type(format_name: str | None, code: str) -> tuple[str, str]:
    """The room's book type from the library's format name and the ISBN: (type id, how it was found)."""
    name = (format_name or '').lower()
    danish = code.startswith('97887') or (len(code) == 10 and code.startswith('87'))
    if re.search(r'hard|indbundet|gebunden|innbundet|inbunden|\bhb\b|cloth', name):
        kind = 'dk-hc-c' if danish else 'us-hc'
    elif re.search(r'mass|pocket|\bmm\b|billigbog', name):
        kind = 'dk-a' if danish else 'us-mm'
    elif re.search(r'graphic|comic|tegneserie', name):
        kind = 'us-gn'
    else:  # paperback, trade, soft cover, or nothing said
        kind = 'dk-b' if danish else 'us-tpb'
    how = f'from the library format "{format_name}"' if format_name else 'guessed: the library has no format for it'
    return kind, how


def record(row: dict, sim_data: str | None) -> dict | None:
    """A library book as the room's book record: {'base': what the library gives, 'saved': the room's own changes}."""
    if NOT_ON_SHELVES.search(row['FormatName'] or ''):
        return None
    code = isbn_lookup.clean(row['ISBN'])
    kind, how = guess_type(row['FormatName'], code)
    spine = SPINES[int(hashlib.md5(row['Title'].encode('utf-8')).hexdigest(), 16) % len(SPINES)]
    base = {'id': serial(row['BookID']), 'isbn': code, 'title': row['Title'], 'author': row['Authors'] or '',
            'pages': row['PageCount'], 'format': kind, 'formatHow': how, 'spineColor': spine, 'backColor': spine,
            'cover': f'/api/sim/cover/{code}' if code else '', 'autoColor': True,
            'note': f"On loan to {row['LoanedTo']}." if row['LoanedTo'] else ''}
    if row['EdgeOut']:  # SPRAYED EDGES in the library
        base['edges'] = {'pattern': 'solid', 'color': '#b0302a', 'color2': '#1b1b1b', 'sides': ['top', 'fore', 'bottom'],
                         'paper': '#efe8d6'}
    saved = json.loads(sim_data) if sim_data else None
    if saved and saved.get('spineColor'):
        base['autoColor'] = False
    return {'base': base, 'saved': saved}


# ---------- what the room reads and saves ----------

def universe(u: int | None) -> int:
    """The version of the room a request is for: the one the page names, or the one the room opens in."""
    if u is None:
        return roomdb.active()
    if not roomdb.exists(u):
        raise HTTPException(409, 'This universe has been deleted: reload the page')
    return u


@app.get('/api/sim/state')
def state(u: int | None = None) -> dict:
    uid = universe(u)
    rows = db.sim_books()
    roomdb.prune({r['BookID'] for r in rows})
    looks = roomdb.rows('SimBooks')
    books = [b for b in (record(r, looks.get(r['BookID'])) for r in rows) if b]
    places = {serial(k): json.loads(v) for k, v in roomdb.rows('SimPlaces', uid).items()}
    cases = {k: json.loads(v) for k, v in roomdb.rows('SimCases', uid).items()}
    furniture = {k: json.loads(v) for k, v in roomdb.rows('SimFurniture', uid).items()}
    return {'books': books, 'places': places, 'cases': cases, 'furniture': furniture, 'universe': uid,
            'universes': roomdb.universes()}


# ---------- versions of the room ----------

@app.get('/api/sim/universes')
def list_universes() -> dict:
    return {'active': roomdb.active(), 'universes': roomdb.universes()}


@app.post('/api/sim/universes')
async def new_universe(request: Request) -> dict:
    """{name, copyOf: a version's id or null}: a new version, empty or a copy of that one. The room opens in it next."""
    rec = await request.json()
    copy_of = rec.get('copyOf')
    if copy_of is not None:
        copy_of = universe(int(copy_of))
    try:
        uid = roomdb.create_universe(rec.get('name') or '', copy_of)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    roomdb.set_active(uid)
    return {'id': uid}


@app.put('/api/sim/universes/{uid}')
async def rename_universe(uid: int, request: Request) -> dict:
    universe(uid)
    try:
        roomdb.rename_universe(uid, (await request.json()).get('name') or '')
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {}


@app.delete('/api/sim/universes/{uid}')
def delete_universe(uid: int) -> dict:
    universe(uid)
    try:
        roomdb.delete_universe(uid)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {'active': roomdb.active()}


@app.post('/api/sim/universes/{uid}/open')
def open_universe(uid: int) -> dict:
    """The version the room opens in from now on."""
    roomdb.set_active(universe(uid))
    return {}


# ---------- books ----------


@app.put('/api/sim/books/{sid}')
async def save_book(sid: str, request: Request) -> dict:
    rec = await request.json()
    _save(book_id(sid), rec)
    return {'id': sid}


@app.post('/api/sim/books')
async def new_book(request: Request) -> dict:
    """A book made in the room's workshop becomes a library book."""
    rec = await request.json()
    title = (rec.get('title') or '').strip()
    if not title:
        raise HTTPException(400, 'A book needs a title')
    new_id = db.save_book('owned', {'Title': title, 'AuthorList': authors(rec), 'PageCount': rec.get('pages'),
                                    'ISBN': isbn_lookup.clean(rec.get('isbn')) or None, 'Read': 0,
                                    'EdgeOut': int(sprayed(rec)), 'FormatName': format_name(rec)})
    _save(new_id, rec)
    return {'id': serial(new_id)}


@app.delete('/api/sim/books/{sid}')
def reset_book(sid: str) -> dict:
    roomdb.reset_book(book_id(sid))
    return {}


def authors(rec: dict) -> list[str]:
    return [a.strip() for a in (rec.get('author') or '').split(',') if a.strip()]


def sprayed(rec: dict) -> bool:
    edges = rec.get('edges') or {}
    return edges.get('pattern', 'none') != 'none' and bool(edges.get('sides'))


def format_name(rec: dict) -> str:
    from_type = rec.get('format') or ''
    return 'Hardcover' if '-hc' in from_type or '-hb' in from_type else 'Paperback'


def _save(bid: int, rec: dict) -> None:
    title = (rec.get('title') or '').strip()
    if not title:
        raise HTTPException(400, 'A book needs a title')
    pages = rec.get('pages')
    data = {k: v for k, v in rec.items() if k not in LIBRARY_FIELDS}
    db.sim_update_book(bid, title, authors(rec), int(pages) if pages else None,
                       isbn_lookup.clean(rec.get('isbn')) or None, sprayed(rec), format_name(rec))
    roomdb.save_book(bid, json.dumps(data))


# ---------- what is in one version of the room ----------

@app.put('/api/sim/places/{sid}')
async def save_place(sid: str, request: Request, u: int | None = None) -> dict:
    uid = universe(u)
    place = await request.json()
    bid = book_id(sid)
    if db.owned_exists(bid):
        roomdb.save_places(uid, {bid: json.dumps(place) if place else None})
    return {}


@app.put('/api/sim/places')
async def save_places(request: Request, u: int | None = None) -> dict:
    """Many places at once, {book id: place or None}: the shelves as the room laid them out by itself."""
    uid = universe(u)
    places = await request.json()
    roomdb.save_places(uid, {book_id(sid): json.dumps(p) if p else None for sid, p in places.items()})
    return {}


@app.delete('/api/sim/places')
def clear_places(u: int | None = None) -> dict:
    roomdb.clear_places(universe(u))
    return {}


@app.put('/api/sim/cases/{key}')
async def save_case(key: str, request: Request, u: int | None = None) -> dict:
    # a bookcase or piece of furniture by its key, 'labels' (how places are written) or 'zones'
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9]{0,23}', key):
        raise HTTPException(404, 'No such bookcase')
    uid = universe(u)
    roomdb.save_case(uid, key, json.dumps(await request.json()))
    return {}


@app.put('/api/sim/furniture/{key}')
async def save_furniture(key: str, request: Request, u: int | None = None) -> dict:
    """{cx, cy, z, rot}: the middle of its footprint and the height of its underside in mm, its turn in degrees"""
    if not re.fullmatch(r'[A-Za-z0-9]{1,20}', key):
        raise HTTPException(404, 'No such piece of furniture')
    uid = universe(u)
    at = await request.json()
    roomdb.save_furniture(uid, key, json.dumps(at) if at else None)
    return {}


@app.delete('/api/sim/furniture')
def clear_furniture(u: int | None = None) -> dict:
    roomdb.clear_furniture(universe(u))
    return {}


@app.post('/api/sim/photos')
async def upload_photo(request: Request) -> dict:
    content_type = request.headers.get('content-type', '')
    if not content_type.startswith('image/'):
        raise HTTPException(415, 'Only pictures')
    photo_id = uuid.uuid4().hex
    roomdb.save_photo(photo_id, content_type, await request.body())
    return {'id': photo_id}


@app.get('/api/sim/photos/{photo_id}')
def photo(photo_id: str) -> Response:
    found = roomdb.photo(photo_id)
    if not found:
        raise HTTPException(404, 'No such photo')
    return Response(found[1], media_type=found[0], headers={'Cache-Control': 'max-age=31536000, immutable'})


# ---------- ISBN lookup and covers, for the workshop ----------

@app.get('/api/sim/isbn/{code}')
def lookup(code: str) -> dict:
    """The library's own ISBN lookup (ISBNdb, Google Books, LIBRIS, Open Library, with the keys in SETTINGS)."""
    settings = backup.load_settings()
    try:
        found = isbn_lookup.lookup(code, (settings.get('isbndb_key') or '').strip(),
                                   (settings.get('google_books_key') or '').strip())
    except (ValueError, ConnectionError, isbn_lookup.BadKey) as e:
        return {'error': str(e)}
    if not found:
        return {'found': False}
    return {'found': True, 'title': found['Title'], 'author': ', '.join(found['AuthorList']),
            'pages': found.get('PageCount'), 'format': found.get('Format') or '', 'source': found['Source']}


@app.get('/api/sim/cover/{code}')
def cover(code: str) -> Response:
    """The front cover for an ISBN, from Open Library or Google Books; fetched once, then kept in COVER_DIR."""
    code = isbn_lookup.clean(code)
    if len(code) not in (10, 13):
        raise HTTPException(404, 'No cover')
    path, none = COVER_DIR / f'{code}.jpg', COVER_DIR / f'{code}.none'
    if not path.exists() and not none.exists():
        image = _fetch_cover(code)
        COVER_DIR.mkdir(parents=True, exist_ok=True)
        if image:
            path.write_bytes(image)
        else:
            none.touch()  # looked for and not found; not asked again
    if not path.exists():
        raise HTTPException(404, 'No cover')
    return Response(path.read_bytes(), media_type='image/jpeg', headers={'Cache-Control': 'max-age=86400'})


def _download(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={'User-Agent': isbn_lookup.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
    except (OSError, ValueError):
        return None
    return data if len(data) > 1000 else None  # a blank placeholder is a few hundred bytes


def _fetch_cover(code: str) -> bytes | None:
    image = _download(f'https://covers.openlibrary.org/b/isbn/{code}-L.jpg?default=false')
    if image:
        return image
    key = (backup.load_settings().get('google_books_key') or '').strip()
    url = 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + code + (f'&key={urllib.parse.quote(key)}' if key else '')
    try:
        items = json.loads(_download(url) or b'{}').get('items') or []
    except ValueError:
        return None
    links = items[0].get('volumeInfo', {}).get('imageLinks', {}) if items else {}
    link = links.get('thumbnail') or links.get('smallThumbnail')
    return _download(link.replace('http://', 'https://').replace('&edge=curl', '')) if link else None
