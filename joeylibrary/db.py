"""SQLite access for the library. Every function opens its own short-lived connection."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path

SCHEMA_FILE = Path(__file__).resolve().parent.parent / 'Library.sqlite.sql'
DATA_DIR = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local' / 'share')) / 'joey-library'
DB_PATH = Path(os.environ.get('JOEY_LIBRARY_DB', DATA_DIR / 'library.db'))


# per book kind: main table, genre link table, author link table
TABLES = {
    'owned': ('BooksOwned', 'BooksOwnedGenres', 'BooksOwnedAuthors'),
    'wished': ('BooksWished', 'BooksWishedGenres', 'BooksWishedAuthors'),
}
# columns the forms edit directly (Format and SeriesName are IDs, handled separately)
COLUMNS = {
    'owned': ['Title', 'Edition', 'LoanedTo', 'LoanedDate', 'Rating', 'Comments', 'ShelfNumber',
              'NumberInSeries', 'Signed', 'EdgeOut', 'Read', 'StartedDate', 'FinishedDate', 'PageCount', 'ISBN'],
    'wished': ['Title', 'Edition', 'NumberInSeries', 'Signed', 'ISBN'],
}
LOOKUPS = {  # table -> (id column, name column)
    'Authors': ('AuthorID', 'AuthorName'),
    'Genres': ('GenreID', 'GenreName'),
    'Formats': ('FormatID', 'FormatName'),
    'Series': ('SeriesID', 'SeriesName'),
}


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create the database from the schema file the first time the app runs."""
    if DB_PATH.exists():
        return
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA_FILE.read_text(encoding='utf-8'))


# ---------- lookup tables ----------

def names(table: str) -> list[str]:
    _, name_col = LOOKUPS[table]
    with connect() as conn:
        return [r[0] for r in conn.execute(f'SELECT {name_col} FROM {table} ORDER BY {name_col} COLLATE NOCASE')]


def _id_for(conn, table: str, name: str | None) -> int | None:
    """Return the ID for a name in a lookup table, creating the row if it is new."""
    name = (name or '').strip()
    if not name:
        return None
    id_col, name_col = LOOKUPS[table]
    row = conn.execute(f'SELECT {id_col} FROM {table} WHERE {name_col} = ? COLLATE NOCASE', (name,)).fetchone()
    if row:
        return row[0]
    return conn.execute(f'INSERT INTO {table} ({name_col}) VALUES (?)', (name,)).lastrowid


# Index pages. 'Edition' is not a table but a text column on both book tables; it is edited across all books.
KINDS = {'owned': 'BooksOwned', 'wished': 'BooksWished'}
REF_COLUMNS = {'Formats': 'Format', 'Series': 'SeriesName'}  # lookups referenced by a column on the book
# Authors and Genres are referenced through link tables named Books<Owned|Wished><Authors|Genres>


def _usage(table: str, kind: str) -> str:
    """SQL that finds the titles of the books of one kind that use an index entry."""
    book = KINDS[kind]
    if table == 'Edition':
        return f'SELECT Title FROM {book} WHERE Edition = ?'
    if table in REF_COLUMNS:
        return f'SELECT Title FROM {book} WHERE {REF_COLUMNS[table]} = ?'
    id_col = LOOKUPS[table][0]
    return f'SELECT b.Title FROM {book}{table} x JOIN {book} b USING (BookID) WHERE x.{id_col} = ?'


