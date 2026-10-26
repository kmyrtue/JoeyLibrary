"""SQLite access for the library. Every function opens its own short-lived connection."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path

SCHEMA_FILE = Path(__file__).resolve().parent.parent / 'Library.sqlite.sql'
DATA_DIR = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local' / 'share')) / 'joey-library'
DB_PATH = Path(os.environ.get('JOEY_LIBRARY_DB', DATA_DIR / 'library.db'))


# per book kind: main table, genre link table, author link table, tag link table
TABLES = {
    'owned': ('BooksOwned', 'BooksOwnedGenres', 'BooksOwnedAuthors', 'BooksOwnedTags'),
    'wished': ('BooksWished', 'BooksWishedGenres', 'BooksWishedAuthors', 'BooksWishedTags'),
}
# shown to the user in front of the BookID, which is a plain number in the database: L0007, W0012
ID_PREFIX = {'owned': 'L', 'wished': 'W'}
SERIAL_DIGITS = 4


def serial(kind: str, book_id: int) -> str:
    return f'{ID_PREFIX[kind]}{book_id:0{SERIAL_DIGITS}d}'
# columns the forms edit directly (Format and SeriesName are IDs, handled separately)
COLUMNS = {
    'owned': ['Title', 'Edition', 'LoanedTo', 'LoanedDate', 'Rating', 'Spice', 'Kink', 'Comments', 'ShelfNumber',
              'NumberInSeries', 'Signed', 'EdgeOut', 'Read', 'PageCount', 'ISBN'],
    'wished': ['Title', 'Edition', 'NumberInSeries', 'Signed', 'Spice', 'Kink', 'ISBN'],
}
LOOKUPS = {  # table -> (id column, name column)
    'Authors': ('AuthorID', 'AuthorName'),
    'Genres': ('GenreID', 'GenreName'),
    'Tags': ('TagID', 'TagName'),
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
    """Create the database from the schema file the first time the app runs; bring an older one up to date."""
    if not DB_PATH.exists():
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with connect() as conn:
            conn.executescript(SCHEMA_FILE.read_text(encoding='utf-8'))
        return
    upgrade()


def upgrade() -> None:
    """Bring a database made by an older version of the app up to date."""
    with connect() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS Tags (TagID INTEGER PRIMARY KEY, TagName VARCHAR(100) NOT NULL UNIQUE)')
        for book in KINDS.values():
            conn.execute(f'''CREATE TABLE IF NOT EXISTS {book}Tags (
                BookID INTEGER, TagID INTEGER, PRIMARY KEY (BookID, TagID),
                FOREIGN KEY (BookID) REFERENCES {book}(BookID) ON DELETE CASCADE,
                FOREIGN KEY (TagID) REFERENCES Tags(TagID) ON DELETE CASCADE)''')
            columns = {r['name'] for r in conn.execute(f'PRAGMA table_info({book})')}
            for rating in ('Spice', 'Kink'):
                if rating not in columns:
                    conn.execute(f'ALTER TABLE {book} ADD COLUMN {rating} INTEGER CHECK ({rating} >= 0 AND {rating} <= 5)')
        conn.execute('''CREATE TABLE IF NOT EXISTS ReadingHistory (
            ReadingID INTEGER PRIMARY KEY,
            BookID INTEGER NOT NULL REFERENCES BooksOwned(BookID) ON DELETE CASCADE,
            StartedDate TEXT, FinishedDate TEXT)''')
        # the started/finished dates used to be columns on the book; they are dropped, not carried over
        columns = {r['name'] for r in conn.execute('PRAGMA table_info(BooksOwned)')}
        if 'StartedDate' in columns:
            conn.execute('ALTER TABLE BooksOwned DROP COLUMN StartedDate')
            conn.execute('ALTER TABLE BooksOwned DROP COLUMN FinishedDate')


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
# Authors, Genres and Tags are referenced through link tables named Books<Owned|Wished><Authors|Genres|Tags>


def _usage(table: str, kind: str) -> str:
    """SQL that finds the IDs and titles of the books of one kind that use an index entry."""
    book = KINDS[kind]
    if table == 'Edition':
        return f'SELECT BookID, Title FROM {book} WHERE Edition = ?'
    if table in REF_COLUMNS:
        return f'SELECT BookID, Title FROM {book} WHERE {REF_COLUMNS[table]} = ?'
    id_col = LOOKUPS[table][0]
    return f'SELECT b.BookID, b.Title FROM {book}{table} x JOIN {book} b USING (BookID) WHERE x.{id_col} = ?'


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


def books_using(table: str, item_id) -> list[tuple[str, int, str]]:
    """(kind, BookID, title) of every book that uses an index entry."""
    with connect() as conn:
        return [(kind, r[0], r[1]) for kind in KINDS
                for r in conn.execute(_usage(table, kind) + ' ORDER BY 2 COLLATE NOCASE', (item_id,))]


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

# the newest reading of a library book, and how many readings were finished
LATEST_READING = '''
               (SELECT StartedDate FROM ReadingHistory r WHERE r.BookID = b.BookID ORDER BY ReadingID DESC LIMIT 1)
                   AS StartedDate,
               (SELECT FinishedDate FROM ReadingHistory r WHERE r.BookID = b.BookID ORDER BY ReadingID DESC LIMIT 1)
                   AS FinishedDate,
               (SELECT COUNT(*) FROM ReadingHistory r WHERE r.BookID = b.BookID AND r.FinishedDate IS NOT NULL)
                   AS TimesRead,'''


def _select_books(kind: str, where: str = '') -> str:
    book, genre_link, author_link, tag_link = TABLES[kind]
    # authors are listed in the order they were linked, so the main author comes first
    return f'''
        SELECT b.*, f.FormatName, s.SeriesName AS SeriesTitle,{LATEST_READING if kind == 'owned' else ''}
               (SELECT group_concat(AuthorName, ', ') FROM (
                    SELECT a.AuthorName FROM {author_link} ba JOIN Authors a USING (AuthorID)
                    WHERE ba.BookID = b.BookID ORDER BY ba.rowid)) AS Authors,
               (SELECT group_concat(GenreName, ', ') FROM (
                    SELECT g.GenreName FROM {genre_link} bg JOIN Genres g USING (GenreID)
                    WHERE bg.BookID = b.BookID ORDER BY g.GenreName)) AS Genres,
               (SELECT group_concat(TagName, ', ') FROM (
                    SELECT t.TagName FROM {tag_link} bt JOIN Tags t USING (TagID)
                    WHERE bt.BookID = b.BookID ORDER BY t.TagName)) AS Tags
        FROM {book} b
        LEFT JOIN Formats f ON f.FormatID = b.Format
        LEFT JOIN Series s ON s.SeriesID = b.SeriesName
        {where}
        ORDER BY b.Title COLLATE NOCASE'''


def list_books(kind: str) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(_select_books(kind))]


def get_book(kind: str, book_id: int) -> dict:
    _, genre_link, author_link, tag_link = TABLES[kind]
    with connect() as conn:
        row = dict(conn.execute(_select_books(kind, 'WHERE b.BookID = ?'), (book_id,)).fetchone())
        row['AuthorList'] = [r[0] for r in conn.execute(
            f'SELECT a.AuthorName FROM {author_link} ba JOIN Authors a USING (AuthorID) '
            f'WHERE ba.BookID = ? ORDER BY ba.rowid', (book_id,))]
        row['GenreList'] = [r[0] for r in conn.execute(
            f'SELECT g.GenreName FROM {genre_link} bg JOIN Genres g USING (GenreID) '
            f'WHERE bg.BookID = ? ORDER BY g.GenreName', (book_id,))]
        row['TagList'] = [r[0] for r in conn.execute(
            f'SELECT t.TagName FROM {tag_link} bt JOIN Tags t USING (TagID) '
            f'WHERE bt.BookID = ? ORDER BY t.TagName', (book_id,))]
        if kind == 'owned':
            row['Readings'] = [dict(r) for r in conn.execute(
                'SELECT ReadingID, StartedDate, FinishedDate FROM ReadingHistory WHERE BookID = ? ORDER BY ReadingID',
                (book_id,))]
    return row


def save_book(kind: str, data: dict, book_id: int | None = None) -> int:
    """Insert or update a book. data holds COLUMNS[kind] plus FormatName, SeriesTitle, AuthorList, GenreList, TagList,
    and for library books Readings: the whole reading history, oldest first."""
    book, genre_link, author_link, tag_link = TABLES[kind]
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
        conn.execute(f'DELETE FROM {tag_link} WHERE BookID = ?', (book_id,))
        for name in dict.fromkeys(data.get('TagList') or []):
            conn.execute(f'INSERT OR IGNORE INTO {tag_link} VALUES (?, ?)', (book_id, _id_for(conn, 'Tags', name)))
        if kind == 'owned' and 'Readings' in data:
            conn.execute('DELETE FROM ReadingHistory WHERE BookID = ?', (book_id,))
            for r in data['Readings']:
                if r.get('StartedDate') or r.get('FinishedDate'):
                    conn.execute('INSERT INTO ReadingHistory (BookID, StartedDate, FinishedDate) VALUES (?, ?, ?)',
                                 (book_id, r.get('StartedDate'), r.get('FinishedDate')))
    return book_id


def delete_book(kind: str, book_id: int) -> None:
    with connect() as conn:
        conn.execute(f'DELETE FROM {TABLES[kind][0]} WHERE BookID = ?', (book_id,))


def find_isbn(isbn: str) -> list[str]:
    """Return where a book with this ISBN already is: 'owned', 'wished', both or neither."""
    found = []
    with connect() as conn:
        for kind, (book, *_) in TABLES.items():
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


# ---------- reading history ----------

def list_readings() -> list[dict]:
    """Every reading of every library book, newest first, with the book's title and authors."""
    with connect() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT r.ReadingID, r.BookID, r.StartedDate, r.FinishedDate, b.Title,
                   (SELECT group_concat(AuthorName, ', ') FROM (
                        SELECT a.AuthorName FROM BooksOwnedAuthors ba JOIN Authors a USING (AuthorID)
                        WHERE ba.BookID = b.BookID ORDER BY ba.rowid)) AS Authors,
                   (SELECT COUNT(*) FROM ReadingHistory x WHERE x.BookID = r.BookID AND x.ReadingID <= r.ReadingID)
                       AS ReadingNo
            FROM ReadingHistory r JOIN BooksOwned b USING (BookID)
            ORDER BY COALESCE(r.FinishedDate, r.StartedDate, '9999') DESC, r.ReadingID DESC''')]


def update_reading(reading_id: int, started: str | None, finished: str | None) -> None:
    with connect() as conn:
        conn.execute('UPDATE ReadingHistory SET StartedDate = ?, FinishedDate = ? WHERE ReadingID = ?',
                     (started or None, finished or None, reading_id))


def delete_reading(reading_id: int) -> None:
    with connect() as conn:
        conn.execute('DELETE FROM ReadingHistory WHERE ReadingID = ?', (reading_id,))


# ---------- statistics ----------

def stat_years() -> list[int]:
    with connect() as conn:
        years = {int(r[0]) for r in conn.execute(
            "SELECT DISTINCT strftime('%Y', FinishedDate) FROM ReadingHistory WHERE FinishedDate IS NOT NULL") if r[0]}
    return sorted(years | {date.today().year}, reverse=True)


def stats(year: int) -> dict:
    """Reading statistics for one year. Every finished reading counts, so a book read twice counts twice."""
    y = str(year)
    finished = "r.FinishedDate IS NOT NULL AND strftime('%Y', r.FinishedDate) = ?"
    readings = 'ReadingHistory r JOIN BooksOwned b USING (BookID)'
    with connect() as conn:
        one = lambda sql, *args: conn.execute(sql, args).fetchone()  # noqa: E731
        read = one(f'SELECT COUNT(*), COALESCE(SUM(b.PageCount), 0), AVG(b.PageCount), COUNT(DISTINCT b.BookID) '
                   f'FROM {readings} WHERE {finished}', y)
        months = {r[0]: (r[1], r[2]) for r in conn.execute(
            f"SELECT CAST(strftime('%m', r.FinishedDate) AS INTEGER), COUNT(*), COALESCE(SUM(b.PageCount), 0) "
            f'FROM {readings} WHERE {finished} GROUP BY 1', (y,))}
        top = lambda sql, *args: [(r[0], r[1]) for r in conn.execute(sql, args)]  # noqa: E731
        return {
            'books': read[0], 'pages': read[1], 'avg_pages': read[2], 'titles': read[3],
            'avg_rating': one(f'SELECT AVG(Rating) FROM BooksOwned WHERE BookID IN '
                              f'(SELECT BookID FROM ReadingHistory r WHERE {finished})', y)[0],
            # finished readings of a book that had been finished before
            'rereads': one(f'''SELECT COUNT(*) FROM ReadingHistory r WHERE {finished} AND EXISTS (
                                SELECT 1 FROM ReadingHistory p WHERE p.BookID = r.BookID AND p.ReadingID < r.ReadingID
                                AND p.FinishedDate IS NOT NULL)''', y)[0],
            'months': [(m, *months.get(m, (0, 0))) for m in range(1, 13)],
            'genres': top(f'''SELECT g.GenreName, COUNT(*) FROM ReadingHistory r
                              JOIN BooksOwnedGenres USING (BookID) JOIN Genres g USING (GenreID)
                              WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8''', y),
            'authors': top(f'''SELECT a.AuthorName, COUNT(*) FROM ReadingHistory r
                               JOIN BooksOwnedAuthors USING (BookID) JOIN Authors a USING (AuthorID)
                               WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5''', y),
            # books whose newest reading has started but not finished
            'reading': one('''SELECT COUNT(*) FROM ReadingHistory r WHERE r.StartedDate IS NOT NULL
                              AND r.FinishedDate IS NULL AND r.ReadingID =
                                  (SELECT MAX(ReadingID) FROM ReadingHistory x WHERE x.BookID = r.BookID)''')[0],
            'total_readings': one('SELECT COUNT(*) FROM ReadingHistory WHERE FinishedDate IS NOT NULL')[0],
            'most_reread': top('''SELECT b.Title, COUNT(*) FROM ReadingHistory r JOIN BooksOwned b USING (BookID)
                                  WHERE r.FinishedDate IS NOT NULL GROUP BY b.BookID HAVING COUNT(*) > 1
                                  ORDER BY 2 DESC, 1 COLLATE NOCASE LIMIT 5'''),
            'owned': one('SELECT COUNT(*), COALESCE(SUM(PageCount), 0) FROM BooksOwned'),
            'unread': one('''SELECT COUNT(*) FROM BooksOwned b WHERE COALESCE(Read, 0) = 0 AND NOT EXISTS (
                             SELECT 1 FROM ReadingHistory r WHERE r.BookID = b.BookID AND r.FinishedDate IS NOT NULL)''')[0],
            'on_loan': one("SELECT COUNT(*) FROM BooksOwned WHERE LoanedTo IS NOT NULL AND LoanedTo <> ''")[0],
            'wished': one('SELECT COUNT(*) FROM BooksWished')[0],
            'signed': one('SELECT COUNT(*) FROM BooksOwned WHERE Signed = 1')[0],
            'sprayed': one('SELECT COUNT(*) FROM BooksOwned WHERE EdgeOut = 1')[0],
            'formats': top('''SELECT COALESCE(f.FormatName, 'Unknown'), COUNT(*) FROM BooksOwned b
                              LEFT JOIN Formats f ON f.FormatID = b.Format GROUP BY 1 ORDER BY 2 DESC'''),
        }
