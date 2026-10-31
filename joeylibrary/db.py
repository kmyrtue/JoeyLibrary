"""SQLite access for the library. Every function opens its own short-lived connection."""
import os
import re
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
    'digital': ('BooksDigital', 'BooksDigitalGenres', 'BooksDigitalAuthors', 'BooksDigitalTags'),
}
# shown to the user in front of the BookID, which is a plain number in the database: L0007, W0012, D0003
ID_PREFIX = {'owned': 'L', 'wished': 'W', 'digital': 'D'}
# the kinds with a reading history, and the ReadingHistory column that points at their book
READ_BY = {'owned': 'BookID', 'digital': 'DigitalID'}
HAS_FORMAT = ('owned', 'wished')  # a digital book's medium (ebook / audiobook) takes the place of a format
MEDIUMS = ('Ebook', 'Audiobook')  # of a digital book; a wished book can also be a 'Book'
SERIAL_DIGITS = 4


def serial(kind: str, book_id: int) -> str:
    return f'{ID_PREFIX[kind]}{book_id:0{SERIAL_DIGITS}d}'
# columns the forms edit directly (Format and SeriesName are IDs, handled separately)
COLUMNS = {
    'owned': ['Title', 'Edition', 'LoanedTo', 'LoanedDate', 'Rating', 'Spice', 'Kink', 'Comments', 'ShelfNumber',
              'NumberInSeries', 'Signed', 'EdgeOut', 'Read', 'PageCount', 'ISBN'],
    'wished': ['Title', 'Edition', 'NumberInSeries', 'Signed', 'Spice', 'Kink', 'ISBN', 'Medium'],
    'digital': ['Title', 'Medium', 'Edition', 'Narrator', 'Length', 'Source', 'Rating', 'Spice', 'Kink', 'Comments',
                'NumberInSeries', 'Read', 'PageCount', 'ISBN', 'Archived'],
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
    # a title compared the way people read it: case (also æøå) and runs of spaces don't matter
    conn.create_function('fold', 1, lambda s: ' '.join(s.split()).casefold() if s else '', deterministic=True)
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


def _schema_table(name: str) -> str:
    """The CREATE TABLE statement for one table in the schema file."""
    return re.search(rf'CREATE TABLE {name} \(.*?\n\);', SCHEMA_FILE.read_text(encoding='utf-8'), re.S).group(0)


def upgrade() -> None:
    """Bring a database made by an older version of the app up to date."""
    with connect() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS Tags (TagID INTEGER PRIMARY KEY, TagName VARCHAR(100) NOT NULL UNIQUE)')
        # the digital list (ebooks and audiobooks) came later
        for table in ('BooksDigital', 'BooksDigitalGenres', 'BooksDigitalAuthors', 'BooksDigitalTags'):
            conn.execute(_schema_table(table).replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS', 1))
        if 'Medium' not in {r['name'] for r in conn.execute('PRAGMA table_info(BooksWished)')}:
            conn.execute("ALTER TABLE BooksWished ADD COLUMN Medium VARCHAR(20) NOT NULL DEFAULT 'Book' "
                         "CHECK (Medium IN ('Book', 'Ebook', 'Audiobook'))")
        for book in KINDS.values():
            conn.execute(f'''CREATE TABLE IF NOT EXISTS {book}Tags (
                BookID INTEGER, TagID INTEGER, PRIMARY KEY (BookID, TagID),
                FOREIGN KEY (BookID) REFERENCES {book}(BookID) ON DELETE CASCADE,
                FOREIGN KEY (TagID) REFERENCES Tags(TagID) ON DELETE CASCADE)''')
            columns = {r['name'] for r in conn.execute(f'PRAGMA table_info({book})')}
            for rating in ('Spice', 'Kink'):
                if rating not in columns:
                    conn.execute(f'ALTER TABLE {book} ADD COLUMN {rating} INTEGER CHECK ({rating} >= 0 AND {rating} <= 5)')
        conn.execute(_schema_table('ReadingHistory').replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS', 1))
        # readings of digital books: the table is rebuilt with a DigitalID column and BookID no longer required
        if 'DigitalID' not in {r['name'] for r in conn.execute('PRAGMA table_info(ReadingHistory)')}:
            conn.execute(_schema_table('ReadingHistory').replace('ReadingHistory', 'ReadingHistoryNew', 1))
            conn.execute('INSERT INTO ReadingHistoryNew (ReadingID, BookID, StartedDate, FinishedDate) '
                         'SELECT ReadingID, BookID, StartedDate, FinishedDate FROM ReadingHistory')
            conn.execute('DROP TABLE ReadingHistory')
            conn.execute('ALTER TABLE ReadingHistoryNew RENAME TO ReadingHistory')
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
KINDS = {kind: tables[0] for kind, tables in TABLES.items()}
REF_COLUMNS = {'Formats': 'Format', 'Series': 'SeriesName'}  # lookups referenced by a column on the book
# Authors, Genres and Tags are referenced through link tables named Books<Owned|Wished|Digital><Authors|Genres|Tags>


def _kinds_with(table: str) -> dict:
    """The book tables that can use an index entry (digital books have no format)."""
    return {k: b for k, b in KINDS.items() if table != 'Formats' or k in HAS_FORMAT}


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
    """Every entry with how many library, wishlist and digital books use it."""
    with connect() as conn:
        if table == 'Edition':
            sql = '''SELECT Edition AS ID, Edition AS Name, SUM(k = 'owned') AS Owned, SUM(k = 'wished') AS Wished,
                            SUM(k = 'digital') AS Digital
                     FROM (SELECT Edition, 'owned' AS k FROM BooksOwned UNION ALL SELECT Edition, 'wished' FROM BooksWished
                           UNION ALL SELECT Edition, 'digital' FROM BooksDigital)
                     WHERE Edition IS NOT NULL AND Edition <> '' GROUP BY Edition ORDER BY Edition COLLATE NOCASE'''
        else:
            id_col, name_col = LOOKUPS[table]
            counts = {kind: '0' for kind in KINDS}
            for kind, book in _kinds_with(table).items():
                if table in REF_COLUMNS:
                    counts[kind] = f'(SELECT COUNT(*) FROM {book} x WHERE x.{REF_COLUMNS[table]} = t.{id_col})'
                else:
                    counts[kind] = f'(SELECT COUNT(*) FROM {book}{table} x WHERE x.{id_col} = t.{id_col})'
            sql = (f"SELECT t.{id_col} AS ID, t.{name_col} AS Name, {counts['owned']} AS Owned, "
                   f"{counts['wished']} AS Wished, {counts['digital']} AS Digital "
                   f'FROM {table} t ORDER BY t.{name_col} COLLATE NOCASE')
        return [dict(r) for r in conn.execute(sql)]


def books_using(table: str, item_id) -> list[tuple[str, int, str]]:
    """(kind, BookID, title) of every book that uses an index entry."""
    with connect() as conn:
        return [(kind, r[0], r[1]) for kind in _kinds_with(table)
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
        for book in _kinds_with(table).values():
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
            for book in _kinds_with(table).values():
                conn.execute(f'UPDATE {book} SET {REF_COLUMNS[table]} = NULL WHERE {REF_COLUMNS[table]} = ?', (item_id,))
        conn.execute(f'DELETE FROM {table} WHERE {id_col} = ?', (item_id,))  # link rows go by ON DELETE CASCADE


def sources() -> list[str]:
    """Where the digital books live (Kindle, Audible, ...), for the SOURCE field's list."""
    with connect() as conn:
        return [r[0] for r in conn.execute(
            "SELECT DISTINCT Source FROM BooksDigital WHERE Source IS NOT NULL AND Source <> '' ORDER BY 1 COLLATE NOCASE")]


def borrowers() -> list[str]:
    with connect() as conn:
        return [r[0] for r in conn.execute(
            "SELECT DISTINCT LoanedTo FROM BooksOwned WHERE LoanedTo IS NOT NULL AND LoanedTo <> '' ORDER BY 1")]


# ---------- books ----------

# the newest reading of a library or digital book, and how many readings were finished (col: see READ_BY)
LATEST_READING = '''
               (SELECT StartedDate FROM ReadingHistory r WHERE r.{col} = b.BookID ORDER BY ReadingID DESC LIMIT 1)
                   AS StartedDate,
               (SELECT FinishedDate FROM ReadingHistory r WHERE r.{col} = b.BookID ORDER BY ReadingID DESC LIMIT 1)
                   AS FinishedDate,
               (SELECT COUNT(*) FROM ReadingHistory r WHERE r.{col} = b.BookID AND r.FinishedDate IS NOT NULL)
                   AS TimesRead,'''


def _select_books(kind: str, where: str = '') -> str:
    book, genre_link, author_link, tag_link = TABLES[kind]
    # authors are listed in the order they were linked, so the main author comes first
    return f'''
        SELECT b.*, {'f.FormatName' if kind in HAS_FORMAT else 'NULL AS FormatName'}, s.SeriesName AS SeriesTitle,{
               LATEST_READING.format(col=READ_BY[kind]) if kind in READ_BY else ''}
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
        {'LEFT JOIN Formats f ON f.FormatID = b.Format' if kind in HAS_FORMAT else ''}
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
        if kind in READ_BY:
            row['Readings'] = [dict(r) for r in conn.execute(
                f'SELECT ReadingID, StartedDate, FinishedDate FROM ReadingHistory WHERE {READ_BY[kind]} = ? '
                f'ORDER BY ReadingID', (book_id,))]
    return row


def _free_id(conn, table: str) -> int:
    """The lowest BookID not in use: a deleted book's number goes to the next new book, so there are no gaps."""
    return conn.execute(f'''SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM {table} WHERE BookID = 1) THEN 1
                            ELSE (SELECT MIN(b.BookID) + 1 FROM {table} b
                                  WHERE NOT EXISTS (SELECT 1 FROM {table} n WHERE n.BookID = b.BookID + 1)) END''').fetchone()[0]


def save_book(kind: str, data: dict, book_id: int | None = None) -> int:
    """Insert or update a book. data holds COLUMNS[kind] plus FormatName, SeriesTitle, AuthorList, GenreList, TagList,
    and for library and digital books Readings: the whole reading history, oldest first."""
    book, genre_link, author_link, tag_link = TABLES[kind]
    with connect() as conn:
        values = {c: data.get(c) for c in COLUMNS[kind]}
        if kind in HAS_FORMAT:
            values['Format'] = _id_for(conn, 'Formats', data.get('FormatName'))
        if kind == 'wished':
            values['Medium'] = values['Medium'] or 'Book'
        if kind == 'digital':
            values['Archived'] = int(bool(values['Archived']))
        values['SeriesName'] = _id_for(conn, 'Series', data.get('SeriesTitle'))
        cols = list(values)
        if book_id is None:
            book_id = _free_id(conn, book)
            conn.execute(
                f'INSERT INTO {book} (BookID, {", ".join(cols)}) VALUES (?, {", ".join("?" * len(cols))})',
                [book_id] + [values[c] for c in cols])
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
        if kind in READ_BY and 'Readings' in data:
            col = READ_BY[kind]
            conn.execute(f'DELETE FROM ReadingHistory WHERE {col} = ?', (book_id,))
            for r in data['Readings']:
                if r.get('StartedDate') or r.get('FinishedDate'):
                    conn.execute(f'INSERT INTO ReadingHistory ({col}, StartedDate, FinishedDate) VALUES (?, ?, ?)',
                                 (book_id, r.get('StartedDate'), r.get('FinishedDate')))
    return book_id


def delete_book(kind: str, book_id: int) -> None:
    with connect() as conn:
        conn.execute(f'DELETE FROM {TABLES[kind][0]} WHERE BookID = ?', (book_id,))


def find_isbn(isbn: str) -> list[str]:
    """Return the lists a book with this ISBN is already on: 'owned', 'wished', 'digital'."""
    found = []
    with connect() as conn:
        for kind, (book, *_) in TABLES.items():
            if conn.execute(f"SELECT 1 FROM {book} WHERE replace(ISBN, '-', '') = ?", (isbn,)).fetchone():
                found.append(kind)
    return found


def move_from_wishlist(wished_id: int) -> tuple[str, int]:
    """'Got it': copy a wishlist book into the library, or for an ebook or audiobook into the digital list, and
    remove it from the wishlist. Returns the kind and BookID it got."""
    data = get_book('wished', wished_id)
    kind = 'digital' if data.get('Medium') in MEDIUMS else 'owned'
    if kind == 'digital':
        data['Archived'] = 0
    new_id = save_book(kind, data)
    delete_book('wished', wished_id)
    return kind, new_id


def set_archived(book_id: int, archived: bool) -> None:
    """Archive a digital book (a library loan that is done) or bring it back; it keeps its readings either way."""
    with connect() as conn:
        conn.execute('UPDATE BooksDigital SET Archived = ? WHERE BookID = ?', (int(archived), book_id))


def lend(book_id: int, borrower: str, when: str | None = None) -> None:
    with connect() as conn:
        conn.execute('UPDATE BooksOwned SET LoanedTo = ?, LoanedDate = ? WHERE BookID = ?',
                     (borrower.strip(), when or date.today().isoformat(), book_id))


def return_book(book_id: int) -> None:
    with connect() as conn:
        conn.execute('UPDATE BooksOwned SET LoanedTo = NULL, LoanedDate = NULL WHERE BookID = ?', (book_id,))


# ---------- reading history ----------

def list_readings() -> list[dict]:
    """Every reading of every library and digital book, newest first, with the book's kind, title and authors."""
    with connect() as conn:
        return [dict(r) for r in conn.execute(f'''{ITEMS}
            SELECT r.ReadingID, i.Kind, i.ID AS BookID, r.StartedDate, r.FinishedDate, i.Title, i.Medium,
                   (SELECT group_concat(AuthorName, ', ') FROM (
                        SELECT a.AuthorName FROM item_authors ia JOIN Authors a USING (AuthorID)
                        WHERE ia.Kind = i.Kind AND ia.ID = i.ID ORDER BY ia.Pos)) AS Authors,
                   (SELECT COUNT(*) FROM ReadingHistory x WHERE x.BookID IS r.BookID AND x.DigitalID IS r.DigitalID
                        AND x.ReadingID <= r.ReadingID) AS ReadingNo
            FROM ReadingHistory r JOIN items i ON {READING_ITEM}
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


# The library and the digital list as one set of items for the reading history and the statistics: Kind is 'owned'
# or 'digital', ID the BookID in that list; their authors and genres likewise (Pos keeps the main author first).
ITEMS = '''WITH items AS (
        SELECT 'owned' AS Kind, BookID AS ID, Title, PageCount, Rating, Read, NULL AS Medium, NULL AS Length,
               0 AS Archived FROM BooksOwned
        UNION ALL SELECT 'digital', BookID, Title, PageCount, Rating, Read, Medium, Length, Archived FROM BooksDigital),
    item_authors AS (
        SELECT 'owned' AS Kind, BookID AS ID, AuthorID, rowid AS Pos FROM BooksOwnedAuthors
        UNION ALL SELECT 'digital', BookID, AuthorID, rowid FROM BooksDigitalAuthors),
    item_genres AS (
        SELECT 'owned' AS Kind, BookID AS ID, GenreID FROM BooksOwnedGenres
        UNION ALL SELECT 'digital', BookID, GenreID FROM BooksDigitalGenres)'''
READING_ITEM = "i.Kind = CASE WHEN r.BookID IS NULL THEN 'digital' ELSE 'owned' END AND i.ID = COALESCE(r.BookID, r.DigitalID)"
# Each book keeps its own reading log, but the statistics count books by title and authors: a fancy edition read after
# the paperback, or the audiobook after the ebook, is a re-read of the same book. Work is the folded title plus the
# sorted author ids. reads is every reading with its item and work.
WORKS = ITEMS + f''',
    works AS (
        SELECT i.*, fold(i.Title) || char(31) || COALESCE((SELECT group_concat(AuthorID, ',') FROM (
            SELECT AuthorID FROM item_authors x WHERE x.Kind = i.Kind AND x.ID = i.ID ORDER BY AuthorID)), '') AS Work
        FROM items i),
    reads AS (
        SELECT r.ReadingID, r.StartedDate, r.FinishedDate, i.* FROM ReadingHistory r JOIN works i ON {READING_ITEM}) '''


def stats(year: int) -> dict:
    """Reading statistics for one year, library and digital books together. Every finished reading counts, so a book
    read twice counts twice; different titles, re-reads and unread books go by title and authors (see WORKS)."""
    y = str(year)
    finished = "r.FinishedDate IS NOT NULL AND strftime('%Y', r.FinishedDate) = ?"
    with connect() as conn:
        one = lambda sql, *args: conn.execute(WORKS + sql, args).fetchone()  # noqa: E731
        top = lambda sql, *args: [(r[0], r[1]) for r in conn.execute(WORKS + sql, args)]  # noqa: E731
        read = one(f'''SELECT COUNT(*), COALESCE(SUM(PageCount), 0), AVG(PageCount), COUNT(DISTINCT Work),
                          SUM(Medium = 'Ebook'), SUM(Medium = 'Audiobook'),
                          COALESCE(SUM(CASE WHEN Medium = 'Audiobook' THEN Length END), 0)
                   FROM reads r WHERE {finished}''', y)
        months = {r[0]: (r[1], r[2]) for r in conn.execute(
            f"{WORKS}SELECT CAST(strftime('%m', r.FinishedDate) AS INTEGER), COUNT(*), COALESCE(SUM(PageCount), 0) "
            f'FROM reads r WHERE {finished} GROUP BY 1', (y,))}
        return {
            'books': read[0], 'pages': read[1], 'avg_pages': read[2], 'titles': read[3],
            'ebooks': read[4] or 0, 'audiobooks': read[5] or 0, 'minutes_listened': read[6],
            'avg_rating': one(f'''SELECT AVG(Rating) FROM items WHERE (Kind, ID) IN (
                                  SELECT Kind, ID FROM reads r WHERE {finished})''', y)[0],
            # finished readings of a book that had been finished before, in this edition, another or another medium
            'rereads': one(f'''SELECT COUNT(*) FROM reads r WHERE {finished} AND EXISTS (
                                SELECT 1 FROM reads p WHERE p.Work = r.Work AND p.FinishedDate IS NOT NULL
                                AND (p.FinishedDate < r.FinishedDate
                                     OR (p.FinishedDate = r.FinishedDate AND p.ReadingID < r.ReadingID)))''', y)[0],
            'months': [(m, *months.get(m, (0, 0))) for m in range(1, 13)],
            'genres': top(f'''SELECT g.GenreName, COUNT(*) FROM reads r JOIN item_genres ig USING (Kind, ID)
                              JOIN Genres g USING (GenreID) WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8''', y),
            'authors': top(f'''SELECT a.AuthorName, COUNT(*) FROM reads r JOIN item_authors ia USING (Kind, ID)
                               JOIN Authors a USING (AuthorID) WHERE {finished} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5''', y),
            # books whose newest reading has started but not finished
            'reading': one('''SELECT COUNT(*) FROM reads r WHERE r.StartedDate IS NOT NULL AND r.FinishedDate IS NULL
                              AND r.ReadingID = (SELECT MAX(ReadingID) FROM reads x WHERE x.Kind = r.Kind AND x.ID = r.ID)''')[0],
            'total_readings': one('SELECT COUNT(*) FROM ReadingHistory WHERE FinishedDate IS NOT NULL')[0],
            # named as the book was at its first reading (the bare Title comes from the row MIN picks)
            'most_reread': top('''SELECT Title, COUNT(*), MIN(ReadingID) FROM reads WHERE FinishedDate IS NOT NULL
                                  GROUP BY Work HAVING COUNT(*) > 1 ORDER BY 2 DESC, 1 COLLATE NOCASE LIMIT 5'''),
            'owned': one('SELECT COUNT(*), COALESCE(SUM(PageCount), 0) FROM BooksOwned'),
            # books on the shelf or in the digital list (not archived) of which no edition has been read
            'unread': one('''SELECT COUNT(DISTINCT w.Work) FROM works w WHERE w.Archived = 0 AND NOT EXISTS (
                             SELECT 1 FROM works o WHERE o.Work = w.Work AND (COALESCE(o.Read, 0) <> 0
                                 OR EXISTS (SELECT 1 FROM reads r WHERE r.Kind = o.Kind AND r.ID = o.ID
                                            AND r.FinishedDate IS NOT NULL)))''')[0],
            'digital': tuple(one('''SELECT COALESCE(SUM(Medium = 'Ebook' AND Archived = 0), 0),
                                    COALESCE(SUM(Medium = 'Audiobook' AND Archived = 0), 0), COALESCE(SUM(Archived), 0)
                                    FROM BooksDigital''')),
            'on_loan': one("SELECT COUNT(*) FROM BooksOwned WHERE LoanedTo IS NOT NULL AND LoanedTo <> ''")[0],
            'wished': one('SELECT COUNT(*) FROM BooksWished')[0],
            'signed': one('SELECT COUNT(*) FROM BooksOwned WHERE Signed = 1')[0],
            'sprayed': one('SELECT COUNT(*) FROM BooksOwned WHERE EdgeOut = 1')[0],
            'formats': top('''SELECT COALESCE(f.FormatName, 'Unknown'), COUNT(*) FROM BooksOwned b
                              LEFT JOIN Formats f ON f.FormatID = b.Format GROUP BY 1 ORDER BY 2 DESC'''),
        }


# ---------- the bookshelf simulation ----------
# The room shows the library books (not the wishlist). Title, authors, pages and ISBN are the library's own and are
# read and changed here; everything else the room keeps is in its own database (roomdb.py).

def sim_books() -> list[dict]:
    """Every library book with what the room needs: authors and format."""
    with connect() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT b.BookID, b.Title, b.PageCount, b.ISBN, b.EdgeOut, b.LoanedTo, f.FormatName,
                   (SELECT group_concat(AuthorName, ', ') FROM (
                        SELECT a.AuthorName FROM BooksOwnedAuthors ba JOIN Authors a USING (AuthorID)
                        WHERE ba.BookID = b.BookID ORDER BY ba.rowid)) AS Authors
            FROM BooksOwned b
            LEFT JOIN Formats f ON f.FormatID = b.Format
            ORDER BY b.Title COLLATE NOCASE''')]


def owned_exists(book_id: int) -> bool:
    with connect() as conn:
        return conn.execute('SELECT 1 FROM BooksOwned WHERE BookID = ?', (book_id,)).fetchone() is not None


def sim_update_book(book_id: int, title: str, authors: list[str], pages: int | None, isbn: str | None,
                    sprayed: bool, format_name: str | None) -> None:
    """Save the library's part of a book changed in the room's workshop. The authors are only relinked when they
    changed, so the order and spelling the library has stay; a format is only filled in when the book has none."""
    with connect() as conn:
        conn.execute('''UPDATE BooksOwned SET Title = ?, PageCount = ?, ISBN = ?, EdgeOut = ?,
                        Format = COALESCE(Format, ?) WHERE BookID = ?''',
                     (title, pages, isbn, int(sprayed), _id_for(conn, 'Formats', format_name), book_id))
        now = [r[0] for r in conn.execute('''SELECT a.AuthorName FROM BooksOwnedAuthors ba JOIN Authors a USING (AuthorID)
                                            WHERE ba.BookID = ? ORDER BY ba.rowid''', (book_id,))]
        if authors and authors != now:
            conn.execute('DELETE FROM BooksOwnedAuthors WHERE BookID = ?', (book_id,))
            for name in dict.fromkeys(authors):
                conn.execute('INSERT OR IGNORE INTO BooksOwnedAuthors VALUES (?, ?)', (book_id, _id_for(conn, 'Authors', name)))