def list_index(table: str) -> list[dict]:
    """Every entry with how many library and wishlist books use it."""
    with connect() as conn:
        if table == 'Edition':
            sql = '''SELECT Edition AS ID, Edition AS Name, SUM(k = 'owned') AS Owned, SUM(k = 'wished') AS Wished
                     FROM (SELECT Edition, 'owned' AS k FROM BooksOwned UNION ALL SELECT Edition, 'wished' FROM BooksWished)
                     WHERE Edition IS NOT NULL AND Edition <> '' GROUP BY Edition ORDER BY Edition COLLATE NOCASE'''
        else:
            id_col, name_col = LOOKUPS[table]
            counts = []
            for kind, book in KINDS.items():
                if table in REF_COLUMNS:
                    counts.append(f'(SELECT COUNT(*) FROM {book} x WHERE x.{REF_COLUMNS[table]} = t.{id_col})')
                else:
                    counts.append(f'(SELECT COUNT(*) FROM {book}{table} x WHERE x.{id_col} = t.{id_col})')
            sql = (f'SELECT t.{id_col} AS ID, t.{name_col} AS Name, {counts[0]} AS Owned, {counts[1]} AS Wished '
                   f'FROM {table} t ORDER BY t.{name_col} COLLATE NOCASE')
        return [dict(r) for r in conn.execute(sql)]


def books_using(table: str, item_id) -> list[tuple[str, str]]:
    """(kind, title) of every book that uses an index entry."""
    with connect() as conn:
        return [(kind, r[0]) for kind in KINDS
                for r in conn.execute(_usage(table, kind) + ' ORDER BY 1 COLLATE NOCASE', (item_id,))]


def add_index(table: str, name: str) -> None:
    name = name.strip()
    id_col, name_col = LOOKUPS[table]
    with connect() as conn:
        if conn.execute(f'SELECT 1 FROM {table} WHERE {name_col} = ? COLLATE NOCASE', (name,)).fetchone():
            raise ValueError(f'{name} is already on the list.')
        conn.execute(f'INSERT INTO {table} ({name_col}) VALUES (?)', (name,))


def rename_index(table: str, item_id, new_name: str) -> str:
    """Rename an entry. Renaming to a name that already exists merges the two; returns 'renamed' or 'merged'."""
    new_name = new_name.strip()
    with connect() as conn:
        if table == 'Edition':
            for book in KINDS.values():
                conn.execute(f'UPDATE {book} SET Edition = ? WHERE Edition = ?', (new_name, item_id))
            return 'renamed'
        id_col, name_col = LOOKUPS[table]
        other = conn.execute(f'SELECT {id_col} FROM {table} WHERE {name_col} = ? COLLATE NOCASE AND {id_col} <> ?',
                             (new_name, item_id)).fetchone()
        if not other:
            conn.execute(f'UPDATE {table} SET {name_col} = ? WHERE {id_col} = ?', (new_name, item_id))
            return 'renamed'
        for book in KINDS.values():
            if table in REF_COLUMNS:
                col = REF_COLUMNS[table]
                conn.execute(f'UPDATE {book} SET {col} = ? WHERE {col} = ?', (other[0], item_id))
            else:
                # OR IGNORE skips books that already have both; their old link goes when the entry is deleted.
                # Updating in place keeps each link's position, so a main author stays first.
                conn.execute(f'UPDATE OR IGNORE {book}{table} SET {id_col} = ? WHERE {id_col} = ?', (other[0], item_id))
        conn.execute(f'DELETE FROM {table} WHERE {id_col} = ?', (item_id,))
        return 'merged'


def delete_index(table: str, item_id) -> None:
    """Delete an entry; books that used it simply lose it (they are not deleted)."""
    with connect() as conn:
        if table == 'Edition':
            for book in KINDS.values():
                conn.execute(f'UPDATE {book} SET Edition = NULL WHERE Edition = ?', (item_id,))
            return
        id_col = LOOKUPS[table][0]
        if table in REF_COLUMNS:
            for book in KINDS.values():
                conn.execute(f'UPDATE {book} SET {REF_COLUMNS[table]} = NULL WHERE {REF_COLUMNS[table]} = ?', (item_id,))
        conn.execute(f'DELETE FROM {table} WHERE {id_col} = ?', (item_id,))  # link rows go by ON DELETE CASCADE


def borrowers() -> list[str]:
    with connect() as conn:
        return [r[0] for r in conn.execute(
            "SELECT DISTINCT LoanedTo FROM BooksOwned WHERE LoanedTo IS NOT NULL AND LoanedTo <> '' ORDER BY 1")]


