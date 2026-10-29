"""The bookshelf simulation's own database, room.db, kept apart from the library's library.db.

The room's data (how books look, where they stand, the bookcases, the furniture, photos) is saved many times a minute
while someone plays. Keeping it in its own file means nothing done in the room can damage the library, and the library
and the room are backed up and restored separately. Books are linked to the library by BookID only; rows for books the
library no longer has are dropped when the room loads.

The room can be kept in several named versions (universes): each has its own places of books, bookcases, zones and
furniture (SimPlaces, SimCases, SimFurniture, by UniverseID). How books look and their photos are shared by all.
"""
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from . import db

SCHEMA_FILE = Path(__file__).resolve().parent.parent / 'Room.sqlite.sql'
DB_PATH = Path(os.environ.get('JOEY_ROOM_DB', db.DB_PATH.parent / 'room.db'))
TABLES = ('SimBooks', 'SimPlaces', 'SimCases', 'SimFurniture', 'SimPhotos')
KEYS = {'SimBooks': 'BookID', 'SimPlaces': 'BookID', 'SimCases': 'CaseKey', 'SimFurniture': 'FurnitureKey'}
PER_UNIVERSE = ('SimPlaces', 'SimCases', 'SimFurniture')
FIRST_NAME = 'My room'  # what the room is called when it is made, or was called before there were versions of it


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create room.db if it is missing, bring an older room.db up to date, and move the room's tables out of library.db
    if an earlier version put them there."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute('PRAGMA journal_mode = WAL')  # many small writes while playing; readers never wait for them
        conn.executescript(SCHEMA_FILE.read_text(encoding='utf-8'))
    _add_universes()
    first = _ensure_universe()
    if not db.DB_PATH.exists():
        return
    with db.connect() as lib:
        old = [r[0] for r in lib.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'Sim%'")]
    old = [t for t in old if t in TABLES]
    if not old:
        return
    # copy first and commit, then drop from the library: if anything fails half way the rows are still in library.db
    with connect() as conn:
        conn.execute('ATTACH DATABASE ? AS lib', (str(db.DB_PATH),))
        for table in old:
            cols = ', '.join(r[1] for r in conn.execute(f'PRAGMA lib.table_info({table})'))
            if table in PER_UNIVERSE:  # from before the room had versions: they belong to the first one
                conn.execute(f'INSERT OR IGNORE INTO main.{table} (UniverseID, {cols}) SELECT ?, {cols} FROM lib.{table}', (first,))
            else:
                conn.execute(f'INSERT OR IGNORE INTO main.{table} ({cols}) SELECT {cols} FROM lib.{table}')
        conn.commit()
        conn.execute('DETACH DATABASE lib')
    with db.connect() as lib:
        for table in old:
            lib.execute(f'DROP TABLE {table}')


def _add_universes() -> None:
    """A room.db from before the room had versions: its places, bookcases and furniture become the first version.

    A copy of the file is written next to it first (room.before-universes.db). Each table is then copied into a new one
    with a UniverseID, and only then put in place of the old one, all in one transaction: if anything fails, room.db
    stays as it was.
    """
    with connect() as conn:
        old = [t for t in PER_UNIVERSE if 'UniverseID' not in [r[1] for r in conn.execute(f'PRAGMA table_info({t})')]]
    if not old:
        return
    keep = DB_PATH.with_name(DB_PATH.stem + '.before-universes.db')
    if not keep.exists():
        src, out = sqlite3.connect(DB_PATH), sqlite3.connect(keep)
        try:
            src.backup(out)
        finally:
            out.close()
            src.close()
    schema = SCHEMA_FILE.read_text(encoding='utf-8')
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    try:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT OR IGNORE INTO SimUniverses (UniverseID, Name, Created) VALUES (1, ?, ?)', (FIRST_NAME, _now()))
        for table in old:
            body = re.search(rf'CREATE TABLE IF NOT EXISTS {table} \((.*?)\);', schema, re.S).group(1)
            key = KEYS[table]
            conn.execute(f'DROP TABLE IF EXISTS {table}_new')
            conn.execute(f'CREATE TABLE {table}_new ({body})')
            conn.execute(f'INSERT INTO {table}_new (UniverseID, {key}, Data) SELECT 1, {key}, Data FROM {table}')
            conn.execute(f'DROP TABLE {table}')
            conn.execute(f'ALTER TABLE {table}_new RENAME TO {table}')
        conn.execute('COMMIT')
    except BaseException:
        conn.execute('ROLLBACK')
        raise
    finally:
        conn.close()


def _ensure_universe() -> int:
    """There is always at least one version of the room, and the one the room opens in exists. Returns the first."""
    with connect() as conn:
        first = conn.execute('SELECT MIN(UniverseID) FROM SimUniverses').fetchone()[0]
        if first is None:
            first = conn.execute('INSERT INTO SimUniverses (Name, Created) VALUES (?, ?)', (FIRST_NAME, _now())).lastrowid
    if not exists(active()):
        set_active(first)
    return first


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


# ---------- versions of the room ----------

def universes() -> list[dict]:
    """Every version of the room, oldest first: [{'id', 'name', 'created'}]"""
    with connect() as conn:
        return [{'id': r[0], 'name': r[1], 'created': r[2]}
                for r in conn.execute('SELECT UniverseID, Name, Created FROM SimUniverses ORDER BY UniverseID')]


def exists(uid: int | None) -> bool:
    if uid is None:
        return False
    with connect() as conn:
        return conn.execute('SELECT 1 FROM SimUniverses WHERE UniverseID = ?', (uid,)).fetchone() is not None


def active() -> int | None:
    """The version the room opens in."""
    with connect() as conn:
        row = conn.execute("SELECT Value FROM SimSettings WHERE SettingKey = 'universe'").fetchone()
    try:
        return int(row[0]) if row else None
    except ValueError:
        return None


def set_active(uid: int) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO SimSettings (SettingKey, Value) VALUES ('universe', ?)", (str(uid),))


def _name(name: str) -> str:
    name = ' '.join((name or '').split())
    if not name:
        raise ValueError('A universe needs a name')
    if len(name) > 60:
        raise ValueError('That name is too long (60 characters at most)')
    return name


def create_universe(name: str, copy_of: int | None = None) -> int:
    """A new version of the room: empty (every book still to be unpacked, the furniture where it was built), or a copy
    of the places, bookcases, zones and furniture of copy_of. Raises ValueError if the name is empty or taken."""
    name = _name(name)
    with connect() as conn:
        try:
            uid = conn.execute('INSERT INTO SimUniverses (Name, Created) VALUES (?, ?)', (name, _now())).lastrowid
        except sqlite3.IntegrityError:
            raise ValueError(f'There is already a universe called "{name}"') from None
        if copy_of is not None:
            for table in PER_UNIVERSE:
                key = KEYS[table]
                conn.execute(f'INSERT INTO {table} (UniverseID, {key}, Data) SELECT ?, {key}, Data FROM {table} WHERE UniverseID = ?',
                             (uid, copy_of))
    return uid


def rename_universe(uid: int, name: str) -> None:
    name = _name(name)
    with connect() as conn:
        try:
            conn.execute('UPDATE SimUniverses SET Name = ? WHERE UniverseID = ?', (name, uid))
        except sqlite3.IntegrityError:
            raise ValueError(f'There is already a universe called "{name}"') from None


def delete_universe(uid: int) -> None:
    """Forget a version of the room and everything placed in it; the last one cannot be deleted."""
    with connect() as conn:
        if conn.execute('SELECT COUNT(*) FROM SimUniverses').fetchone()[0] <= 1:
            raise ValueError('The last universe cannot be deleted')
        for table in PER_UNIVERSE:
            conn.execute(f'DELETE FROM {table} WHERE UniverseID = ?', (uid,))
        conn.execute('DELETE FROM SimUniverses WHERE UniverseID = ?', (uid,))
    if active() == uid:
        _ensure_universe()


# ---------- what is in the room ----------

def rows(table: str, uid: int | None = None) -> dict:
    """{key: JSON text} of SimBooks, or of SimPlaces (by BookID), SimCases or SimFurniture in version uid."""
    with connect() as conn:
        if table in PER_UNIVERSE:
            return {r[0]: r[1] for r in conn.execute(f'SELECT {KEYS[table]}, Data FROM {table} WHERE UniverseID = ?', (uid,))}
        return {r[0]: r[1] for r in conn.execute(f'SELECT {KEYS[table]}, Data FROM {table}')}


def prune(book_ids: set[int]) -> None:
    """Forget the looks and places (in every version) of books that are no longer in the library."""
    with connect() as conn:
        for table in ('SimBooks', 'SimPlaces'):
            for (bid,) in conn.execute(f'SELECT DISTINCT BookID FROM {table}').fetchall():
                if bid not in book_ids:
                    conn.execute(f'DELETE FROM {table} WHERE BookID = ?', (bid,))


def save_book(book_id: int, data: str) -> None:
    with connect() as conn:
        conn.execute('INSERT OR REPLACE INTO SimBooks (BookID, Data) VALUES (?, ?)', (book_id, data))


def reset_book(book_id: int) -> None:
    """Forget how the room drew a book; it goes back to what the library knows."""
    with connect() as conn:
        conn.execute('DELETE FROM SimBooks WHERE BookID = ?', (book_id,))


def forget_book(book_id: int) -> None:
    """A library book was deleted: forget its looks and its places, so a new book given its number starts fresh."""
    with connect() as conn:
        conn.execute('DELETE FROM SimBooks WHERE BookID = ?', (book_id,))
        conn.execute('DELETE FROM SimPlaces WHERE BookID = ?', (book_id,))


def save_places(uid: int, places: dict[int, str | None]) -> None:
    """Where books stand in version uid, {BookID: JSON text}, in one transaction; None takes a book off the shelves."""
    with connect() as conn:
        for bid, data in places.items():
            if data is None:
                conn.execute('DELETE FROM SimPlaces WHERE UniverseID = ? AND BookID = ?', (uid, bid))
            else:
                conn.execute('INSERT OR REPLACE INTO SimPlaces (UniverseID, BookID, Data) VALUES (?, ?, ?)', (uid, bid, data))


def clear_places(uid: int) -> None:
    with connect() as conn:
        conn.execute('DELETE FROM SimPlaces WHERE UniverseID = ?', (uid,))


def save_case(uid: int, key: str, data: str) -> None:
    with connect() as conn:
        conn.execute('INSERT OR REPLACE INTO SimCases (UniverseID, CaseKey, Data) VALUES (?, ?, ?)', (uid, key, data))


def save_furniture(uid: int, key: str, data: str | None) -> None:
    """Where a bookcase or a piece of furniture has been moved to in version uid; None puts it back where it was."""
    with connect() as conn:
        if data is None:
            conn.execute('DELETE FROM SimFurniture WHERE UniverseID = ? AND FurnitureKey = ?', (uid, key))
        else:
            conn.execute('INSERT OR REPLACE INTO SimFurniture (UniverseID, FurnitureKey, Data) VALUES (?, ?, ?)', (uid, key, data))


def clear_furniture(uid: int) -> None:
    with connect() as conn:
        conn.execute('DELETE FROM SimFurniture WHERE UniverseID = ?', (uid,))


def save_photo(photo_id: str, content_type: str, data: bytes) -> None:
    with connect() as conn:
        conn.execute('INSERT INTO SimPhotos (PhotoID, ContentType, Data) VALUES (?, ?, ?)', (photo_id, content_type, data))


def photo(photo_id: str) -> tuple[str, bytes] | None:
    with connect() as conn:
        row = conn.execute('SELECT ContentType, Data FROM SimPhotos WHERE PhotoID = ?', (photo_id,)).fetchone()
    return (row[0], row[1]) if row else None
