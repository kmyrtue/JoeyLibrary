/* The bookshelf simulation's own database (room.db, next to library.db). The library's columns stay the truth for
   title, authors, pages and ISBN; these tables hold only what the room needs on top, as JSON text the room reads and
   writes. BookID is the library's BooksOwned.BookID; it is not a foreign key because the library is another file.
   Run on every start, so every statement must be safe to repeat. A room.db from before versions of the room existed is
   moved to these tables by roomdb.init_db. */

/* Named versions of the room: each has its own places of books, bookcases, zones and furniture, so a layout can be
   tried out and another one picked up again later. How books look and their photos are the same in all of them. */
CREATE TABLE IF NOT EXISTS SimUniverses (
    UniverseID INTEGER PRIMARY KEY,
    Name VARCHAR(60) NOT NULL UNIQUE COLLATE NOCASE,
    Created TEXT NOT NULL
);

/* The room's own settings, by key: 'universe' = the UniverseID the room opens in */
CREATE TABLE IF NOT EXISTS SimSettings (
    SettingKey VARCHAR(40) PRIMARY KEY,
    Value TEXT
);

/* How a book looks in the room: book type, size, spine colours, sprayed edges, ids of photos of its sides */
CREATE TABLE IF NOT EXISTS SimBooks (
    BookID INTEGER PRIMARY KEY,
    Data TEXT NOT NULL
);

/* Where a book stands in a version of the room: a shelf and a position on it, or the pose of a book lying loose */
CREATE TABLE IF NOT EXISTS SimPlaces (
    UniverseID INTEGER NOT NULL,
    BookID INTEGER NOT NULL,
    Data TEXT NOT NULL,
    PRIMARY KEY (UniverseID, BookID)
);

/* One row per bookcase (A, B, C, D) or piece of furniture in a version of the room: its name, where its movable
   shelves sit and the shelves' names; also 'labels' (how places are written), 'zones' and 'cats' */
CREATE TABLE IF NOT EXISTS SimCases (
    UniverseID INTEGER NOT NULL,
    CaseKey VARCHAR(24) NOT NULL,
    Data TEXT NOT NULL,
    PRIMARY KEY (UniverseID, CaseKey)
);

/* Where a bookcase or a piece of furniture has been moved to in a version of the room; no row = where it was built */
CREATE TABLE IF NOT EXISTS SimFurniture (
    UniverseID INTEGER NOT NULL,
    FurnitureKey VARCHAR(20) NOT NULL,
    Data TEXT NOT NULL,
    PRIMARY KEY (UniverseID, FurnitureKey)
);

/* Photos of the sides of books, straightened in the book workshop */
CREATE TABLE IF NOT EXISTS SimPhotos (
    PhotoID VARCHAR(40) PRIMARY KEY,
    ContentType VARCHAR(100) NOT NULL,
    Data BLOB NOT NULL
);