# ---------- books ----------

def _select_books(kind: str, where: str = '') -> str:
    book, genre_link, author_link = TABLES[kind]
    # authors are listed in the order they were linked, so the main author comes first
    return f'''
        SELECT b.*, f.FormatName, s.SeriesName AS SeriesTitle,
               (SELECT group_concat(AuthorName, ', ') FROM (
                    SELECT a.AuthorName FROM {author_link} ba JOIN Authors a USING (AuthorID)
                    WHERE ba.BookID = b.BookID ORDER BY ba.rowid)) AS Authors,
               (SELECT group_concat(GenreName, ', ') FROM (
                    SELECT g.GenreName FROM {genre_link} bg JOIN Genres g USING (GenreID)
                    WHERE bg.BookID = b.BookID ORDER BY g.GenreName)) AS Genres
        FROM {book} b
        LEFT JOIN Formats f ON f.FormatID = b.Format
        LEFT JOIN Series s ON s.SeriesID = b.SeriesName
        {where}
        ORDER BY b.Title COLLATE NOCASE'''


def list_books(kind: str) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(_select_books(kind))]


def get_book(kind: str, book_id: int) -> dict:
    _, genre_link, author_link = TABLES[kind]
    with connect() as conn:
        row = dict(conn.execute(_select_books(kind, 'WHERE b.BookID = ?'), (book_id,)).fetchone())
        row['AuthorList'] = [r[0] for r in conn.execute(
            f'SELECT a.AuthorName FROM {author_link} ba JOIN Authors a USING (AuthorID) '
            f'WHERE ba.BookID = ? ORDER BY ba.rowid', (book_id,))]
        row['GenreList'] = [r[0] for r in conn.execute(
            f'SELECT g.GenreName FROM {genre_link} bg JOIN Genres g USING (GenreID) '
            f'WHERE bg.BookID = ? ORDER BY g.GenreName', (book_id,))]
    return row


def save_book(kind: str, data: dict, book_id: int | None = None) -> int:
    """Insert or update a book. data holds COLUMNS[kind] plus FormatName, SeriesTitle, AuthorList, GenreList."""
    book, genre_link, author_link = TABLES[kind]
    with connect() as conn:
        values = {c: data.get(c) for c in COLUMNS[kind]}
        values['Format'] = _id_for(conn, 'Formats', data.get('FormatName'))
        values['SeriesName'] = _id_for(conn, 'Series', data.get('SeriesTitle'))
        cols = list(values)
        if book_id is None:
            book_id = conn.execute(
                f'INSERT INTO {book} ({", ".join(cols)}) VALUES ({", ".join("?" * len(cols))})',
                [values[c] for c in cols]).lastrowid
        else:
            conn.execute(f'UPDATE {book} SET {", ".join(f"{c} = ?" for c in cols)} WHERE BookID = ?',
                         [values[c] for c in cols] + [book_id])
        conn.execute(f'DELETE FROM {author_link} WHERE BookID = ?', (book_id,))
        for name in dict.fromkeys(data.get('AuthorList') or []):  # dict.fromkeys drops duplicates, keeps order
            conn.execute(f'INSERT OR IGNORE INTO {author_link} VALUES (?, ?)', (book_id, _id_for(conn, 'Authors', name)))
        conn.execute(f'DELETE FROM {genre_link} WHERE BookID = ?', (book_id,))
        for name in dict.fromkeys(data.get('GenreList') or []):
            conn.execute(f'INSERT OR IGNORE INTO {genre_link} VALUES (?, ?)', (book_id, _id_for(conn, 'Genres', name)))
    return book_id


def delete_book(kind: str, book_id: int) -> None:
    with connect() as conn:
        conn.execute(f'DELETE FROM {TABLES[kind][0]} WHERE BookID = ?', (book_id,))


def find_isbn(isbn: str) -> list[str]:
    """Return where a book with this ISBN already is: 'owned', 'wished', both or neither."""
    found = []
    with connect() as conn:
        for kind, (book, _, _) in TABLES.items():
            if conn.execute(f"SELECT 1 FROM {book} WHERE replace(ISBN, '-', '') = ?", (isbn,)).fetchone():
                found.append(kind)
    return found


def move_to_library(wished_id: int) -> int:
    """'Bought it': copy a wishlist book into the library and remove it from the wishlist."""
    data = get_book('wished', wished_id)
    new_id = save_book('owned', data)
    delete_book('wished', wished_id)
    return new_id


def lend(book_id: int, borrower: str, when: str | None = None) -> None:
    with connect() as conn:
        conn.execute('UPDATE BooksOwned SET LoanedTo = ?, LoanedDate = ? WHERE BookID = ?',
                     (borrower.strip(), when or date.today().isoformat(), book_id))


def return_book(book_id: int) -> None:
    with connect() as conn:
        conn.execute('UPDATE BooksOwned SET LoanedTo = NULL, LoanedDate = NULL WHERE BookID = ?', (book_id,))


# ---------- statistics ----------

def stat_years() -> list[int]:
    with connect() as conn:
        years = {int(r[0]) for r in conn.execute(
            "SELECT DISTINCT strftime('%Y', FinishedDate) FROM BooksOwned WHERE FinishedDate IS NOT NULL") if r[0]}
    return sorted(years | {date.today().year}, reverse=True)


def stats(year: int) -> dict:
    y = str(year)
    finished = "FinishedDate IS NOT NULL AND strftime('%Y', FinishedDate) = ?"
    with connect() as conn:
        one = lambda sql, *args: conn.execute(sql, args).fetchone()  # noqa: E731
        read = one(f'SELECT COUNT(*), COALESCE(SUM(PageCount), 0), AVG(PageCount), AVG(Rating) '
                   f'FROM BooksOwned WHERE {finished}', y)
        months = {r[0]: (r[1], r[2]) for r in conn.execute(
            f"SELECT CAST(strftime('%m', FinishedDate) AS INTEGER), COUNT(*), COALESCE(SUM(PageCount), 0) "
            f'FROM BooksOwned WHERE {finished} GROUP BY 1', (y,))}
        top = lambda sql, *args: [(r[0], r[1]) for r in conn.execute(sql, args)]  # noqa: E731
        return {
            'books': read[0], 'pages': read[1], 'avg_pages': read[2], 'avg_rating': read[3],
            'months': [(m, *months.get(m, (0, 0))) for m in range(1, 13)],
            'genres': top(f'''SELECT g.GenreName, COUNT(*) FROM BooksOwned b
                              JOIN BooksOwnedGenres USING (BookID) JOIN Genres g USING (GenreID)
                              WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8''', y),
            'authors': top(f'''SELECT a.AuthorName, COUNT(*) FROM BooksOwned b
                               JOIN BooksOwnedAuthors USING (BookID) JOIN Authors a USING (AuthorID)
                               WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5''', y),
            'reading': one("SELECT COUNT(*) FROM BooksOwned WHERE StartedDate IS NOT NULL AND FinishedDate IS NULL")[0],
            'owned': one('SELECT COUNT(*), COALESCE(SUM(PageCount), 0) FROM BooksOwned'),
            'unread': one('SELECT COUNT(*) FROM BooksOwned WHERE COALESCE(Read, 0) = 0')[0],
            'lent': one("SELECT COUNT(*) FROM BooksOwned WHERE LoanedTo IS NOT NULL AND LoanedTo <> ''")[0],
            'wished': one('SELECT COUNT(*) FROM BooksWished')[0],
            'signed': one('SELECT COUNT(*) FROM BooksOwned WHERE Signed = 1')[0],
            'sprayed': one('SELECT COUNT(*) FROM BooksOwned WHERE EdgeOut = 1')[0],
            'formats': top('''SELECT COALESCE(f.FormatName, 'Unknown'), COUNT(*) FROM BooksOwned b
                              LEFT JOIN Formats f ON f.FormatID = b.Format GROUP BY 1 ORDER BY 2 DESC'''),
        }
